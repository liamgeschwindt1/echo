// Schema 0.4/0.5 localisation checks: windows, robust fixes, flags, uncertainty and tracks.
// SIMULATED checks of the estimator logic only; nothing here is a real-world accuracy claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newNode, newSource, DEFAULT_SETTINGS } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { gaussian, mulberry32 } from '../src/rng.js';
import { BUILTIN_ARRAYS, offsetsM } from '../src/arrays.js';
import { commonTimeTrack } from '../src/track.js';
import { positionAt } from '../src/motion.js';

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

// ---------- P3/P4: robust fix on synthetic rays ----------
import { robustFix, azimuthDeg } from '../src/fix.js';

const S = DEFAULT_SETTINGS;
const ray = (id, origin, target, { errDeg = 0, sigma = 1, el = null, trusted = false } = {}) => ({
  node_id: id,
  origin,
  azimuth_deg: azimuthDeg(origin, target) + errDeg,
  elevation_deg: el ?? 0,
  elevation_trusted: trusted,
  sigma_deg: sigma
});
const scn5 = { nodes: [[0, 0], [70, 0], [70, 70], [0, 70], [35, -1]].map((p, i) => ({ id: `n${i + 1}`, position: [...p, 5] })), buildings: [] };
const herr = (fix, t) => Math.hypot(fix.position[0] - t[0], fix.position[1] - t[1]);

test('P3: two bad nodes out of five are rejected with a reason, the fix stays within a few metres', () => {
  // Off the n1-n3 diagonal: with the source on it, n1 and n3 agree with any point of the diagonal and the case is ambiguous.
  const t = [40, 28, 1.5];
  const rays = scn5.nodes.map((n, i) => ray(n.id, n.position, t, { errDeg: i === 3 ? 25 : i === 4 ? -18 : [0.3, -0.4, 0.2][i] }));
  const all = robustFix(rays.map((r) => ({ ...r, sigma_deg: 90 })).slice(0, 2).concat(rays.slice(2)), { settings: { ...S, fix_inlier_gate_sigma: Infinity }, scenario: scn5 });
  const fix = robustFix(rays, { settings: S, scenario: scn5 });
  assert.equal(fix.method, 'ransac_wls');
  assert.deepEqual(fix.rejected_nodes.map((r) => r.node_id).sort(), ['n4', 'n5']);
  assert.ok(fix.rejected_nodes.every((r) => r.reason === 'outlier' && r.residual_sigma > S.fix_inlier_gate_sigma));
  assert.ok(herr(fix, t) < 2, String(herr(fix, t)));
  assert.ok(herr(all, t) > herr(fix, t));
  assert.equal(fix.fix_suspect, false);
});

test('P4: conditioning uses the horizontal crossing angle and z is clamped for flat arrays', () => {
  const t = [30, 40, 1.5];
  const fix = robustFix([ray('a', [0, 0, 5], t, { el: -40 }), ray('b', [60, 0, 5], t, { el: -40 })], { settings: S, scenario: scn5 });
  assert.equal(fix.z_clamped, true);
  assert.equal(fix.position[2], S.source_height_prior_m);
  assert.ok(Math.abs(fix.max_crossing_angle_horizontal_deg - (azimuthDeg([60, 0], t) - azimuthDeg([0, 0], t))) < 1e-6);
  // Two almost parallel horizontal rays are poorly conditioned however steep their elevations are.
  const par = robustFix([ray('a', [0, 0, 5], [0, 100]), ray('b', [3, 0, 5], [2, 100])], { settings: S, scenario: scn5 });
  assert.equal(par.poorly_conditioned, true);
});

test('P4: trusted elevations recover a 3D fix when the horizontal rays are parallel', () => {
  const target = [50, 0, 75];
  const fix = robustFix([
    ray('a', [0, 0, 5], target, { trusted: true, el: Math.atan2(70, 50) * (180 / Math.PI) }),
    ray('b', [100, 4, 5], target, { trusted: true, el: Math.atan2(70, Math.hypot(50, 4)) * (180 / Math.PI) })
  ], { settings: S, scenario: scn5 });
  assert.equal(fix.method, '3d_two_ray');
  assert.equal(fix.poorly_conditioned, false);
  assert.ok(fix.max_crossing_angle_horizontal_deg < S.fix_min_crossing_deg);
  assert.ok(fix.max_angle_3d_deg > S.fix_min_crossing_deg);
  assert.ok(Math.hypot(...fix.position.map((v, i) => v - target[i])) < 1e-6);
  assert.equal(fix.z_clamped, false);
  assert.deepEqual(fix.z_from_nodes, ['a', 'b']);
});

