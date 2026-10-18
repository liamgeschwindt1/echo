// Vertical behaviour of reflections (brief section E): ground and wall bounces keep the correct elevation, walls are finite in z,
// ring radii follow sqrt((c t)^2 - dz^2). Known limits: roofs and undersides do not reflect, back-trace is horizontal only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findPaths, reflectionImages } from '../src/sim/core/geometry.js';
import { defaultScenario, newBuilding } from '../src/sim/core/scenario.js';
import { pathReport } from '../src/sim/core/pathreport.js';
import { sliceRadius } from '../src/sim/core/wavefront.js';
import { speedOfSound } from '../src/sim/core/physics.js';

const C = speedOfSound(15);
const deg = (r) => (r * 180) / Math.PI;
const settings = (over = {}) => ({ ...defaultScenario().settings, air_absorption: false, ...over });

function elevationOf(path, from) {
  const d = [path.image[0] - from[0], path.image[1] - from[1], path.image[2] - from[2]];
  return deg(Math.asin(d[2] / Math.hypot(...d)));
}

test('ground bounce: arrival elevation is -atan((z_node + z_source) / d_horizontal), about -16.26 degrees for the brief example', () => {
  const src = [0, 0, 1.5];
  const node = [22.28, 0, 5];
  const { paths } = findPaths(src, node, { settings: settings({ ground_reflectivity: 0.8, reflection_order: 0 }), buildings: [], c: C });
  const ground = paths.find((p) => p.type === 'ground');
  const expected = -deg(Math.atan((5 + 1.5) / 22.28));
  assert.ok(Math.abs(expected - -16.26) < 0.01, `example value ${expected}`);
  assert.ok(Math.abs(elevationOf(ground, node) - expected) < 1e-9, `${elevationOf(ground, node)} vs ${expected}`);
  // Through the path report as well (the angle the node would see).
  const rep = pathReport({ centre: { paths, directBlocked: false }, node: { position: node }, source: { keyframes: [{ position: src }] }, bearing: null, settings: defaultScenario().settings });
  assert.ok(Math.abs(rep.paths.find((p) => p.type === 'ground').arrival_elevation_deg - expected) < 1e-9);
});

test('wall bounce: elevation is -asin(dz / unfolded length), unchanged by the vertical wall, about -7.57 degrees for the brief example', () => {
  const src = [0, 0, 1.5];
  const node = [16.34, 0, 5];
  // East face at x = -5: unfolded horizontal length 16.34 + 10 = 26.34 m, dz 3.5 m, path 26.57 m.
  const r = findPaths(src, node, { settings: settings({ ground_reflectivity: 0, reflection_order: 1, diffraction_order: 0, diffraction_model: 'maekawa' }), buildings: [newBuilding('w', -15, 0, 20, 20, 15)], c: C });
  const wall = r.paths.find((p) => p.type === 'wall');
  assert.ok(wall, 'wall path exists');
  assert.ok(Math.abs(wall.length - 26.57) < 0.01, `length ${wall.length}`);
  const expected = -deg(Math.asin(3.5 / wall.length));
  assert.ok(Math.abs(expected - -7.57) < 0.01, `example value ${expected}`);
  assert.ok(Math.abs(elevationOf(wall, node) - expected) < 1e-9);
  // The elevation is that of the unfolded line to the image source, whatever the wall's horizontal orientation.
  const horizontal = Math.hypot(wall.image[0] - node[0], wall.image[1] - node[1]);
  assert.ok(Math.abs(deg(Math.atan2(wall.image[2] - node[2], horizontal)) - expected) < 1e-9);
});

test('finite wall height: a 2 m wall does not reflect a 1.5 m source to a 5 m microphone (off_face); with diffraction an over-edge path appears', () => {
  const src = [0, 0, 1.5];
  const mic = [30, 0, 5];
  const low = [newBuilding('b1', -20, 0, 20, 20, 2)]; // east face at x = -10, top at z = 2
  const off = findPaths(src, mic, { settings: settings({ ground_reflectivity: 0, reflection_order: 1, diffraction_order: 0, diffraction_model: 'maekawa' }), buildings: low, c: C });
  assert.ok(!off.paths.some((p) => p.type === 'wall'));
  assert.ok(off.dropped.some((d) => d.type === 'wall' && d.reason === 'off_face'));
  const on = findPaths(src, mic, { settings: settings({ ground_reflectivity: 0, reflection_order: 1, diffraction_order: 1 }), buildings: low, c: C });
  assert.ok(!on.paths.some((p) => p.type === 'wall'));
  const over = on.paths.find((p) => p.type === 'diffracted' && p.surfaces.includes('b1:roof:east'));
  assert.ok(over, 'over-edge path');
  const z = over.hits[0][2];
  assert.ok(Math.abs(z - 2) < 1e-9, `diffraction point on the roof edge: z ${z}`);
  // A tall wall reflects the same geometry.
  const tall = findPaths(src, mic, { settings: settings({ ground_reflectivity: 0, reflection_order: 1, diffraction_order: 0, diffraction_model: 'maekawa' }), buildings: [newBuilding('b1', -20, 0, 20, 20, 15)], c: C });
  assert.ok(tall.paths.some((p) => p.type === 'wall'));
});

test('ring radius on the slice is sqrt((c t)^2 - dz^2) for the source and every image source', () => {
  const st = settings({ ground_reflectivity: 0.8, reflection_order: 2 });
  const src = [3, 4, 1.5];
  const slice = 1.5;
  const buildings = [newBuilding('b1', 20, 0, 10, 10, 15), newBuilding('b2', -15, 10, 8, 20, 12)];
  const t = 0.2;
  const images = [{ image: src }, ...reflectionImages(src, st, buildings)];
  assert.ok(images.length > 5);
  for (const img of images) {
    const dz = img.image[2] - slice;
    const rho = sliceRadius(C, t, dz);
    if (rho === null) continue;
    const P = [img.image[0] + rho, img.image[1], slice];
    assert.ok(Math.abs(Math.hypot(P[0] - img.image[0], P[1] - img.image[1], P[2] - img.image[2]) - C * t) < 1e-9);
  }
  // The ground image sits below the ground: dz uses its negative height.
  const ground = reflectionImages(src, st, []).find((i) => i.seq.length === 1);
  assert.equal(ground.image[2], -1.5);
});

test('known limits: a roof never produces a reflection path (only blocks and diffracts)', () => {
  // Source and microphone both above a roof: no roof bounce is listed, whatever the reflection order.
  const r = findPaths([0, 0, 25], [10, 0, 25], { settings: settings({ ground_reflectivity: 0, reflection_order: 2, diffraction_order: 0, diffraction_model: 'maekawa' }), buildings: [newBuilding('b1', 5, 0, 30, 30, 15)], c: C });
  assert.ok(r.paths.every((p) => p.type === 'direct'), `paths ${r.paths.map((p) => p.type)}`);
});
