import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metricValues, riskCoverage, rankingFlips, summariseRuns } from '../src/benchmark/metrics.js';
import { beginSealedRun, sealedInputHash } from '../src/benchmark/sealed.js';
import { buildJobs } from '../src/benchmark/experiment.js';
import { metricTable, riskCoverageChart, confidenceReport } from '../src/benchmark/report.js';
import { compareRound2Reports } from '../src/benchmark/acceptance.js';
import { consensusCandidateWins } from '../src/fix.js';
import { estimateExperiment, presetExperiment } from '../src/benchmark/experiment.js';

const run = (error, suspect = false, extra = {}) => ({
  job: { config: { id: 'c0', name: 'Base', values: {}, settings: {}, group: 'grid' }, scene: 'sparse_20', seed: 1, split: 'train', realism: 'off', analysis_mode: 'measured_only' },
  scores: { fix_count: error === null ? 0 : 1, sources: [{ horizontal_m: error, suspect, nodes: [], track_errors_m: [] }], unmatched_fixes: 0, unmatched_suspect: 0 },
  runtime_ms: 0, ...extra
});

test('scene endpoints include misses and unflagged unmatched hypotheses', () => {
  const runs = [run(1), run(20), run(null)];
  assert.equal(metricValues(runs).useful_fix_rate, 1 / 3);
  assert.equal(metricValues(runs).unflagged_wrong_fix_rate, 1 / 3);
  const duplicate = run(null);
  duplicate.scores.fix_count = 1;
  duplicate.scores.unmatched_fixes = 1;
  assert.equal(metricValues([duplicate]).unflagged_wrong_fix_rate, 1);
  assert.equal(riskCoverage([duplicate]).curve[1].mean_error_m, null);
  const partial = run(1); partial.scores.sources[0].nodes = [{ az_error_deg: 1, sigma_deg: 2 }, { az_error_deg: 3, sigma_deg: null }];
  assert.equal(metricValues([partial]).within_1sigma, null);
  assert.equal(metricValues([partial]).within_2sigma, null);
});

test('risk curve groups equal confidence without consulting truth and penalises no answer', () => {
  assert.equal(riskCoverage([run(null)]).area, 1);
  assert.equal(riskCoverage([]).area, null);
  const a = riskCoverage([run(1), run(20), run(null)]);
  assert.equal(a.curve.length, 2);
  assert.equal(a.curve[1].coverage, 2 / 3);
  assert.equal(a.curve[1].risk, 0.5);
  assert.ok(Math.abs(a.area - 2 / 3) < 1e-12);
  assert.deepEqual(a, riskCoverage([run(null), run(20), run(1)]));
  const good = run(1), bad = run(20);
  good.scores.sources[0].p_wrong = 0.1; bad.scores.sources[0].p_wrong = 0.9;
  assert.equal(riskCoverage([good, bad]).area, 0.25);
});

test('coverage-adjusted default does not reward low-coverage conditional median', () => {
  const row = (array, useful, median) => ({
    values: { mic_array: array }, split: 'train', realism: 'off', analysis_mode: 'measured_only',
    population: ['sparse_20|1'],
    metrics: { useful_fix_rate: { value: useful }, horizontal_median_m: { value: median } }
  });
  assert.equal(rankingFlips([row('sparse', 0.01, 0.1), row('broad', 0.8, 2)]).rankings[0].winner, 'broad');
  const missing = row('missing', 0.5, 1); delete missing.population;
  assert.equal(rankingFlips([missing, row('broad', 0.8, 2)]).rankings[0].winner, null);
  const unequal = row('unequal', 0.9, 0.5); unequal.population = ['another-site|1'];
  assert.equal(rankingFlips([unequal, row('broad', 0.8, 2)]).rankings[0].winner, null);
});

test('risk metrics render and targets honour both bounds', () => {
  const summary = summariseRuns([run(1)], { bootstrap_samples: 2 });
  const table = metricTable({ summary }, { metrics: { useful_fix_rate: { min: 0.1, max: 0.9 } } });
  assert.match(table, /risk_coverage_area/);
  assert.match(table, /class="fail"/);
  assert.match(riskCoverageChart(summary), /Risk versus fraction of all scenes/);
  const reliability = confidenceReport({ confidence_evaluation: [{ split: '<train>', realism: 'off', n_episodes: 1, reliability: [
    { count: 0, predicted: null, observed: null }, { count: 1, predicted: 0.1, observed: 1 }
  ] }] });
  assert.match(reliability, /Reliability diagram/);
  assert.match(reliability, /&lt;train&gt;/);
  assert.equal(reliability.match(/<circle /g).length, 1);
});

test('consensus cost ties below 1e-10 use canonical node pair, not machine-zero noise', () => {
  const set = [1, 2];
  const best = { set, cost: 1e-30, pair_key: 'n2\0n3' };
  assert.equal(consensusCandidateWins(set, 1e-28, ['n2', 'n1'], best), true);
  assert.equal(consensusCandidateWins(set, 0, ['n4', 'n5'], best), false);
  assert.equal(consensusCandidateWins(set, 1, ['n1', 'n2'], best), false);
  assert.equal(consensusCandidateWins([1, 2, 3], 10, ['n4', 'n5'], best), true);
});

