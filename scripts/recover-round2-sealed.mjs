import { readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { buildJobs, scenarioForJob } from '../packages/sim-core/src/benchmark/experiment.js';
import { finishExperiment } from '../packages/sim-core/src/benchmark/runner.js';
import { canonical, cacheKeys } from '../packages/sim-core/src/benchmark/cache.js';
import { validateScenario } from '../packages/sim-core/src/scenario.js';
import { sealedInputHash } from '../packages/sim-core/src/benchmark/sealed.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';

if (process.argv.length !== 2) throw new Error('Fixed recovery only; no rendering/inference or sealed override');
const root = new URL('../', import.meta.url), sha = (b) => createHash('sha256').update(b).digest('hex');
const { experiment, configs, jobs } = buildJobs(JSON.parse(await readFile(new URL('docs/experiments/round2-sealed.json', root))));
const hash = sealedInputHash(experiment);
const ledgerUrl = new URL(`docs/experiments/sealed-runs/${hash}.jsonl`, root);
const ledger = (await readFile(ledgerUrl, 'utf8')).trim().split('\n').map(JSON.parse);
if (ledger.filter((e) => e.state === 'started').length !== 1 || ledger.some((e) => e.state === 'completed')) {
  throw new Error('Requires the original single attempt, without a completed export');
}
const log = await readFile('/tmp/echo-round2-sealed.log');
const progress = [...log.toString().matchAll(/^(\d+)\/160 (\S+) test (off|on)\/measured_only( \[cache\])?$/gm)];
if (progress.length !== 160 || !log.includes('Converting circular structure to JSON')) throw new Error('Original complete execution/export failure not proven');
for (let i = 0; i < jobs.length; i++) {
  const p = progress[i], job = jobs[i];
  if (+p[1] !== i + 1 || p[2] !== job.scene || p[3] !== job.realism ||
      !!p[4] !== (job.config.id === 'c1')) throw new Error('Original progress differs from registered dispatch');
}
const cacheUrl = new URL('.benchmark-round2-sealed/', root), cached = new Map(), cacheAudit = [];
for (const name of await readdir(cacheUrl)) {
  if (!/^run-[a-f0-9]{64}\.bin$/.test(name)) continue;
  const bytes = await readFile(new URL(name, cacheUrl)), run = deserialize(bytes);
  if (run.manifest.code_version !== ledger[0].producer.code_version ||
      run.manifest.sealed?.input_sha256 !== hash || run.cache_keys.run.replace(':', '-') + '.bin' !== name) {
    throw new Error('Unexpected original cache identity');
  }
  const seal = run.manifest.sealed;
  if (seal.producer.sealed !== seal) throw new Error('Expected the exact known producer self-reference');
  const { sealed: ignoredCycle, ...originalProducer } = seal.producer;
  if (!isDeepStrictEqual(originalProducer, ledger[0].producer)) throw new Error('Producer differs from original pre-dispatch ledger');
  seal.producer = structuredClone(ledger[0].producer);
  const key = `${run.job.scene}|${run.job.seed}|${run.job.realism}`;
  if (cached.has(key)) throw new Error('Duplicate physical cache');
  cached.set(key, run);
  cacheAudit.push({ file: name, sha256: sha(bytes), original_job: run.job.id });
}
if (cached.size !== 80) throw new Error('All80 physical result caches are required');
const runs = [];
for (const job of jobs) {
  const original = cached.get(`${job.scene}|${job.seed}|${job.realism}`);
  const scenario = validateScenario(scenarioForJob(experiment.custom_scenes[job.scene], job));
  if (!original || !isDeepStrictEqual(scenario, original.scenario)) throw new Error('Registered physical inputs differ');
  const keys = await cacheKeys(scenario, { ...original.manifest,
    analysis_settings: { settings: scenario.settings, mode: job.analysis_mode, wrong_fix_m: experiment.wrong_fix_m }
  });
  if (!isDeepStrictEqual(keys, original.cache_keys)) throw new Error('Registered run key differs');
  runs.push({ ...original, job, cache_hit: job.config.id === 'c1',
    manifest: { ...original.manifest, seed: job.seed, variable_values: job.config.values },
    resume_identity: canonical({ job, custom_scene: experiment.custom_scenes[job.scene], wrong_fix_m: experiment.wrong_fix_m }) });
}
const first = runs[0].manifest;
const audio = [...new Map(runs.flatMap((r) => r.manifest.audio).map((clip) => [clip.id, clip])).values()]
  .sort((a, b) => a.id.localeCompare(b.id));
const manifest = { ...ledger[0].producer, sealed: first.sealed, cache_policy: first.cache_policy,
  audio, runtime: first.runtime, expected_runs: 160, cancelled: false };
const report = finishExperiment(experiment, configs, runs, manifest);
const json = JSON.stringify(report, null, 2) + '\n';
const audit = {
  schema: 1, input_sha256: hash, at: new Date().toISOString(),
  script_sha256: sha(await readFile(new URL(import.meta.url))), original_log_sha256: sha(log),
  original_producer: ledger[0].producer,
  original_execution: { jobs: 160, physical_results: 80, second_label_cache_hits: 80, cli_exit: 1, failure: 'JSON producer self-reference after all160 jobs' },
  operation: 'Pure export recovery from complete immutable result caches. Replace only the manifest producer back-reference with its exact original ledger snapshot; reconstruct recorded labels/cache-hit flags and unchanged shared aggregation. No renderer, inference, scoring, seal start or override invoked.',
  output_sha256: sha(Buffer.from(json)), caches: cacheAudit
};
await writeFile(new URL('baselines/round2-sealed-recovery.json', root), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
await appendFile(ledgerUrl, JSON.stringify({ state: 'export-failed', at: audit.at,
  runs: 160, error: audit.original_execution.failure }) + '\n', { flush: true });
await writeFile(new URL('baselines/round2-sealed.json', root), json, { flag: 'wx' });
await writeFile(new URL('baselines/round2-sealed.csv', root), reportCsv(report));
await writeFile(new URL('baselines/round2-sealed.html', root), reportHtml(report, manifest.targets));
await appendFile(ledgerUrl, JSON.stringify({ state: 'completed', at: new Date().toISOString(), runs: 160,
  output: 'baselines/round2-sealed.json', export_recovery: 'baselines/round2-sealed-recovery.json',
  rerendered: 0, inference_reexecuted: 0, override: false }) + '\n', { flush: true });
console.log('Recovered all160 original sealed jobs; no renderer/inference/scoring rerun and no seal override.');