test('P4: the 3D residual rejects a bad elevation and flags a below-ground fix', () => {
  const target = [50, 0, 75];
  const fix = robustFix([
    ray('a', [0, 0, 5], target, { trusted: true, el: Math.atan2(70, 50) * (180 / Math.PI) }),
    ray('b', [100, 0, 5], target, { trusted: true, el: Math.atan2(70, 50) * (180 / Math.PI) }),
    ray('c', [30, 0, 5], target, { trusted: true, el: 30 })
  ], { settings: S, scenario: scn5 });
  assert.equal(fix.method, '3d_two_ray');
  assert.deepEqual(fix.inlier_nodes, ['a', 'b']);
  assert.equal(fix.rejected_nodes[0].node_id, 'c');
  assert.ok(fix.rejected_nodes[0].residual_sigma > S.fix_inlier_gate_sigma);
  const below = [0, 0, -10];
  const under = robustFix([
    ray('a', [0, 0, 5], below, { trusted: true, el: Math.atan2(-15, 50) * (180 / Math.PI) }),
    ray('b', [100, 4, 5], below, { trusted: true, el: Math.atan2(-15, Math.hypot(50, 4)) * (180 / Math.PI) })
  ], { settings: S, scenario: scn5 });
  assert.equal(under.method, '3d_two_ray');
  assert.ok(under.suspect_reasons.includes('below_ground'));
});

test('P4: suspect flags for below ground, behind a node, range ratio and outside the scene', () => {
  const t = [30, 40, 1.5];
  // Trusted elevations that point underground: z from the nodes, flagged below_ground.
  const under = robustFix([ray('a', [0, 0, 5], t, { el: -35, trusted: true }), ray('b', [60, 0, 5], t, { el: -35, trusted: true })], { settings: S, scenario: scn5 });
  assert.equal(under.z_clamped, false);
  assert.ok(under.position[2] < 0 && under.suspect_reasons.includes('below_ground'));
  // Rays that only meet behind a node.
  const behind = robustFix([ray('a', [0, 0, 5], [-10, -30]), ray('b', [60, 0, 5], [70, -30])], { settings: S, scenario: scn5 });
  assert.equal(behind.position, null);
  assert.ok(behind.suspect_reasons.includes('negative_range'));
  // 19 m against 211 m.
  const ratio = robustFix([ray('a', [0, 0, 5], [12, 15]), ray('b', [200, 80, 5], [12, 15])], { settings: S, scenario: { nodes: [{ position: [0, 0, 5] }, { position: [200, 80, 5] }], buildings: [] } });
  assert.ok(ratio.suspect_reasons.includes('range_ratio'), JSON.stringify(ratio.ranges_m));
  const far = robustFix([ray('a', [0, 0, 5], [400, 400]), ray('b', [70, 0, 5], [400, 400])], { settings: S, scenario: scn5 });
  assert.ok(far.suspect_reasons.includes('outside_scene'));
});

test('P4: flags are consistent: small errors are rarely suspect while gross ones are', () => {
  const rng = mulberry32(17);
  const t = [35, 30, 1.5];
  let goodSuspect = 0;
  for (let k = 0; k < 40; k++) {
    const rays = scn5.nodes.slice(0, 4).map((n) => ray(n.id, n.position, t, { errDeg: 0.5 * gaussian(rng), sigma: 0.5 }));
    const fix = robustFix(rays, { settings: S, scenario: scn5 });
    if (fix.fix_suspect) goodSuspect++;
    assert.ok(herr(fix, t) < 3);
  }
  assert.ok(goodSuspect <= 4, String(goodSuspect));
  // Rays that all disagree far beyond their stated sigma: whenever the fix is 20 m or more off, it is flagged.
  let gross = 0;
  for (let k = 0; k < 40; k++) {
    const rays = scn5.nodes.slice(0, 4).map((n) => ray(n.id, n.position, t, { errDeg: 15 * gaussian(rng), sigma: 0.5 }));
    const fix = robustFix(rays, { settings: S, scenario: scn5 });
    if (!fix.position || fix.poorly_conditioned || herr(fix, t) < 20) continue;
    gross++;
    assert.ok(fix.fix_suspect, JSON.stringify({ e: herr(fix, t), r: fix.suspect_reasons, rej: fix.rejected_nodes.length }));
  }
  assert.ok(gross > 0);
  // Known limit: two rays always meet, so a biased two-node fix cannot be detected from the bearings alone.
});