test('benchmark tiers and estimates use historical expensive-scene measurements', () => {
  assert.equal(buildJobs(presetExperiment('smoke')).jobs.length, 16);
  assert.equal(buildJobs(presetExperiment('standard')).jobs.length, 100);
  assert.equal(buildJobs(presetExperiment('full')).jobs.length, 2700);
  const estimate = estimateExperiment({ ...presetExperiment('standard'), scenes: ['seven_source'] });
  assert.match(estimate.basis, /recorded stage p90/);
  assert.ok(estimate.milliseconds / estimate.runs > 100000, 'Seven-source scheduling must not use a 5-second placeholder');
});

test('round-two acceptance guards silent wrong fixes, missing populations, and paired improvement', () => {
  const report = (errors) => {
    const runs = errors.map((e, i) => { const r = run(e, true); r.job.seed = i; return r; });
    return { experiment: { wrong_fix_m: 10 }, runs, manifest: { expected_runs: runs.length, scoring_version: 'test' } };
  };
  const baseline = report([20, 25, 30, 35]);
  const improved = report([1, 2, 3, 4]);
  assert.equal(compareRound2Reports(improved, baseline, { bootstrap_samples: 40 }).pass, true);
  assert.equal(compareRound2Reports(baseline, baseline, { bootstrap_samples: 40 }).pass, true);
  const silent = structuredClone(baseline); silent.runs[0].scores.sources[0].suspect = false;
  assert.equal(compareRound2Reports(silent, baseline, { bootstrap_samples: 40 }).pass, false);
  const mismatch = structuredClone(improved); mismatch.runs[0].job.seed = 99;
  assert.equal(compareRound2Reports(mismatch, baseline).pass, false);
  const incomplete = structuredClone(improved); incomplete.manifest.expected_runs++;
  assert.equal(compareRound2Reports(incomplete, baseline).pass, false);
  for (const r of baseline.runs) r.scenario = { nodes: [], sources: [], buildings: [], settings: { noise_floor_db_spl: 45 } };
  const differentPhysics = structuredClone(baseline); differentPhysics.runs[0].scenario.settings.noise_floor_db_spl = 30;
  assert.equal(compareRound2Reports(differentPhysics, baseline).pass, false);
});

test('sealed population hash is frozen; 40 new sites and explicit three-way splits', async () => {
  const e = JSON.parse(await readFile(new URL('../../../docs/experiments/round2-sealed.json', import.meta.url), 'utf8'));
  assert.equal(sealedInputHash(e), e.preregistration.input_sha256);
  assert.equal(e.scenes.length, 40);
  const jobs = buildJobs(e).jobs;
  assert.equal(jobs.length, 160);
  assert.ok(jobs.every((j) => j.split === 'test'));
  const changed = structuredClone(e); changed.custom_scenes[e.scenes[0]].nodes[0].position[0] += 1;
  assert.throws(() => sealedInputHash(changed), /hash mismatch/);
  const evaluation = JSON.parse(await readFile(new URL('../../../docs/experiments/round2-evaluation.json', import.meta.url), 'utf8'));
  const counts = buildJobs(evaluation).jobs.reduce((a, j) => ({ ...a, [j.split]: (a[j.split] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { train: 68, validation: 82 });
});

test('seal producer is an independent serializable snapshot when attached to the caller manifest', async () => {
  const e = JSON.parse(await readFile(new URL('../../../docs/experiments/round2-sealed.json', import.meta.url), 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'echo-seal-snapshot-'));
  try {
    const manifest = { code_version: 'unit-test', runtime: { node: 'original' } };
    const seal = await beginSealedRun(e, { directory, manifest });
    manifest.sealed = seal.manifest;
    manifest.runtime.node = 'later mutation';
    const exported = JSON.parse(JSON.stringify({ manifest, runs: [{ manifest }] }));
    assert.deepEqual(exported.manifest.sealed.producer, {
      code_version: 'unit-test', runtime: { node: 'original' }
    });
    const started = JSON.parse((await readFile(seal.manifest.ledger, 'utf8')).trim());
    assert.deepEqual(started.producer, seal.manifest.producer);
    await seal.finish('completed', { unit_test: true });
  } finally { await rm(directory, { recursive: true }); }
});

test('seal persists a failed attempt and requires an auditable override', async () => {
  const e = JSON.parse(await readFile(new URL('../../../docs/experiments/round2-sealed.json', import.meta.url), 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'echo-seal-'));
  try {
    const first = await beginSealedRun(e, { directory });
    await first.finish('failed', { error: 'test interruption' });
    await assert.rejects(beginSealedRun(e, { directory }), /already attempted/);
    await assert.rejects(beginSealedRun(e, { directory, override: ' ' }), /nonempty/);
    const retry = await beginSealedRun(e, { directory, override: 'Unit-test explicit retry, not a real test execution' });
    assert.match(retry.manifest.override_reason, /Unit-test/);
    const ledger = await readFile(first.manifest.ledger, 'utf8');
    assert.equal(ledger.trim().split('\n').length, 3);
    assert.match(ledger, /test interruption/);
  } finally { await rm(directory, { recursive: true }); }
});
