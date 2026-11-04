import { mulberry32 } from '../rng.js';
import { percentile } from '../sweep.js';
import { SCENES } from './scenes.js';
import { BENCHMARK_DEFAULTS } from './experiment.js';
import { canonical } from './cache.js';

export const METRICS = Object.freeze({
  horizontal_median_m: { direction: 'lower', unit: 'm', tolerance: 0 },
  horizontal_p90_m: { direction: 'lower', unit: 'm', tolerance: 0 },
  error_3d_median_m: { direction: 'lower', unit: 'm', tolerance: 0 },
  error_3d_p90_m: { direction: 'lower', unit: 'm', tolerance: 0 },
  scene_fix_rate: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  source_fix_rate: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  within_target_rate: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  wrong_fix_rate: { direction: 'lower', unit: 'fraction', tolerance: 0 },
  suspect_recall: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  suspect_precision: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  unmatched_fix_rate: { direction: 'lower', unit: 'fraction', tolerance: 0 },
  track_fix_count: { direction: 'higher', unit: 'fixes', tolerance: 0 },
  track_median_error_m: { direction: 'lower', unit: 'm', tolerance: 0 },
  bearing_median_deg: { direction: 'lower', unit: 'deg', tolerance: 0 },
  elevation_median_deg: { direction: 'lower', unit: 'deg', tolerance: 0 },
  within_1sigma: { direction: 'target', target: 0.6827, unit: 'fraction', tolerance: 0 },
  within_2sigma: { direction: 'target', target: 0.9545, unit: 'fraction', tolerance: 0 },
  detection_rate: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  labelling_accuracy: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  runtime_ms: { direction: 'lower', unit: 'ms', tracked: false }
});
const ratio = (a, b) => b ? a / b : null;
const finite = (a) => a.filter(Number.isFinite);

export function metricValues(runs, { wrong_fix_m = 10 } = {}) {
  const sources = runs.flatMap((r) => r.scores.sources);
  const fixes = sources.filter((s) => Number.isFinite(s.horizontal_m));
  const nodes = sources.flatMap((s) => s.nodes);
  const bearings = nodes.filter((n) => Number.isFinite(n.az_error_deg) && Number.isFinite(n.sigma_deg));
  const wrong = fixes.filter((s) => s.horizontal_m > wrong_fix_m);
  const flagged = fixes.filter((s) => s.suspect);
  const unmatched = runs.reduce((a, r) => a + r.scores.unmatched_fixes, 0);
  const tracks = sources.flatMap((s) => s.track_errors_m);
  const detection = nodes.filter((n) => n.detected !== null);
  return {
    horizontal_median_m: percentile(finite(fixes.map((s) => s.horizontal_m)), 50),
    horizontal_p90_m: percentile(finite(fixes.map((s) => s.horizontal_m)), 90),
    error_3d_median_m: percentile(finite(fixes.map((s) => s.error_3d_m)), 50),
    error_3d_p90_m: percentile(finite(fixes.map((s) => s.error_3d_m)), 90),
    scene_fix_rate: ratio(runs.filter((r) => r.scores.fix_count > 0).length, runs.length),
    source_fix_rate: ratio(fixes.length, sources.length),
    within_target_rate: ratio(fixes.filter((s) => s.horizontal_m <= wrong_fix_m).length, fixes.length + unmatched),
    wrong_fix_rate: ratio(wrong.length + unmatched, fixes.length + unmatched),
    suspect_recall: ratio(wrong.filter((s) => s.suspect).length + runs.reduce((a, r) => a + r.scores.unmatched_suspect, 0), wrong.length + unmatched),
    suspect_precision: ratio(flagged.filter((s) => s.horizontal_m > wrong_fix_m).length + runs.reduce((a, r) => a + r.scores.unmatched_suspect, 0), flagged.length + runs.reduce((a, r) => a + r.scores.unmatched_suspect, 0)),
    unmatched_fix_rate: ratio(unmatched, fixes.length + unmatched),
    track_fix_count: tracks.length,
    track_median_error_m: percentile(finite(tracks), 50),
    bearing_median_deg: percentile(finite(nodes.map((n) => n.az_error_deg)), 50),
    elevation_median_deg: percentile(finite(nodes.map((n) => n.el_error_deg)), 50),
    within_1sigma: ratio(bearings.filter((n) => n.az_error_deg <= n.sigma_deg).length, bearings.length),
    within_2sigma: ratio(bearings.filter((n) => n.az_error_deg <= 2 * n.sigma_deg).length, bearings.length),
    detection_rate: ratio(detection.filter((n) => n.detected).length, detection.length),
    labelling_accuracy: null,
    runtime_ms: runs.reduce((a, r) => a + r.runtime_ms, 0)
  };
}

