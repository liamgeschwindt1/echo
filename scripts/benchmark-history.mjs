import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { summariseRuns } from '../packages/sim-core/src/benchmark/metrics.js';
import { canonical } from '../packages/sim-core/src/benchmark/cache.js';

const root = new URL('../', import.meta.url);
const paths = process.argv.slice(2);
if (!paths.length) throw new Error('Provide complete stored benchmark report paths');
const entries = [];
for (const path of paths) {
  const bytes = await readFile(new URL(path, root)), report = JSON.parse(path.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  if (report.kind !== 'echo-sim-benchmark' || report.manifest.cancelled || report.runs.length !== report.manifest.expected_runs) throw new Error(`Not a complete benchmark: ${path}`);
  const population = [...new Set(report.runs.map((r) => canonical({ scene: r.job.scene, seed: r.job.seed, realism: r.job.realism, mode: r.job.analysis_mode, values: r.job.config.values })))].sort();
  entries.push({
    report: path, report_sha256: createHash('sha256').update(bytes).digest('hex'),
    population_sha256: createHash('sha256').update(canonical(population)).digest('hex'),
    git_hash: report.manifest.git_hash, code_version: report.manifest.code_version, dirty: report.manifest.dirty,
    n_runs: report.runs.length, schema: report.schema,
    summary: summariseRuns(report.runs, { ...report.experiment, bootstrap_samples: 100 })
  });
}
await writeFile(new URL('docs/benchmark-history.json', root), JSON.stringify({
  schema: 1, notes: 'Stored complete reports only. Metrics recomputed with current scoring aggregation from stored scores; inference is unchanged. Different population hashes are not a longitudinal regression comparison. Dirty producers retain their original code hash.',
  entries
}, null, 2) + '\n');
