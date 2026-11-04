import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedConsensus } from '../../../scripts/lib/weighted-consensus.mjs';
import { hardwareSigma } from '../../../scripts/lib/global-fusion.mjs';
import { buildScene } from '../src/benchmark/scenes.js';

const traceRays = [
  { node_id: 'n1', origin: [11.5, 22.4, 5], azimuth_deg: 76.67027255561736, sigma_deg: 4.147991588053557, reliable: true },
  { node_id: 'n2', origin: [27.3, -17, 5], azimuth_deg: 111.30692939506086, sigma_deg: 70.96927379957819, reliable: false },
  { node_id: 'n3', origin: [13.3, 59.7, 5], azimuth_deg: -38.70495006027591, sigma_deg: 3.363862205069154, reliable: true },
  { node_id: 'n7', origin: [-37.5, 36.9, 5], azimuth_deg: -13.801077148515928, sigma_deg: 32.351837612941004, reliable: false }
];
for (const mode of ['weighted', 'predictive']) test(`${mode} consensus protects the exact trace's high-weight n1/n3`, () => {
  const options = { mode, min_cross_deg: 10, gate: 3 };
  const fix = weightedConsensus(traceRays, options);
  assert.ok(fix?.inlier_nodes.includes('n1') && fix.inlier_nodes.includes('n3'));
  assert.ok(fix.position.every(Number.isFinite));
  assert.ok(fix.covariance?.flat().every(Number.isFinite));
  assert.deepEqual(weightedConsensus([...traceRays].reverse(), options), fix);
  assert.deepEqual(weightedConsensus(traceRays.map((r) => ({ ...r, true_position: [1e9, -1e9] })), options), fix);
});
test('declared heading and position uncertainty scale while scalar gain cancels PHAT', () => {
  const s = buildScene('sparse_20'), n = s.nodes[0];
  assert.equal(hardwareSigma(n, s.settings), 2.5);
  assert.ok(hardwareSigma(n, { ...s.settings, heading_error_sigma_deg: 2.5 }) > 3.5);
  assert.ok(hardwareSigma(n, { ...s.settings, mic_position_sigma_mm: 5 }) > 2.5);
  assert.equal(hardwareSigma(n, { ...s.settings, mic_gain_sigma_db: 10 }), 2.5);
});
