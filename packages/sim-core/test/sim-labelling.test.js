// P9: labelling in the simulator with the echo app's stack. Models are stubbed (YAMNet is MediaPipe/WASM, browser only),
// so these tests check the wiring, the association, the scoring and the export rules, not classifier accuracy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue } from '@echo/shared/catalogue.js';
import { defaultScenario, newNode, newSource } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { labelEvents, labellingSanityCheck, truthFor } from '../src/labelling.js';
import { delayAndSum } from '../src/beamform.js';
import { micPositions } from '../src/mics.js';
import { mulberry32, gaussian } from '../src/rng.js';

const FS = 48000;
const read = (n) => JSON.parse(readFileSync(new URL(`../../assets/public/config/${n}`, import.meta.url), 'utf8'));
const cat = buildCatalogue(read('labels.json'), read('priorities.json'));
const manifest = read('sim-label-manifest.json');

function crash(seed = 3, lenS = 0.6) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round(lenS * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.exp(-i / FS / 0.12);
  return out;
}

// Stub runners: loud windows look like glass to both models, quiet ones like ambience. Deterministic in the audio.
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));
const glassRunners = {
  yamnet: async (x) => (rms(x) > 1e-3 ? { Glass: 0.7, Shatter: 0.5 } : { Silence: 0.9 }),
  clap: async (x) => (rms(x) > 1e-3 ? { glass_break: { softmax: 0.8, cosine: 0.32 }, bottle_bank: { softmax: 0.1, cosine: 0.2 } } : { traffic_steady: { softmax: 0.6, cosine: 0.1 } })
};

function glassScene(level = 110) {
  const s = defaultScenario();
  s.nodes = [newNode('n1', 0, 0), newNode('n2', 50, 0)];
  s.sources = [{ ...newSource('s1', 'glass_breaking', 22, 18, level), start_s: 3.5 }];
  s.settings = { ...s.settings, noise_floor_db_spl: 40 };
  const clips = new Map([['glass_breaking', crash()]]);
  const rendered = renderScenario(s, clips, { lengthS: 9.5 });
  const durations = new Map([['glass_breaking', 0.6]]);
  return { s, rendered, durations, results: analyseScenario(s, rendered, durations) };
}

test('P9: truth comes from the editable manifest (label, group from labels.json, accepted alternatives)', () => {
  assert.deepEqual(truthFor(manifest, cat, 'glass_breaking'), { label: 'glass_break', group: 'GLASS', accept: ['glass_break'], cosine_min: null });
  assert.ok(truthFor(manifest, cat, 'fireworks').accept.includes('fireworks_crackle'));
  assert.equal(truthFor(manifest, cat, 'engine'), null);
});

test('P9: each heard node is labelled on omni and beamformed input with the app stack; bearings and fixes are untouched', async () => {
  const { s, rendered, durations, results } = glassScene();
  const before = JSON.stringify(results);
  const out = await labelEvents(s, rendered, results, { cat, runners: glassRunners, manifest, settings: s.settings, clipDurations: durations });
  assert.equal(JSON.stringify(results), before);
  assert.equal(out.mode, 'model');
  for (const input of ['omni', 'beamformed']) {
    const ev = out.events.filter((e) => e.input === input);
    assert.equal(ev.length, 2);
    for (const e of ev) {
      assert.equal(e.detected, true);
      assert.equal(e.label, 'glass_break');
      assert.equal(e.group, 'GLASS');
      assert.equal(e.true_label, 'glass_break');
      assert.equal(e.correct, true);
      assert.equal(e.correct_top3, true);
      assert.ok(e.trigger.level && e.trigger.yamnet && e.trigger.watchlist.some((w) => w.name === 'Glass'), JSON.stringify(e.trigger));
      assert.ok(Math.abs(e.lag_s) < 1.2, String(e.lag_s));
      assert.ok(e.multi_labels.some((m) => m.label === 'glass_break'));
      assert.ok(!e.multi_labels.some((m) => m.label === 'traffic_steady'));
      for (const k of ['label', 'group', 'confidence', 'target_share', 'group_shares', 'yamnet_corroboration', 'rule_flags', 'input', 'true_label', 'correct', 'correct_top3']) assert.ok(k in e, k);
    }
  }
  assert.equal(out.sources[0].label, 'glass_break');
  assert.equal(out.sources[0].input, 'beamformed');
  assert.equal(out.summary.beamformed.all.top1, 1);
  assert.equal(out.summary.omni.by_group.GLASS.top1, 1);
  assert.ok(out.association_rule && out.notes[0].includes('synthetic'));
  // Labels only: no audio-derived arrays anywhere in the output.
  const json = JSON.stringify(out);
  assert.ok(!/embedding|spectrogram|samples|"audio"/.test(json));
});

