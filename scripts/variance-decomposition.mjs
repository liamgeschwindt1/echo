import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { scoreMeasured } from '../packages/sim-core/src/benchmark/score.js';
import { speedOfSound } from '../packages/sim-core/src/physics.js';
import { fuseGlobalTracks } from './lib/global-fusion.mjs';
import { varianceIntervals } from './lib/variance.mjs';

const root = new URL('../', import.meta.url);
const registrationBytes = await readFile(new URL('docs/experiments/round2-variance.json', root));
const registration = JSON.parse(registrationBytes);
const reportBytes = await readFile(new URL('baselines/round2-variance-runs.json', root));
const report = JSON.parse(reportBytes), jobs = buildJobs(registration.benchmark).jobs;
const ids = new Set(jobs.map((j) => j.id));
if (report.manifest.cancelled || report.runs.length !== jobs.length || new Set(report.runs.map((r) => r.job.id)).size !== jobs.length ||
    report.runs.some((r) => !ids.has(r.job.id))) throw new Error('Variance study population is incomplete or unequal');
const rows = report.runs.flatMap((r) => registration.analysis.algorithms.map((algorithm) => {
  const c = speedOfSound(r.scenario.settings.temperature_c);
  const inference = algorithm === 'retained-legacy' ? r.inference : { ...r.inference,
    fixes: fuseGlobalTracks(r.inference.nodes, { c, options: r.inference.options, consensus: 'predictive', scenario: r.scenario }).fixes };
  const scores = algorithm === 'retained-legacy' ? r.scores : scoreMeasured(r.scenario, inference, { c });
  const errors = scores.fixes.map((f) => f.horizontal_m).filter(Number.isFinite);
  if (scores.fix_count && !scores.unmatched_fixes && !errors.length) throw new Error('Answered scene lacks a finite score');
  return { run_id: r.job.id, seed: r.job.seed, split: r.job.split, ...r.job.config.values, realism: r.job.realism, algorithm,
    fix_count: scores.fix_count, unmatched_fixes: scores.unmatched_fixes,
    conditional_rmse_m: errors.length ? Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / errors.length) : null,
    scene_loss: !scores.fix_count || scores.unmatched_fixes ? 1 : Math.max(...errors.map((e) => Math.min(e / 10, 1))) };
}));
const factors = Object.fromEntries(registration.analysis.factors.map((name) => [name, [...new Set(rows.map((r) => r[name]))]]));
if (Object.values(factors).some((levels) => levels.includes(undefined))) throw new Error('Missing registered factor values');
const output = { registration, registration_sha256: createHash('sha256').update(registrationBytes).digest('hex'),
  input_sha256: createHash('sha256').update(reportBytes).digest('hex'), producer: report.manifest,
  complete: true, runs: jobs.length, algorithm_rows: rows.length, factors,
  summary: Object.fromEntries(registration.analysis.algorithms.map((algorithm) => {
    const subset = rows.filter((r) => r.algorithm === algorithm);
    return [algorithm, { scenes: subset.length, answered: subset.filter((r) => r.fix_count > 0).length,
      matched: subset.filter((r) => r.conditional_rmse_m !== null).length, unmatched_fixes: subset.reduce((s, r) => s + r.unmatched_fixes, 0) }];
  })),
  decomposition: Object.fromEntries(Object.keys(registration.analysis.responses).map((response) =>
    [response, varianceIntervals(rows, response, factors)])), rows };
await writeFile(new URL('baselines/round2-variance.json', root), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ summary: output.summary, decomposition: output.decomposition }, null, 2));
