import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newNode, newSource } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { estimateBearing } from '../src/localise.js';
import { micPositions, micPairs, MIC_PAIRS } from '../src/mics.js';
import { distance, speedOfSound } from '../src/physics.js';
import { mulberry32, gaussian } from '../src/rng.js';

const FS = 48000;
const node = (over = {}) => ({ ...newNode('n1', 0, 0), position: [0, 0, 0], mic_layout: 'stagger_8', ...over });
const local = (n) => micPositions(n);

test('stagger_8 geometry: 8 mics, rings at the stated radii, heights and azimuths', () => {
  const p = local(node());
  assert.equal(p.length, 8);
  for (let k = 0; k < 4; k++) {
    const az = (k * 90 * Math.PI) / 180;
    assert.ok(Math.abs(p[k][0] - 0.06 * Math.cos(az)) < 1e-12 && Math.abs(p[k][1] - 0.06 * Math.sin(az)) < 1e-12 && p[k][2] === 0);
    const az2 = ((45 + k * 90) * Math.PI) / 180;
    assert.ok(Math.abs(p[4 + k][0] - 0.12 * Math.cos(az2)) < 1e-12 && Math.abs(p[4 + k][1] - 0.12 * Math.sin(az2)) < 1e-12 && p[4 + k][2] === 0.06);
  }
});

// The brief expected 10.7 cm as the nearest-neighbour distance. That is the nearest LOWER-to-UPPER distance. Two adjacent
// lower-ring mics are only 6 cm * sqrt(2) = 8.49 cm apart, so the true nearest neighbour is 8.49 cm. Both are asserted.
test('stagger_8 sanity distances', () => {
  const p = local(node());
  const d = (i, j) => distance(p[i], p[j]);
  let nearest = Infinity;
  let nearestCross = Infinity;
  let longestHoriz = 0;
  for (const [i, j] of micPairs(8)) {
    nearest = Math.min(nearest, d(i, j));
    if (i < 4 && j >= 4) nearestCross = Math.min(nearestCross, d(i, j));
    longestHoriz = Math.max(longestHoriz, Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]));
  }
  assert.ok(Math.abs(nearestCross - 0.107) < 0.0005, `nearest cross-ring ${nearestCross}`);
  assert.ok(Math.abs(nearest - 0.0849) < 0.0005, `nearest overall ${nearest}`);
  assert.ok(Math.abs(longestHoriz - 0.24) < 1e-9, `longest horizontal ${longestHoriz}`);
  assert.equal(Math.max(...p.map((q) => q[2])) - Math.min(...p.map((q) => q[2])), 0.06);
});

test('stagger_8 parameters and rotation', () => {
  const p = micPositions(node({ mic_radius_lower_m: 0.05, mic_radius_upper_m: 0.2, mic_ring_height_m: 0.1, mic_per_ring: 3 }));
  assert.equal(p.length, 6);
  assert.ok(Math.abs(Math.hypot(p[0][0], p[0][1]) - 0.05) < 1e-12 && Math.abs(Math.hypot(p[3][0], p[3][1]) - 0.2) < 1e-12 && p[3][2] === 0.1);
  const r = micPositions(node({ rotation_deg: 90 }));
  const base = local(node());
  r.forEach((q, i) => assert.ok(Math.abs(q[0] + base[i][1]) < 1e-12 && Math.abs(q[1] - base[i][0]) < 1e-12 && q[2] === base[i][2]));
});

test('flat_square is unchanged', () => {
  const p = micPositions({ position: [1, 2, 3], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 });
  assert.deepEqual(p.map((q) => q.map((v) => Math.round(v * 1e9) / 1e9)), [[0.95, 1.95, 3], [1.05, 1.95, 3], [1.05, 2.05, 3], [0.95, 2.05, 3]]);
  assert.deepEqual(MIC_PAIRS, [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
});

function burst(ms, seed) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round((ms / 1000) * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.sin((Math.PI * i) / out.length);
  return out;
}

function quietScene(n, srcPos) {
  const s = defaultScenario();
  Object.assign(s.settings, { air_absorption: false, ground_reflectivity: 0, noise_floor_db_spl: -60, mic_self_noise_db_spl: -60 });
  s.nodes = [n];
  s.sources = [{ ...newSource('s1', 'b', srcPos[0], srcPos[1], 100), start_s: 0.2, keyframes: [{ t: 0, position: srcPos }] }];
  return s;
}

test('stagger_8 measures elevation directly (free field), and position jitter perturbs only the rendered array', () => {
  const c = speedOfSound(15);
  for (const [src, label] of [[[40, 10, 20], 'above'], [[40, -10, -12], 'below']]) {
    const s = quietScene(node({ position: [0, 0, 5] }), src);
    const rn = renderScenario(s, new Map([['b', burst(60, 5)]]), { lengthS: 0.8 }).nodes[0];
    const b = estimateBearing({ mics: rn.mics, positions: rn.mic_positions, startSample: Math.round(0.25 * FS), endSample: Math.round(0.4 * FS), fs: FS, c, band: [200, 1600] });
    const d = [src[0], src[1], src[2] - 5];
    const trueEl = (Math.asin(d[2] / Math.hypot(...d)) * 180) / Math.PI;
    assert.equal(b.elevation_sign_assumed, false, label);
    assert.ok(Math.abs(b.elevation_deg - trueEl) < 3, `${label}: est ${b.elevation_deg} true ${trueEl}`);
  }
  const j = quietScene(node({ position: [0, 0, 5] }), [40, 10, 20]);
  j.settings.mic_position_sigma_mm = 1;
  const rn = renderScenario(j, new Map([['b', burst(60, 5)]]), { lengthS: 0.8 }).nodes[0];
  const dz = rn.mic_positions_true.map((p, i) => p[2] - rn.mic_positions[i][2]);
  assert.ok(dz.every((v) => v !== 0 && Math.abs(v) < 0.01), 'z is jittered too');
});

test('flat_square bearing still flags an assumed elevation sign', () => {
  const s = quietScene({ ...newNode('n1', 0, 0), position: [0, 0, 5] }, [40, 10, 1.5]);
  const rn = renderScenario(s, new Map([['b', burst(60, 5)]]), { lengthS: 0.8 }).nodes[0];
  const b = estimateBearing({ mics: rn.mics, positions: rn.mic_positions, startSample: Math.round(0.25 * FS), endSample: Math.round(0.4 * FS), fs: FS, c: speedOfSound(15), band: [200, 1600] });
  assert.equal(b.elevation_sign_assumed, true);
});
