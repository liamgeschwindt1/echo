import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreMeasured, SCORING_VERSION, DETECTION_BEARING_TOLERANCE_DEG } from '../src/benchmark/score.js';
import { metricValues, compareReports, failureAtlas } from '../src/benchmark/metrics.js';
import { finishExperiment, rescoreReport } from '../src/benchmark/runner.js';
import { buildJobs } from '../src/benchmark/experiment.js';
import { defaultScenario, newNode, newSource } from '../src/scenario.js';

function fixture(intervals, errors = intervals.map(() => 0)) {
  const scenario = defaultScenario();
  scenario.nodes = [newNode('n1', 0, 0), newNode('n2', 10, 0)];
  scenario.sources = [{ ...newSource('s1', 'click', 5, 10, 100), start_s: 0 }];
  const measured = {
    options: { bearing_sigma_deg: 2.5 },
    nodes: scenario.nodes.map((node) => ({ tracks: intervals.map((times) => ({
      windows: times.map((t_s) => ({ t_s, az_deg: Math.atan2(10, 5 - node.position[0]) * 180 / Math.PI }))
    })) })),
    fixes: intervals.map((times, i) => ({
      final_position: [5 + errors[i], 10], low_confidence: true, ambiguous: false, reliable: true,
      node_tracks: [`0:${i}`, `1:${i}`],
      positions: times.map((t_e) => ({ t_e, position: [5 + errors[i], 10] }))
    }))
  };
  return { scenario, measured };
}
const score = ({ scenario, measured }) => scoreMeasured(scenario, measured, { c: 343 });

test('separate sound bursts may match one source without false unmatched fixes', () => {
  const scores = score(fixture([[1, 2], [4, 5]]));
  assert.equal(scores.fixes.length, 2);
  assert.equal(scores.sources.length, 1);
  assert.equal(scores.unmatched_fixes, 0);
  const metrics = metricValues([{ scores, runtime_ms: 0 }]);
  assert.equal(metrics.wrong_fix_rate, 0);
  assert.equal(metrics.source_fix_rate, 1);
  assert.equal(metrics.track_fix_count, 4);
});
test('three-node detectability comes from source-aligned tracks even without a fused fix', () => {
  const scenario = defaultScenario();
  scenario.nodes = [newNode('n1', -10, 0), newNode('n2', 10, 0), newNode('n3', 0, 10), newNode('n4', -10, -10)];
  scenario.sources = [newSource('s1', 'click', 20, 20, 100)];
  const measured = {
    options: { bearing_sigma_deg: 2.5 },
    nodes: scenario.nodes.map((node, i) => {
      const source = scenario.sources[0].keyframes[0].position;
      const bearing = Math.atan2(source[1] - node.position[1], source[0] - node.position[0]) * 180 / Math.PI;
      return { tracks: [{ windows: [{ t_s: i === 2 ? 2.9 : 3.1, az_deg: bearing }] }] };
    }),
    fixes: []
  };
  const scores = scoreMeasured(scenario, measured, { c: 343 });
  assert.equal(scores.sources[0].nodes.filter((node) => node.detected).length, 3);
  assert.match(scores.sources[0].nodes[0].detection_method, new RegExp(`${DETECTION_BEARING_TOLERANCE_DEG} degrees`));
  assert.equal(metricValues([{ scores, runtime_ms: 0 }]).detectable_3_node_events_within_10m, 0);
  const outsideClip = scoreMeasured(scenario, measured, { c: 343, clip_durations: new Map([['click', 0.05]]) });
  assert.equal(outsideClip.sources[0].nodes.filter((node) => node.detected).length, 0);
});
test('every assigned episode enters error quantiles and suspect metrics, not just the closest', () => {
  const scores = score(fixture([[1, 2], [4, 5]], [0, 15]));
  const metrics = metricValues([{ scores, runtime_ms: 0 }]);
  assert.equal(scores.sources[0].horizontal_m, 0);
  assert.equal(metrics.horizontal_median_m, 15);
  assert.equal(metrics.horizontal_p90_m, 15);
  assert.equal(metrics.wrong_fix_rate, 0.5);
  assert.equal(metrics.within_target_rate, 0.5);
  assert.equal(metrics.suspect_recall, 1);
  assert.equal(metrics.suspect_precision, 0.5);
});
test('overlapping and touching hypotheses remain one-to-one and unmatched counts cannot improve success', () => {
  for (const second of [[1.5, 2.5], [2, 3]]) {
    const scores = score(fixture([[1, 2], second]));
    assert.equal(scores.fixes.length, 1);
    assert.equal(scores.unmatched_fixes, 1);
    assert.equal(metricValues([{ scores, runtime_ms: 0 }]).wrong_fix_rate, 0.5);
  }
});
test('a late precise burst cannot hide an earlier wrong burst; absent emission times fail explicitly', () => {
  const input = fixture([[1, 2], [4, 5]], [15, 0]);
  assert.equal(metricValues([{ scores: score(input), runtime_ms: 0 }]).wrong_fix_rate, 0.5);
  input.measured.fixes[0].positions = [];
  assert.throws(() => score(input), /without emission times/);
});
test('failure atlas includes every wrong episode and unmatched hypothesis without inventing spatial error', () => {
  const run = { job: { scene: 'sparse_20' }, scores: score(fixture([[1, 2], [4, 5]], [0, 15])) };
  const [atlas] = failureAtlas([run]);
  assert.equal(atlas.failures, 1);
  assert.equal(atlas.median_error_m, 15);
  assert.equal(atlas.unmatched_fixes, 0);
  run.scores = score(fixture([[1, 2], [1.5, 2.5]]));
  const [duplicates] = failureAtlas([run]);
  assert.equal(duplicates.failures, 1);
  assert.equal(duplicates.no_fix, 0);
  assert.equal(duplicates.unmatched_fixes, 1);
  assert.equal(duplicates.median_error_m, null);
});
test('explicit re-scoring preserves inference and originals, updates provenance and rejects mixed conventions', () => {
  const { scenario, measured } = fixture([[1, 2], [4, 5]]);
  const { experiment, configs, jobs } = buildJobs({ name: 'rescore', scenes: ['sparse_20'], seeds: [1], realism: ['off'], analysis_modes: ['measured_only'], mode: 'grid', sweeps: [] });
  const run = { job: jobs[0], scenario, inference: measured, scores: scoreMeasured(scenario, measured, { c: 343 }), manifest: { code_version: 'original-inference' }, cache_keys: { render: 'audio', run: 'old-result' }, runtime_ms: 0 };
  const original = finishExperiment(experiment, configs, [run], { code_version: 'original-inference' });
  original.manifest.scoring_version = 'source-one-to-one-v1';
  const before = structuredClone(original);
  const updated = rescoreReport(original, { code_version: 'new-scoring', git_hash: 'revision', dirty: false });
  assert.deepEqual(original, before);
  assert.deepEqual(updated.runs[0].inference, measured);
  assert.equal(updated.runs[0].manifest.code_version, 'original-inference');
  assert.equal(updated.manifest.scoring_version, SCORING_VERSION);
  assert.equal(updated.manifest.scoring_provenance.code_version, 'new-scoring');
  assert.equal(updated.runs[0].cache_keys.run, null);
  assert.equal(updated.runs[0].manifest.rescored_from.run_cache_key, 'old-result');
  assert.equal(compareReports(updated, original).pass, false);
  assert.deepEqual(compareReports(updated, original).differences, []);
  assert.equal(compareReports(updated, updated).pass, true);
});
