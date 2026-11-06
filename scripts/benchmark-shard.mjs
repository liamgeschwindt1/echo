import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { buildJobs, presetExperiment } from '../packages/sim-core/src/benchmark/experiment.js';
import { buildScene } from '../packages/sim-core/src/benchmark/scenes.js';
import { scenarioForJob } from '../packages/sim-core/src/benchmark/experiment.js';
import { nodeExecutor, loadBenchmarkClips, codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { finishExperiment } from '../packages/sim-core/src/benchmark/runner.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';
import { assertShardedUnsealed } from './lib/integration-seal-guard.mjs';

function pickJobs(jobs, shardIndex, shardCount) {
  const start = Math.floor((shardIndex * jobs.length) / shardCount);
  const end = Math.floor(((shardIndex + 1) * jobs.length) / shardCount);
  return jobs.slice(start, end);
}

async function main() {
  const { values } = parseArgs({
    options: {
      experiment: { type: 'string' },
      out: { type: 'string' },
      workers: { type: 'string' },
      cache: { type: 'string' },
      'discard-renders': { type: 'boolean' },
      'shard-index': { type: 'string' },
      'shard-count': { type: 'string' }
    }
  });
  if (!values.experiment) throw new Error('--experiment is required');
  if (values['shard-index'] === undefined || values['shard-count'] === undefined) throw new Error('--shard-index and --shard-count are required');
  const out = resolve(values.out ?? `artifacts/shards/shard-${values['shard-index']}.json`);
  const workers = Number(values.workers ?? '2');
  const shardIndex = Number(values['shard-index']);
  const shardCount = Number(values['shard-count']);
  if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error('Workers must be 1..16');
  if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardIndex < 0 || shardCount < 1 || shardIndex >= shardCount) {
    throw new Error('Invalid shard index/count');
  }
  const experiment = values.experiment.endsWith('.json')
    ? JSON.parse(await readFile(resolve(values.experiment), 'utf8'))
    : presetExperiment(values.experiment);
  assertShardedUnsealed(experiment);
  const { experiment: normalised, configs, jobs } = buildJobs(experiment, { allowAboveCap: true });
  const shardJobs = pickJobs(jobs, shardIndex, shardCount);
  if (!shardJobs.length) throw new Error(`Shard ${shardIndex}/${shardCount} has zero jobs`);
  const clipIds = new Set(shardJobs.flatMap((job) => {
    const scene = normalised.custom_scenes?.[job.scene] ?? buildScene(job.scene);
    return scenarioForJob(scene, job).sources.map((source) => source.clip);
  }));
  const clips = await loadBenchmarkClips(clipIds);
  const manifest = await codeManifest();
  manifest.shard = {
    shard_index: shardIndex,
    shard_count: shardCount,
    expected_jobs: jobs.length,
    shard_jobs: shardJobs.length,
    input_sha256: createHash('sha256').update(JSON.stringify(experiment)).digest('hex')
  };
  const cacheDirectory = resolve(values.cache ?? `.benchmark-cache-shard-${shardIndex}`);
  const executor = await nodeExecutor({
    workers,
    clips,
    manifest,
    experiment: normalised,
    cacheDirectory,
    discardRenders: !!values['discard-renders']
  });
  const groupForJob = new Map(await Promise.all(shardJobs.map(async (job) => [job.id, await executor.renderGroup(job)])));
  const groupRemaining = new Map();
  for (const group of groupForJob.values()) groupRemaining.set(group, (groupRemaining.get(group) ?? 0) + 1);
  const results = new Array(shardJobs.length);
  let cursor = 0;
  async function workerLoop() {
    while (cursor < shardJobs.length) {
      const index = cursor++;
      const job = shardJobs[index];
      const result = await executor.execute(job);
      results[index] = result;
      const group = groupForJob.get(job.id);
      const left = (groupRemaining.get(group) ?? 1) - 1;
      groupRemaining.set(group, left);
      if (left === 0 && executor.onRenderComplete) await executor.onRenderComplete(group);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(workers, shardJobs.length) }, workerLoop));
  } finally {
    await executor.close();
  }
  const report = finishExperiment(normalised, configs, results, {
    ...executor.manifest,
    cancelled: false,
    expected_runs: shardJobs.length,
    full_expected_runs: jobs.length
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  const stem = out.replace(/\.json$/, '');
  await writeFile(`${stem}.csv`, reportCsv(report));
  await writeFile(`${stem}.html`, reportHtml(report, executor.manifest.targets));
  console.log(JSON.stringify({
    shard_index: shardIndex,
    shard_count: shardCount,
    shard_jobs: shardJobs.length,
    expected_jobs: jobs.length,
    output: out
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
