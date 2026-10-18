import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSurfaces, findPaths, insideBuilding, CONCRETE_ABSORPTION } from '../src/sim/core/geometry.js';
import { defaultScenario, newBuilding, newNode, newSource, placementErrors, validateScenario } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { speedOfSound } from '../src/sim/core/physics.js';
import { mulberry32, gaussian } from '../src/sim/core/rng.js';

const FS = 48000;
const settings = (over = {}) => ({ ...defaultScenario().settings, air_absorption: false, ground_reflectivity: 0, ...over });
const wallAt = (id, xMax, yMin, yMax, h = 15) => newBuilding(id, xMax - 10, (yMin + yMax) / 2, 20, yMax - yMin, h);

function burst(ms = 20, seed = 3) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round((ms / 1000) * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.sin((Math.PI * i) / out.length);
  return out;
}

test('one-wall mirror: lengths, delay difference and level (acceptance 2)', () => {
  const s = settings();
  const c = speedOfSound(15);
  const b = wallAt('b1', -10, -10, 10);
  const { paths } = findPaths([0, 0, 1.5], [30, 0, 5], { settings: s, buildings: [b], c });
  const direct = paths.find((p) => p.type === 'direct');
  const wall = paths.find((p) => p.type === 'wall');
  assert.ok(Math.abs(direct.length - 30.2) < 0.005, String(direct.length));
  assert.ok(Math.abs(wall.length - 50.12) < 0.005, String(wall.length));
  assert.deepEqual(wall.surfaces, ['b1:east']);
  assert.ok(Math.abs(wall.hits[0][2] - 2.2) < 1e-9);
  const dtSamples = ((wall.length - direct.length) / c) * FS;
  assert.ok(Math.abs(dtSamples - 0.0585 * FS) < 12, String(dtSamples)); // about 58.5 ms
  const levelDb = 20 * Math.log10(wall.gain / wall.length / (direct.gain / direct.length));
  assert.ok(Math.abs(levelDb + 4.5) < 0.05, String(levelDb)); // -4.40 dB spreading, -0.13 dB wall factor
  assert.ok(Math.abs(levelDb - (20 * Math.log10(30.2 / 50.12) + 10 * Math.log10(1 - CONCRETE_ABSORPTION))) < 0.01);
});

test('one-wall mirror in a render: second arrival 58.5 ms later at about -4.5 dB', () => {
  const scn = defaultScenario();
  Object.assign(scn.settings, { air_absorption: false, ground_reflectivity: 0, noise_floor_db_spl: -40, mic_self_noise_db_spl: -40 });
  scn.buildings = [wallAt('b1', -10, -10, 10)];
  scn.nodes = [{ ...newNode('n1', 30, 0), mic_spacing_m: 0.001 }];
  scn.sources = [{ ...newSource('s1', 'b', 0, 0, 100), start_s: 0.2 }];
  const out = renderScenario(scn, new Map([['b', burst()]]), { lengthS: 1 });
  const sig = out.nodes[0].mics[0];
  const rms = (from, to) => Math.sqrt(sig.slice(from, to).reduce((a, v) => a + v * v, 0) / (to - from));
  const c = speedOfSound(15);
  const t1 = Math.round((0.2 + 30.2 / c) * FS);
  const t2 = Math.round((0.2 + 50.12 / c) * FS);
  assert.ok(Math.abs((t2 - t1) / FS - 0.0585) < 0.0006);
  const ratio = 20 * Math.log10(rms(t2 - 100, t2 + 1100) / rms(t1 - 100, t1 + 1100));
  assert.ok(Math.abs(ratio + 4.53) < 0.1, String(ratio));
});