export function aggregate(runs, options = {}) {
  const o = { ...BENCHMARK_DEFAULTS, ...options };
  const values = metricValues(runs, o);
  const rng = mulberry32(7103);
  const draws = Object.fromEntries(Object.keys(METRICS).map((k) => [k, []]));
  // Resample complete scene/seed runs, not individual correlated sources or bearings.
  if (runs.length >= 2) for (let b = 0; b < o.bootstrap_samples; b++) {
    const sample = Array.from({ length: runs.length }, () => runs[Math.floor(rng() * runs.length)]);
    const v = metricValues(sample, o);
    for (const k of Object.keys(draws)) if (Number.isFinite(v[k])) draws[k].push(v[k]);
  }
  const tail = (1 - o.confidence) * 50;
  return Object.fromEntries(Object.entries(values).map(([k, value]) => [k, {
    value, ci: draws[k].length ? [percentile(draws[k], tail), percentile(draws[k], 100 - tail)] : null,
    n_runs: runs.length, confidence: o.confidence
  }]));
}

export function summariseRuns(runs, options = {}) {
  const keys = [...new Set(runs.map((r) => [r.job.config.id, r.job.split, r.job.realism, r.job.analysis_mode].join('|')))].sort();
  return keys.map((key) => {
    const subset = runs.filter((r) => [r.job.config.id, r.job.split, r.job.realism, r.job.analysis_mode].join('|') === key);
    const job = subset[0].job;
    return { key, config_id: job.config.id, name: job.config.name, values: job.config.values, settings: job.config.settings, group: job.config.group, split: job.split, realism: job.realism, analysis_mode: job.analysis_mode, metrics: aggregate(subset, options) };
  });
}

const loss = (v, m) => m.direction === 'target' ? Math.abs(v - m.target) : m.direction === 'higher' ? -v : v;
function matchingRow(current, before) {
  if (before.values === undefined) return current.find((r) => r.key === before.key);
  const candidates = current.filter((r) => r.split === before.split && r.realism === before.realism &&
    r.analysis_mode === before.analysis_mode && canonical(r.values) === canonical(before.values) &&
    (before.settings === undefined || canonical(r.settings) === canonical(before.settings)));
  return candidates.length === 1 ? candidates[0] : candidates.find((r) => r.key === before.key);
}
export function compareSummaries(current, baseline, tolerances = {}) {
  const differences = [];
  const regressions = [];
  for (const before of baseline) {
    const after = matchingRow(current, before);
    if (!after) { regressions.push({ key: before.key, reason: 'missing configuration' }); continue; }
    for (const [metric, definition] of Object.entries(METRICS)) {
      if (definition.tracked === false) continue;
      const a = after.metrics[metric]?.value, b = before.metrics[metric]?.value;
      if (a === null && b === null) continue;
      const missing = !Number.isFinite(a) && Number.isFinite(b);
      const regression = missing || (Number.isFinite(a) && Number.isFinite(b) && loss(a, definition) - loss(b, definition) > (tolerances[metric] ?? definition.tolerance) + 1e-10);
      const row = { key: before.key, metric, before: b, after: a, delta: Number.isFinite(a) && Number.isFinite(b) ? a - b : null, regression, ...(missing ? { reason: 'metric became unavailable' } : {}) };
      differences.push(row);
      if (regression) regressions.push(row);
    }
  }
  return { differences, regressions, pass: regressions.length === 0 };
}

export function compareReports(current, baseline, tolerances = {}) {
  const comparison = compareSummaries(current.summary, baseline.summary, tolerances);
  const cases = (report, row) => report.runs.filter((r) =>
    r.job.config.id === row.config_id && r.job.split === row.split && r.job.realism === row.realism && r.job.analysis_mode === row.analysis_mode)
    .map((r) => `${r.job.scene}|${r.job.seed}`).sort();
  for (const before of baseline.summary) {
    const after = matchingRow(current.summary, before);
    if (after && canonical(cases(current, after)) !== canonical(cases(baseline, before))) comparison.regressions.push({ key: before.key, reason: 'different scene/seed populations; metric delta is not a regression comparison' });
  }
  if ((current.experiment.wrong_fix_m ?? BENCHMARK_DEFAULTS.wrong_fix_m) !== (baseline.experiment.wrong_fix_m ?? BENCHMARK_DEFAULTS.wrong_fix_m)) comparison.regressions.push({ reason: 'different wrong-fix scoring targets' });
  comparison.pass = comparison.regressions.length === 0;
  return comparison;
}

