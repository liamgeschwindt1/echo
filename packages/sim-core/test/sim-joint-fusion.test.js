import test from 'node:test';
import assert from 'node:assert/strict';
import { fuseTracks, MEASURED_DEFAULTS } from '../src/measured.js';
import { fuseJointTracks } from '../src/joint-fusion.js';

function trackNodes({ outlier = false } = {}) {
  const positions = [[-20, 0, 5], [20, 0, 5], [0, -20, 5], [0, 20, 5]];
  const source = [0, 35];
  const c = 343;
  return positions.map((node_position, ni) => {
    const azimuth = Math.atan2(source[1] - node_position[1], source[0] - node_position[0]) * 180 / Math.PI +
      (outlier && ni === 3 ? 30 : 0);
    const range = Math.hypot(source[0] - node_position[0], source[1] - node_position[1]);
    return {
      node_id: `n${ni}`,
      node_position,
      tracks: [{
        onsets: [],
        windows: Array.from({ length: 10 }, (_, i) => ({
          t_s: 1 + i * 0.025 + range / c,
          az_deg: azimuth,
          residual_s: 0.000001,
          peak_mean: 0.9
        }))
      }]
    };
  });
}

test('joint fusion uses multiple nodes, rejects a bad ray and reports model covariance deterministically', () => {
  const nodes = trackNodes({ outlier: true });
  const options = { ...MEASURED_DEFAULTS, fusion_mode: 'joint' };
  const context = { c: 343, options };
  const first = fuseJointTracks(nodes, context);
  assert.equal(first.length, 1);
  const [fix] = first;
  assert.equal(fix.algorithm, 'joint-ransac-huber');
  assert.equal(fix.n_nodes, 3);
  assert.equal(fix.low_confidence, true, 'model covariance is not calibrated');
  assert.equal(fix.reliable, false);
  assert.ok(Math.hypot(fix.final_position[0], fix.final_position[1] - 35) < 1e-5);
  assert.equal(fix.covariance.length, 2);
  assert.ok(fix.covariance.flat().every(Number.isFinite));
  assert.ok(fix.covariance_radius_90_m > 0);
  assert.deepEqual(fix, fuseJointTracks(nodes, context)[0]);
  assert.deepEqual(fuseTracks(nodes, context).map((f) => f.n_nodes), [2], 'legacy remains selectable and pairwise');
});

test('joint fit leaves fewer-than-three-node results to legacy fallback', () => {
  const nodes = trackNodes().slice(0, 2);
  assert.deepEqual(fuseJointTracks(nodes, { c: 343, options: MEASURED_DEFAULTS }), []);
  assert.equal(fuseTracks(nodes, { c: 343, options: MEASURED_DEFAULTS })[0].n_nodes, 2);
});
