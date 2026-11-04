import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILTIN_ARRAYS, bearingError, micList } from '../src/arrays.js';
import { randomScene } from '../src/benchmark/scenes.js';
import { contentHash } from '../src/benchmark/cache.js';
import { goldenFor } from './golden-lib.js';
import { ARRAY_VOLUME_SCENES } from './golden-scenes.js';

const model = (id) => BUILTIN_ARRAYS.find((a) => a.id === id);
function triple(mics) {
  const [p, ...rest] = Object.values(mics).map((point) => point.map((v) => BigInt(Math.round(v * 10))));
  const [a, b, c] = rest.map((point) => point.map((v, i) => v - p[i]));
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  return det < 0n ? -det : det;
}
test('new four-mic subset has globally maximum volume, with exact deterministic ties', () => {
  const selected = model('ball12_d180_sub4_maxvol').mics;
  const entries = Object.entries(model('ball12_d180').mics);
  let maximum = 0n, combinations = 0;
  for (let a = 0; a < 9; a++) for (let b = a + 1; b < 10; b++) for (let c = b + 1; c < 11; c++) for (let d = c + 1; d < 12; d++) {
    const volume = triple(Object.fromEntries([a, b, c, d].map((i) => entries[i])));
    if (volume > maximum) maximum = volume;
    combinations++;
  }
  assert.equal(combinations, 495);
  assert.equal(triple(selected), maximum);
  assert.equal(maximum, 1795785888n);
  assert.deepEqual(Object.keys(selected), ['A1', 'C1', 'C2', 'C3']);
  for (const [name, point] of Object.entries(selected)) assert.deepEqual(point, model('ball12_d180').mics[name]);
});
test('legacy subset stays coplanar while opt-in geometry resolves all three axes', () => {
  const legacy = model('ball12_d180_sub4').mics;
  assert.deepEqual(Object.keys(legacy), ['A1', 'B2', 'C1', 'D2']);
  assert.equal(triple(legacy), 0n);
  assert.equal(bearingError(micList(model('ball12_d180_sub4'))).az_deg, Infinity);
  const error = bearingError(micList(model('ball12_d180_sub4_maxvol')));
  assert.ok(Number.isFinite(error.az_deg));
  assert.ok(Number.isFinite(error.el_deg));
});
test('adding a library array does not change any frozen held-out site input', async () => {
  assert.equal(await contentHash(Array.from({ length: 8 }, (_, i) => randomScene(7919 * (i + 1)))), '46235eebc422b57db997fcb40d482f6cb191d21e7957043f423e0a02a18e9d71');
});
test('opt-in noncoplanar array has an independent bit-identical signal golden', () => {
  const expected = JSON.parse(readFileSync(new URL('./golden/golden-array-max-volume.json', import.meta.url), 'utf8'));
  const current = goldenFor('maximum_volume_four', ARRAY_VOLUME_SCENES);
  assert.deepEqual(current.mics, expected.maximum_volume_four.mics);
});
