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
  events_within_10m_misses_counted: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  detectable_3_node_fraction: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  detectable_3_node_events_within_10m: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  detectable_3_node_event_count: { direction: 'higher', unit: 'events', tolerance: 0, tracked: false },
  scene_fix_rate: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  useful_fix_rate: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  unflagged_wrong_fix_rate: { direction: 'lower', unit: 'fraction', tolerance: 0 },
  risk_coverage_area: { direction: 'lower', unit: 'fraction', tolerance: 0 },
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
  fix_brier_score: { direction: 'lower', unit: 'score', tolerance: 0 },
  fix_log_loss: { direction: 'lower', unit: 'nats', tolerance: 0 },
  fix_error_10m_auc: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  fix_reliability_error: { direction: 'lower', unit: 'fraction', tolerance: 0 },
  detection_rate: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  labelling_accuracy: { direction: 'higher', unit: 'fraction', tolerance: 0 },
  runtime_ms: { direction: 'lower', unit: 'ms', tracked: false }
});
const ratio = (a, b) => b ? a / b : null;
const finite = (a) => a.filter(Number.isFinite);
const siteId = (run) => run.job.site_id ?? run.job.scene ?? run.job.id;

function siteClusterSample(runs, rng) {
  const clusters = new Map();
  for (const run of runs) {
    const id = siteId(run);
    const rows = clusters.get(id) ?? [];
    rows.push(run);
    clusters.set(id, rows);
  }
  const sites = [...clusters.keys()];
  return Array.from({ length: sites.length }, () => clusters.get(sites[Math.floor(rng() * sites.length)])).flat();
}

function fixProbabilityRows(runs, wrongFixM) {
  const rows = runs.flatMap((run) => (run.scores.fixes ?? [])
    .filter((fix) => Number.isFinite(fix.horizontal_m))
    .map((fix) => {
      const p = fix.p_wrong;
      if (p !== undefined && p !== null && (!Number.isFinite(p) || p < 0 || p > 1)) {
        throw new Error('Fix wrong-probability must be a finite value between 0 and 1');
      }
      return { p, wrong: Number(fix.horizontal_m > wrongFixM) };
    }));
  return rows;
}

function auc(rows) {
  const positives = rows.filter((r) => r.wrong).length;
  const negatives = rows.length - positives;
  if (!positives || !negatives) return null;
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  let positiveRanks = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].p === sorted[i].p) j++;
    const meanRank = ((i + 1) + j) / 2;
    positiveRanks += sorted.slice(i, j).filter((r) => r.wrong).length * meanRank;
    i = j;
  }
  return (positiveRanks - positives * (positives + 1) / 2) / (positives * negatives);
}

function fixReliability(runs, wrongFixM, bins = 10) {
  const rows = fixProbabilityRows(runs, wrongFixM);
  if (!rows.length || rows.some((r) => !Number.isFinite(r.p))) return { n_fixes: rows.length, bins: [], error: null };
  const groups = Array.from({ length: bins }, () => []);
  for (const row of rows) groups[Math.min(bins - 1, Math.floor(row.p * bins))].push(row);
  const reliability = groups.map((group, i) => ({
    bin: i,
    count: group.length,
    predicted: group.length ? group.reduce((s, r) => s + r.p, 0) / group.length : null,
    observed: group.length ? group.reduce((s, r) => s + r.wrong, 0) / group.length : null
  }));
  const error = reliability.reduce((sum, b) => sum + b.count / rows.length *
    Math.abs(b.predicted - b.observed), 0);
  return { n_fixes: rows.length, bins: reliability, error };
}

function fixProbabilityMetrics(runs, wrongFixM) {
  const rows = fixProbabilityRows(runs, wrongFixM);
  if (!rows.length || rows.some((r) => !Number.isFinite(r.p))) {
    return { fix_brier_score: null, fix_log_loss: null, fix_error_10m_auc: null, fix_reliability_error: null };
  }
  const epsilon = 1e-15;
  return {
    fix_brier_score: rows.reduce((sum, r) => sum + (r.p - r.wrong) ** 2, 0) / rows.length,
    fix_log_loss: rows.reduce((sum, r) => sum - (r.wrong
      ? Math.log(Math.max(epsilon, r.p))
      : Math.log(Math.max(epsilon, 1 - r.p))), 0) / rows.length,
    fix_error_10m_auc: auc(rows),
    fix_reliability_error: fixReliability(runs, wrongFixM).error
  };
}

