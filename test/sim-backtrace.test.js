import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScenario } from '../src/sim/core/render.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { backtraceCandidates, traceBearing, mapBounds } from '../src/sim/core/backtrace.js';
import { intersectRays } from '../src/sim/core/localise.js';
import { newBuilding } from '../src/sim/core/scenario.js';
import { cornerScene } from './backtrace-scene.js';

test('corner scene: n1 unfolds via b5 west, n2 via b6 north, both land on the source', () => {
  const { scenario, clips, lengthS } = cornerScene();
  const rendered = renderScenario(scenario, new Map(Object.entries(clips)), { lengthS });
  const [r] = analyseScenario(scenario, rendered, new Map(Object.entries(clips).map(([k, v]) => [k, v.length / 48000])));
  const bt = r.backtrace;
  assert.ok(bt.true_error_m < 0.2, String(bt.true_error_m));
  assert.ok(bt.true_rank <= 3);
  const hit = bt.candidates.find((c) => c.rank === bt.true_rank);
  assert.deepEqual(hit.support.find((s) => s.node_id === 'n1').faces, ['b5:west']);
  assert.deepEqual(hit.support.find((s) => s.node_id === 'n2').faces, ['b6:north']);
  assert.equal(bt.intersection_error_m, null); // plain fix has a negative range here and is rejected
});

test('rays branch at the first face and stop at the reflection order', () => {
  const b = [newBuilding('b1', 20, 0, 4, 40, 15)];
  const bounds = mapBounds({ nodes: [{ position: [0, 0, 5] }], buildings: b });
  const legs = traceBearing([0, 0, 5], 0, { buildings: b, reflection_order: 2, bounds }).legs;
  assert.equal(legs[0].ends_at, 'b1:west');
  assert.equal(legs[1].kind, 'dashed');
  assert.equal(legs[1].dir[0], -1);
  const none = traceBearing([0, 0, 5], 0, { buildings: b, reflection_order: 0, bounds }).legs;
  assert.equal(none.length, 1);
  // a node above the roofline passes over the building
  assert.equal(traceBearing([0, 0, 20], 0, { buildings: b, reflection_order: 2, bounds }).legs[0].ends_at, 'edge');
});

test('crossings behind a node are rejected', () => {
  const nodes = [
    { node_id: 'a', position: [0, 0, 5], azimuth_deg: 0, uncertainty_deg: 2 },
    { node_id: 'b', position: [10, 10, 5], azimuth_deg: -90, uncertainty_deg: 2 }
  ];
  assert.equal(backtraceCandidates(nodes, []).candidates.length, 1);
  nodes[1].azimuth_deg = 90;
  assert.equal(backtraceCandidates(nodes, []).candidates.length, 0);
});

test('intersectRays rejects a negative range and measures the angle between lines', () => {
  const fix = intersectRays([
    { origin: [0, 0, 0], direction: [1, 0, 0] },
    { origin: [10, 10, 0], direction: [0, 1, 0] }
  ]);
  assert.equal(fix.negative_range, true);
  assert.equal(fix.position, null);
  const ok = intersectRays([
    { origin: [0, 0, 0], direction: [1, 0, 0] },
    { origin: [10, 10, 0], direction: [0, -1, 0] }
  ]);
  assert.ok(Math.abs(ok.position[0] - 10) < 1e-9 && ok.max_angle_deg > 89.9);
  const para = intersectRays([
    { origin: [0, 0, 0], direction: [1, 0, 0] },
    { origin: [0, 5, 0], direction: [-1, 0, 0] }
  ]);
  assert.ok(para.max_angle_deg < 1e-6 && para.poorly_conditioned);
});
