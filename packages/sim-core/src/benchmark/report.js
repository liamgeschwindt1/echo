import { METRICS, rankingFlips } from './metrics.js';

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const formatNumber = (n) => Number.isFinite(n) ? n.toFixed(3) : 'unavailable';
const csvCell = (s) => `"${String(s ?? '').replaceAll('"', '""')}"`;

export function reportCsv(report) {
  const metrics = Object.keys(METRICS);
  const heads = ['config', 'split', 'realism', 'analysis_mode', 'values', ...metrics.flatMap((m) => [m, `${m}_ci_low`, `${m}_ci_high`])];
  return [heads, ...report.summary.map((r) => [r.name, r.split, r.realism, r.analysis_mode, JSON.stringify(r.values), ...metrics.flatMap((m) => [r.metrics[m]?.value, ...(r.metrics[m]?.ci ?? [null, null])])])].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function plainSummary(report, metric = 'useful_fix_rate') {
  const ranking = rankingFlips(report.summary, metric);
  const winners = [...new Set(ranking.rankings.filter((r) => r.realism === 'on' && r.split === 'train' && r.analysis_mode === 'measured_only').map((r) => r.winner).filter(Boolean))];
  const flipNames = [...new Set(ranking.flips.filter((f) => f.split === 'train').map((f) => f.variable))];
  const base = `${report.runs.length}/${report.manifest.expected_runs ?? report.runs.length} runs. ${report.manifest.cancelled ? 'Incomplete; cancelled or paused.' : 'Simulated only.'}`;
  if (report.manifest.cancelled || report.runs.length !== (report.manifest.expected_runs ?? report.runs.length)) return `${base} Rankings suppressed for incomplete populations.`;
  return `${base} ${winners.length === 1 ? `${winners[0]} leads measured-only realism-on by ${metric}, using point estimates.` : 'No single supported array winner.'} ${flipNames.length ? `Ranking changes with ${flipNames.join(', ')}.` : 'No ranking flip demonstrated by this experiment.'}`;
}

export function metricTable(report, targets = {}) {
  const columns = ['horizontal_median_m', 'horizontal_p90_m', 'error_3d_median_m', 'source_fix_rate', 'events_within_10m_misses_counted', 'detectable_3_node_fraction', 'detectable_3_node_events_within_10m', 'detectable_3_node_event_count', 'scene_fix_rate', 'useful_fix_rate', 'unflagged_wrong_fix_rate', 'risk_coverage_area', 'within_target_rate', 'wrong_fix_rate', 'suspect_recall', 'suspect_precision', 'track_fix_count', 'track_median_error_m', 'bearing_median_deg', 'elevation_median_deg', 'within_1sigma', 'within_2sigma', 'detection_rate', 'fix_brier_score', 'fix_log_loss', 'fix_error_10m_auc', 'fix_reliability_error'];
  return `<table><thead><tr><th>Config / split / realism / mode</th>${columns.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead><tbody>${report.summary.map((r) => `<tr><th>${escapeHtml(`${r.name} / ${r.split} / ${r.realism} / ${r.analysis_mode}`)}</th>${columns.map((k) => {
    const m = r.metrics[k] ?? { value: null, ci: null }, value = m.value;
    const targetKey = ({
      source_fix_rate: 'coverage',
      events_within_10m_misses_counted: 'events_within_10m_misses_counted',
      bearing_median_deg: 'bearing_median_deg_realism_on'
    })[k] ?? k;
    const legacyTarget = targets.metrics?.[k];
    const tiers = targets.tiers && !(k === 'bearing_median_deg' && r.realism !== 'on')
      ? Object.entries(targets.tiers).filter(([, values]) => values[targetKey]).map(([name, values]) => [name, values[targetKey]])
      : [];
    const reached = tiers.filter(([, target]) => Number.isFinite(value) &&
      (target.max === undefined || value <= target.max) &&
      (target.min === undefined || value >= target.min)).at(-1)?.[0] ?? null;
    const legacyPass = legacyTarget && Number.isFinite(value)
      ? (legacyTarget.max === undefined || value <= legacyTarget.max) &&
        (legacyTarget.min === undefined || value >= legacyTarget.min)
      : null;
    const hasTarget = tiers.length > 0 || !!legacyTarget;
    const insufficient = r.status === 'insufficient';
    const status = insufficient ? '' : reached ? `pass tier-${reached}` : legacyPass === true ? 'pass' : hasTarget && Number.isFinite(value) ? 'fail' : '';
    const label = insufficient ? `insufficient (${r.n_scenes ?? 0} sites)` :
      reached ? `${reached} tier` : legacyPass === true ? 'target met' :
        hasTarget && Number.isFinite(value) ? 'below minimum' : 'CI unavailable';
    const interval = m.ci ? `[${m.ci.map(formatNumber).join(', ')}]` : '';
    return `<td data-config="${escapeHtml(r.config_id)}" data-split="${escapeHtml(r.split)}" data-realism="${escapeHtml(r.realism)}" data-mode="${escapeHtml(r.analysis_mode)}" data-tier="${escapeHtml(reached ?? '')}" class="${status}">${formatNumber(value)}${interval || label ? `<small>${interval}${interval && label ? ' · ' : ''}${label}</small>` : ''}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
}

export function riskCoverageChart(summary) {
  return summary.map((row) => {
    const curve = row.risk_coverage?.curve.filter((p) => p.risk !== null) ?? [];
    if (!curve.length) return `<p>${escapeHtml(row.key)}: risk curve unavailable (no fixes).</p>`;
    const path = `M60 ${260 - curve[0].risk * 220} ` + curve.map((p) => `V${260 - p.risk * 220}H${60 + p.coverage * 590}`).join('');
    const metres = curve.filter((p) => Number.isFinite(p.mean_error_m));
    const maxError = Math.max(...metres.map((p) => p.mean_error_m), 1);
    return `<svg viewBox="0 0 700 300" role="img" aria-label="Risk versus fraction of all scenes answered"><path d="M60 30V260H650" fill="none" stroke="#aaa"/><text x="60" y="20">${escapeHtml(row.key)}; area ${formatNumber(row.risk_coverage.area)}</text><path fill="none" stroke="#ffb000" d="${path}"/><text x="60" y="285">0</text><text x="570" y="285">1: all scenes</text><text x="5" y="40">risk 1</text></svg>${metres.length ? `<svg viewBox="0 0 700 300" role="img" aria-label="Mean horizontal error in metres versus fraction of all scenes answered"><path d="M60 30V260H650" fill="none" stroke="#aaa"/><text x="60" y="20">Mean worst-fix error per answered scene (m); unknown unmatched error is unavailable</text><polyline fill="none" stroke="#4cc9f0" points="${metres.map((p) => `${60 + p.coverage * 590},${260 - p.mean_error_m / maxError * 220}`).join(' ')}"/><text x="5" y="40">${formatNumber(maxError)}</text><text x="570" y="285">1: all scenes</text></svg>` : '<p>Metre-error curve unavailable: unmatched or no measured errors.</p>'}`;
  }).join('');
}

export function confidenceReport(report) {
  if (!Array.isArray(report.confidence_evaluation)) return '';
  const model = report.confidence_model?.regression;
  const coefficients = model ? `<p>Standardised logit; intercept ${formatNumber(model.intercept)}; train-only Platt intercept/slope ${formatNumber(model.calibration?.intercept)} / ${formatNumber(model.calibration?.slope)}. Simulator-to-real calibration is unmeasured.</p><table><tr><th>Feature</th><th>Coefficient</th><th>Train mean</th><th>Train scale</th></tr>${model.features.map((f, i) => `<tr><th>${escapeHtml(f)}</th><td>${formatNumber(model.coefficients[i])}</td><td>${formatNumber(model.means[i])}</td><td>${formatNumber(model.scales[i])}</td></tr>`).join('')}</table>` : '';
  return `<h2>Offline confidence trial: reliability</h2><p>Not a deployed model. Empty bins remain unavailable. A 90% radius is a train-fitted geometric empirical interval, not a real-world conformal guarantee.</p>${coefficients}${report.confidence_evaluation.map((r) => {
    const bins = r.reliability.filter((b) => b.count > 0 && Number.isFinite(b.predicted) && Number.isFinite(b.observed));
    return `<p>${escapeHtml(r.split)} / ${escapeHtml(r.realism)}; episodes ${escapeHtml(r.n_episodes)}; Brier ${formatNumber(r.brier_score)}; empirical 90% radius coverage ${formatNumber(r.radius_90_coverage)} (N=${escapeHtml(r.radius_n)})</p><svg viewBox="0 0 400 340" role="img" aria-label="Reliability diagram: predicted versus observed wrong-fix probability"><path d="M50 30V290H350M50 290L350 30" fill="none" stroke="#aaa"/>${bins.map((b) => `<circle cx="${50 + 300 * b.predicted}" cy="${290 - 260 * b.observed}" r="${3 + Math.min(7, Math.sqrt(b.count))}" fill="#4cc9f0"><title>N=${b.count}, predicted ${formatNumber(b.predicted)}, observed ${formatNumber(b.observed)}</title></circle>`).join('')}<text x="50" y="315">Predicted P(error &gt; 10 m), 0 to 1</text><text x="5" y="20">Observed wrong fraction, 0 to 1</text></svg>`;
  }).join('')}`;
}

function acceptanceTable(comparison) {
  if (comparison?.rule !== 'round2') return '';
  const rows = comparison.rows.flatMap((r) => Object.entries(r.changes).map(([metric, c]) =>
    `<tr><th>${escapeHtml(r.key)} / ${r.n_pairs}</th><td>${escapeHtml(metric)}</td><td>${formatNumber(c.before)}</td><td>${formatNumber(c.after)}</td><td>${formatNumber(c.delta)}<small>${c.ci ? c.ci.map(formatNumber).join(' to ') : 'CI unavailable / guard only'}</small></td><td class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}: ${escapeHtml(r.reasons.join('; '))}</td></tr>`
  )).join('');
  return `<h2>Rule-four acceptance: ${comparison.pass ? 'PASS' : 'FAIL'}</h2><p>${escapeHtml(comparison.method)}</p><table><tr><th>Partition / pairs</th><th>Metric</th><th>Before</th><th>After</th><th>Delta / paired CI</th><th>Partition verdict / reasons</th></tr>${rows}</table>`;
}

export function lineChart(summary, variable, metric) {
  const rows = summary.filter((r) => Number.isFinite(Number(r.values[variable])) && Number.isFinite(r.metrics[metric]?.value));
  if (!rows.length) return '<p>No numeric sweep for selected metric.</p>';
  const xs = rows.map((r) => Number(r.values[variable]));
  const ys = rows.flatMap((r) => [r.metrics[metric].value, ...(r.metrics[metric].ci ?? [])]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), maxY = Math.max(...ys, 1), minY = Math.min(...ys, 0);
  const x = (v) => 60 + (v - minX) / (maxX - minX || 1) * 570;
  const y = (v) => 260 - (v - minY) / (maxY - minY || 1) * 220;
  const groups = new Map();
  for (const r of rows) {
    const key = JSON.stringify(Object.fromEntries(Object.entries(r.values).filter(([k]) => k !== variable))) + ` ${r.split}/${r.realism}/${r.analysis_mode}`;
    const group = groups.get(key) ?? [];
    group.push(r); groups.set(key, group);
  }
  const colours = ['#ffb000', '#4cc9f0', '#f72585', '#b8f65a', '#c77dff', '#2dd4bf'];
  return `<svg viewBox="0 0 700 ${330 + groups.size * 18}" role="img" aria-label="${escapeHtml(`${metric} vs ${variable}, bootstrap confidence bands`)}"><path d="M60 40V260H630" fill="none" stroke="#aaa"/><text x="60" y="285">${formatNumber(minX)}</text><text x="570" y="285">${formatNumber(maxX)}</text><text x="5" y="45">${formatNumber(maxY)}</text><text x="5" y="260">${formatNumber(minY)}</text>${[...groups].map(([key, group], i) => {
    group.sort((a, b) => Number(a.values[variable]) - Number(b.values[variable]));
    const colour = colours[i % colours.length];
    const band = group.every((r) => r.metrics[metric].ci) ? `<polygon fill="${colour}" opacity=".15" points="${[...group.map((r) => `${x(Number(r.values[variable]))},${y(r.metrics[metric].ci[0])}`), ...[...group].reverse().map((r) => `${x(Number(r.values[variable]))},${y(r.metrics[metric].ci[1])}`)].join(' ')}"/>` : '';
    return `${band}<polyline fill="none" stroke="${colour}" points="${group.map((r) => `${x(Number(r.values[variable]))},${y(r.metrics[metric].value)}`).join(' ')}"/>${group.map((r) => `<circle cx="${x(Number(r.values[variable]))}" cy="${y(r.metrics[metric].value)}" r="3" fill="${colour}"><title>${escapeHtml(r.name)}: ${formatNumber(r.metrics[metric].value)}</title></circle>`).join('')}<text x="60" y="${325 + i * 18}" fill="${colour}">${escapeHtml(key)}</text>`;
  }).join('')}<text x="250" y="305">${escapeHtml(variable)} / ${escapeHtml(metric)}</text></svg>`;
}

export function heatmap(summary, xVariable, yVariable, metric) {
  const rows = summary.filter((r) => r.values[xVariable] !== undefined && r.values[yVariable] !== undefined);
  if (!rows.length) return '<p>Pick two swept variables for heatmap.</p>';
  const xs = [...new Set(rows.map((r) => r.values[xVariable]))], ys = [...new Set(rows.map((r) => r.values[yVariable]))];
  const max = Math.max(...rows.map((r) => r.metrics[metric]?.value).filter(Number.isFinite), 1);
  return `<table><tr><th>${escapeHtml(yVariable)} / ${escapeHtml(xVariable)}</th>${xs.map((x) => `<th>${escapeHtml(x)}</th>`).join('')}</tr>${ys.map((y) => `<tr><th>${escapeHtml(y)}</th>${xs.map((x) => {
    const cell = rows.filter((r) => r.values[xVariable] === x && r.values[yVariable] === y);
    if (cell.length !== 1) return '<td>Filter context: multiple configs</td>';
    const r = cell[0], m = r.metrics[metric]?.value;
    return `<td style="background:rgba(255,176,0,${Number.isFinite(m) ? Math.min(0.7, m / max * 0.7) : 0})" data-config="${escapeHtml(r.config_id)}" data-split="${r.split}" data-realism="${r.realism}" data-mode="${r.analysis_mode}">${formatNumber(m)}</td>`;
  }).join('')}</tr>`).join('')}</table>`;
}

export function tornado(summary, metric) {
  const bases = summary.filter((r) => r.group === 'base');
  if (!bases.length) return '<p>Tornado requires one-at-a-time mode.</p>';
  const changes = summary.filter((r) => r.group !== 'base').map((r) => {
    const b = bases.find((b) => b.split === r.split && b.realism === r.realism && b.analysis_mode === r.analysis_mode);
    return { variable: r.group, delta: b && Number.isFinite(b.metrics[metric]?.value) && Number.isFinite(r.metrics[metric]?.value) ? r.metrics[metric].value - b.metrics[metric].value : null };
  });
  const effects = [...new Set(changes.map((r) => r.variable))].map((v) => {
    const deltas = changes.filter((r) => r.variable === v && r.delta !== null).map((r) => Math.abs(r.delta));
    return { variable: v, effect: deltas.length ? Math.max(...deltas) : null };
  }).sort((a, b) => (b.effect ?? -Infinity) - (a.effect ?? -Infinity));
  const max = Math.max(...effects.map((e) => e.effect).filter(Number.isFinite), 1);
  return `<table><tr><th>Variable</th><th>Largest absolute change from base</th></tr>${effects.map((e) => `<tr><th>${escapeHtml(e.variable)}</th><td>${e.effect === null ? '' : `<meter min="0" max="${max}" value="${e.effect}"></meter> `}${formatNumber(e.effect)}</td></tr>`).join('')}</table>`;
}

export function reportHtml(report, targets = {}) {
  const numeric = report.experiment.sweeps.find((s) => s.values.every((v) => typeof v === 'number'))?.variable;
  const risk = `<h2>Risk versus coverage</h2>${riskCoverageChart(report.summary)}${confidenceReport(report)}${acceptanceTable(report.comparison)}`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(report.experiment.name)} benchmark</title><style>body{background:#171b22;color:#ddd;font:14px system-ui;margin:24px}table{border-collapse:collapse;display:block;overflow:auto}td,th{padding:8px;border:1px solid #46505c}small{display:block;color:#aeb8c8}.pass,.tier-minimum{background:#184431}.tier-standard{background:#12513a}.tier-exceptional{background:#146458}.fail{background:#58252a}svg{max-width:1000px;width:100%;fill:#ddd}pre{white-space:pre-wrap}</style><h1>${escapeHtml(report.experiment.name)}</h1><p>${escapeHtml(plainSummary(report))}</p>${metricTable(report, targets)}${risk}${numeric ? lineChart(report.summary, numeric, 'horizontal_median_m') : ''}${tornado(report.summary, 'horizontal_median_m')}<h2>Ranking</h2><pre>${escapeHtml(JSON.stringify(report.ranking.flips, null, 2))}</pre><h2>Failure atlas</h2><pre>${escapeHtml(JSON.stringify(report.failure_atlas, null, 2))}</pre><h2>Reproducibility</h2><pre>${escapeHtml(JSON.stringify(report.manifest, null, 2))}</pre><h2>Limits</h2>${report.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}</html>`;
}
