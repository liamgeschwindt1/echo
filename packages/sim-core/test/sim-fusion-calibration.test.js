import test from 'node:test';
import assert from 'node:assert/strict';
import { headingCalibration } from '../src/ext/fusion/heading-calibration.js';
import { fuseLikelihoodTracks } from '../src/ext/fusion/likelihood-fusion.js';
import { MEASURED_DEFAULTS } from '../src/measured.js';

function makeTrack(azimuth, t0 = 1) {
  return {
    windows: Array.from({ length: 8 }, (_, i) => ({
      t_s: t0 + i * 0.02,
      az_deg: azimuth,
      residual_s: 1e-6,
      peak_mean: 0.9
    })),
    onsets: []
  };
}

test('heading self-calibration estimates per-node offsets with observability guard', () => {
  const source = [15, 30];
  const nodes = [[0, 0, 5], [30, 0, 5], [0, 30, 5]];
  const injected = [0, 5, -4];
  const nodeResults = nodes.map((node_position, ni) => {
    const truth = Math.atan2(source[1] - node_position[1], source[0] - node_position[0]) * 180 / Math.PI;
    return {
      node_id: `n${ni}`,
      node_position,
      tracks: [makeTrack(truth + injected[ni], 1 + ni * 0.01)]
    };
  });
  const fixes = [{
    node_tracks: ['0:0', '1:0', '2:0'],
    final_position: source
  }];
  const calibration = headingCalibration(nodeResults, fixes, {
    ...MEASURED_DEFAULTS,
    heading_self_calibration_min_fixes: 1,
    heading_self_calibration_min_nodes: 3
  });
  assert.equal(calibration.applied, true);
  const offsets = calibration.node_offsets.map((entry) => entry.offset_deg);
  assert.ok(Math.abs(offsets[0]) < 0.1);
  assert.ok(Math.abs(offsets[1] + 5) < 0.5);
  assert.ok(Math.abs(offsets[2] - 4) < 0.5);
});

test('likelihood-product fusion makes one fix per cluster and returns confidence radius', () => {
  const source = [20, 25];
  const nodes = [[0, 0, 5], [35, 0, 5], [0, 35, 5]];
  const nodeResults = nodes.map((node_position, ni) => {
    const az = Math.atan2(source[1] - node_position[1], source[0] - node_position[0]) * 180 / Math.PI;
    return {
      node_id: `n${ni}`,
      node_position,
      tracks: [makeTrack(az, 1)]
    };
  });
  const { fixes } = fuseLikelihoodTracks(nodeResults, {
    c: 343,
    options: {
      ...MEASURED_DEFAULTS,
      fusion_mode: 'likelihood',
      likelihood_grid_step_m: 1,
      likelihood_margin_m: 25,
      likelihood_min_nodes: 2,
      likelihood_min_track_windows: 3
    }
  });
  assert.equal(fixes.length, 1);
  assert.ok(Math.hypot(fixes[0].final_position[0] - source[0], fixes[0].final_position[1] - source[1]) <= 2);
  assert.ok(fixes[0].confidence.radius_90_m >= 0);
  assert.equal(fixes[0].extensions.fusion.mode, 'likelihood_product');
});
