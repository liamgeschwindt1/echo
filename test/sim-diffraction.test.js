import test from 'node:test';
import assert from 'node:assert/strict';
import { diffractionLossDb, findPaths } from '../src/sim/core/geometry.js';
import { defaultScenario, newBuilding, newNode, newSource } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { renderComponents } from '../src/sim/core/components.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { mulberry32, gaussian } from '../src/sim/core/rng.js';

const FS = 48000;
const C = 340.39;

function burst(ms = 30, seed = 3) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round((ms / 1000) * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.sin((Math.PI * i) / out.length);
  return out;
}

const tone = (f, ms = 300) => Float32Array.from({ length: Math.round((ms / 1000) * FS) }, (_, i) => Math.sin((2 * Math.PI * f * i) / FS) * Math.sin((Math.PI * i) / Math.round((ms / 1000) * FS)) ** 2);

function scene(over = {}, buildings = [], nodes = [], sources = []) {
  const s = defaultScenario();
  Object.assign(s.settings, { air_absorption: false, ground_reflectivity: 0, noise_floor_db_spl: 25, mic_self_noise_db_spl: 10, reflection_order: 0, ...over });
  s.buildings = buildings;
  s.nodes = nodes;
  s.sources = sources;
  return s;
}

test('thin screen: about 5 dB at the shadow edge, 20 dB cap for large N', () => {
  assert.ok(Math.abs(diffractionLossDb(0, 1000, C) - 4.77) < 0.01); // 10 log10(3)
  assert.ok(diffractionLossDb(0.001, 500, C) < 5.2);
  assert.equal(diffractionLossDb(5, 3000, C), 20);
  assert.ok(diffractionLossDb(0.3, 200, C) < diffractionLossDb(0.3, 3000, C) - 5);
});

test('diffraction_order 0 changes nothing: no diffracted paths, identical signals', () => {
  const b = [newBuilding('b1', 50, 0, 10, 10, 15)];
  const mk = (over) => scene(over, b, [newNode('n1', 100, 0)], [{ ...newSource('s1', 'b', 0, 0, 110), start_s: 0.2 }]);
  const a = mk({});
  delete a.settings.diffraction_order;
  const z = mk({ diffraction_order: 0 });
  const clips = new Map([['b', burst()]]);
  const ra = renderScenario(a, clips, { lengthS: 1.2 });
  const rz = renderScenario(z, clips, { lengthS: 1.2 });
  assert.deepEqual(ra.nodes[0].mics[2], rz.nodes[0].mics[2]);
  assert.ok(!rz.paths[0].centre[0].paths.some((p) => p.type === 'diffracted'));
});

test('order 1 adds diffracted paths only when the direct path is blocked', () => {
  const s = scene({ diffraction_order: 1 });
  const free = findPaths([0, 0, 1.5], [100, 0, 5], { settings: s.settings, buildings: [newBuilding('b1', 50, 40, 10, 10, 15)], c: C });
  assert.ok(!free.paths.some((p) => p.type === 'diffracted'));
  const blocked = findPaths([0, 0, 1.5], [100, 0, 5], { settings: s.settings, buildings: [newBuilding('b1', 50, 0, 10, 10, 15)], c: C });
  const d = blocked.paths.filter((p) => p.type === 'diffracted');
  assert.ok(d.length >= 2);
  for (const p of d) assert.ok(p.length > p.direct_distance);
});

test('node behind a building: bearing points at a corner and the picked path is diffracted', () => {
  const s = scene({ diffraction_order: 1, noise_floor_db_spl: 30 }, [newBuilding('b1', 50, 347, 10, 700, 100)], [newNode('n1', 100, 30)], [{ ...newSource('s1', 'b', 0, 0, 125), start_s: 0.2 }]);
  const out = renderScenario(s, new Map([['b', burst(60)]]), { lengthS: 1.4 });
  const [r] = analyseScenario(s, out, new Map([['b', 0.06]]));
  const n = r.nodes[0];
  assert.equal(n.direct_blocked, true);
  assert.equal(n.picked_path_type, 'diffracted');
  const picked = n.paths[n.picked_path_index];
  assert.match(picked.surfaces[0], /corner/);
  assert.ok(n.azimuth_error_deg > 10, `error vs true source ${n.azimuth_error_deg}`); // points at the corner, not the source
  assert.ok(Math.abs(((n.bearing.azimuth_deg - picked.arrival_azimuth_deg + 540) % 360) - 180) <= 5);
  assert.equal(r.fix, null); // one node only
  const withTwo = { ...s, nodes: [newNode('n1', 100, 30), newNode('n2', 100, -60)] };
  const out2 = renderScenario(withTwo, new Map([['b', burst(60)]]), { lengthS: 1.4 });
  const [r2] = analyseScenario(withTwo, out2, new Map([['b', 0.06]]));
  assert.ok(r2.nodes[0].picked_path_type === 'diffracted');
  if (r2.fix) assert.equal(r2.fix.fix_suspect, true);
});

test('200 Hz loses much less than 3 kHz on the same diffracted path (thin screen)', () => {
  const run = (f) => {
    const s = scene({ diffraction_order: 1 }, [newBuilding('b1', 50, 0, 0.5, 40, 6)], [{ ...newNode('n1', 60, 0), mic_spacing_m: 0.01 }], [{ ...newSource('s1', 't', 0, 0, 100), start_s: 0.1 }]);
    const out = renderComponents(s, new Map([['t', tone(f)]]), 1, 0, 'by_path');
    const sig = out.series.find((x) => x.id === 'diffracted').mics[0];
    let sum = 0;
    for (const v of sig) sum += v * v;
    return 10 * Math.log10(sum / sig.length);
  };
  const low = run(200);
  const high = run(3000);
  assert.ok(low - high > 5, `200 Hz ${low.toFixed(1)} dB vs 3 kHz ${high.toFixed(1)} dB`);
});