test('P4: heard_nodes counts heard nodes and usable_nodes counts nodes with a usable bearing', () => {
  const s1 = { ...newSource('s1', 'g', 25, 25, 110), start_s: 3 };
  const scn = scene([s1]);
  const [r] = analyseScenario(scn, renderScenario(scn, new Map([['g', gappedBursts()]]), { lengthS: 6 }), new Map([['g', 1.6]]));
  assert.equal(r.heard_nodes, r.nodes.filter((n) => n.heard).length);
  assert.equal(r.usable_nodes, r.nodes.filter((n) => n.usable).length);
  assert.ok(r.fix.inlier_nodes.length >= 2 && r.fix.method === 'two_ray');
});

// ---------- P6: common-time track ----------

test('P6: a moving source gets a track of fixes at common emission times, scored against the moving truth', () => {
  const rng = mulberry32(21);
  const noise = new Float32Array(Math.round(3 * FS));
  for (let i = 0; i < noise.length; i++) noise[i] = gaussian(rng) * 0.3;
  const src = { ...newSource('s1', 'n', 5, 25, 104), start_s: 3, keyframes: [{ t: 3, position: [5, 25, 1.5] }, { t: 6, position: [45, 30, 1.5] }] };
  const scn = defaultScenario();
  scn.nodes = [newNode('n1', 0, 0), newNode('n2', 60, 0), newNode('n3', 30, 55)];
  scn.sources = [src];
  scn.settings = { ...scn.settings, noise_floor_db_spl: 40 };
  const [r] = analyseScenario(scn, renderScenario(scn, new Map([['n', noise]]), { lengthS: 7 }), new Map([['n', 3]]));
  const t = r.track;
  assert.equal(t.alignment, 'common_emission_time');
  assert.ok(t.fixes.length > 3, String(t.fixes.length));
  for (const f of t.fixes) {
    // Fix time is the emission time; the fix becomes available when the last inlier window has arrived.
    assert.ok(f.t_s > f.t_emit_s);
    const truth = positionAt(src, f.t_emit_s + t.window_s / 2);
    assert.ok(Math.abs(f.error_m - Math.hypot(f.position[0] - truth[0], f.position[1] - truth[1])) < 1e-9);
  }
  const errs = t.fixes.map((f) => f.error_m).sort((a, b) => a - b);
  assert.ok(errs[Math.floor(errs.length / 2)] < 5, JSON.stringify(errs));
  assert.ok(Number.isInteger(t.rejected_count));
});

