import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSpatialTdoas, stationarySpatialFix, spatialEligible, analyseSpatial } from '../../../scripts/lib/measured-spatial.mjs';
import { micPairs, micPositions } from '../src/mics.js';
import { analyseMeasured, MEASURED_DEFAULTS } from '../src/measured.js';

test('spatial DOA recovers known elevation and propagates only declared azimuth heading noise', () => {
  const p = [[0, 0, 0], [0.1, 0, 0], [0, 0.1, 0], [0, 0, 0.1]];
  const u = [0.3, 0.4, Math.sqrt(0.75)], c = 343, fs = 48000;
  const delays = micPairs(p.length).map(([i, j]) => p[j].reduce((s, x, k) => s + (x - p[i][k]) * u[k] / c, 0));
  const fit = fitSpatialTdoas(p, delays, { fs, c });
  assert.ok(Math.abs(fit.az_deg - 53.13010235415598) < 1e-8);
  assert.ok(Math.abs(fit.elevation_deg - 60) < 1e-8);
  const shifted = fitSpatialTdoas(p, delays, { fs, c, headingSigmaDeg: 2.5 });
  assert.ok(Math.abs(shifted.sigma_az_deg ** 2 - fit.sigma_az_deg ** 2 - 6.25) < 1e-8);
  assert.equal(shifted.sigma_elevation_deg, fit.sigma_elevation_deg);
  assert.ok(fitSpatialTdoas(p, delays, { fs, c, positionSigmaMm: 5 }).sigma_az_deg > fit.sigma_az_deg);
  assert.equal(fitSpatialTdoas(p, delays.map(() => 0), { fs, c }), null);
});

test('spatial geometry leaves planar legacy nodes ineligible', () => {
  assert.equal(spatialEligible({ position: [0, 0, 5], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 }), false);
  assert.equal(spatialEligible({ position: [0, 0, 5], rotation_deg: 0, mic_layout: 'tetrahedron', mic_spacing_m: 0.1 }), true);
});

test('stationary spatial fit recovers a known3D point without a source-height constraint', () => {
  const point = [10, 20, 50], positions = [[0, 0, 5], [30, 0, 5]];
  const obs = positions.map((node_position) => {
    const d = point.map((x, k) => x - node_position[k]);
    return { node_position, az_deg: Math.atan2(d[1], d[0]) * 180 / Math.PI,
      elevation_deg: Math.atan2(d[2], Math.hypot(d[0], d[1])) * 180 / Math.PI,
      sigma_az_deg: 1, sigma_elevation_deg: 1 };
  });
  const solved = stationarySpatialFix(obs, [10, 20, 1.5]);
  assert.ok(Math.hypot(...solved.position.map((x, k) => x - point[k])) < 1e-8);
  assert.ok(stationarySpatialFix(obs.map((x) => ({ ...x, elevation_deg: undefined })), [10, 20, 1.5]).reason);
});

test('spatial pipeline does not access simulator-only fields', () => {
  const node = { id: 'n1', position: [0, 0, 5], rotation_deg: 0, mic_layout: 'tetrahedron', mic_spacing_m: 0.1 };
  const scenario = { nodes: [node], settings: { localisation_band_hz: [300, 3000] } };
  const renderedNode = { mics: Array.from({ length: 4 }, () => new Float32Array(4096)), mic_positions: micPositions(node) };
  for (const [object, key] of [[scenario, 'sources'], [renderedNode, 'mic_positions_true'], [renderedNode, 'activity']]) {
    Object.defineProperty(object, key, { get() { throw new Error(`Truth accessed:${key}`); } });
  }
  const result = analyseSpatial(scenario, { sample_rate: 48000, nodes: [renderedNode] }, { c: 343 });
  assert.deepEqual(result.fixes, []);
  assert.equal(result.nodes[0].tracks.length, 0);
});

test('rank-deficient-only pipeline preserves the exact legacy path', () => {
  const node = { id: 'n1', position: [0, 0, 5], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 };
  const scenario = { nodes: [node], settings: { localisation_band_hz: [300, 3000] } };
  const data = { sample_rate: 48000, nodes: [{ mics: Array.from({ length: 4 }, () => new Float32Array(4096)), mic_positions: micPositions(node) }] };
  assert.deepEqual(analyseSpatial(scenario, data, { c: 343 }), { ...analyseMeasured(scenario, data, { c: 343 }), options: MEASURED_DEFAULTS });
});