export function riskCoverage(runs, { wrong_fix_m = 10 } = {}) {
  const answered = runs.filter((r) => r.scores.fix_count > 0).map((r) => {
    const fixes = r.scores.fixes ?? r.scores.sources.filter((s) => Number.isFinite(s.horizontal_m));
    const unmatched = r.scores.unmatched_fixes ?? 0;
    const probabilities = [...fixes.map((s) => Number.isFinite(s.p_wrong) ? s.p_wrong : s.suspect ? 1 : 0),
      ...(r.scores.unmatched_predictions ?? []).map((s) => Number.isFinite(s.p_wrong) ? s.p_wrong : s.suspect ? 1 : 0)];
    if (unmatched && !r.scores.unmatched_predictions) probabilities.push(r.scores.unmatched_suspect === unmatched ? 1 : 0);
    return {
      confidence: 1 - Math.max(...probabilities, 0),
      wrong: unmatched > 0 || fixes.some((s) => s.horizontal_m > wrong_fix_m),
      error_m: unmatched ? null : fixes.length ? Math.max(...fixes.map((s) => s.horizontal_m)) : null
    };
  }).sort((a, b) => b.confidence - a.confidence);
  const curve = [{ coverage: 0, risk: null, mean_error_m: null, n_scenes: 0, confidence: null }];
  let count = 0, wrong = 0, area = 0, errorSum = 0, missingErrors = 0;
  for (let i = 0; i < answered.length;) {
    let j = i;
    while (j < answered.length && answered[j].confidence === answered[i].confidence) {
      const scene = answered[j++];
      wrong += Number(scene.wrong); count++;
      if (Number.isFinite(scene.error_m)) errorSum += scene.error_m;
      else missingErrors++;
    }
    const coverage = count / runs.length, risk = wrong / count;
    area += (coverage - curve.at(-1).coverage) * risk;
    curve.push({ coverage, risk, mean_error_m: missingErrors ? null : errorSum / count, n_scenes: count, confidence: answered[i].confidence });
    i = j;
  }
  // Unanswered scenes cost one, so abstaining from everything cannot win.
  return {
    curve, area: runs.length ? area + 1 - answered.length / runs.length : null,
    max_coverage: ratio(answered.length, runs.length),
    definition: 'Scene risk = any wrong/unmatched emitted fix. Rank by worst emitted confidence; equal-confidence groups stay together. Step integral over all scenes; unanswered tail costs 1. Mean metre error is unavailable if an unmatched hypothesis has unknown error.'
  };
}