test('blocked direct path is removed and first arrival is the earliest reflection (acceptance 3)', () => {
  const scn = defaultScenario();
  Object.assign(scn.settings, { air_absorption: false, ground_reflectivity: 0, noise_floor_db_spl: 20 });
  scn.buildings = [newBuilding('b1', 50, 0, 10, 10, 15), newBuilding('b2', 50, 30, 40, 4, 15)];
  scn.nodes = [newNode('n1', 100, 0)];
  scn.sources = [{ ...newSource('s1', 'b', 0, 0, 110), start_s: 0.2 }];
  const out = renderScenario(scn, new Map([['b', burst()]]), { lengthS: 1.5 });
  const [r] = analyseScenario(scn, out, new Map([['b', 0.02]]));
  const n = r.nodes[0];
  assert.equal(n.direct_blocked, true);
  assert.ok(!n.paths.some((p) => p.type === 'direct'));
  assert.ok(n.paths.length > 0);
  const earliest = Math.min(...n.paths.map((p) => p.delay_s));
  assert.ok(Math.abs(n.first_arrival_s - (0.2 + earliest)) < 1e-9);
  assert.equal(n.level_reference_check ?? n.paths[0].level_reference, 'strongest_path');
});

test('blocking can be switched off, and then the direct path is kept but flagged', () => {
  const s = settings({ block_direct_behind_buildings: false });
  const b = newBuilding('b1', 50, 0, 10, 10, 15);
  const r = findPaths([0, 0, 1.5], [100, 0, 5], { settings: s, buildings: [b], c: 340 });
  assert.equal(r.directBlocked, true);
  assert.ok(r.paths.some((p) => p.type === 'direct'));
});

test('placement inside a building is rejected, above the roofline is fine (acceptance 4)', () => {
  const scn = defaultScenario();
  scn.buildings = [newBuilding('b1', 0, 0, 10, 10, 3)];
  scn.sources = [newSource('s1', 'b', 1, 1)];
  scn.nodes = [newNode('n1', 1, 1)]; // z = 5, above a 3 m roof
  assert.deepEqual(placementErrors(scn), ['source s1 is inside building b1']);
  assert.throws(() => validateScenario(scn), /inside building/);
  assert.ok(insideBuilding([0, 0, 1], scn.buildings));
  assert.ok(!insideBuilding([0, 0, 4], scn.buildings));
});

test('version 0.1 files still load and gain an empty building list', () => {
  const old = { version: '0.1', settings: { temperature_c: 10 }, nodes: [newNode('n1', 0, 0)], sources: [newSource('s1', 'b', 5, 5)] };
  const v = validateScenario(old);
  assert.equal(v.version, '0.2');
  assert.deepEqual(v.buildings, []);
  assert.equal(v.settings.temperature_c, 10);
  assert.throws(() => validateScenario({ ...old, version: '0.9' }), /unsupported/);
});

test('order 2 finds wall-wall and wall-ground paths, within the cap', () => {
  const s = settings({ ground_reflectivity: 0.8, reflection_order: 2 });
  const bs = [wallAt('b1', -10, -20, 20), newBuilding('b2', 20, 25, 40, 10, 15)];
  const { paths } = findPaths([0, 0, 1.5], [30, 5, 5], { settings: s, buildings: bs, c: 340 });
  assert.ok(paths.some((p) => p.surfaces.length === 2 && p.type === 'wall'));
  assert.ok(paths.some((p) => p.surfaces.includes('ground') && p.surfaces.length === 2));
  assert.ok(paths.length <= 64);
  assert.ok(buildSurfaces(bs).length === 9);
});

test('identical scenario and seed give identical path diagnostics (acceptance 5)', () => {
  const make = () => {
    const scn = defaultScenario();
    scn.buildings = [newBuilding('b1', 50, 30, 30, 6, 15)];
    scn.nodes = [newNode('n1', 100, 0)];
    scn.sources = [{ ...newSource('s1', 'b', 0, 0, 110), start_s: 0.2 }];
    const out = renderScenario(scn, new Map([['b', burst()]]), { lengthS: 1.2 });
    return { out, res: analyseScenario(scn, out, new Map([['b', 0.02]])) };
  };
  const a = make();
  const b = make();
  assert.deepEqual(a.res[0].nodes[0].paths, b.res[0].nodes[0].paths);
  assert.deepEqual(a.out.nodes[0].mics[1], b.out.nodes[0].mics[1]);
});

test('saved test scenarios load (acceptance 2 and 7 inputs)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('./scenarios/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const v = validateScenario(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    assert.equal(v.version, '0.2', f);
  }
});
