import test from 'node:test';
import assert from 'node:assert/strict';
import { valueHash } from '../../../scripts/lib/value-hash.mjs';

test('profiling value hash is allocation/order invariant but byte and type exact', () => {
  const x = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4);
  assert.equal(valueHash({ a: x, b: -0 }), valueHash({ b: -0, a: new Uint8Array([1, 2, 3]) }));
  assert.notEqual(valueHash(x), valueHash(new Uint8Array([1, 2, 4])));
  assert.notEqual(valueHash(x), valueHash(new Int8Array([1, 2, 3])));
  assert.notEqual(valueHash(-0), valueHash(0));
  assert.notEqual(valueHash([, 1]), valueHash([undefined, 1]));
  assert.throws(() => valueHash(new Map()), /Unsupported/);
});