export function pairedComparison(runs, metric, options = {}) {
  const o = { ...BENCHMARK_DEFAULTS, ...options };
  const ids = [...new Set(runs.map((r) => r.job.config.id))];
  if (ids.length !== 2) return null;
  const key = (r) => `${r.job.scene}|${r.job.seed}|${r.job.realism}|${r.job.analysis_mode}`;
  const b = new Map(runs.filter((r) => r.job.config.id === ids[1]).map((r) => [key(r), r]));
  const delta = runs.filter((r) => r.job.config.id === ids[0]).flatMap((r) => {
    const other = b.get(key(r));
    if (!other) return [];
    const aV = metricValues([r], o)[metric], bV = metricValues([other], o)[metric];
    return Number.isFinite(aV) && Number.isFinite(bV) ? [bV - aV] : [];
  });
  if (!delta.length) return { metric, n_pairs: 0, delta: null, ci: null, p_value: null };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const observed = mean(delta), rng = mulberry32(9137), draws = [];
  let extreme = 0;
  for (let i = 0; i < o.permutation_samples; i++) {
    if (Math.abs(mean(delta.map((d) => rng() < 0.5 ? -d : d))) >= Math.abs(observed) - 1e-12) extreme++;
  }
  if (delta.length >= 2) for (let i = 0; i < o.bootstrap_samples; i++) draws.push(mean(Array.from({ length: delta.length }, () => delta[Math.floor(rng() * delta.length)])));
  const tail = (1 - o.confidence) * 50;
  return { metric, n_pairs: delta.length, delta: observed, ci: draws.length ? [percentile(draws, tail), percentile(draws, 100 - tail)] : null, p_value: (extreme + 1) / (o.permutation_samples + 1), method: 'paired sign-flip randomisation; complete scene/seed pairs; mean per-run metric delta B-A' };
}

export function rankingFlips(summary, metric = 'horizontal_median_m', rankVariable = 'mic_array') {
  const definition = METRICS[metric];
  if (!definition) throw new Error(`Unknown ranking metric: ${metric}`);
  const partitions = new Map();
  for (const row of summary) {
    if (row.values[rankVariable] === undefined) continue;
    const context = Object.fromEntries(Object.entries(row.values).filter(([k]) => k !== rankVariable).sort());
    const key = JSON.stringify([row.split, row.realism, row.analysis_mode, context]);
    const group = partitions.get(key) ?? { context, split: row.split, realism: row.realism, analysis_mode: row.analysis_mode, rows: [] };
    group.rows.push(row);
    partitions.set(key, group);
  }
  const rankings = [...partitions.values()].map((g) => {
    const rows = g.rows.filter((r) => Number.isFinite(r.metrics[metric]?.value)).sort((a, b) => loss(a.metrics[metric].value, definition) - loss(b.metrics[metric].value, definition));
    const best = rows[0]?.metrics[metric].value;
    const winners = rows.filter((r) => Math.abs(r.metrics[metric].value - best) < 1e-10).map((r) => r.values[rankVariable]);
    return { ...g, rows, winners, winner: winners.length === 1 ? winners[0] : null };
  });
  const flips = [];
  for (let i = 0; i < rankings.length; i++) for (let j = i + 1; j < rankings.length; j++) {
    const a = rankings[i], b = rankings[j];
    if (a.split !== b.split || a.analysis_mode !== b.analysis_mode || !a.winner || !b.winner || a.winner === b.winner) continue;
    const variables = [...new Set([...Object.keys(a.context), ...Object.keys(b.context)])].filter((k) => a.context[k] !== b.context[k]);
    if (a.realism !== b.realism) variables.push('realism');
    if (variables.length === 1) flips.push({ variable: variables[0], from: a.winner, to: b.winner, from_context: a.context, to_context: b.context, split: a.split, analysis_mode: a.analysis_mode });
  }
  return { metric, rank_variable: rankVariable, rankings, flips, note: 'Point-estimate rankings; ties and unavailable metrics have no winner. CI overlap is not evidence of superiority.' };
}

export function failureAtlas(runs, wrongFixM = 10) {
  const categories = new Map();
  let total = 0;
  for (const run of runs) for (const s of run.scores.sources) {
    if (Number.isFinite(s.horizontal_m) && s.horizontal_m <= wrongFixM) continue;
    total++;
    const category = SCENES.find((x) => x.id === run.job.scene)?.category ?? 'custom';
    const row = categories.get(category) ?? { category, failures: 0, no_fix: 0, errors_m: [] };
    row.failures++;
    if (s.horizontal_m === null) row.no_fix++;
    else row.errors_m.push(s.horizontal_m);
    categories.set(category, row);
  }
  return [...categories.values()].map((r) => ({ category: r.category, failures: r.failures, no_fix: r.no_fix, share: ratio(r.failures, total), median_error_m: percentile(r.errors_m, 50), p90_error_m: percentile(r.errors_m, 90) })).sort((a, b) => b.failures - a.failures);
}

export function detectionByRange(runs, bins = [0, 20, 50, 100, 200, Infinity]) {
  return bins.slice(0, -1).map((min, i) => {
    const nodes = runs.flatMap((r) => r.scores.sources.flatMap((s) => s.nodes)).filter((n) => n.range_m >= min && n.range_m < bins[i + 1] && n.detected !== null);
    return { min_m: min, max_m: Number.isFinite(bins[i + 1]) ? bins[i + 1] : null, count: nodes.length, detection_rate: ratio(nodes.filter((n) => n.detected).length, nodes.length) };
  });
}
