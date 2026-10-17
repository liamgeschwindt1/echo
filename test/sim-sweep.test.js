import test from 'node:test';
import assert from 'node:assert/strict';
import { sweep, runTrials, summarise, percentile, SWEEP_PARAMS } from '../src/sim/core/sweep.js';
import { defaultScenario, newNode, newSource } from '../src/sim/core/scenario.js';
import { mulberry32, gaussian } from '../src/sim/core/rng.js';

const FS = 48000;
const rng = mulberry32(5);
const clip = new Float32Array(FS * 0.3).map((_, i) => gaussian(rng) * Math.exp(-i / FS / 0.02));
const clips = new Map([['c', clip]]);
const durations = new Map([['c', 0.3]]);

function base() {
  const s = defaultScenario();
  s.nodes = [newNode('a', 0, 0), newNode('b', 60, 0), newNode('c', 30, 50)];
  s.sources = [{ ...newSource('s1', 'c', 25, 20, 120), start_s: 1 }];
  return s;
}

test('percentile', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.equal(percentile([], 50), null);
});

test('node_count and distance_scale variants do not mutate the input', () => {
  const s = base();
  assert.equal(SWEEP_PARAMS.node_count(s, 2).nodes.length, 2);
  const far = SWEEP_PARAMS.distance_scale(s, 2);
  assert.notDeepEqual(far.sources[0].keyframes[0].position, s.sources[0].keyframes[0].position);
  assert.deepEqual(s.sources[0].keyframes[0].position, [25, 20, 1.5]);
});

test('repeats vary the seed and summarise', () => {
  const trials = runTrials(base(), clips, durations, { seeds: 3 });
  assert.deepEqual(trials.map((t) => t.seed), [1, 2, 3]);
  const s = summarise(trials);
  assert.equal(s.fix_rate, 1);
  assert.ok(s.error_3d_median_m < 2);
});

test('more nodes localise where one cannot', () => {
  const rows = sweep(base(), clips, durations, { param: 'node_count', values: [1, 3], seeds: 1 });
  assert.equal(rows[0].fix_rate, 0);
  assert.equal(rows[1].fix_rate, 1);
});
