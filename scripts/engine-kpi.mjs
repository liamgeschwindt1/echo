import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { aggregate, metricValues } from '../packages/sim-core/src/benchmark/metrics.js';
import { canonical, renderSettingsFor } from '../packages/sim-core/src/benchmark/cache.js';

const DEFAULT_BOOTSTRAP_SAMPLES = 2000;
const KPI_VERSION = 1;
const HEADLINE_METRICS = [
  ['events_within_10m_misses_counted', 'fraction'],
  ['horizontal_p90_m', 'm'],
  ['horizontal_median_m', 'm'],
  ['scene_fix_rate', 'fraction'],
  ['source_fix_rate', 'fraction'],
  ['unflagged_wrong_fix_rate', 'fraction'],
  ['within_1sigma', 'fraction'],
  ['within_2sigma', 'fraction'],
  ['error_3d_p90_m', 'm'],
  ['track_median_error_m', 'm']
];
const NULL_METRIC = Object.freeze({
  value: null,
  interval95: null,
  n_sites: null,
  n_runs: null
});

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const ratio = rank - low;
  return sorted[low] * (1 - ratio) + sorted[high] * ratio;
}

function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function metricCell(rawMetric, unit) {
  if (!rawMetric || rawMetric.value === null || rawMetric.value === undefined || !Number.isFinite(rawMetric.value)) {
    return { ...NULL_METRIC, unit };
  }
  const ci = Array.isArray(rawMetric.ci) && rawMetric.ci.length === 2 &&
    Number.isFinite(rawMetric.ci[0]) && Number.isFinite(rawMetric.ci[1])
    ? [rawMetric.ci[0], rawMetric.ci[1]]
    : null;
  return {
    value: rawMetric.value,
    interval95: ci,
    n_sites: Number.isInteger(rawMetric.n_sites) ? rawMetric.n_sites : null,
    n_runs: Number.isInteger(rawMetric.n_runs) ? rawMetric.n_runs : null,
    unit
  };
}

function metricCellFromValue(value, nSites, nRuns, unit) {
  if (!Number.isFinite(value)) return { ...NULL_METRIC, unit };
  return { value, interval95: null, n_sites: nSites, n_runs: nRuns, unit };
}

function selectBenchmarkRow(report) {
  const preferred = report.summary.find((row) =>
    row.analysis_mode === 'measured_only' && row.realism === 'on' &&
    (row.split === 'validation' || row.split === 'all'));
  return preferred ?? report.summary.find((row) => row.analysis_mode === 'measured_only') ?? report.summary[0] ?? null;
}

function groupedBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
  }
  return map;
}

function siteId(run) {
  return run.job.site_id ?? run.job.scene ?? run.job.id;
}

function pairedMetricDelta(currentRuns, baselineRuns, metric, wrongFixM, bootstrapSamples = DEFAULT_BOOTSTRAP_SAMPLES) {
  const currentBySite = groupedBy(currentRuns, siteId);
  const baselineBySite = groupedBy(baselineRuns, siteId);
  const sites = [...currentBySite.keys()];
  const difference = (after, before) => {
    const a = metricValues(after, { wrong_fix_m: wrongFixM })[metric];
    const b = metricValues(before, { wrong_fix_m: wrongFixM })[metric];
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
  };
  const delta = difference(currentRuns, baselineRuns);
  if (!Number.isFinite(delta)) return { delta: null, interval95: null, n_sites: sites.length, n_runs: currentRuns.length };
  const rng = mulberry32(0x7f4a7c15);
  const draws = [];
  if (sites.length >= 2) for (let i = 0; i < bootstrapSamples; i++) {
    const sample = Array.from({ length: sites.length }, () => sites[Math.floor(rng() * sites.length)]);
    const value = difference(sample.flatMap((id) => currentBySite.get(id)), sample.flatMap((id) => baselineBySite.get(id)));
    if (Number.isFinite(value)) draws.push(value);
  }
  return { delta, interval95: draws.length ? [percentile(draws, 2.5), percentile(draws, 97.5)] : null, n_sites: sites.length, n_runs: currentRuns.length };
}

