// Schema 0.4 localisation upgrade (P1-P8): window gating, window policy, robust fix, flags, uncertainty, tracks.
// SIMULATED checks of the estimator logic only; nothing here is a real-world accuracy claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newNode, newSource, DEFAULT_SETTINGS } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { gaussian, mulberry32 } from '../src/rng.js';

const FS = 48000;

// Two 80 ms noise bursts with 1.4 s of silence between them.
function gappedBursts(seed = 5) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round(1.6 * FS));
  for (const start of [0, 1.48]) {
    const a = Math.round(start * FS);
    for (let i = 0; i < 0.08 * FS; i++) out[a + i] = gaussian(rng) * Math.sin((Math.PI * i) / (0.08 * FS));
  }
  return out;
}

// One 300 ms noise burst.
function burst(seed = 9, lenS = 0.3) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round(lenS * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.sin((Math.PI * i) / out.length);
  return out;
}

function scene(sources, settings = {}) {
  const s = defaultScenario();
  s.nodes = [newNode('a', 0, 0), newNode('b', 60, 0)];
  s.sources = sources;
  s.settings = { ...s.settings, noise_floor_db_spl: 40, mic_self_noise_db_spl: 25, ...settings };
  return s;
}

test('P1: a node never reports a reliable bearing from a silent window', () => {
  // s2 covers the first burst of s1 and s3 the second, so the only non-overlapped part of s1 is the silence between.
  const s1 = { ...newSource('s1', 'g', 25, 25, 110), start_s: 3 };
  const s2 = { ...newSource('s2', 'b', 27, 23, 110), start_s: 2.92 };
  const s3 = { ...newSource('s3', 'b', 23, 27, 110), start_s: 4.4 };
  const scn = scene([s1, s2, s3]);
  const clips = new Map([['g', gappedBursts()], ['b', burst()]]);
  const out = renderScenario(scn, clips, { lengthS: 6.5 });
  const results = analyseScenario(scn, out, new Map([['g', 1.6], ['b', 0.3]]));
  for (const r of results) {
    for (const n of r.nodes) {
      assert.ok(n.window_snr_db === null || Number.isFinite(n.window_snr_db));
      if (n.reliable) assert.ok(n.window_snr_db >= scn.settings.min_snr_db, `${r.source_id}@${n.node_id}: reliable on ${n.window_snr_db} dB`);
      if (n.window_snr_db !== null && n.window_snr_db < scn.settings.min_snr_db) {
        assert.equal(n.localisation_status, 'no_signal');
        assert.equal(n.bearing, null);
      }
      // The localisation window lies inside the source's arrival span at the node.
      if (n.bearing) assert.ok(n.window_s[0] >= n.arrival_span_s[0] - 0.02 && n.window_s[1] <= n.arrival_span_s[1] + 0.02, JSON.stringify([n.window_s, n.arrival_span_s]));
    }
  }
});

test('P2: an impulsive onset is localised on a short onset-gated window, a fixed policy keeps the whole window', () => {
  const s1 = { ...newSource('s1', 'g', 25, 25, 110), start_s: 3 };
  const clips = new Map([['g', gappedBursts()]]);
  const auto = scene([s1]);
  const [r] = analyseScenario(auto, renderScenario(auto, clips, { lengthS: 6 }), new Map([['g', 1.6]]));
  for (const n of r.nodes) {
    assert.equal(n.window_policy, 'onset_gated');
    assert.equal(n.trigger.type, 'impulsive');
    assert.ok(n.window_s[1] - n.window_s[0] <= (DEFAULT_SETTINGS.onset_window_ms + DEFAULT_SETTINGS.window_pad_ms) / 1000 + 1e-9);
  }
  const fixed = scene([s1], { window_policy: 'fixed' });
  const [rf] = analyseScenario(fixed, renderScenario(fixed, clips, { lengthS: 6 }), new Map([['g', 1.6]]));
  for (const n of rf.nodes) {
    assert.equal(n.window_policy, 'fixed');
    assert.ok(n.window_s[1] - n.window_s[0] > 1);
  }
});
