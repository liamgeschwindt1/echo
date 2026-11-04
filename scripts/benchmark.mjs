import { readFile, writeFile, mkdir, statfs } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { presetExperiment, buildJobs, scenarioForJob, estimateExperiment } from '../packages/sim-core/src/benchmark/experiment.js';
import { buildScene } from '../packages/sim-core/src/benchmark/scenes.js';
import { nodeExecutor, loadBenchmarkClips, codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { runExperiment } from '../packages/sim-core/src/benchmark/runner.js';
import { compareReports } from '../packages/sim-core/src/benchmark/metrics.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';
import { beginSealedRun } from '../packages/sim-core/src/benchmark/sealed.js';
import { compareRound2Reports } from '../packages/sim-core/src/benchmark/acceptance.js';

const { values: args } = parseArgs({ options: {
  experiment: { type: 'string' }, compare: { type: 'string' }, out: { type: 'string' },
  workers: { type: 'string' }, cache: { type: 'string' },
  'fail-on-regress': { type: 'boolean' }, 'discard-renders': { type: 'boolean' },
  sealed: { type: 'boolean' }, 'sealed-override': { type: 'string' },
  acceptance: { type: 'string' },
  help: { type: 'boolean', short: 'h' }
} });
if (args.help) {
  console.log('Usage: npm run benchmark -- --experiment <file|preset> [--compare baseline.json] [--fail-on-regress] [--out results.json] [--workers 1..16] [--cache directory] [--discard-renders] [--sealed] [--sealed-override reason]');
  process.exit(0);
}
if (args['fail-on-regress'] && !args.compare) throw new Error('--fail-on-regress requires --compare');
if (args.acceptance !== undefined && args.acceptance !== 'round2') throw new Error('--acceptance must be round2');
const option = (name, fallback) => args[name.slice(2)] ?? fallback;
const input = option('--experiment', 'smoke');
const experiment = input.endsWith('.json') ? JSON.parse(await readFile(resolve(input), 'utf8')) : presetExperiment(input);
const { experiment: e, jobs } = buildJobs(experiment);
if (!!e.sealed !== !!args.sealed) throw new Error('Sealed experiments require --sealed; --sealed requires a sealed experiment');
if (args['sealed-override'] !== undefined && !args.sealed) throw new Error('--sealed-override requires --sealed');
const disk = await statfs(process.cwd());
if (1 - disk.bavail / disk.blocks > 0.85) throw new Error('Disk exceeds 85%; refusing to start a new study');
const out = resolve(option('--out', 'baselines/latest.json'));
const workers = Number(option('--workers', String(Math.min(2, availableParallelism()))));
if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error('Workers must be 1..16');
const estimate = estimateExperiment(e);
console.log(`Estimated ${estimate.runs} runs, ${(estimate.milliseconds / 60000 / workers).toFixed(1)} minutes at ${workers} workers (${estimate.basis}; ${estimate.unmeasured_runs ?? 0} unmeasured cases).`);
const clipsNeeded = new Set(jobs.flatMap((job) => scenarioForJob(e.custom_scenes?.[job.scene] ?? buildScene(job.scene), job).sources.map((s) => s.clip)));
const clips = await loadBenchmarkClips(clipsNeeded);
const manifest = await codeManifest();
const seal = args.sealed ? await beginSealedRun(e, {
  directory: resolve('docs/experiments/sealed-runs'), override: args['sealed-override'], manifest
}) : null;
if (seal) manifest.sealed = seal.manifest;
const controller = new AbortController();
process.once('SIGINT', () => { console.error('Cancellation requested; finish active jobs, then save partial report.'); controller.abort(); });
let report;
try {
  const executor = await nodeExecutor({ workers, clips, manifest, experiment: e, cacheDirectory: resolve(option('--cache', '.benchmark-cache')), discardRenders: !!args['discard-renders'] });
  try {
    report = await runExperiment(e, {
      ...executor, workers, signal: controller.signal, manifest: executor.manifest,
      onProgress: ({ done, total, result }) => {
        // Held-out numbers are saved, never printed for tuning.
        if (result) console.log(`${done}/${total} ${result.job.scene} ${result.job.split} ${result.job.realism}/${result.job.analysis_mode}${result.cache_hit ? ' [cache]' : ''}`);
      }
    });
  } finally { await executor.close(); }
  const baselineFile = option('--compare', null);
  if (baselineFile) {
    const baseline = JSON.parse(await readFile(resolve(baselineFile), 'utf8'));
    report.comparison = args.acceptance === 'round2' ? compareRound2Reports(report, baseline, e) : compareReports(report, baseline, e.tolerances);
    if (args['fail-on-regress'] && !report.comparison.pass) process.exitCode = 1;
  }
  if (controller.signal.aborted) process.exitCode = 130;
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  const stem = out.replace(/\.json$/, '');
  await writeFile(`${stem}.csv`, reportCsv(report));
  await writeFile(`${stem}.html`, reportHtml(report, manifest.targets));
  await seal?.finish(controller.signal.aborted ? 'cancelled' : 'completed', { output: out, runs: report.runs.length });
  console.log(`Saved ${out}; ${report.comparison ? report.comparison.pass ? 'no regressions' : `${report.comparison.regressions.length} REGRESSIONS` : 'baseline report'}.`);
} catch (error) {
  await seal?.finish('failed', { error: error.message, runs: report?.runs.length });
  throw error;
}