test('P6: an elevated D180 source orbiting two nodes keeps rolling observations and fixes', () => {
  const fs = FS;
  const c = 343;
  const durationS = 10;
  const startS = 3;
  const center = [50, 0];
  const radius = 70;
  const nodes = [newNode('n1', 0, 0), newNode('n2', 100, 0)];
  const source = {
    ...newSource('drone', 'noise', center[0], center[1], 145),
    start_s: startS,
    keyframes: Array.from({ length: 17 }, (_, i) => {
      const angle = (2 * Math.PI * i) / 16;
      return { t: startS + (durationS * i) / 16, position: [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), 75] };
    })
  };
  const scenario = { ...defaultScenario(), nodes, sources: [source] };
  const model = BUILTIN_ARRAYS.find((x) => x.id === 'ball12_d180');
  assert.ok(model);
  const sampleCount = Math.ceil((startS + durationS + 1) * fs);
  const rng = mulberry32(321);
  const sourceNoise = new Float32Array(sampleCount + 128);
  let filtered = 0;
  for (let i = 0; i < sourceNoise.length; i++) {
    filtered = 0.3 * gaussian(rng) + 0.7 * filtered;
    sourceNoise[i] = filtered;
  }
  const renderedNodes = nodes.map((node) => {
    const offsets = offsetsM(model);
    const micPositions = offsets.map((o) => [node.position[0] + o[0], node.position[1] + o[1], node.position[2] + o[2]]);
    const directions = [new Float32Array(sampleCount), new Float32Array(sampleCount), new Float32Array(sampleCount)];
    for (let i = 0; i < sampleCount; i++) {
      const arrivalS = i / fs;
      let target = positionAt(source, arrivalS);
      for (let it = 0; it < 5; it++) target = positionAt(source, arrivalS - Math.hypot(target[0] - node.position[0], target[1] - node.position[1], target[2] - node.position[2]) / c);
      const d = [target[0] - node.position[0], target[1] - node.position[1], target[2] - node.position[2]];
      const range = Math.hypot(...d);
      for (let k = 0; k < 3; k++) directions[k][i] = d[k] / range;
    }
    const mics = offsets.map((offset) => {
      const audio = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const delaySamples = ((offset[0] * directions[0][i] + offset[1] * directions[1][i] + offset[2] * directions[2][i]) / c) * fs;
        const at = i + delaySamples + 32;
        const lo = Math.floor(at);
        const frac = at - lo;
        audio[i] = sourceNoise[lo] * (1 - frac) + sourceNoise[lo + 1] * frac;
      }
      return audio;
    });
    return { id: node.id, mics, mic_positions: micPositions };
  });
  const frames = new Float32Array(Math.ceil(sampleCount / (fs * 0.01))).fill(1);
  const rendered = {
    length: sampleCount,
    nodes: renderedNodes,
    activity: nodes.map(() => ({ per_source: [{ all: frames }], noise_band_power: 0.001 }))
  };
  const perNode = nodes.map((node) => {
    const p0 = positionAt(source, startS);
    return {
      bearing: {
        azimuth_deg: azimuthDeg(node.position, p0),
        uncertainty_deg: 1,
        elevation_sign_assumed: false,
        elevation_confidence: 'ok'
      },
      direct_to_reflected_db: 30,
      delay_spread_s: 0,
      reflection_gap_s: 0
    };
  });
  const track = commonTimeTrack({
    scenario,
    rendered,
    si: 0,
    settings: { ...S, track_iterations: 2 },
    c,
    fs,
    lengthS: startS + durationS + 1,
    windowS: 0.1,
    intervalS: 0.1,
    activeWindows: nodes.map(() => [startS, startS + durationS + 1]),
    perNode,
    longFix: null,
    durationS,
    reflectorM: nodes.map(() => null),
    meanPower: () => 1,
    toDb: () => 30
  });
  const errors = track.fixes.map((f) => f.error_m).sort((a, b) => a - b);
  const firstFixError = track.fixes[0]?.raw_error_m;
  assert.ok(track.fixes.length > 10, `track fixes: ${track.fixes.length}; rejected: ${track.rejected_count}`);
  assert.ok(track.rejected_count < 20, String(track.rejected_count));
  assert.ok(track.observations.length > 40, `observations: ${track.observations.length}`);
  assert.ok(Number.isFinite(firstFixError) && firstFixError < 10, String(firstFixError));
  assert.ok(errors[Math.floor(errors.length / 2)] < 10, JSON.stringify(errors));
});

// ---------- P8: detected vs localisable ----------
import { decimationFor } from '../src/activity.js';
import { rfft, irfft } from '../src/dsp.js';

test('P8: a 4-8 kHz sound is detected (broadband) but not localisable (200-1600 Hz), and still counts as heard', () => {
  const rng = mulberry32(31);
  const n = 1 << 15;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = gaussian(rng);
  const X = rfft(x, n);
  for (let k = 0; k < X.re.length; k++) {
    const f = (k * FS) / n;
    if (f < 4000 || f > 8000) X.re[k] = X.im[k] = 0;
  }
  const hiss = Float32Array.from(irfft(X.re, X.im, n));
  const s = scene([{ ...newSource('s1', 'h', 20, 20, 95), start_s: 3 }]);
  const [r] = analyseScenario(s, renderScenario(s, new Map([['h', hiss]]), { lengthS: 4.5 }), new Map([['h', n / FS]]));
  for (const nr of r.nodes) {
    assert.equal(nr.detected_broadband, true, String(nr.snr_detection_db));
    assert.equal(nr.localisable, false, String(nr.snr_db));
    assert.equal(nr.heard, true);
    assert.ok(nr.aliasing_limit_hz > 1600 && nr.aliasing_limit_hz < 1800);
  }
  assert.equal(r.heard_nodes, 2);
  assert.equal(r.usable_nodes, 0);
});

