import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, unlink, access } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { aggregate } from '../packages/sim-core/src/benchmark/metrics.js';
import { canonical } from '../packages/sim-core/src/benchmark/cache.js';
import { sealedInputHash } from '../packages/sim-core/src/benchmark/sealed.js';
import { EXPORT_SCHEMA } from '../packages/sim-core/src/export.js';

const rawPath = resolve(process.argv[2] ?? 'baselines/matrix-baseline-r3-run.json');
const experimentPath = resolve(process.argv[3] ?? 'docs/experiments/matrix-r3-baseline.json');
const sitesPath = resolve(process.argv[4] ?? 'docs/experiments/matrix-r3-sites.json');
const sealPath = resolve(process.argv[5] ?? 'docs/experiments/matrix-r3-sealed.json');
const outputPath = resolve(process.argv[6] ?? 'baselines/matrix-baseline-r3.json');
const compressedPath = outputPath.replace(/\.json$/, '.full.json.gz');
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

for (const path of [outputPath, compressedPath, retainedCsv, retainedHtml]) {
  if (await exists(path)) throw new Error(`Refusing to overwrite existing matrix evidence: ${path}`);
}

const [reportBytes, experimentBytes, sitesBytes, sealBytes] = await Promise.all([
  readFile(rawPath), readFile(experimentPath), readFile(sitesPath), readFile(sealPath)
]);
const report = JSON.parse(reportBytes);
const experiment = JSON.parse(experimentBytes);
const sites = JSON.parse(sitesBytes);
const seal = JSON.parse(sealBytes);
const frozenSealHash = sealedInputHash(seal);
if (report.kind !== 'echo-sim-benchmark' || report.schema !== EXPORT_SCHEMA ||
    report.experiment.preregistration?.input_sha256 !== sites.input_sha256 ||
    report.experiment.preregistration?.generator_sha256 !== sites.generator_sha256 ||
    report.experiment.preregistration?.sealed_input_sha256 !== frozenSealHash) {
  throw new Error('Matrix report does not match the current generated input or benchmark schema');
}
const expected = buildJobs(experiment).jobs.map((job) => job.id).sort();
const actual = report.runs.map((run) => run.job.id).sort();
if (report.manifest.cancelled || report.runs.length !== expected.length ||
    canonical(actual) !== canonical(expected) || report.manifest.expected_runs !== expected.length) {
  throw new Error('Matrix report is incomplete or does not match the preregistered population');
}
if (report.runs.some((run) => !run.scenario.sources.length ||
    run.scenario.sources.length !== run.scenario.settings.matrix_simultaneous_sources ||
    run.job.split === 'test')) {
  throw new Error('Matrix report contains a missing or mislabelled source population');
}

const siteIds = new Set(sites.sites.map((site) => site.metadata.id));
if (report.runs.some((run) => !siteIds.has(run.job.scene))) throw new Error('Matrix report contains an unregistered site');
const options = experiment;
const profiles = experiment.realism;
const cellIndices = [...new Set(sites.sites.filter((site) => Number.isInteger(site.cell_index)).map((site) => site.cell_index))].sort((a, b) => a - b);
const cellFactors = new Map(sites.cells.map((cell) => [cell.cell_index, {
  environment: cell.environment,
  source_height: cell.source_height,
  motion: cell.motion,
  simultaneous_sources: cell.simultaneous_sources
}]));

function summarize(runs) {
  const nSites = new Set(runs.map((run) => run.job.scene)).size;
  return {
    n_scenes: nSites,
    status: nSites < 5 ? 'insufficient' : 'reported',
    metrics: aggregate(runs, options)
  };
}

const cellSummary = cellIndices.map((cellIndex) => {
  const cells = {};
  for (const split of ['all', 'train', 'validation']) for (const profile of profiles) {
    const runs = report.runs.filter((run) =>
      run.scenario.settings.matrix_cell_index === cellIndex &&
      run.job.scene.startsWith('core-') &&
      (split === 'all' || run.job.split === split) &&
      run.job.realism === profile);
    cells[`${split}/${profile}`] = summarize(runs);
  }
  return { cell_index: cellIndex, factors: cellFactors.get(cellIndex), results: cells };
});

const generalisationSummary = profiles.map((profile) => {
  const rows = report.runs.filter((run) =>
    run.scenario.settings.matrix_environment && run.job.scene.startsWith('generalisation-') &&
    run.job.realism === profile);
  return { realism: profile, ...summarize(rows) };
});

const densityGroups = new Map();
for (const run of report.runs) {
  if (!run.job.scene.startsWith('density-') || !run.scenario.settings.matrix_node_count) continue;
  const key = `${run.scenario.settings.matrix_node_count}|${run.scenario.settings.matrix_mean_spacing_m}|${run.job.realism}`;
  const rows = densityGroups.get(key) ?? [];
  rows.push(run);
  densityGroups.set(key, rows);
}
const nodeDensity = [...densityGroups].map(([key, runs]) => {
  const [node_count, mean_spacing_m, profile] = key.split('|');
  return {
    node_count: Number(node_count),
    mean_spacing_m: Number(mean_spacing_m),
    realism: profile,
    ...summarize(runs)
  };
}).sort((a, b) => a.node_count - b.node_count || a.mean_spacing_m - b.mean_spacing_m || a.realism.localeCompare(b.realism));

const summary = {
  schema: 1,
  kind: 'echo-matrix-baseline',
  complete: true,
  experiment: experiment.name,
  input_sha256: sites.input_sha256,
  preregistration_sha256: sites.preregistration_sha256,
  generator_sha256: sites.generator_sha256,
  sealed_input_sha256: frozenSealHash,
  raw_report_sha256: createHash('sha256').update(reportBytes).digest('hex'),
  population: {
    runs: report.runs.length,
    expected_runs: report.manifest.expected_runs,
    train_sites: new Set(report.runs.filter((r) => r.job.split === 'train').map((r) => r.job.scene)).size,
    validation_sites: new Set(report.runs.filter((r) => r.job.split === 'validation').map((r) => r.job.scene)).size,
    profiles,
    analysis_modes: experiment.analysis_modes
  },
  producer: report.manifest,
  definitions: {
    intervals: 'Site-cluster bootstrap; repeated runs from a site are resampled together.',
    insufficient: 'Groups with fewer than five distinct sites are marked insufficient; null metrics remain unavailable.',
    event_coverage: 'Expected source events are the denominator; missed source events count as failures.',
    detectable_subset: 'A source event is detectable when at least three nodes report a detected track; conditional event coverage is reported separately.'
  },
  cells: cellSummary,
  generalisation: generalisationSummary,
  node_density: nodeDensity
};
if (summary.sealed_input_sha256 !== experiment.preregistration.sealed_input_sha256) {
  throw new Error('Frozen sealed hash does not match the preregistration');
}

await writeFile(compressedPath, gzipSync(reportBytes, { level: 9 }), { flag: 'wx' });
await writeFile(outputPath, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
await rename(csvPath, retainedCsv);
await rename(htmlPath, retainedHtml);
await unlink(rawPath);
console.log(JSON.stringify({
  summary: outputPath,
  complete_report: compressedPath,
  cells: cellSummary.length,
  runs: report.runs.length,
  input_sha256: sites.input_sha256,
  sealed_input_sha256: summary.sealed_input_sha256
}, null, 2));