function convertHeadline(metrics) {
  return Object.fromEntries(HEADLINE_METRICS.map(([key, unit]) => [key, metricCell(metrics[key], unit)]));
}

function convertProfileMetrics(results = {}) {
  const converted = {};
  for (const [profile, profileResult] of Object.entries(results)) {
    if (!profileResult?.metrics) {
      converted[profile] = {};
      continue;
    }
    converted[profile] = Object.fromEntries(Object.entries(profileResult.metrics).map(([metric, value]) => [metric, metricCell(value, null)]));
  }
  return converted;
}

function matrixBreakdownFromSummary(matrixSummary) {
  if (!matrixSummary?.cells) return [];
  return matrixSummary.cells.map((cell) => ({
    cell_index: cell.cell_index,
    factors: cell.factors,
    install_profiles: convertProfileMetrics({
      off: cell.results?.['all/off'],
      on: cell.results?.['all/on'],
      surveyed: cell.results?.['all/surveyed'],
      self_calibrated: null
    })
  }));
}

function sourceCountBreakdown(benchmarkReport) {
  if (!benchmarkReport?.runs) return [];
  const grouped = groupedBy(benchmarkReport.runs, (run) =>
    String(run.scenario?.settings?.matrix_simultaneous_sources ?? run.scenario?.sources?.length ?? 'unknown'));
  return [...grouped.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([sourceCount, runs]) => ({
    simultaneous_sources: Number(sourceCount),
    metrics: convertHeadline(aggregate(runs, { wrong_fix_m: benchmarkReport.experiment?.wrong_fix_m }))
  }));
}

function nodeCountBreakdown(benchmarkReport) {
  if (!benchmarkReport?.runs) return [];
  const grouped = groupedBy(benchmarkReport.runs, (run) =>
    `${run.scenario?.settings?.matrix_node_count ?? run.scenario?.nodes?.length ?? 0}|${run.job.realism}`);
  return [...grouped.entries()].map(([key, runs]) => {
    const [count, realism] = key.split('|');
    return {
      node_count: Number(count),
      realism,
      metrics: convertHeadline(aggregate(runs, { wrong_fix_m: benchmarkReport.experiment?.wrong_fix_m }))
    };
  }).sort((a, b) => a.node_count - b.node_count || a.realism.localeCompare(b.realism));
}

function installProfileBreakdown(benchmarkReport) {
  if (!benchmarkReport?.runs) return [];
  const grouped = groupedBy(benchmarkReport.runs, (run) => run.job.realism);
  return [...grouped.entries()].map(([profile, runs]) => ({
    profile,
    metrics: convertHeadline(aggregate(runs, { wrong_fix_m: benchmarkReport.experiment?.wrong_fix_m }))
  })).sort((a, b) => a.profile.localeCompare(b.profile));
}

function detectabilityBreakdown(headline) {
  return {
    original_detectable_3_nodes: {
      detectable_fraction: headline.detectable_3_node_fraction ?? { ...NULL_METRIC, unit: 'fraction' },
      events_within_10m: headline.detectable_3_node_events_within_10m ?? { ...NULL_METRIC, unit: 'fraction' },
      event_count: headline.detectable_3_node_event_count ?? { ...NULL_METRIC, unit: 'events' }
    },
    second_detectability_label: {
      definition: null,
      detectable_fraction: { ...NULL_METRIC, unit: 'fraction' },
      events_within_10m: { ...NULL_METRIC, unit: 'fraction' },
      event_count: { ...NULL_METRIC, unit: 'events' }
    }
  };
}

