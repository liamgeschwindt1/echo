import test from 'node:test';
import assert from 'node:assert/strict';
import { placementScale, placementGrid, placementBounds, suggestPlacement, placementSvg } from '../src/ui/placement.js';

const bounds = { min_x: -60, max_x: 60, min_y: -60, max_y: 60 };
test('orthogonal-bearing Jacobian gives analytic covariance; collinear and missing bearings stay null', () => {
  const value = placementScale([0, 0], [[-10, 0, 1.5], [0, -10, 1.5]], { sigma_deg: .1 * 180 / Math.PI });
  assert.ok(Math.abs(value.rms_m - Math.sqrt(2)) < 1e-10);
  assert.ok(Math.abs(value.major_m - 1) < 1e-10);
  assert.equal(placementScale([0, 0], [[-10, 0, 5], [10, 0, 5]]).major_m, null);
  assert.equal(placementScale([0, 0], [[-10, 0, 5]]).rms_m, null);
});
test('placement uses known footprint blocking and explicitly assumed bearing range', () => {
  const nodes = [[-10, 0, 5], [0, -10, 5]];
  const building = { id: 'b', position: [-5, 0, 0], size: [2, 2, 10] };
  assert.equal(placementScale([0, 0], nodes, {}, [building]).visible_nodes, 1);
  assert.equal(placementScale([0, 0], nodes, { max_range_m: 5 }).major_m, null);
});
test('greedy N2..6 suggestions are deterministic unique prefixes and do not worsen their declared objective', () => {
  let previous = null;
  for (let n = 2; n <= 6; n++) {
    const result = suggestPlacement(bounds, n);
    assert.deepEqual(result, suggestPlacement(bounds, n));
    assert.equal(new Set(result.nodes.map(JSON.stringify)).size, n);
    if (previous) { assert.deepEqual(result.nodes.slice(0, n - 1), previous.nodes); assert.ok(result.objective <= previous.objective + 1e-12); }
    previous = result;
  }
});
test('placement has finite exports, null blind spots and no source-truth bounds dependency', () => {
  const scene = { nodes: [{ position: [0, 0, 5] }], buildings: [], sources: [{ position: [1e9, 1e9, 1e9] }] };
  assert.deepEqual(placementBounds(scene), { min_x: -20, max_x: 20, min_y: -20, max_y: 20 });
  const grid = placementGrid(bounds, [[0, 0, 5]], {}, [], 3);
  assert.ok(grid.every((p) => p.major_m === null));
  assert.ok(!JSON.stringify(grid).includes('Infinity'));
  assert.match(placementSvg(bounds, [[0, 0, 5]]), /blind under assumptions/);
  assert.throws(() => placementScale([0, 0], [], { sigma_deg: 0 }), /assumptions/);
  assert.throws(() => placementGrid({ ...bounds, max_x: -60 }, []), /grid/);
  assert.throws(() => placementGrid({ ...bounds, min_x: -1e308, max_x: 1e308 }, []), /grid/);
  assert.throws(() => placementGrid({ ...bounds, min_x: 0, max_x: 1e308 }, []), /grid/);
  assert.ok(!placementSvg(bounds, [[1e308, 0, 5]]).includes('Infinity'));
  assert.throws(() => suggestPlacement(bounds, 7), /2\.\.6/);
});
