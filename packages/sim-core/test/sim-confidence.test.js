import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confidenceFeatures, fitLogistic, predictWrong, applyConfidence, reliabilityDiagram, CONFIDENCE_FEATURES } from '../../../scripts/lib/confidence.mjs';

const fixture = () => ({
  nodes: [
    { node_position: [-10, 0, 1.5], tracks: [{ windows: [{ az_deg: 45, residual_s: 1e-6, peak_mean: 0.9, h_mag: 1, t_s: 1 }, { az_deg: 45.1, residual_s: 1e-6, peak_mean: 0.9, h_mag: 1, t_s: 1.1 }] }] },
    { node_position: [10, 0, 1.5], tracks: [{ windows: [{ az_deg: 135, residual_s: 1e-6, peak_mean: 0.9, h_mag: 1, t_s: 1 }, { az_deg: 134.9, residual_s: 1e-6, peak_mean: 0.9, h_mag: 1, t_s: 1.1 }] }] }
  ],
  fixes: [{ final_position: [0, 10], node_tracks: ['0:0', '1:0'], chi2_mean: 0.1, nis_mean: 0.1, onset_skew_s: null }]
});

test('confidence features are deterministic, finite and cannot access source/path truth', () => {
  const f = fixture();
  const sensor = { buildings: [], settings: {} };
  for (const k of ['sources', 'truth', 'paths']) Object.defineProperty(sensor, k, { get: () => { throw new Error('truth accessed'); } });
  const result = confidenceFeatures(f.fixes[0], f.nodes, sensor);
  assert.equal(result.values.length, CONFIDENCE_FEATURES.length);
  assert.ok(result.values.every(Number.isFinite));
  assert.ok(result.scale_m > 0);
  assert.deepEqual(result, confidenceFeatures(f.fixes[0], f.nodes, sensor));
  const invalid = fixture(); invalid.nodes[0].tracks[0].windows[0].az_deg = NaN;
  assert.throws(() => confidenceFeatures(invalid.fixes[0], invalid.nodes, sensor), /Nonfinite/);
});

test('regularised logistic coefficients reproduce predictions without nonfinite values', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ x: CONFIDENCE_FEATURES.map((_, j) => j ? 0 : i), y: Number(i >= 10) }));
  const model = fitLogistic(rows, { iterations: 200 });
  assert.deepEqual(model, fitLogistic(rows, { iterations: 200 }));
  assert.ok(model.coefficients.every(Number.isFinite));
  assert.ok(predictWrong(model, rows[0].x) < predictWrong(model, rows.at(-1).x));
  assert.ok(predictWrong(model, rows[0].x) > 0);
  const inference = fixture(), settings = { heading_error_sigma_deg: 2.5 };
  applyConfidence(inference, { settings, buildings: [] }, { id: 'test', regression: model, flag_threshold: 0.5, radius: { on: { quantile: 2 } } });
  assert.ok(inference.fixes[0].confidence.radius_90_m > 0);
  assert.equal(inference.fixes[0].confidence.radius_condition, 'on');
  assert.match(inference.fixes[0].confidence.status, /not real-data/);
});

test('reliability bins preserve unavailable values and include exact probabilities zero and one', () => {
  const diagram = reliabilityDiagram([{ p: 0, y: 0 }, { p: 1, y: 1 }]);
  assert.equal(diagram[0].count, 1);
  assert.equal(diagram[9].count, 1);
  assert.equal(diagram[1].observed, null);
});
