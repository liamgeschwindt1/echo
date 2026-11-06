import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { buildJobs, presetExperiment } from '../packages/sim-core/src/benchmark/experiment.js';
import { finishExperiment } from '../packages/sim-core/src/benchmark/runner.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';

async function listShardReports(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^shard-\d+\.json$/.test(entry.name))
    .map((entry) => resolve(directory, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  const { values } = parseArgs({
    options: {
      experiment: { type: 'string' },
      'shard-dir': { type: 'string' },
      out: { type: 'string' }
    }
  });
  if (!values.experiment) throw new Error('--experiment is required');
  if (!values['shard-dir']) throw new Error('--shard-dir is required');
  const out = resolve(values.out ?? 'artifacts/sharded-merged.json');
  const experiment = values.experiment.endsWith('.json')
    ? JSON.parse(await readFile(resolve(values.experiment), 'utf8'))
    : presetExperiment(values.experiment);
  const { experiment: normalised, configs, jobs } = buildJobs(experiment, { allowAboveCap: true });
  const expectedIds = jobs.map((job) => job.id);
  const shardPaths = await listShardReports(resolve(values['shard-dir']));
  if (!shardPaths.length) throw new Error('No shard reports found');
  const shardReports = await Promise.all(shardPaths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const sourceHashes = new Set(shardReports.map((report) => report.manifest?.code_version));
  if (sourceHashes.size !== 1) throw new Error('Shard source hash mismatch');
  const inputHash = createHash('sha256').update(JSON.stringify(experiment)).digest('hex');
  const shardInputHashes = new Set(shardReports.map((report) => report.manifest?.shard?.input_sha256));
  if (shardInputHashes.size !== 1 || !shardInputHashes.has(inputHash)) throw new Error('Shard input hash mismatch');
  const runs = shardReports.flatMap((report) => report.runs ?? []);
  const runIds = runs.map((run) => run.job.id);
  const duplicate = runIds.find((id, index) => runIds.indexOf(id) !== index);
  if (duplicate) throw new Error(`Duplicate job id in shard reports: ${duplicate}`);
  const missing = expectedIds.filter((id) => !runIds.includes(id));
  const extra = runIds.filter((id) => !expectedIds.includes(id));
  if (missing.length || extra.length) {
    throw new Error(`Shard coverage mismatch; missing=${missing.length}, extra=${extra.length}`);
  }
  const indexById = new Map(jobs.map((job, index) => [job.id, index]));
  runs.sort((a, b) => indexById.get(a.job.id) - indexById.get(b.job.id));
  const baseManifest = shardReports[0].manifest;
  const report = finishExperiment(normalised, configs, runs, {
    ...baseManifest,
    shard: {
      merged: true,
      shard_reports: shardReports.length,
      expected_jobs: jobs.length,
      input_sha256: inputHash
    },
    cancelled: false,
    expected_runs: jobs.length
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  const stem = out.replace(/\.json$/, '');
  await writeFile(`${stem}.csv`, reportCsv(report));
  await writeFile(`${stem}.html`, reportHtml(report, baseManifest.targets));
  console.log(JSON.stringify({
    shard_reports: shardReports.length,
    runs: runs.length,
    expected_runs: jobs.length,
    source_hash: [...sourceHashes][0],
    output: out
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
