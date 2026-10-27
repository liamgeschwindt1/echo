import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingBox, buildingPolygon, buildSurfaces, edgesFor, findPaths, insideBuilding, planRanges, segmentBlocked, simplifyRing } from '../src/geometry.js';
import { traceBearing } from '../src/backtrace.js';
import { defaultScenario, newBuilding, newNode, newSource, placementErrors } from '../src/scenario.js';
import { speedOfSound } from '../src/physics.js';
import { mulberry32 } from '../src/rng.js';

const C = speedOfSound(15);
const settings = (over = {}) => ({ ...defaultScenario().settings, air_absorption: false, ground_reflectivity: 0, ...over });

// Building with a footprint given in world coordinates, stored the way the OpenStreetMap import stores it.
function footprintBuilding(id, ring, h = 15) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...ys) - Math.min(...ys);
  const position = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
  return { id, position, size: [w, d, h], rotation_deg: 0, footprint: [[...ring, ring[0]].map(([x, y]) => [(x - position[0]) / w, (y - position[1]) / d])] };
}

// L shape: 40 x 40 with the north-east 30 x 30 quarter missing.
const L_RING = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]];

test('footprint outline: simplified, counter-clockwise, closing point removed', () => {
  const poly = buildingPolygon(footprintBuilding('l', L_RING));
  assert.equal(poly.length, 6);
  for (const [i, p] of L_RING.entries()) assert.ok(Math.hypot(poly[i][0] - p[0], poly[i][1] - p[1]) < 1e-9);
  const cw = simplifyRing([...L_RING].reverse());
  assert.deepEqual(cw.map((p) => p.map(Math.round)), L_RING);
  // A point 0.2 m off a straight wall is dropped.
  assert.equal(simplifyRing([[0, 0], [20, 0.2], [40, 0], [40, 20], [0, 20]]).length, 4);
  assert.equal(buildingPolygon(newBuilding('b', 0, 0)), null);
});

test('footprint blocks only where the building is: the L notch is open ground', () => {
  const b = footprintBuilding('l', L_RING);
  const boxes = [buildingBox(b)];
  assert.ok(!insideBuilding([30, 30, 1.5], [b]), 'notch is outside');
  assert.ok(insideBuilding([5, 30, 1.5], [b]), 'west arm is inside');
  assert.ok(!insideBuilding([5, 30, 20], [b]), 'above the roof is outside');
  assert.ok(!segmentBlocked([20, 50, 1.5], [50, 20, 1.5], boxes), 'line across the notch');
  assert.ok(segmentBlocked([-5, 20, 1.5], [20, 20, 1.5], boxes), 'line through the west arm');
  assert.ok(!segmentBlocked([-5, 20, 20], [20, 20, 20], boxes), 'line over the roof');
  assert.ok(!segmentBlocked([10, 15, 1.5], [10, 35, 1.5], boxes), 'grazing along a wall');
  assert.deepEqual(planRanges([-10, 20], [50, 20], boxes[0]).map((r) => r.map((t) => +(t * 60 - 10).toFixed(6))), [[0, 10]]);
});

test('placement inside the bounding box but outside the outline is allowed', () => {
  const s = defaultScenario();
  s.buildings = [footprintBuilding('l', L_RING)];
  s.nodes = [newNode('n1', 30, 30)];
  s.sources = [newSource('s1', 'clip', 25, 25)];
  assert.deepEqual(placementErrors(s), []);
  s.nodes = [newNode('n1', 5, 30)];
  assert.equal(placementErrors(s).length, 1);
});

test('a footprint square gives the same paths as the equivalent box', () => {
  const ring = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  const box = newBuilding('b', 0, 0, 20, 20, 15);
  const poly = footprintBuilding('b', ring);
  for (const over of [{ diffraction_model: 'maekawa', diffraction_order: 1 }, { diffraction_model: 'wedge', diffraction_order: 2 }]) {
    const st = settings({ ...over, reflection_order: 1 });
    for (const [src, mic] of [[[-30, 5, 1.5], [30, -3, 1.5]], [[-30, 40, 1.5], [25, 20, 1.5]], [[-40, -25, 3], [35, 15, 2]]]) {
      const a = findPaths(src, mic, { settings: st, buildings: [box], c: C });
      const b = findPaths(src, mic, { settings: st, buildings: [poly], c: C });
      assert.equal(a.directBlocked, b.directBlocked);
      // Chains whose two hits sit on the same roof corner (legs ~1e-7 m) are numerically degenerate in both models: compare length only.
      const degenerate = (p) => p.hits.length === 2 && Math.hypot(p.hits[0][0] - p.hits[1][0], p.hits[0][1] - p.hits[1][1], p.hits[0][2] - p.hits[1][2]) < 1e-3;
      const lens = (r) => r.paths.map((p) => `${p.type}:${p.length.toFixed(6)}:${degenerate(p) ? '-' : (p.gain / p.length).toExponential(6)}`).sort();
      assert.deepEqual(lens(b), lens(a), JSON.stringify(over));
    }
  }
});