function buildingBreakdown(benchmarkReport) {
  if (!benchmarkReport?.runs) return { open_cells: null, building_cells: null, harm_vs_open: null };
  const byEnv = groupedBy(benchmarkReport.runs.filter((run) => run.scenario?.settings?.matrix_environment),
    (run) => run.scenario.settings.matrix_environment);
  const openRuns = byEnv.get('open') ?? [];
  const buildingRuns = [...(byEnv.get('mixed') ?? []), ...(byEnv.get('dense') ?? [])];
  const metric = 'events_within_10m_misses_counted';
  const openMetrics = aggregate(openRuns, { wrong_fix_m: benchmarkReport.experiment?.wrong_fix_m });
  const buildingMetrics = aggregate(buildingRuns, { wrong_fix_m: benchmarkReport.experiment?.wrong_fix_m });
  const open = metricCell(openMetrics[metric], 'fraction');
  const building = metricCell(buildingMetrics[metric], 'fraction');
  const harmValue = Number.isFinite(open.value) && Number.isFinite(building.value) ? building.value - open.value : null;
  return {
    open_cells: open,
    building_cells: building,
    harm_vs_open: metricCellFromValue(harmValue, Math.min(open.n_sites ?? 0, building.n_sites ?? 0), Math.min(open.n_runs ?? 0, building.n_runs ?? 0), 'fraction')
  };
}

function failureAttribution(benchmarkReport) {
  if (!Array.isArray(benchmarkReport?.failure_atlas)) return [];
  const rows = benchmarkReport.failure_atlas.flatMap((entry) => entry.categories ?? []);
  const grouped = groupedBy(rows, (row) => row.category);
  return [...grouped.entries()].map(([category, categories]) => ({
    cause_code: category,
    failures: categories.reduce((sum, row) => sum + (row.failures ?? 0), 0),
    no_fix: categories.reduce((sum, row) => sum + (row.no_fix ?? 0), 0),
    unmatched_fixes: categories.reduce((sum, row) => sum + (row.unmatched_fixes ?? 0), 0),
    median_error_m: finiteNumber(percentile(categories.map((row) => row.median_error_m).filter(Number.isFinite), 50))
  })).sort((a, b) => b.failures - a.failures);
}