test('P8: the activity decimation follows the band (default band unchanged, wider bands are not cut off)', () => {
  assert.equal(decimationFor([200, 1600], 48000), 8);
  assert.equal(decimationFor([200, 3000], 48000), 4);
  assert.equal(decimationFor([50, 9000], 48000), 2);
  for (const band of [[200, 1600], [200, 3000], [50, 9000]]) assert.ok(band[1] * 1.2 < 48000 / (2 * decimationFor(band, 48000)));
});

// ---------- P7: diffraction-aware backtrace ----------
import { newBuilding } from '../src/scenario.js';
import { backtraceCandidates } from '../src/backtrace.js';

test('P7: a node blocked by a long wall supports the true candidate through the corner (edge hypothesis)', () => {
  // Wall from y = -3 to y = 697 at x = 45..55: n1 at (100, 30) cannot see the source at (0, 0) and hears it round the
  // corner (55, -3). n2 and n3 see the source directly.
  const s = defaultScenario();
  Object.assign(s.settings, { air_absorption: false, ground_reflectivity: 0, noise_floor_db_spl: 30, mic_self_noise_db_spl: 10, reflection_order: 0, diffraction_order: 1, diffraction_model: 'maekawa' });
  s.buildings = [newBuilding('b1', 50, 347, 10, 700, 100)];
  s.nodes = [newNode('n1', 100, 30), newNode('n2', 100, -60), newNode('n3', -30, -50)];
  s.sources = [{ ...newSource('s1', 'b', 0, 0, 125), start_s: 0.2 }];
  const rng = mulberry32(3);
  const b = new Float32Array(Math.round(0.06 * FS));
  for (let i = 0; i < b.length; i++) b[i] = gaussian(rng) * Math.sin((Math.PI * i) / b.length);
  const [r] = analyseScenario(s, renderScenario(s, new Map([['b', b]]), { lengthS: 1.4 }), new Map([['b', 0.06]]));
  const n1 = r.nodes[0];
  assert.equal(n1.direct_blocked, true);
  assert.ok(r.backtrace.edge_hypotheses.n1.some((id) => /b1:/.test(id)), JSON.stringify(r.backtrace.edge_hypotheses));
  const near = r.backtrace.candidates.filter((c) => Math.hypot(c.position[0], c.position[1]) < 3);
  assert.ok(near.length, JSON.stringify(r.backtrace.top.map((c) => c.position)));
  const best = near[0];
  assert.ok(best.rank <= 3, String(best.rank));
  assert.equal(best.support.find((x) => x.node_id === 'n1')?.hypothesis, 'edge');
  assert.ok(best.hypotheses.includes('edge') && best.hypotheses.includes('direct'));
});

test('P7: edge hypotheses never come from a corner the node cannot see, and reflections still unfold as before', () => {
  const buildings = [newBuilding('b1', 0, 30, 20, 10, 15), newBuilding('b2', 0, 60, 40, 10, 15)];
  // From (0,0) looking north, b2's corners are hidden behind b1.
  const out = backtraceCandidates([{ node_id: 'a', position: [0, 0, 5], azimuth_deg: 90, uncertainty_deg: 30 }], buildings);
  assert.ok(out.edge_hypotheses.a.every((id) => !id.startsWith('b2:') || id === 'b2:roof'), JSON.stringify(out.edge_hypotheses));
  assert.ok(out.edge_hypotheses.a.some((id) => id.startsWith('b1:')));
  const off = backtraceCandidates([{ node_id: 'a', position: [0, 0, 5], azimuth_deg: 90, uncertainty_deg: 30 }], buildings, { edges: false });
  assert.deepEqual(off.edge_hypotheses.a, []);
  assert.deepEqual(off.traces, out.traces);
});
