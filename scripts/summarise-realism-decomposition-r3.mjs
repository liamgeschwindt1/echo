import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { canonical } from '../packages/sim-core/src/benchmark/cache.js';
import { metricValues } from '../packages/sim-core/src/benchmark/metrics.js';
import { mulberry32 } from '../packages/sim-core/src/rng.js';
import { percentile } from '../packages/sim-core/src/sweep.js';
import { EXPORT_SCHEMA } from '../packages/sim-core/src/export.js';

const rawPath = resolve(process.argv[2] ?? 'baselines/matrix-realism-r3-run.json');
const experimentPath = resolve(process.argv[3] ?? 'docs/experiments/matrix-r3-realism-decomposition.json');
const sitesPath = resolve(process.argv[4] ?? 'docs/experiments/matrix-r3-realism-sites.json');
const outputPath = resolve(process.argv[5] ?? 'baselines/matrix-realism-r3.json');
const archivePath = outputPath.replace(/\.json$/, '.full.json.gz');
const csvPath = rawPath.replace(/\.json$/, '.csv');
const htmlPath = rawPath.replace(/\.json$/, '.html');
const retainedCsv = outputPath.replace(/\.json$/, '-runs.csv');
const retainedHtml = outputPath.replace(/\.json$/, '-runs.html');

async function exists(path) {
  try { await access(path); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

for (const path of [outputPath, archivePath, retainedCsv, retainedHtml]) {
  if (await exists(path)) throw new Error(`Refusing to overwrite existing matrix evidence: ${path}`);
}

const [rawBytes, experimentBytes, sitesBytes] = await Promise.all([
  readFile(rawPath), readFile(experimentPath), readFile(sitesPath)
]);
const report = JSON.parse(rawBytes);
const experiment = JSON.parse(experimentBytes);
const population = JSON.parse(sitesBytes);
if (report.kind !== 'echo-sim-benchmark' || report.schema !== EXPORT_SCHEMA ||
    report.experiment.preregistration?.input_sha256 !== population.input_sha256 ||
    report.experiment.preregistration?.sealed_input_sha256 !== population.sealed_input_sha256) {
  throw new Error('Realism report does not match the preregistered generated population or schema');
}
const expected = buildJobs(experiment).jobs.map((job) => job.id).sort();
const actual = report.runs.map((run) => run.job.id).sort();
if (report.manifest.cancelled || report.runs.length !== expected.length ||
    report.manifest.expected_runs !== expected.length || canonical(actual) !== canonical(expected) ||
    report.runs.some((run) => run.job.split === 'test')) {
  throw new Error('Realism report is incomplete or contains an unregistered split');
}

const metadata = new Map(population.rows.map((row) => [row.id, row.metadata]));
const groups = new Map();
for (const run of report.runs) {
  const info = metadata.get(run.job.scene);
  if (!info || info.render_seed !== run.job.seed) throw new Error(`Unregistered realism scene or seed: ${run.job.scene}`);
  const variants = groups.get(info.contrast_id) ?? {};
  if (variants[info.variant]) throw new Error(`Duplicate realism variant: ${info.contrast_id}/${info.variant}`);
  variants[info.variant] = run;
  groups.set(info.contrast_id, variants);
}
if (groups.size !== population.sites) throw new Error('Realism contrast count does not match the registered population');

const metricNames = [
  'horizontal_median_m', 'horizontal_p90_m', 'source_fix_rate',
  'events_within_10m_misses_counted', 'detectable_3_node_fraction',
  'detectable_3_node_events_within_10m', 'wrong_fix_rate', 'within_1sigma',
  'within_2sigma', 'fix_brier_score', 'fix_log_loss', 'fix_error_10m_auc',
  'fix_reliability_error'
];
const contrasts = [...groups].map(([contrastId, variants]) => {
  const { baseline, treatment } = variants;
  if (!baseline || !treatment || baseline.job.seed !== treatment.job.seed) {
    throw new Error(`Missing or unpaired realism contrast: ${contrastId}`);
  }
  const before = metricValues([baseline], experiment);
  const after = metricValues([treatment], experiment);
  const info = metadata.get(baseline.job.scene);
  return {
    id: contrastId,
    kind: info.kind,
    components: info.components,
    values: info.values,
    environment: info.environment,
    node_count: info.node_count,
    site_seed: info.site_seed,
    render_seed: info.render_seed,
    status: 'single matched site; descriptive only',
    metrics: Object.fromEntries(metricNames.map((metric) => [metric, {
      baseline: before[metric],
      treatment: after[metric],
      delta: Number.isFinite(before[metric]) && Number.isFinite(after[metric])
        ? after[metric] - before[metric]
        : null
    }]))
  };
});

const grouped = new Map();
for (const row of contrasts) {
  const key = `${row.kind}/${row.components.join('+')}`;
  const rows = grouped.get(key) ?? [];
  rows.push(row);
  grouped.set(key, rows);
}
const summaries = [...grouped].map(([key, rows], groupIndex) => {
  const nSites = new Set(rows.map((row) => row.site_seed)).size;
  const metrics = Object.fromEntries(metricNames.map((metric) => {
    const values = rows.map((row) => row.metrics[metric].delta).filter(Number.isFinite);
    if (!values.length) return [metric, { n_pairs: 0, mean_delta: null, ci: null }];
    const mean = (sample) => sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const observed = mean(values);
    const rng = mulberry32(9103 + groupIndex);
    const draws = nSites >= 2 ? Array.from({ length: experiment.bootstrap_samples }, () =>
      mean(Array.from({ length: values.length }, () => values[Math.floor(rng() * values.length)]))) : [];
    return [metric, {
      n_pairs: values.length,
      mean_delta: observed,
      ci: draws.length ? [percentile(draws, 2.5), percentile(draws, 97.5)] : null
    }];
  }));
  return {
    key,
    kind: rows[0].kind,
    components: rows[0].components,
    n_sites: nSites,
    status: nSites < 5 ? 'insufficient' : 'descriptive paired effect',
    metrics
  };
});

const summary = {
  schema: 1,
  kind: 'echo-realism-decomposition',
  complete: true,
  input_sha256: population.input_sha256,
  sealed_input_sha256: population.sealed_input_sha256,
  raw_report_sha256: createHash('sha256').update(rawBytes).digest('hex'),
  population: {
    sites: population.sites,
    contrasts: contrasts.length,
    runs: report.runs.length,
    expected_runs: report.manifest.expected_runs
  },
  producer: report.manifest,
  definitions: {
    paired_delta: 'Treatment minus zero-impairment baseline, using the same site seed for both variants.',
    intervals: 'Bootstrap complete matched site contrasts; intervals are descriptive and not field-performance guarantees.',
    insufficient: 'Groups with fewer than five distinct sites are marked insufficient.',
    limitations: 'The site design is simulated, one source, stationary, ground-level, and limited to open/mixed environments.'
  },
  summaries,
  contrasts
};

await writeFile(archivePath, gzipSync(rawBytes, { level: 9 }), { flag: 'wx' });
await writeFile(outputPath, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
await rename(csvPath, retainedCsv);
await rename(htmlPath, retainedHtml);
console.log(JSON.stringify({
  summary: outputPath,
  full_report: archivePath,
  contrasts: contrasts.length,
  runs: report.runs.length,
  input_sha256: population.input_sha256
}, null, 2));
