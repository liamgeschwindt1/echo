import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactTrackAssignment, fuseGlobalTracks } from '../../../scripts/lib/global-fusion.mjs';
import { fuseTracks } from '../src/measured.js';

test('global disjoint assignment beats the greedy trap and is deterministic', () => {
  const proposal = (tracks, utility) => ({ fix: { node_tracks: tracks }, utility });
  const candidates = [proposal(['a', 'b'], 4), proposal(['a', 'c'], 3), proposal(['b', 'd'], 3)];
  const result = exactTrackAssignment(candidates);
  assert.equal(result.utility, 6);
  assert.deepEqual(result.fixes.map((f) => f.node_tracks), [['a', 'c'], ['b', 'd']]);
  assert.deepEqual(result, exactTrackAssignment(candidates));
});

test('three compatible measured node tracks fuse without source truth', () => {
  const positions = [[-10, 0, 1.5], [10, 0, 1.5], [0, -10, 1.5]], source = [0, 20];
  const c = 343;
  const nodes = positions.map((node_position, ni) => ({
    node_id: `n${ni}`, node_position, tracks: [{
      windows: Array.from({ length: 10 }, (_, j) => ({
        t_s: 1 + j * 0.025 + Math.hypot(source[0] - node_position[0], source[1] - node_position[1]) / c,
        az_deg: Math.atan2(source[1] - node_position[1], source[0] - node_position[0]) * 180 / Math.PI
      }))
    }]
  }));
  const global = fuseGlobalTracks(nodes, { c });
  assert.equal(global.fixes.length, 1);
  assert.equal(global.fixes[0].n_nodes, 3);
  assert.ok(Math.hypot(global.fixes[0].final_position[0], global.fixes[0].final_position[1] - 20) < 1e-8);
  assert.equal(fuseTracks(nodes, { c })[0].n_nodes, 2, 'Legacy path remains unchanged');
});
