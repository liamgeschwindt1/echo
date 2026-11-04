import test from 'node:test';
import assert from 'node:assert/strict';
import { testingExperiment, parseVariableValues } from '../src/ui/testing.js';
import { testingEditorResults } from '../src/ui/testing-view.js';
import { VARIABLES, estimateExperiment, buildJobs, presetExperiment } from '@echo/sim-core/benchmark/experiment.js';

test('Testing builds shared-engine experiments without JSON editing', () => {
  const sweep = { variable: 'heading_error_sigma_deg', values: [0, 2.5], group: 'Hardware errors' };
  const experiment = testingExperiment({ scenes: ['sparse_20'], seeds: 1, mode: 'grid', sweeps: [sweep] });
  assert.equal(estimateExperiment(experiment).runs, 4);
  assert.equal(buildJobs(experiment).jobs.length, 4);
  assert.equal(experiment.analysis_modes[0], 'measured_only');
});
test('Testing parses list types strictly', () => {
  const number = VARIABLES.find((v) => v.id === 'min_snr_db');
  const string = VARIABLES.find((v) => v.id === 'window_policy');
  assert.deepEqual(parseVariableValues(number, '3, 6, 12'), [3, 6, 12]);
  assert.deepEqual(parseVariableValues(string, 'fixed, auto'), ['fixed', 'auto']);
  assert.throws(() => parseVariableValues(number, 'bad'), /comma-separated/);
});
test('Testing paired A/B uses chosen first/last variable values or explicit realism pair', () => {
  const e = testingExperiment({ scenes: ['sparse_20'], seeds: 1, mode: 'paired', sweeps: [{ variable: 'min_snr_db', values: [3, 6, 12] }] });
  assert.equal(e.configs[0].values.min_snr_db, 3);
  assert.equal(e.configs[1].values.min_snr_db, 12);
  const realism = testingExperiment({ scenes: ['sparse_20'], seeds: 1, mode: 'paired' });
  assert.equal(realism.configs[1].settings.heading_error_sigma_deg, 2.5);
  assert.deepEqual(realism.realism, ['custom']);
});
test('All Testing presets expand and show counts using shared engine', () => {
  for (const name of ['Hardware error robustness', 'Array ranking', 'Detection range vs noise', 'Noise and environment sensitivity', 'Threshold tuning', 'Node count and spacing', 'Overlapping sources', 'Realism on vs off', 'Full regression (compare with baseline)']) {
    const e = presetExperiment(name), count = estimateExperiment(e);
    assert.ok(count.runs > 0);
    if (!count.above_cap) assert.equal(buildJobs(e).jobs.length, count.runs);
  }
});
test('Editor adapter returns exact assisted results and never invents measured elevation error', () => {
  const original = [{ source_id: 's1' }];
  assert.equal(testingEditorResults({ job: { analysis_mode: 'truth_assisted' }, inference: original }), original);
  const results = testingEditorResults({
    job: { analysis_mode: 'measured_only' }, scenario: { nodes: [], settings: { source_height_prior_m: 1.5 }, sources: [{ id: 's1', keyframes: [{ position: [1, 2, 1.5] }] }] },
    scores: { sources: [{ source_id: 's1', measured_fix_index: 0, nodes: [], horizontal_m: 2, suspect: true }] },
    inference: { options: {}, nodes: [], fixes: [{ final_position: [2, 3], node_tracks: [], low_confidence: true, reliable: false }] }
  });
  assert.equal(results[0].error_3d_m, null);
  assert.equal(results[0].fix.z_clamped, true);
  assert.deepEqual(results[0].fix.position, [2, 3, 1.5]);
});