export function metricValues(runs, { wrong_fix_m = 10 } = {}) {
  const sources = runs.flatMap((r) => r.scores.sources);
  const scoredFixes = runs.flatMap((r) => r.scores.fixes ?? r.scores.sources);
  const eventResults = runs.flatMap((run) => {
    const expected = run.scores.sources;
    const fixes = run.scores.fixes ?? expected;
    return expected.map((source, sourceIndex) => {
      const sourceFixes = fixes.filter((fix, fixIndex) =>
        (source.source_id === undefined || source.source_id === null) && fixes === expected
          ? fixIndex === sourceIndex
          : fix.source_id === source.source_id);
      const withinTarget = sourceFixes.some((fix) => Number.isFinite(fix.horizontal_m) && fix.horizontal_m <= wrong_fix_m);
      return {
        detectable: source.nodes.filter((node) => node.detected === true).length >= 3,
        withinTarget
      };
    });
  });
  const detectableEvents = eventResults.filter((event) => event.detectable);
  const fixes = scoredFixes.filter((s) => Number.isFinite(s.horizontal_m));
  const nodes = sources.flatMap((s) => s.nodes);
  const bearingNodes = scoredFixes.flatMap((s) => s.nodes ?? []);
  const eligibleBearings = bearingNodes.filter((n) => Number.isFinite(n.az_error_deg));
  const bearings = eligibleBearings.filter((n) => Number.isFinite(n.sigma_deg) && n.sigma_deg >= 0);
  const twoSigma = (n) => Object.hasOwn(n, 'two_sigma_deg') ? n.two_sigma_deg : Number.isFinite(n.sigma_deg) ? 2 * n.sigma_deg : null;
  const bearings2 = eligibleBearings.filter((n) => Number.isFinite(twoSigma(n)) && twoSigma(n) >= 0);
  const wrong = fixes.filter((s) => s.horizontal_m > wrong_fix_m);
  const flagged = fixes.filter((s) => s.suspect);
  const unmatched = runs.reduce((a, r) => a + r.scores.unmatched_fixes, 0);
  const tracks = scoredFixes.flatMap((s) => s.track_errors_m ?? []);
  const detection = nodes.filter((n) => n.detected !== null);
  const fixProbabilities = fixProbabilityMetrics(runs, wrong_fix_m);
  return {
    horizontal_median_m: percentile(finite(fixes.map((s) => s.horizontal_m)), 50),
    horizontal_p90_m: percentile(finite(fixes.map((s) => s.horizontal_m)), 90),
    error_3d_median_m: percentile(finite(fixes.map((s) => s.error_3d_m)), 50),
    error_3d_p90_m: percentile(finite(fixes.map((s) => s.error_3d_m)), 90),
    events_within_10m_misses_counted: ratio(eventResults.filter((event) => event.withinTarget).length, eventResults.length),
    detectable_3_node_fraction: ratio(detectableEvents.length, eventResults.length),
    detectable_3_node_events_within_10m: ratio(detectableEvents.filter((event) => event.withinTarget).length, detectableEvents.length),
    detectable_3_node_event_count: detectableEvents.length,
    scene_fix_rate: ratio(runs.filter((r) => r.scores.fix_count > 0).length, runs.length),
    useful_fix_rate: ratio(runs.filter((r) => (r.scores.fixes ?? r.scores.sources).some((s) => Number.isFinite(s.horizontal_m) && s.horizontal_m <= wrong_fix_m && !s.suspect)).length, runs.length),
    unflagged_wrong_fix_rate: ratio(runs.filter((r) => (r.scores.fixes ?? r.scores.sources).some((s) => Number.isFinite(s.horizontal_m) && s.horizontal_m > wrong_fix_m && !s.suspect) || r.scores.unmatched_fixes > r.scores.unmatched_suspect).length, runs.length),
    risk_coverage_area: riskCoverage(runs, { wrong_fix_m }).area,
    source_fix_rate: ratio(sources.filter((s) => Number.isFinite(s.horizontal_m)).length, sources.length),
    within_target_rate: ratio(fixes.filter((s) => s.horizontal_m <= wrong_fix_m).length, fixes.length + unmatched),
    wrong_fix_rate: ratio(wrong.length + unmatched, fixes.length + unmatched),
    suspect_recall: ratio(wrong.filter((s) => s.suspect).length + runs.reduce((a, r) => a + r.scores.unmatched_suspect, 0), wrong.length + unmatched),
    suspect_precision: ratio(flagged.filter((s) => s.horizontal_m > wrong_fix_m).length + runs.reduce((a, r) => a + r.scores.unmatched_suspect, 0), flagged.length + runs.reduce((a, r) => a + r.scores.unmatched_suspect, 0)),
    unmatched_fix_rate: ratio(unmatched, fixes.length + unmatched),
    track_fix_count: tracks.length,
    track_median_error_m: percentile(finite(tracks), 50),
    bearing_median_deg: percentile(finite(bearingNodes.map((n) => n.az_error_deg)), 50),
    elevation_median_deg: percentile(finite(bearingNodes.map((n) => n.el_error_deg)), 50),
    within_1sigma: bearings.length === eligibleBearings.length ? ratio(bearings.filter((n) => n.az_error_deg <= n.sigma_deg).length, bearings.length) : null,
    within_2sigma: bearings2.length === eligibleBearings.length ? ratio(bearings2.filter((n) => n.az_error_deg <= twoSigma(n)).length, bearings2.length) : null,
    ...fixProbabilities,
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
  const nSites = new Set(runs.map(siteId)).size;
  if (nSites >= 2) for (let b = 0; b < o.bootstrap_samples; b++) {
    const sample = siteClusterSample(runs, rng);
    const v = metricValues(sample, o);
    for (const k of Object.keys(draws)) if (Number.isFinite(v[k])) draws[k].push(v[k]);
  }
  const tail = (1 - o.confidence) * 50;
  return Object.fromEntries(Object.entries(values).map(([k, value]) => [k, {
    value, ci: draws[k].length ? [percentile(draws[k], tail), percentile(draws[k], 100 - tail)] : null,
    n_runs: runs.length, n_sites: nSites, confidence: o.confidence
  }]));
}

export function summariseRuns(runs, options = {}) {
  const keys = [...new Set(runs.map((r) => [r.job.config.id, r.job.split, r.job.realism, r.job.analysis_mode].join('|')))].sort();
  return keys.map((key) => {
    const subset = runs.filter((r) => [r.job.config.id, r.job.split, r.job.realism, r.job.analysis_mode].join('|') === key);
    const job = subset[0].job;
    return {
      key, config_id: job.config.id, name: job.config.name, values: job.config.values,
      settings: job.config.settings, group: job.config.group, split: job.split,
      realism: job.realism, analysis_mode: job.analysis_mode,
      population: subset.map((r) => `${r.job.scene}|${r.job.seed}`).sort(),
      metrics: aggregate(subset, options),
      fix_reliability: fixReliability(subset, options.wrong_fix_m ?? BENCHMARK_DEFAULTS.wrong_fix_m),
      risk_coverage: riskCoverage(subset, options)
    };
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
  if ((current.manifest?.scoring_version ?? 'source-one-to-one-v1') !== (baseline.manifest?.scoring_version ?? 'source-one-to-one-v1')) {
    return { differences: [], regressions: [{ reason: 'different scoring conventions; explicitly re-score reports before comparison' }], pass: false };
  }
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
  const deltas = runs.filter((r) => r.job.config.id === ids[0]).flatMap((r) => {
    const other = b.get(key(r));
    if (!other) return [];
    const aV = metricValues([r], o)[metric], bV = metricValues([other], o)[metric];
    return Number.isFinite(aV) && Number.isFinite(bV) ? [{ site: siteId(r), delta: bV - aV }] : [];
  });
  if (!deltas.length) return { metric, n_pairs: 0, n_sites: 0, delta: null, ci: null, p_value: null };
  const clusters = new Map();
  for (const row of deltas) clusters.set(row.site, [...(clusters.get(row.site) ?? []), row.delta]);
  const sites = [...clusters.keys()];
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const observed = mean(deltas.map((r) => r.delta)), rng = mulberry32(9137), draws = [];
  let extreme = 0;
  for (let i = 0; i < o.permutation_samples; i++) {
    const signs = new Map(sites.map((site) => [site, rng() < 0.5 ? -1 : 1]));
    if (Math.abs(mean(deltas.map((r) => signs.get(r.site) * r.delta))) >= Math.abs(observed) - 1e-12) extreme++;
  }
  if (sites.length >= 2) for (let i = 0; i < o.bootstrap_samples; i++) {
    const sample = Array.from({ length: sites.length }, () => clusters.get(sites[Math.floor(rng() * sites.length)])).flat();
    draws.push(mean(sample));
  }
  const tail = (1 - o.confidence) * 50;
  return {
    metric, n_pairs: deltas.length, n_sites: sites.length, delta: observed,
    ci: draws.length ? [percentile(draws, tail), percentile(draws, 100 - tail)] : null,
    p_value: (extreme + 1) / (o.permutation_samples + 1),
    method: 'paired site-cluster sign-flip randomisation; paired scene/seed runs; mean per-run metric delta B-A'
  };
}

export function rankingFlips(summary, metric = 'useful_fix_rate', rankVariable = 'mic_array') {
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
    const populations = g.rows.map((r) => Array.isArray(r.population) && r.population.length ? canonical([...r.population].sort()) : null);
    if (populations.includes(null) || new Set(populations).size > 1) return { ...g, rows: [], winners: [], winner: null, reason: 'Unequal or unknown scene/seed populations; ranking suppressed' };
    if (g.rows.some((r) => !Number.isFinite(r.metrics[metric]?.value))) return { ...g, rows: g.rows, winners: [], winner: null, reason: 'Ranking metric unavailable for at least one array; no comparison against null' };
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
  for (const run of runs) {
    const category = SCENES.find((x) => x.id === run.job.scene)?.category ?? 'custom';
    const add = (error, unmatched = 0, count = 1) => {
      if (!count) return;
      total += count;
      const row = categories.get(category) ?? { category, failures: 0, no_fix: 0, unmatched_fixes: 0, errors_m: [] };
      row.failures += count;
      if (unmatched) row.unmatched_fixes += count;
      else if (error === null) row.no_fix += count;
      else row.errors_m.push(error);
      categories.set(category, row);
    };
    const entries = run.scores.fixes
      ? [...run.scores.fixes, ...run.scores.sources.filter((s) => !Number.isFinite(s.horizontal_m))]
      : run.scores.sources;
    for (const s of entries) if (!Number.isFinite(s.horizontal_m) || s.horizontal_m > wrongFixM) add(s.horizontal_m ?? null);
    add(null, 1, run.scores.unmatched_fixes);
  }
  return [...categories.values()].map((r) => ({ category: r.category, failures: r.failures, no_fix: r.no_fix, unmatched_fixes: r.unmatched_fixes, share: ratio(r.failures, total), median_error_m: percentile(r.errors_m, 50), p90_error_m: percentile(r.errors_m, 90) })).sort((a, b) => b.failures - a.failures);
}

export function detectionByRange(runs, bins = [0, 20, 50, 100, 200, Infinity]) {
  return bins.slice(0, -1).map((min, i) => {
    const nodes = runs.flatMap((r) => r.scores.sources.flatMap((s) => s.nodes)).filter((n) => n.range_m >= min && n.range_m < bins[i + 1] && n.detected !== null);
    return { min_m: min, max_m: Number.isFinite(bins[i + 1]) ? bins[i + 1] : null, count: nodes.length, detection_rate: ratio(nodes.filter((n) => n.detected).length, nodes.length) };
  });
}