function realismPenalty(benchmarkReport) {
  if (!benchmarkReport?.runs) return { coverage_delta: { ...NULL_METRIC, unit: 'fraction' }, horizontal_p90_delta_m: { ...NULL_METRIC, unit: 'm' } };
  const byRealism = groupedBy(benchmarkReport.runs, (run) => run.job.realism);
  const on = aggregate(byRealism.get('on') ?? [], { wrong_fix_m: benchmarkReport.experiment?.wrong_fix_m });
  const off = aggregate(byRealism.get('off') ?? [], { wrong_fix_m: benchmarkReport.experiment?.wrong_fix_m });
  const coverageDelta = Number.isFinite(on.source_fix_rate?.value) && Number.isFinite(off.source_fix_rate?.value)
    ? on.source_fix_rate.value - off.source_fix_rate.value
    : null;
  const p90Delta = Number.isFinite(on.horizontal_p90_m?.value) && Number.isFinite(off.horizontal_p90_m?.value)
    ? on.horizontal_p90_m.value - off.horizontal_p90_m.value
    : null;
  return {
    coverage_delta: metricCellFromValue(coverageDelta, null, null, 'fraction'),
    horizontal_p90_delta_m: metricCellFromValue(p90Delta, null, null, 'm')
  };
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readFileMaybeCompressed(path) {
  const bytes = await readFile(path);
  if (path.endsWith('.gz')) return gunzipSync(bytes);
  return bytes;
}

async function readJson(path) {
  const bytes = await readFileMaybeCompressed(path);
  return { data: JSON.parse(bytes.toString('utf8')), sha256: hashBytes(bytes) };
}

async function readOptionalJson(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

function metricDeltaMap(currentHeadline) {
  return Object.fromEntries(HEADLINE_METRICS.map(([metric, unit]) => {
    const current = currentHeadline[metric];
    return [metric, {
      delta: null,
      interval95: null,
      n_sites: current?.n_sites ?? null,
      n_runs: current?.n_runs ?? null,
      unit
    }];
  }));
}

function applyPairedIntervals(deltaMetrics, pairedDeltas) {
  for (const [metric, paired] of Object.entries(pairedDeltas ?? {})) {
    if (!deltaMetrics[metric]) continue;
    deltaMetrics[metric] = {
      ...deltaMetrics[metric],
      delta: finiteNumber(paired.delta),
      interval95: paired.interval95,
      n_sites: paired.n_sites,
      n_runs: paired.n_runs
    };
  }
}

export function pairedDeltasForReports(currentBenchmark, baselineBenchmark) {
  if (!currentBenchmark?.runs || !baselineBenchmark?.runs) return {};
  const complete = (report) => !report.manifest?.cancelled &&
    report.runs.length === report.manifest?.expected_runs;
  if (!complete(currentBenchmark) || !complete(baselineBenchmark) ||
      currentBenchmark.manifest.scoring_version !== baselineBenchmark.manifest.scoring_version ||
      (currentBenchmark.experiment?.wrong_fix_m ?? 10) !== (baselineBenchmark.experiment?.wrong_fix_m ?? 10)) return {};
  const identity = (run) => canonical([
    siteId(run), run.job.scene, run.job.seed, run.job.split, run.job.realism,
    run.job.analysis_mode, run.job.config?.values ?? {}
  ]);
  const current = new Map(currentBenchmark.runs.map((run) => [identity(run), run]));
  const baseline = new Map(baselineBenchmark.runs.map((run) => [identity(run), run]));
  if (current.size !== currentBenchmark.runs.length || baseline.size !== baselineBenchmark.runs.length ||
      current.size !== baseline.size || [...current.keys()].some((key) => !baseline.has(key))) return {};
  const physical = (run) => canonical({
    nodes: run.scenario?.nodes, sources: run.scenario?.sources, buildings: run.scenario?.buildings,
    settings: renderSettingsFor(run.scenario?.settings ?? {})
  });
  if ([...current].some(([key, run]) => physical(run) !== physical(baseline.get(key)))) return {};
  const wrongFixM = currentBenchmark.experiment?.wrong_fix_m ?? 10;
  return Object.fromEntries(HEADLINE_METRICS.map(([metric]) => [
    metric,
    pairedMetricDelta(currentBenchmark.runs, baselineBenchmark.runs, metric, wrongFixM)
  ]));
}

function extractPrimaryReports(reports) {
  const benchmark = reports.find((report) => report.kind === 'echo-sim-benchmark') ?? null;
  const matrix = reports.find((report) => report.kind === 'echo-matrix-baseline') ?? null;
  return { benchmark, matrix };
}

export async function buildArtifacts({ engineId, parentId, status, branch, sourceHash, optionSet = {}, notes = '', reportInputs, date = new Date().toISOString() }) {
  const parsed = await Promise.all(reportInputs.map(async (path) => {
    const absolute = resolve(path);
    const { data, sha256 } = await readJson(absolute);
    return { absolute, relative: relative(process.cwd(), absolute), sha256, data };
  }));
  const reports = parsed.map((entry) => entry.data);
  const { benchmark, matrix } = extractPrimaryReports(reports);
  if (!benchmark && !matrix) throw new Error('No supported report kind found. Expected echo-sim-benchmark or echo-matrix-baseline.');
  const selectedBenchmark = benchmark ?? null;
  const selectedRow = selectedBenchmark ? selectBenchmarkRow(selectedBenchmark) : null;
  const rowMetrics = selectedRow?.metrics ?? {};
  const aggregateMetrics = selectedBenchmark?.runs ? aggregate(selectedBenchmark.runs, { wrong_fix_m: selectedBenchmark.experiment?.wrong_fix_m }) : null;
  const metricsSource = aggregateMetrics ?? rowMetrics;
  const headline = {
    ...convertHeadline(metricsSource),
    detectable_3_node_fraction: metricCell(metricsSource.detectable_3_node_fraction, 'fraction'),
    detectable_3_node_events_within_10m: metricCell(metricsSource.detectable_3_node_events_within_10m, 'fraction'),
    detectable_3_node_event_count: metricCell(metricsSource.detectable_3_node_event_count, 'events'),
    aerial_3d_fix_rate: { ...NULL_METRIC, unit: 'fraction' },
    aerial_height_error_m: { ...NULL_METRIC, unit: 'm' },
    track_continuity: { ...NULL_METRIC, unit: 'fraction' },
    time_to_fix_s: { ...NULL_METRIC, unit: 's' },
    id_switches: { ...NULL_METRIC, unit: 'count' }
  };

  const kpi = {
    schema_version: KPI_VERSION,
    engine_id: engineId,
    parent_id: parentId ?? null,
    headline,
    breakdowns: {
      matrix_24_cells: matrixBreakdownFromSummary(matrix),
      by_source_count: sourceCountBreakdown(selectedBenchmark),
      node_count_curve_2_to_8: nodeCountBreakdown(selectedBenchmark),
      install_profile_comparison: installProfileBreakdown(selectedBenchmark),
      detectable_subsets: detectabilityBreakdown(headline),
      building_vs_open: buildingBreakdown(selectedBenchmark),
      failure_attribution: failureAttribution(selectedBenchmark)
    },
    tracking: {
      track_error_median_m: headline.track_median_error_m,
      continuity: headline.track_continuity,
      time_to_fix_s: headline.time_to_fix_s,
      id_switches: headline.id_switches
    },
    realism_penalty: realismPenalty(selectedBenchmark),
    comparisons: {
      vs_parent: null,
      vs_le0: null
    },
    provenance: {
      date,
      branch,
      source_hash: sourceHash,
      option_set: optionSet,
      reports: parsed.map((entry) => ({ path: entry.relative, sha256: entry.sha256, kind: entry.data.kind ?? null })),
      populations: {
        benchmark_expected_runs: selectedBenchmark?.manifest?.expected_runs ?? null,
        benchmark_runs: selectedBenchmark?.runs?.length ?? null,
        matrix_runs: matrix?.population?.runs ?? null
      },
      preregistration_sha256: matrix?.preregistration_sha256 ?? selectedBenchmark?.experiment?.preregistration?.input_sha256 ?? null
    }
  };

  const parentKpiPath = parentId ? resolve('engines', parentId, 'kpi.json') : null;
  const le0KpiPath = engineId === 'LE-0' ? null : resolve('engines', 'LE-0', 'kpi.json');
  const parentKpi = parentKpiPath ? await readOptionalJson(parentKpiPath) : null;
  const le0Kpi = le0KpiPath ? await readOptionalJson(le0KpiPath) : null;
  const parentRefs = parentId ? await readOptionalJson(resolve('engines', parentId, 'refs.json')) : null;
  const le0Refs = engineId === 'LE-0' ? null : await readOptionalJson(resolve('engines', 'LE-0', 'refs.json'));
  const parentBenchmark = parentRefs?.reports?.find((report) => report.kind === 'echo-sim-benchmark')
    ? (await readJson(resolve(parentRefs.reports.find((report) => report.kind === 'echo-sim-benchmark').path))).data
    : null;
  const le0Benchmark = le0Refs?.reports?.find((report) => report.kind === 'echo-sim-benchmark')
    ? (await readJson(resolve(le0Refs.reports.find((report) => report.kind === 'echo-sim-benchmark').path))).data
    : null;

  if (parentKpi) {
    const vsParent = metricDeltaMap(kpi.headline, parentKpi.headline);
    applyPairedIntervals(vsParent, pairedDeltasForReports(selectedBenchmark, parentBenchmark));
    kpi.comparisons.vs_parent = { engine_id: parentId, metrics: vsParent };
  }
  if (engineId === 'LE-0') {
    const self = Object.fromEntries(HEADLINE_METRICS.map(([metric, unit]) => [metric, {
      delta: Number.isFinite(headline[metric].value) ? 0 : null,
      interval95: Number.isFinite(headline[metric].value) ? [0, 0] : null,
      n_sites: headline[metric].n_sites, n_runs: headline[metric].n_runs, unit
    }]));
    kpi.comparisons.vs_le0 = { engine_id: 'LE-0', metrics: self };
  } else if (le0Kpi) {
    const vsLe0 = metricDeltaMap(kpi.headline, le0Kpi.headline);
    applyPairedIntervals(vsLe0, pairedDeltasForReports(selectedBenchmark, le0Benchmark));
    kpi.comparisons.vs_le0 = { engine_id: 'LE-0', metrics: vsLe0 };
  }

  const engine = {
    id: engineId,
    parent_id: parentId ?? null,
    date,
    branch,
    source_hash: sourceHash,
    option_set: optionSet,
    status,
    notes
  };
  const refs = {
    engine_id: engineId,
    reports: parsed.map((entry) => ({ path: entry.relative, sha256: entry.sha256, kind: entry.data.kind ?? null }))
  };
  return { engine, kpi, refs };
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

function sortEngineId(a, b) {
  const parse = (id) => {
    const match = /^LE-(\d+)$/.exec(id);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };
  return parse(a.id) - parse(b.id) || a.id.localeCompare(b.id);
}

async function updateRegistry(entry) {
  const registryPath = resolve('engines/registry.json');
  let registry = [];
  try {
    registry = JSON.parse(await readFile(registryPath, 'utf8'));
    if (!Array.isArray(registry)) throw new Error('Registry must be an array');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const next = [...registry.filter((row) => row.id !== entry.id), entry].sort(sortEngineId);
  await ensureDir(dirname(registryPath));
  await writeFile(registryPath, `${JSON.stringify(next, null, 2)}\n`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      'engine-id': { type: 'string' },
      'parent-id': { type: 'string' },
      status: { type: 'string' },
      branch: { type: 'string' },
      'source-hash': { type: 'string' },
      notes: { type: 'string' },
      report: { type: 'string', multiple: true },
      'option-set': { type: 'string' }
    }
  });
  if (!values['engine-id']) throw new Error('--engine-id is required');
  if (!values.status) throw new Error('--status is required');
  if (!values.report?.length) throw new Error('At least one --report path is required');
  const optionSet = values['option-set'] ? JSON.parse(values['option-set']) : {};
  const branch = values.branch ?? 'unknown';
  const sourceHash = values['source-hash'] ?? 'unknown';
  const { engine, kpi, refs } = await buildArtifacts({
    engineId: values['engine-id'],
    parentId: values['parent-id'] ?? null,
    status: values.status,
    branch,
    sourceHash,
    optionSet,
    notes: values.notes ?? '',
    reportInputs: values.report
  });
  const engineDir = resolve('engines', engine.id);
  await ensureDir(engineDir);
  await writeFile(resolve(engineDir, 'engine.json'), `${JSON.stringify(engine, null, 2)}\n`);
  await writeFile(resolve(engineDir, 'kpi.json'), `${JSON.stringify(kpi, null, 2)}\n`);
  await writeFile(resolve(engineDir, 'refs.json'), `${JSON.stringify(refs, null, 2)}\n`);
  await updateRegistry({
    id: engine.id,
    parent: engine.parent_id,
    date: engine.date,
    status: engine.status,
    branch: engine.branch,
    source_hash: engine.source_hash
  });
  console.log(JSON.stringify({ engine: resolve(engineDir, 'engine.json'), kpi: resolve(engineDir, 'kpi.json'), refs: resolve(engineDir, 'refs.json') }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
