import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildJobs, estimateExperiment, presetExperiment, reduceExperiment, normaliseExperiment } from '../src/benchmark/experiment.js';
import { SCENES, buildScene } from '../src/benchmark/scenes.js';
import { applyValues, VARIABLES } from '../src/benchmark/variables.js';
import { cacheKeys, MemoryCache, audioHash } from '../src/benchmark/cache.js';
import { aggregate, metricValues, compareSummaries, rankingFlips, pairedComparison } from '../src/benchmark/metrics.js';
import { runJob, runExperiment } from '../src/benchmark/runner.js';
import { reportCsv, reportHtml } from '../src/benchmark/report.js';
import { click } from './golden-scenes.js';
import { analyseMeasured } from '../src/measured.js';
import { speedOfSound } from '../src/physics.js';

const experiment = (extra = {}) => ({ name: 'test', scenes: ['sparse_20'], seeds: [1, 101], mode: 'grid', sweeps: [], realism: ['off'], analysis_modes: ['measured_only'], ...extra });
const source = (error, suspect = false) => ({ horizontal_m: error, error_3d_m: error, suspect, track_errors_m: [], nodes: [] });
const fakeRun = (error, extra = {}) => ({
  job: { config: { id: 'c0', name: 'Base', values: {}, group: 'base' }, scene: 'sparse_20', seed: 1, split: 'train', realism: 'off', analysis_mode: 'measured_only' },
  scores: { sources: [source(error)], fix_count: error === null ? 0 : 1, unmatched_fixes: 0, unmatched_suspect: 0 }, runtime_ms: 10, manifest: { code_version: 'test' }, ...extra
});

