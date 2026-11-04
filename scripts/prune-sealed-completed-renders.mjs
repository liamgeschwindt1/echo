import { readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises';
import { deserialize } from 'node:v8';
import { createHash } from 'node:crypto';
import { DiskCache } from '../packages/sim-core/src/benchmark/node.js';
import { buildJobs, scenarioForJob } from '../packages/sim-core/src/benchmark/experiment.js';
import { validateScenario } from '../packages/sim-core/src/scenario.js';
import { canonical, cacheKeys } from '../packages/sim-core/src/benchmark/cache.js';
import { sealedInputHash } from '../packages/sim-core/src/benchmark/sealed.js';

// One-off operational cleanup: never remove inference, change a job, or rerender.
if (process.argv.length !== 2) throw new Error('No arguments: fixed round-two paths only');
const root = new URL('../', import.meta.url);
const registration = new URL('docs/experiments/round2-sealed.json', root);
const { experiment, jobs } = buildJobs(JSON.parse(await readFile(registration)));
const inputHash = sealedInputHash(experiment);
const cacheUrl = new URL('.benchmark-round2-sealed/', root);
const cache = new DiskCache(cacheUrl.pathname);
const ledger = new URL(`docs/experiments/sealed-runs/${inputHash}.jsonl`, root);
const entries = (await readFile(ledger, 'utf8')).trim().split('\n').map(JSON.parse);
if (entries.filter((e) => e.state === 'started').length !== 1 ||
    entries.some((e) => ['completed', 'failed', 'cancelled'].includes(e.state))) {
  throw new Error('Cleanup requires exactly one still-running sealed attempt');
}
const auditUrl = new URL('baselines/round2-sealed-storage.json', root);
const planned = [];
for (const name of await readdir(cacheUrl)) {
  if (!/^run-[a-f0-9]{64}\.bin$/.test(name)) continue;
  const bytes = await readFile(new URL(name, cacheUrl)), run = deserialize(bytes);
  if (run.manifest.sealed?.input_sha256 !== inputHash ||
      run.manifest.code_version !== '2f7230fc50b341ad0c3fbd147bad728cc9fe6bb92e2fbc748bc25cf7c1a1bf38' ||
      cache.path(run.cache_keys.run) !== new URL(name, cacheUrl).pathname) {
    throw new Error(`Unexpected completed-result identity: ${name}`);
  }
  const consumers = jobs.filter((job) => job.scene === run.job.scene &&
    job.seed === run.job.seed && job.realism === run.job.realism &&
    job.analysis_mode === run.job.analysis_mode);
  if (consumers.length !== 2) throw new Error('Expected both registered algorithm labels');
  for (const job of consumers) {
    const scenario = validateScenario(scenarioForJob(experiment.custom_scenes[job.scene], job));
    if (canonical(scenario) !== canonical(run.scenario)) throw new Error('Consumer inputs differ');
    const keys = await cacheKeys(scenario, {
      code_version: run.manifest.code_version, render_code_version: run.manifest.render_code_version,
      runtime: run.manifest.runtime, audio: run.manifest.audio, schema: run.manifest.schema,
      analysis_settings: { settings: scenario.settings, mode: job.analysis_mode, wrong_fix_m: experiment.wrong_fix_m }
    });
    if (canonical(keys) !== canonical(run.cache_keys)) throw new Error('Consumer cache keys differ');
  }
  const renderBytes = (await stat(cache.path(run.cache_keys.render))).size;
  planned.push({ completed_job: run.job.id, consumer_jobs: consumers.map((j) => j.id),
    cache_keys: run.cache_keys, result_sha256: createHash('sha256').update(bytes).digest('hex'),
    render_bytes: renderBytes });
}
if (!planned.length) throw new Error('No completed whole-result caches eligible for cleanup');
const audit = {
  schema: 1, input_sha256: inputHash, started: new Date().toISOString(),
  script_sha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  reason: 'Config-major scheduling retains raw audio until the second label. Every consumer has the exact already-completed run key; runJob checks that cache before reading audio.',
  changes: 'Storage only. Result caches remain byte-identical; no inference, population, settings or producer metadata changes. No partial outcomes inspected.',
  planned
};
await writeFile(auditUrl, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
await appendFile(ledger, JSON.stringify({ state: 'storage-amendment', at: audit.started,
  audit: 'baselines/round2-sealed-storage.json', reason: audit.reason }) + '\n', { flush: true });
for (const item of planned) {
  await cache.delete(item.cache_keys.render);
  await cache.delete(item.cache_keys.origin);
}
audit.completed = new Date().toISOString();
await writeFile(auditUrl, JSON.stringify(audit, null, 2) + '\n', { flush: true });
console.log(JSON.stringify({ completed_results_preserved: planned.length,
  raw_bytes_removed: planned.reduce((sum, item) => sum + item.render_bytes, 0), audit: auditUrl.pathname }));
