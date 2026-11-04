import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { availableParallelism } from 'node:os';
import { presetExperiment, buildJobs, scenarioForJob, estimateExperiment } from '../packages/sim-core/src/benchmark/experiment.js';
import { buildScene } from '../packages/sim-core/src/benchmark/scenes.js';
import { nodeExecutor, loadBenchmarkClips, codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { runExperiment } from '../packages/sim-core/src/benchmark/runner.js';
import { compareSummaries } from '../packages/sim-core/src/benchmark/metrics.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[i + 1];
};
const input = option('--experiment', 'smoke');
const experiment = input.endsWith('.json') ? JSON.parse(await readFile(resolve(input), 'utf8')) : presetExperiment(input);
const { experiment: e, jobs } = buildJobs(experiment);
const out = resolve(option('--out', 'baselines/latest.json'));
const workers = Number(option('--workers', String(Math.min(2, availableParallelism()))));
if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error('Workers must be 1..16');
const estimate = estimateExperiment(e);
console.log(`Estimated ${estimate.runs} runs, ${(estimate.milliseconds / 60000 / workers).toFixed(1)} worker-minutes (rough; cache not yet counted).`);
const clipsNeeded = new Set(jobs.flatMap((job) => scenarioForJob(e.custom_scenes?.[job.scene] ?? buildScene(job.scene), job).sources.map((s) => s.clip)));
const clips = await loadBenchmarkClips(clipsNeeded);
const manifest = await codeManifest();
const executor = await nodeExecutor({ workers, clips, manifest, experiment: e, cacheDirectory: resolve(option('--cache', '.benchmark-cache')) });
const controller = new AbortController();
process.once('SIGINT', () => { console.error('Cancellation requested; finish active jobs, then save partial report.'); controller.abort(); });
let report;
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
  report.comparison = compareSummaries(report.summary, baseline.summary, e.tolerances);
  if (args.includes('--fail-on-regress') && !report.comparison.pass) process.exitCode = 1;
} else if (args.includes('--fail-on-regress')) throw new Error('--fail-on-regress requires --compare');
if (controller.signal.aborted) process.exitCode = 130;
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
const stem = out.replace(/\.json$/, '');
await writeFile(`${stem}.csv`, reportCsv(report));
let targets = {};
try { targets = JSON.parse(await readFile(new URL('../docs/targets.json', import.meta.url), 'utf8')); }
catch (err) { if (err.code !== 'ENOENT') throw err; }
await writeFile(`${stem}.html`, reportHtml(report, targets));
console.log(`Saved ${out}; ${report.comparison ? report.comparison.pass ? 'no regressions' : `${report.comparison.regressions.length} REGRESSIONS` : 'baseline report'}.`);
