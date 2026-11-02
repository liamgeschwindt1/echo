import test from 'node:test';
import assert from 'node:assert/strict';
import { SWEEP_PARAMS, SWEEP_VARIABLES, sweepCases, sweepMulti } from '../src/sweep.js';
import { BUILTIN_ARRAYS, arrayImportTemplate, parseArrayImport } from '../src/arrays.js';
import { micPositions } from '../src/mics.js';
import { defaultScenario, newNode, newSource } from '../src/scenario.js';
import { mulberry32, gaussian } from '../src/rng.js';

const FS = 48000;
const rng = mulberry32(5);
const clips = new Map([['c', new Float32Array(FS * 0.3).map((_, i) => gaussian(rng) * Math.exp(-i / FS / 0.02))]]);
const durations = new Map([['c', 0.3]]);
const arrays = BUILTIN_ARRAYS.filter((a) => ['flat4_100', 'ball12_d180'].includes(a.id));

function base() {
  const s = defaultScenario();
  s.nodes = [newNode('a', 0, 0), newNode('b', 60, 0), newNode('c', 30, 50)];
  s.sources = [{ ...newSource('s1', 'c', 25, 20, 120), start_s: 1 }];
  return s;
}

test('sweep variables list mic array first and every one has a variant', () => {
  assert.equal(SWEEP_VARIABLES[0].id, 'mic_array');
  for (const v of SWEEP_VARIABLES) assert.equal(typeof SWEEP_PARAMS[v.id], 'function', v.id);
});

test('mic_array variant swaps every node layout without touching the input', () => {
  const s = base();
  const out = SWEEP_PARAMS.mic_array(s, 'ball12_d180', { arrays });
  assert.ok(out.nodes.every((n) => micPositions(n).length === 12));
  assert.equal(s.nodes[0].mic_layout, 'flat_square');
  assert.throws(() => SWEEP_PARAMS.mic_array(s, 'nope', { arrays }), /unknown mic array/);
});

test('cases are the cartesian product', () => {
  const cases = sweepCases([{ param: 'a', values: [1, 2] }, { param: 'b', values: ['x', 'y', 'z'] }]);
  assert.equal(cases.length, 6);
  assert.deepEqual(cases[4], { a: 2, b: 'y' });
});

test('sweepMulti compares mic arrays and rejects huge grids', () => {
  const rows = sweepMulti(base(), clips, durations, { vars: [{ param: 'mic_array', values: ['flat4_100', 'ball12_d180'] }], seeds: 1, arrays });
  assert.deepEqual(rows.map((r) => r.values.mic_array), ['flat4_100', 'ball12_d180']);
  for (const r of rows) assert.equal(r.trials, 1);
  const many = { param: 'noise_floor_db_spl', values: Array.from({ length: 61 }, (_, i) => i) };
  assert.throws(() => sweepMulti(base(), clips, durations, { vars: [many], seeds: 1 }), /too many/);
  assert.throws(() => sweepMulti(base(), clips, durations, { vars: [{ param: 'zzz', values: [1] }], seeds: 1 }), /unknown sweep parameter/);
});

test('the import template round-trips and its readme keys are skipped', () => {
  const models = parseArrayImport(JSON.parse(JSON.stringify(arrayImportTemplate())));
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'my_array');
  assert.equal(Object.keys(models[0].mics).length, 4);
});

test('import converts units and reports which entry is bad', () => {
  const m = parseArrayImport({ a: { name: 'A', units: 'm', mics: { M1: [0.05, 0, 0], M2: [-0.05, 0, 0] } } });
  assert.deepEqual(m[0].mics.M1, [50, 0, 0]);
  assert.throws(() => parseArrayImport({ bad: { name: 'B', mics: { M1: [0, 0, 0] } } }), /bad: array: needs 2/);
  assert.throws(() => parseArrayImport({ a: { name: 'A', units: 'ft', mics: {} } }), /units/);
  assert.throws(() => parseArrayImport({ _readme: 'x' }), /no arrays/);
  assert.equal(parseArrayImport({ name: 'Single one', mics: { M1: [0, 0, 0], M2: [10, 0, 0] } }, 'f')[0].id, 'single-one');
});