test('P9: oracle mode substitutes the true labels without running models', async () => {
  const { s, rendered, durations, results } = glassScene();
  const boom = { yamnet: async () => assert.fail('model ran'), clap: async () => assert.fail('model ran') };
  const out = await labelEvents(s, rendered, results, { cat, runners: boom, manifest, settings: { ...s.settings, labelling_mode: 'oracle' }, clipDurations: durations });
  assert.equal(out.mode, 'oracle');
  assert.ok(out.events.every((e) => e.input === 'oracle' && e.label === 'glass_break' && e.correct));
});

test('P9: delay-and-sum keeps a plane wave from the steered direction and attenuates one from elsewhere', () => {
  const node = { id: 'n', position: [0, 0, 5], mic_layout: 'stagger_8' };
  const pos = micPositions(node);
  const c = 340;
  const len = 4800;
  const u = [1, 0, 0];
  const mk = (dir) => pos.map((p) => {
    const lead = ((p[0] - 0) * dir[0] + (p[1] - 0) * dir[1] + (p[2] - 5) * dir[2]) / c;
    return Float32Array.from({ length: len }, (_, i) => Math.sin(2 * Math.PI * 1500 * (i / FS + lead)));
  });
  const energy = (x) => x.slice(500, len - 500).reduce((a, v) => a + v * v, 0);
  const on = delayAndSum(mk(u), pos, u, { c, fs: FS });
  const off = delayAndSum(mk([-1, 0, 0]), pos, u, { c, fs: FS });
  const ref = energy(mk(u)[0]);
  assert.ok(Math.abs(energy(on) / ref - 1) < 0.02, String(energy(on) / ref));
  assert.ok(energy(off) < 0.5 * ref, String(energy(off) / ref));
});

test('P9: sanity check compares the app path on the clean clip with the sim path through a short, loud render', async () => {
  const clip = crash();
  const res = await labellingSanityCheck({
    clip,
    clipId: 'glass_breaking',
    fs: FS,
    cat,
    runners: glassRunners,
    renderOne: async (id) => {
      const s = defaultScenario();
      s.nodes = [newNode('n1', 0, 0)];
      s.sources = [{ ...newSource('s1', id, 2, 0, 100), start_s: 3 }];
      s.nodes[0].position[2] = 1.5;
      const rendered = renderScenario(s, new Map([[id, clip]]), { lengthS: 9 });
      return { scenario: s, rendered, results: analyseScenario(s, rendered, new Map([[id, clip.length / FS]])) };
    }
  });
  assert.equal(res.agree, true, JSON.stringify(res));
  assert.equal(res.app_label, 'glass_break');
});

test('export schema 0.4: changelog, placeholder thresholds, notes, labels only', async () => {
  const { buildExport, EXPORT_SCHEMA } = await import('../src/export.js');
  const { s, rendered, durations, results } = glassScene();
  const labelling = await labelEvents(s, rendered, results, { cat, runners: glassRunners, manifest, settings: s.settings, clipDurations: durations });
  const ex = JSON.parse(JSON.stringify(buildExport({ scenario: s, nodes: [], results, labelling })));
  assert.equal(ex.schema, '0.4');
  assert.equal(EXPORT_SCHEMA, '0.4');
  assert.equal(ex.changelog[0].schema, '0.4');
  assert.ok(Object.values(ex.thresholds).every((t) => t.placeholder === true && 'value' in t));
  assert.ok(ex.notes.some((n) => /synthetic/.test(n)));
  for (const k of ['usable_nodes', 'heard_nodes', 'track', 'fix']) assert.ok(k in ex.results[0], k);
  for (const k of ['window_snr_db', 'window_policy', 'weight']) assert.ok(k in ex.results[0].nodes[0], k);
  for (const k of ['method', 'inlier_nodes', 'rejected_nodes', 'z_clamped']) assert.ok(k in ex.results[0].fix, k);
  assert.ok('rejected_count' in ex.results[0].track);
  assert.ok(!/"(mics|embedding|embeddings|spectrogram|audio_embeds)"/.test(JSON.stringify(ex)));
  assert.ok(ex.labelling.events.length > 0);
});
