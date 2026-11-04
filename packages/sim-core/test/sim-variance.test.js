import test from 'node:test';
import assert from 'node:assert/strict';
import { decompose, varianceIntervals } from '../../../scripts/lib/variance.mjs';

test('variance shares recover a balanced additive population and preserve missing support', () => {
  const rows = [1, 2, 3].flatMap((seed) => [0, 1].flatMap((a) => [0, 1].map((b) => ({ seed, a, b, y: 2 * a + b }))));
  const factors = { a: [0, 1], b: [0, 1] }, result = decompose(rows, 'y', factors);
  assert.ok(Math.abs(result.explained - 1) < 1e-12);
  assert.ok(Math.abs(result.shares.a - 0.8) < 1e-12);
  assert.ok(Math.abs(result.shares.b - 0.2) < 1e-12);
  assert.equal(decompose(rows.map((r) => ({ ...r, y: r.a ? null : r.y })), 'y', factors).shares, null);
  assert.equal(decompose(rows.map((r) => ({ ...r, y: 1 })), 'y', factors).explained, null);
  const first = varianceIntervals(rows, 'y', factors, { samples: 20 });
  assert.deepEqual(first, varianceIntervals(rows, 'y', factors, { samples: 20 }));
  assert.equal(first.clusters, 3);
  assert.ok(Math.abs(first.intervals.shares.a.low - 0.8) < 1e-12);
});
