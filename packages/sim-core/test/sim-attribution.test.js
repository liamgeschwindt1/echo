import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateNoiseShares } from '../../../scripts/lib/noise-attribution.mjs';

test('separate attribution recovers noiseless powers and preserves unidentifiable nulls', () => {
  const pois = [[-35, 20, 1.5], [30, 25, 1.5], [-10, -35, 1.5]], receptor = [0, 0, 1.5];
  const square = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
  for (const n of [3, 6]) {
    const positions = Array.from({ length: n }, (_, i) => [25 * Math.cos(i * 2 * Math.PI / n), 25 * Math.sin(i * 2 * Math.PI / n), 1.5]);
    const expected = [0.6, 0.25, 0.15], sourcePowers = expected.map((p, i) => p * square(receptor, pois[i]));
    const powers = positions.map((p) => pois.reduce((sum, q, j) => sum + sourcePowers[j] / square(p, q), 0));
    const input = { positions, pois, powers, receptor }, result = estimateNoiseShares(input);
    assert.equal(result.status, 'estimated');
    result.shares.forEach((p, i) => assert.ok(Math.abs(p - expected[i]) < 1e-9));
    assert.deepEqual(result, estimateNoiseShares(input));
    assert.equal(estimateNoiseShares({ ...input, positions: positions.slice(0, 2), powers: powers.slice(0, 2) }).shares, null);
    assert.equal(estimateNoiseShares({ ...input, positions: positions.map(() => positions[0]) }).shares, null);
    assert.throws(() => estimateNoiseShares({ ...input, powers: powers.map(() => NaN) }), /Invalid/);
    assert.equal(estimateNoiseShares({ ...input, powers: powers.map(() => 0) }).shares, null);
  }
});
