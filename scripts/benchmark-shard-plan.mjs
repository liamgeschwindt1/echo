import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { buildJobs, presetExperiment } from '../packages/sim-core/src/benchmark/experiment.js';
import { assertShardedUnsealed } from './lib/integration-seal-guard.mjs';

export function shardSlices(total, shardCount) {
  return Array.from({ length: shardCount }, (_, shardIndex) => {
    const start = Math.floor((shardIndex * total) / shardCount);
    const end = Math.floor(((shardIndex + 1) * total) / shardCount);
    return { shard_index: shardIndex, start, end, job_count: end - start };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      experiment: { type: 'string' },
      shards: { type: 'string' }
    }
  });
  const experimentInput = values.experiment ?? 'smoke';
  const shardCountRaw = Number(values.shards ?? '4');
  if (!Number.isInteger(shardCountRaw) || shardCountRaw < 1 || shardCountRaw > 20) throw new Error('Shards must be 1..20');
  const experiment = experimentInput.endsWith('.json')
    ? JSON.parse(await readFile(resolve(experimentInput), 'utf8'))
    : presetExperiment(experimentInput);
  assertShardedUnsealed(experiment);
  const { jobs } = buildJobs(experiment, { allowAboveCap: true });
  if (!jobs.length) throw new Error('No jobs in experiment');
  const shardCount = Math.min(shardCountRaw, jobs.length, 20);
  const slices = shardSlices(jobs.length, shardCount).filter((slice) => slice.job_count > 0);
  const inputHash = createHash('sha256').update(JSON.stringify(experiment)).digest('hex');
  process.stdout.write(JSON.stringify({
    include: slices,
    expected_jobs: jobs.length,
    shard_count: slices.length,
    input_sha256: inputHash
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