test('reflection off a 45 degree wall obeys the mirror law', () => {
  const b = footprintBuilding('d', [[0, -10], [10, 0], [0, 10], [-10, 0]]);
  const surfaces = buildSurfaces([b]);
  assert.equal(surfaces.length, 5);
  const src = [20, -5, 1.5];
  const mic = [5, -20, 1.5];
  const { paths } = findPaths(src, mic, { settings: settings({ reflection_order: 1, diffraction_order: 0 }), buildings: [b], c: C });
  const wall = paths.filter((p) => p.type === 'wall');
  assert.deepEqual(wall.map((p) => p.surfaces), [['d:wall-0']]);
  const [h] = wall[0].hits;
  assert.ok(Math.abs(h[0] - h[1] - 10) < 1e-9, 'hit is on the wall x - y = 10');
  assert.ok(Math.abs(h[0] - 5) < 1e-9 && Math.abs(h[1] + 5) < 1e-9, JSON.stringify(h));
  const len = Math.hypot(src[0] - h[0], src[1] - h[1]) + Math.hypot(mic[0] - h[0], mic[1] - h[1]);
  assert.ok(Math.abs(wall[0].length - len) < 1e-9);
});

test('diffraction edges follow the real corners: concave corners skipped, angles from the outline', () => {
  const ell = edgesFor([footprintBuilding('l', L_RING)]).edges;
  const vertical = ell.filter((e) => e.kind === 'vertical');
  assert.equal(vertical.length, 5, 'six corners, one concave');
  assert.ok(vertical.every((e) => Math.abs(e.n - 1.5) < 1e-12));
  assert.equal(ell.filter((e) => e.kind === 'roof').length, 6);
  const hex = Array.from({ length: 6 }, (_, i) => [20 * Math.cos((i * Math.PI) / 3), 20 * Math.sin((i * Math.PI) / 3)]);
  const hexEdges = edgesFor([footprintBuilding('h', hex)]).edges.filter((e) => e.kind === 'vertical');
  assert.equal(hexEdges.length, 6);
  assert.ok(hexEdges.every((e) => Math.abs(e.n - 4 / 3) < 1e-9), 'exterior angle 240 degrees');
  // Shadow behind a hexagon is filled by diffraction round two of its corners (one corner cannot see both ends).
  const { paths, directBlocked } = findPaths([-40, 0, 1.5], [40, 0, 1.5], { settings: settings({ diffraction_model: 'wedge', diffraction_order: 2 }), buildings: [footprintBuilding('h', hex)], c: C });
  assert.ok(directBlocked);
  assert.ok(paths.some((p) => p.diffraction?.chain === 'EE' && p.diffraction.terms.every((t) => Math.abs(t.n - 4 / 3) < 1e-9)));
});

test('back-traced bearings reflect off angled walls', () => {
  const b = footprintBuilding('d', [[0, -10], [10, 0], [0, 10], [-10, 0]]);
  const { legs } = traceBearing([20, -5, 1.5], 180, { buildings: [b], reflection_order: 1, bounds: { min: [-100, -100], max: [100, 100] } });
  assert.equal(legs.length, 2);
  assert.equal(legs[0].ends_at, 'd:wall-0');
  assert.ok(Math.abs(legs[0].len - 15) < 1e-9);
  assert.ok(Math.abs(legs[1].dir[0]) < 1e-9 && Math.abs(legs[1].dir[1] + 1) < 1e-9, JSON.stringify(legs[1].dir));
});

test('the plan grid used for many buildings gives the same blocking as testing every building', () => {
  const rng = mulberry32(7);
  const buildings = [];
  for (let i = 0; i < 40; i++) {
    const x = rng() * 300 - 150;
    const y = rng() * 300 - 150;
    const w = 5 + rng() * 30;
    const d = 5 + rng() * 30;
    buildings.push(i % 2 ? newBuilding(`b${i}`, x, y, w, d, 5 + rng() * 30) : footprintBuilding(`b${i}`, L_RING.map(([u, v]) => [x + (u * w) / 40, y + (v * d) / 40]), 5 + rng() * 30));
  }
  const boxes = buildings.map(buildingBox);
  const point = () => [rng() * 400 - 200, rng() * 400 - 200, rng() * 30];
  let blocked = 0;
  for (let k = 0; k < 3000; k++) {
    const a = k % 10 ? point() : [Math.round(rng() * 10) * 20 - 100, -200, 2];
    const b = k % 10 ? point() : [a[0], 200, 2];
    const linear = boxes.some((box) => segmentBlocked(a, b, [box]));
    assert.equal(segmentBlocked(a, b, boxes), linear, JSON.stringify([a, b]));
    blocked += linear;
  }
  assert.ok(blocked > 300 && blocked < 2700, String(blocked));
});

test('outline blocking agrees with dense sampling along random segments', () => {
  const rng = mulberry32(11);
  const shapes = [footprintBuilding('l', L_RING, 12), footprintBuilding('h', Array.from({ length: 6 }, (_, i) => [20 * Math.cos(i), 20 * Math.sin(i * 1.3)]), 12)];
  for (const b of shapes) {
    const box = buildingBox(b);
    let blocked = 0;
    for (let k = 0; k < 2000; k++) {
      const a = [rng() * 80 - 30, rng() * 80 - 30, rng() * 15];
      const c = [rng() * 80 - 30, rng() * 80 - 30, rng() * 15];
      let sampled = false;
      for (let j = 1; j < 4000 && !sampled; j++) {
        const t = j / 4000;
        sampled = !!insideBuilding([a[0] + t * (c[0] - a[0]), a[1] + t * (c[1] - a[1]), a[2] + t * (c[2] - a[2])], [b]);
      }
      const got = segmentBlocked(a, c, [box]);
      // Dense sampling can miss a sliver shorter than a sample step; only that direction of disagreement is tolerated.
      if (got !== sampled) assert.ok(got && !sampled, JSON.stringify([a, c]));
      blocked += got;
    }
    assert.ok(blocked > 200, String(blocked));
  }
});
