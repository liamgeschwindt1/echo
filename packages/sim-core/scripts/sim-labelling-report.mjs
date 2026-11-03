// Labelling with the real YAMNet + CLAP models inside the simulator (Node runners, src/node-models.js), per scene:
// the app-vs-sim sanity check on clean clips, then per node and source the omni and beamformed labels, the oracle
// run, and the summary metrics per input (top-1, top-3, alert recall, false alerts, time to detection) with the
// overlap and SNR breakdowns.
//   node scripts/sim-labelling-report.mjs [--suite exports|upgrade] [--scenes a,b] [--json out.json]
// SIMULATED audio (clip + modelled propagation and air absorption; no wind, rain, housing scattering or coloured
// noise). Classifier accuracy here is not a prediction of real-world accuracy.
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXPORT_IDS, exportScenario } from '../test/export-scenes.js';
import { SCENE_IDS, upgradeScenario } from '../test/upgrade-scenes.js';
import { readWavMono48k } from './lib-wav.mjs';
import { defaultScenario, newNode, newSource, renderLengthS } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { labelEvents, labellingSanityCheck } from '../src/labelling.js';
import { loadNodeRunners, closeNodeRunners } from '../src/node-models.js';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const suite = opt('--suite', 'exports');
const build = suite === 'exports' ? exportScenario : upgradeScenario;
const scenes = opt('--scenes', (suite === 'exports' ? EXPORT_IDS : SCENE_IDS).join(',')).split(',');
const FS = 48000;

const readCfg = (n) => JSON.parse(readFileSync(new URL(`../../assets/public/config/${n}`, import.meta.url), 'utf8'));
const labelManifest = readCfg('sim-label-manifest.json');
const audio = JSON.parse(readFileSync(new URL('../../assets/public/test-audio/manifest.json', import.meta.url), 'utf8'));
const clips = new Map();
for (const c of audio.clips) if (c.file) clips.set(c.id, readWavMono48k(new URL(`../../assets/public/test-audio/${c.file}`, import.meta.url).pathname));
const durations = new Map([...clips].map(([k, v]) => [k, v.length / FS]));

const t0 = Date.now();
const { cat, runners, models } = await loadNodeRunners();
console.log(`models loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s: YAMNet ${models.yamnet.file}, CLAP ${models.clap.id} (logit scale ${models.clap.logit_scale}, placeholder)`);

// Sanity check (P9 acceptance): the app path on the clean clip against the sim path through a 2 m, quiet render.
const sanity = [];
for (const id of ['glass_breaking', 'car_horn', 'dog']) {
  const clip = clips.get(id);
  const res = await labellingSanityCheck({
    clip,
    clipId: id,
    fs: FS,
    cat,
    runners,
    renderOne: async (cid) => {
      const s = defaultScenario();
      s.settings = { ...s.settings, noise_floor_db_spl: 30 };
      s.nodes = [{ ...newNode('n1', 0, 0), position: [0, 0, 1.5] }];
      s.sources = [{ ...newSource('s1', cid, 2, 0, 100), start_s: 3 }];
      const r = renderScenario(s, new Map([[cid, clip]]), { lengthS: renderLengthS(s, durations) + 3 });
      return { scenario: s, rendered: r, results: analyseScenario(s, r, durations) };
    }
  });
  sanity.push({ clip: id, ...res });
  console.log(`sanity ${id}: app ${res.app_label ?? 'none'}, sim ${res.sim_label ?? 'none'} -> ${res.agree ? 'agree' : 'DISAGREE'}`);
}

const pct = (v) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);
const out = [];
for (const id of scenes) {
  const scn = build(id);
  const used = new Map(scn.sources.map((s) => [s.clip, clips.get(s.clip)]));
  const rendered = renderScenario(scn, used, { lengthS: renderLengthS(scn, durations) });
  const results = analyseScenario(scn, rendered, durations);
  const tl = Date.now();
  const model = await labelEvents(scn, rendered, results, { cat, runners, manifest: labelManifest, settings: { ...scn.settings, labelling_mode: 'model' }, clipDurations: durations, models });
  const labelS = (Date.now() - tl) / 1000;
  const oracle = await labelEvents(scn, rendered, results, { cat, runners: null, manifest: labelManifest, settings: { ...scn.settings, labelling_mode: 'oracle' }, clipDurations: durations });
  console.log(`\n## ${id} (${labelS.toFixed(0)} s of model inference)`);
  console.log('| source | true | node | omni label (conf) | beamformed label (conf) | multi-labels (beamformed) | overlap | SNR dB | status |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const src = scn.sources.find((s) => s.id === r.source_id);
    for (const n of r.nodes.filter((x) => x.heard)) {
      const ev = (input) => model.events.find((e) => e.source_id === r.source_id && e.node_id === n.node_id && e.input === input);
      const cell = (e) => (!e ? '-' : !e.detected ? 'not detected' : `${e.label}${e.correct === true ? ' ✓' : e.correct === false ? ' ✗' : ''} (${e.confidence?.toFixed(2)})`);
      const b = ev('beamformed');
      const multi = b?.multi_labels?.slice(0, 3).map((m) => m.label).join(', ') || '-';
      console.log(`| ${r.source_id} | ${ev('omni')?.true_label ?? `(${src.clip}, unscored)`} | ${n.node_id} | ${cell(ev('omni'))} | ${cell(b)} | ${multi} | ${n.overlapped_with?.length ?? 0} | ${(n.snr_detection_db ?? n.snr_db)?.toFixed(0)} | ${n.localisation_status} |`);
    }
  }
  for (const [input, s] of Object.entries({ ...model.summary, oracle: oracle.summary.oracle })) {
    if (!s) continue;
    const a = s.all;
    console.log(`${input}: ${a.n} events, ${a.scored} scored, detected ${a.detected}, top-1 ${pct(a.top1)}, top-3 ${pct(a.top3)}, alert recall ${pct(a.alert_recall)}, false alerts ${a.false_alerts}`);
  }
  console.log(`per source (beamformed vote): ${model.sources.map((s) => `${s.source_id} ${s.label ?? 'none'}${s.correct === true ? ' ✓' : s.correct === false ? ' ✗' : ''}${s.same_class_sources.length ? ` [same class as ${s.same_class_sources.join(',')}]` : ''}`).join('; ')}`);
  out.push({ scene: id, label_s: labelS, events: model.events, sources: model.sources, summary: model.summary, oracle_summary: oracle.summary });
}

// Totals over all scenes per input.
const all = out.flatMap((s) => s.events);
console.log('\n## all scenes');
for (const input of ['omni', 'beamformed']) {
  const ev = all.filter((e) => e.input === input);
  const scored = ev.filter((e) => e.true_label);
  const by = (f) => (scored.filter(f).length ? scored.filter((e) => f(e) && e.correct).length / scored.filter(f).length : null);
  console.log(`${input}: ${ev.length} events, ${scored.length} scored, top-1 ${pct(by(() => true))}, top-3 ${pct(scored.length ? scored.filter((e) => e.correct_top3).length / scored.length : null)}; no overlap ${pct(by((e) => !e.overlapped))}, overlapped ${pct(by((e) => e.overlapped))}; SNR <10 dB ${pct(by((e) => (e.node_snr_db ?? 0) < 10))}, >=20 dB ${pct(by((e) => (e.node_snr_db ?? 0) >= 20))}; direct blocked ${pct(by((e) => e.direct_blocked))}`);
}

const json = opt('--json', null);
if (json) {
  const dir = resolve(json, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(json, JSON.stringify({ suite, models, sanity, scenes: out }, null, 2));
}
closeNodeRunners();
