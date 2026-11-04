import { metricValues } from './metrics.js';
import { canonical } from './cache.js';
import { mulberry32 } from '../rng.js';
import { percentile } from '../sweep.js';

const endpoints = ['horizontal_median_m', 'horizontal_p90_m', 'risk_coverage_area'];
const guarded = ['scene_fix_rate', 'unflagged_wrong_fix_rate', 'within_1sigma', 'within_2sigma'];
const identity = (r) => `${r.job.scene}|${r.job.seed}`;
const loss = (k, v) => k === 'within_1sigma' ? Math.abs(v - 0.6827) : k === 'within_2sigma' ? Math.abs(v - 0.9545) : v;

export function compareRound2Reports(current, baseline, options = {}) {
  const rows = [], regressions = [];
  const samples = options.bootstrap_samples ?? 1000;
  const confidence = options.confidence ?? 0.95;
  if (!Number.isInteger(samples) || samples < 1 || !(confidence > 0 && confidence < 1)) throw new Error('Invalid paired bootstrap settings');
  const optionsFor = { wrong_fix_m: current.experiment.wrong_fix_m ?? 10 };
  if ((baseline.experiment.wrong_fix_m ?? 10) !== optionsFor.wrong_fix_m ||
      baseline.manifest.scoring_version !== current.manifest.scoring_version) {
    return { pass: false, differences: [], regressions: [{ reason: 'Different scoring conventions or wrong-fix target' }], rule: 'round2' };
  }
  if (current.manifest.cancelled || baseline.manifest.cancelled ||
      current.runs.length !== current.manifest.expected_runs || baseline.runs.length !== baseline.manifest.expected_runs) {
    return { pass: false, differences: [], regressions: [{ reason: 'Incomplete population' }], rule: 'round2' };
  }
  const groups = [...new Set(baseline.runs.map((r) => `${r.job.config.id}|${r.job.split}|${r.job.realism}|${r.job.analysis_mode}`))];
  if (current.runs.length !== baseline.runs.length) regressions.push({ reason: 'Different run counts' });
  for (const key of groups) {
    const subset = (report) => report.runs.filter((r) => `${r.job.config.id}|${r.job.split}|${r.job.realism}|${r.job.analysis_mode}` === key).sort((a, b) => identity(a).localeCompare(identity(b)));
    const before = subset(baseline), after = subset(current);
    if (canonical(before.map(identity)) !== canonical(after.map(identity)) ||
        canonical(before.map((r) => r.job.config.values)) !== canonical(after.map((r) => r.job.config.values))) {
      regressions.push({ key, reason: 'Different scene/seed/variable populations' }); continue;
    }
    if (before.some((r, i) => canonical(r.scenario) !== canonical(after[i].scenario))) {
      // Analysis settings may change deliberately; physical inputs must not.
      const inputs = (r) => ({ nodes: r.scenario?.nodes, sources: r.scenario?.sources, buildings: r.scenario?.buildings });
      if (before.some((r, i) => canonical(inputs(r)) !== canonical(inputs(after[i])))) {
        regressions.push({ key, reason: 'Different physical scene inputs' }); continue;
      }
    }
    const b = metricValues(before, optionsFor), a = metricValues(after, optionsFor);
    const changes = Object.fromEntries([...guarded, ...endpoints].map((metric) => [metric, {
      before: b[metric], after: a[metric],
      delta: Number.isFinite(a[metric]) && Number.isFinite(b[metric]) ? a[metric] - b[metric] : null,
      ci: null
    }]));
    const draws = Object.fromEntries(endpoints.map((k) => [k, []]));
    const rng = mulberry32(20261104);
    if (before.length >= 2) for (let i = 0; i < samples; i++) {
      const indices = Array.from({ length: before.length }, () => Math.floor(rng() * before.length));
      const bv = metricValues(indices.map((j) => before[j]), optionsFor), av = metricValues(indices.map((j) => after[j]), optionsFor);
      for (const k of endpoints) if (Number.isFinite(bv[k]) && Number.isFinite(av[k])) draws[k].push(av[k] - bv[k]);
    }
    const tail = (1 - confidence) * 50;
    for (const k of endpoints) if (draws[k].length) changes[k].ci = [percentile(draws[k], tail), percentile(draws[k], 100 - tail)];
    const reasons = [];
    for (const k of guarded) {
      if (!Number.isFinite(b[k]) && !Number.isFinite(a[k])) continue;
      if (!Number.isFinite(a[k])) { reasons.push(`${k} became unavailable`); continue; }
      if (!Number.isFinite(b[k])) continue;
      if (k === 'scene_fix_rate' ? a[k] < b[k] - 0.02 - 1e-10
        : k === 'unflagged_wrong_fix_rate' ? a[k] > b[k] + 1e-10
          : loss(k, a[k]) > loss(k, b[k]) + 1e-10) reasons.push(`${k} fails guard`);
    }
    const comparable = Object.keys(b).filter((k) => k !== 'runtime_ms');
    const allEqual = comparable.every((k) => canonical(b[k]) === canonical(a[k]));
    const improved = endpoints.some((k) => changes[k].delta < 0 && changes[k].ci?.[1] < 0);
    if (!allEqual && !improved) reasons.push('No paired median/p90/risk-area improvement with CI excluding zero');
    const row = { key, n_pairs: before.length, changes, all_equal: allEqual, improved, pass: !reasons.length, reasons };
    rows.push(row);
    for (const reason of reasons) regressions.push({ key, reason });
  }
  return {
    rule: 'round2', pass: !regressions.length, rows, regressions,
    differences: rows.flatMap((r) => Object.entries(r.changes).map(([metric, change]) => ({ key: r.key, metric, ...change, regression: r.reasons.some((s) => s.startsWith(metric)) }))),
    method: 'Paired bootstrap of whole matching scene/seed runs; aggregate endpoint delta after-before. Missing conditional errors are omitted from endpoint draws, never imputed as zero. Calibration guard is absolute distance to nominal. All-equal compares all non-runtime metric values.'
  };
}
