import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ARRAYS, GENERATORS, arrayMetrics, micList, validateArrayModel } from '../src/arrays.js';
import { nodeShares } from '../src/attribution.js';
import { defaultScenario, newNode, newSource } from '../src/scenario.js';

test('built-in arrays all validate and include dome, puck and ball subsets', () => {
  for (const a of BUILTIN_ARRAYS) validateArrayModel(a);
  const ids = BUILTIN_ARRAYS.map((a) => a.id);
  for (const id of ['dome12_d230', 'puck12_d210', 'ball12_d180_sub4', 'ball12_d180_sub6', 'ball12_d180_sub8']) assert.ok(ids.includes(id), id);
  for (const n of [4, 6, 8]) assert.equal(Object.keys(BUILTIN_ARRAYS.find((a) => a.id === `ball12_d180_sub${n}`).mics).length, n);
});

test('subsets keep ball coordinates and have a vertical baseline from 4 mics up', () => {
  const ball = BUILTIN_ARRAYS.find((a) => a.id === 'ball12_d180').mics;
  const sub = BUILTIN_ARRAYS.find((a) => a.id === 'ball12_d180_sub4');
  for (const [k, p] of Object.entries(sub.mics)) assert.deepEqual(p, ball[k]);
  assert.ok(arrayMetrics(micList(sub)).vertical_baseline_mm > 0);
});

test('dome and puck generators give 12 mics with a vertical baseline', () => {
  for (const key of ['dome', 'puck']) {
    const m = GENERATORS[key].build(Object.fromEntries(GENERATORS[key].params.map(([k, , d]) => [k, d])));
    assert.equal(Object.keys(m).length, 12);
    assert.ok(arrayMetrics(Object.values(m)).vertical_baseline_mm > 0);
  }
});

test('node shares sum to 100 and separate heard from unheard sources', () => {
  const scenario = defaultScenario();
  scenario.nodes = [newNode('n1', 0, 0)];
  scenario.sources = [newSource('s1', 'a', 10, 0, 90), newSource('s2', 'b', 100, 0, 90)];
  const results = [
    { source_id: 's1', true_position: [10, 0, 1.5], nodes: [{ node_id: 'n1', heard: true, snr_db: 40 }] },
    { source_id: 's2', true_position: [100, 0, 1.5], nodes: [{ node_id: 'n1', heard: false, snr_db: -5 }] }
  ];
  const rows = nodeShares(scenario, results, 'n1');
  assert.equal(rows[0].measured_share_pct, 100);
  assert.equal(rows[1].measured_share_pct, null);
  assert.ok(Math.abs(rows[0].true_share_pct + rows[1].true_share_pct - 100) < 1e-9);
  assert.ok(rows[0].true_share_pct > 98);
  assert.equal(nodeShares(scenario, results, 'nope'), null);
});