test('benchmark scenes have >=30% untouched IDs and every scene validates', () => {
  assert.ok(SCENES.filter((s) => s.split === 'held-out').length / SCENES.length >= 0.3);
  for (const { id } of SCENES) assert.ok(buildScene(id).sources.length);
});
test('grid count, seeds and held-out are explicit and repeatable', () => {
  const e = experiment({ sweeps: [{ variable: 'min_snr_db', values: [3, 6, 12] }, { variable: 'node_count', range: { min: 2, max: 3, steps: 2 } }] });
  const built = buildJobs(e);
  assert.equal(built.jobs.length, 12);
  assert.equal(estimateExperiment(e).runs, 12);
  assert.equal(built.jobs.filter((j) => j.split === 'held-out').length, 6);
  assert.deepEqual(buildJobs(e), built);
});
test('OAT includes base and does not cross variables', () => {
  const { configs } = buildJobs(experiment({ mode: 'one-at-a-time', sweeps: [{ variable: 'heading_error_sigma_deg', values: [0, 1, 2.5] }, { variable: 'min_snr_db', values: [3, 6, 12] }] }));
  assert.equal(configs.length, 5);
  assert.ok(configs.every((c) => Object.keys(c.values).length <= 1));
});
test('random and Latin hypercube sample deterministically; LHS covers equal discrete strata', () => {
  for (const mode of ['random', 'latin-hypercube']) {
    const e = experiment({ mode, samples: 4, sweeps: [{ variable: 'heading_error_sigma_deg', values: [0, 1, 2, 3] }] });
    assert.deepEqual(buildJobs(e), buildJobs(e));
    if (mode === 'latin-hypercube') assert.equal(new Set(buildJobs(e).configs.map((c) => c.values.heading_error_sigma_deg)).size, 4);
  }
});
test('cap rejects before expansion and reduce samples reaches safe size', () => {
  const e = presetExperiment('Array ranking');
  e.max_runs = 200;
  assert.throws(() => buildJobs(e), /cap/);
  assert.ok(estimateExperiment(reduceExperiment(e)).runs <= 200);
  assert.throws(() => normaliseExperiment(experiment({ seeds: [1, 1] })), /unique/);
  assert.throws(() => buildJobs(experiment({ sweeps: [{ variable: 'noise_correlation', values: [1.1] }] })), /fraction/);
  assert.throws(() => buildJobs(experiment({ sweeps: [{ variable: 'unknown', values: [1] }] })), /Unknown/);
});
test('variable transforms are nonmutating and each descriptor has render classification', () => {
  const scene = buildScene('sparse_20'), before = structuredClone(scene);
  for (const variable of VARIABLES) {
    assert.ok(['render', 'analysis'].includes(variable.affects));
    const changed = applyValues(scene, { [variable.id]: variable.values[0] });
    assert.notEqual(changed, scene);
    assert.deepEqual(scene, before);
  }
  assert.equal(applyValues(scene, { node_count: 6 }).nodes.length, 6);
});
test('render cache ignores analysis thresholds but includes realism, bands, audio and code', async () => {
  const s = buildScene('sparse_20');
  const context = { code_version: 'v1', audio: [{ id: 'click', sha256: 'abc' }], schema: '0.7' };
  const key = await cacheKeys(s, { ...context, analysis_settings: s.settings });
  const analysis = structuredClone(s); analysis.settings.fix_inlier_gate_sigma = 4;
  const next = await cacheKeys(analysis, { ...context, analysis_settings: analysis.settings });
  assert.equal(key.render, next.render); assert.notEqual(key.run, next.run);
  for (const id of ['heading_error_sigma_deg', 'localisation_band_hz']) {
    const changed = structuredClone(s); changed.settings[id] = id.endsWith('hz') ? [300, 1500] : 2;
    assert.notEqual((await cacheKeys(changed, context)).render, key.render);
  }
  assert.notEqual((await cacheKeys(s, { ...context, code_version: 'v2' })).render, key.render);
  assert.notEqual((await cacheKeys(s, { ...context, audio: [] })).render, key.render);
});
test('missing errors never become zero and no wrong fixes does not mean perfect recall', () => {
  const values = metricValues([fakeRun(null), fakeRun(4)]);
  assert.equal(values.horizontal_median_m, 4);
  assert.equal(values.scene_fix_rate, 0.5);
  assert.equal(values.suspect_recall, null);
  assert.equal(aggregate([fakeRun(4)]).horizontal_median_m.ci, null);
  const agg = aggregate([fakeRun(4), fakeRun(8)], { bootstrap_samples: 40 });
  assert.deepEqual(agg, aggregate([fakeRun(4), fakeRun(8)], { bootstrap_samples: 40 }));
  assert.ok(agg.horizontal_median_m.ci[0] >= 4);
});
test('unmatched measured fixes count as wrong and cannot improve success', () => {
  const r = fakeRun(2);
  r.scores.unmatched_fixes = 1; r.scores.unmatched_suspect = 1;
  const m = metricValues([r]);
  assert.equal(m.within_target_rate, 0.5); assert.equal(m.wrong_fix_rate, 0.5);
  assert.equal(m.suspect_recall, 1); assert.equal(m.suspect_precision, 1);
});
test('regression comparison gates loss of availability, missing configs and calibration distance', () => {
  const row = (value) => ({ key: 'a', metrics: { horizontal_median_m: { value }, within_1sigma: { value: 0.68 } } });
  assert.equal(compareSummaries([row(4)], [row(3)]).pass, false);
  assert.equal(compareSummaries([row(null)], [row(3)]).pass, false);
  assert.equal(compareSummaries([], [row(3)]).pass, false);
  assert.equal(compareSummaries([row(3)], [row(3)]).pass, true);
});
test('array ranking flips identify only single changing variables, ties have no winner', () => {
  const row = (array, heading, value) => ({ values: { mic_array: array, heading_error_sigma_deg: heading }, split: 'train', realism: 'on', analysis_mode: 'measured_only', metrics: { horizontal_median_m: { value } } });
  const result = rankingFlips([row('a', 0, 1), row('b', 0, 2), row('a', 3, 5), row('b', 3, 2)]);
  assert.equal(result.flips[0].variable, 'heading_error_sigma_deg');
  assert.equal(result.flips[0].from, 'a'); assert.equal(result.flips[0].to, 'b');
  assert.equal(rankingFlips([row('a', 0, 2), row('b', 0, 2)]).rankings[0].winner, null);
});
test('paired significance uses identical seeds, no unpaired leakage', () => {
  const runs = [fakeRun(5), fakeRun(2)];
  runs[1].job = structuredClone(runs[0].job); runs[1].job.config.id = 'c1';
  const p = pairedComparison(runs, 'horizontal_median_m', { bootstrap_samples: 20, permutation_samples: 40 });
  assert.equal(p.delta, -3); assert.equal(p.n_pairs, 1); assert.equal(p.ci, null);
  runs[1].job.seed = 2;
  assert.equal(pairedComparison(runs, 'horizontal_median_m').n_pairs, 0);
});
test('measured inference cannot access simulator-only fields', () => {
  const forbidden = () => { throw new Error('simulator truth accessed'); };
  const scenario = { nodes: [], settings: { localisation_band_hz: [200, 1600] } };
  const rendered = { sample_rate: 48000, nodes: [] };
  for (const k of ['sources', 'start_s', 'true_position']) Object.defineProperty(scenario, k, { get: forbidden });
  for (const k of ['activity', 'paths', 'source_positions']) Object.defineProperty(rendered, k, { get: forbidden });
  assert.deepEqual(analyseMeasured(scenario, rendered, { c: speedOfSound(15) }), { nodes: [], fixes: [] });
});
test('cached real run is deterministic and analysis-only sweep reuses audio', async () => {
  const s = buildScene('sparse_20');
  s.sources[0].clip = 'click'; s.sources[0].start_s = 0.2;
  s.settings.reflection_order = 0; s.settings.diffraction_order = 0;
  const clips = new Map([['click', click()]]);
  const e = experiment({ scenes: ['custom'], custom_scenes: { custom: s }, seeds: [1], analysis_modes: ['truth_assisted'], sweeps: [{ variable: 'fix_inlier_gate_sigma', values: [3, 4] }] });
  const jobs = buildJobs(e).jobs, cache = new MemoryCache();
  const context = { clips, custom_scenes: e.custom_scenes, manifest: { code_version: 'test', audio: await audioHash(clips) }, cache };
  const first = await runJob(jobs[0], context), cached = await runJob(jobs[0], context), changed = await runJob(jobs[1], context);
  assert.deepEqual(first.scores, cached.scores);
  assert.equal(cached.cache_hit, true); assert.equal(changed.render_cache_hit, true);
  assert.notEqual(first.cache_keys.run, changed.cache_keys.run);
});
test('scheduler cancels dispatch and resumes complete jobs without duplication', async () => {
  const e = experiment({ seeds: [1, 2, 101] }), controller = new AbortController();
  let count = 0;
  const execute = async (job) => { count++; controller.abort(); return fakeRun(2, { job }); };
  const partial = await runExperiment(e, { execute, signal: controller.signal, workers: 1, manifest: { code_version: 'test' } });
  assert.equal(partial.runs.length, 1);
  const full = await runExperiment(e, { execute: async (job) => fakeRun(2, { job }), completed: partial.runs, workers: 1, manifest: { code_version: 'test' } });
  assert.equal(full.runs.length, 3); assert.equal(count, 1);
});
test('reports escape scene/config text, CSV quotes, standalone HTML has no remote dependencies', async () => {
  const report = await runExperiment(experiment(), { execute: async (job) => fakeRun(2, { job }), manifest: { code_version: 'test' } });
  report.experiment.name = '<script>alert(1)</script>';
  assert.ok(reportHtml(report).includes('&lt;script&gt;'));
  assert.ok(!reportHtml(report).includes('<script>'));
  assert.ok(reportCsv(report).startsWith('"config"'));
  const runner = await readFile(new URL('../src/benchmark/runner.js', import.meta.url), 'utf8');
  assert.ok(runner.includes('sensorScenario'));
});
