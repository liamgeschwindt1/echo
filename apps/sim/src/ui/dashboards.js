import targets from '../../../../docs/targets.json' with { type: 'json' };
import { adaptEngineKpi } from './engine-kpi-adapter.js';

const DASHBOARD_BANNER = 'Synthetic simulator outputs only. Targets are placeholders. Missing values show as not measured. Different populations are not ranked; paired differences require matched runs.';
const INSTALL_PROFILES = ['pooled', 'off', 'on', 'surveyed', 'self-calibrated'];
const PLACEHOLDER_PAGES = [
  { id: 'labelling', label: 'Labelling', note: 'Later: label quality and class-association dashboard.' },
  { id: 'detection', label: 'Event detection and false alarms', note: 'Later: event-detection and false-alarm dashboard.' },
  { id: 'twin', label: 'Digital twin', note: 'Later: digital-twin quality and drift dashboard.' },
  { id: 'hardware', label: 'Hardware and arrays', note: 'Later: hardware and array dashboard.' },
  { id: 'system', label: 'System', note: 'Later: system-level operational dashboard.' }
];

const headlineMetrics = [
  { key: 'events_within_10m_misses_counted', label: 'Events within 10 m (misses count)' },
  { key: 'horizontal_p90_m', label: 'P90 horizontal error (m)' },
  { key: 'horizontal_median_m', label: 'Median horizontal error (m)' },
  { key: 'scene_fix_rate', label: 'Scene fix rate' },
  { key: 'source_fix_rate', label: 'Source fix rate' },
  { key: 'unflagged_wrong_fix_rate', label: 'Unflagged wrong-fix rate' },
  { key: 'within_1sigma', label: 'Within 1σ' },
  { key: 'within_2sigma', label: 'Within 2σ' },
  { key: 'error_3d_p90_m', label: 'Aerial 3D error p90 (m)' },
  { key: 'aerial_3d_fix_rate', label: 'Aerial 3D fix rate' },
  { key: 'aerial_height_error_m', label: 'Aerial height error (m)' },
  { key: 'track_median_error_m', label: 'Track median error (m)' },
  { key: 'track_continuity', label: 'Track continuity' },
  { key: 'time_to_fix_s', label: 'Time to fix (s)' }
];

const valueMetrics = new Set(['horizontal_p90_m', 'horizontal_median_m', 'error_3d_p90_m', 'aerial_height_error_m', 'track_median_error_m', 'time_to_fix_s']);

const notMeasured = '<span class="dash-muted">not measured</span>';

function metricLabel(profile, split, mode) {
  return `${split}/${profile}/${mode}`;
}

function parseResultKey(key) {
  const [split, profile = 'off', mode = 'measured_only'] = key.split('/');
  return { split, profile, mode };
}

function weightedMetric() {
  // Cell quantiles and event rates cannot be pooled from per-cell scalar summaries.
  return { value: null, ci: null, n_sites: null, n_runs: null, confidence: null };
}

function toFixed(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : null;
}

function fmtValue(metricKey, value) {
  if (!Number.isFinite(value)) return notMeasured;
  if (valueMetrics.has(metricKey)) return toFixed(value, 3);
  return `${(value * 100).toFixed(1)}%`;
}

function fmtCi(metricKey, ci) {
  if (!Array.isArray(ci) || ci.length !== 2 || !Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) return notMeasured;
  if (valueMetrics.has(metricKey)) return `${toFixed(ci[0], 3)} to ${toFixed(ci[1], 3)}`;
  return `${(ci[0] * 100).toFixed(1)}% to ${(ci[1] * 100).toFixed(1)}%`;
}

function toTier(metricKey, value) {
  if (!Number.isFinite(value)) return null;
  const tiers = targets?.tiers ?? {};
  const keys = ['minimum', 'standard', 'exceptional'];
  let best = null;
  for (const name of keys) {
    const bounds = tiers?.[name]?.[metricKey];
    if (!bounds) continue;
    const minOk = bounds.min == null || value >= bounds.min;
    const maxOk = bounds.max == null || value <= bounds.max;
    if (minOk && maxOk) best = name;
  }
  return best;
}

export function deltaMetric(current, base) {
  const paired = current?.paired_deltas?.[base?.engine_id];
  if (!Number.isFinite(paired?.delta)) return null;
  return { value: paired.delta, ci: paired.interval95 ?? null };
}

function fmtDelta(metricKey, delta) {
  if (!delta || !Number.isFinite(delta.value)) return 'delta not measured';
  const arrow = delta.value > 0 ? '↑' : delta.value < 0 ? '↓' : '→';
  const body = valueMetrics.has(metricKey) ? toFixed(delta.value, 3) : `${(delta.value * 100).toFixed(1)} pp`;
  const ci = delta.ci ? (valueMetrics.has(metricKey) ? `${toFixed(delta.ci[0], 3)} to ${toFixed(delta.ci[1], 3)}` : `${(delta.ci[0] * 100).toFixed(1)} to ${(delta.ci[1] * 100).toFixed(1)} pp`) : 'paired interval unavailable';
  return `${arrow} ${body} (${ci})`;
}

function sortedEngineIds(registry) {
  if (!registry) return [];
  if (Array.isArray(registry)) return registry.map((item) => item?.id).filter(Boolean);
  if (Array.isArray(registry.engines)) return registry.engines.map((item) => item?.id).filter(Boolean);
  return [];
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function optionSetFromEngine(engine) {
  const options = engine?.options ?? engine?.option_set ?? engine?.optionSet ?? {};
  if (!options || typeof options !== 'object') return {};
  return options;
}

export function mapBaselineToKpi(data) {
  const profileBuckets = new Map();
  const cellsByProfile = new Map();
  for (const cell of data.cells ?? []) {
    for (const [key, result] of Object.entries(cell.results ?? {})) {
      const parsed = parseResultKey(key);
      if (parsed.split !== 'all' || parsed.mode !== 'measured_only') continue;
      const bucketKey = metricLabel(parsed.profile, parsed.split, parsed.mode);
      if (!profileBuckets.has(bucketKey)) profileBuckets.set(bucketKey, []);
      profileBuckets.get(bucketKey).push(result);
      if (!cellsByProfile.has(parsed.profile)) cellsByProfile.set(parsed.profile, []);
      cellsByProfile.get(parsed.profile).push({
        key: bucketKey,
        split: parsed.split,
        mode: parsed.mode,
        factors: cell.factors,
        status: result.status,
        n_scenes: result.n_scenes,
        metrics: result.metrics
      });
    }
  }
  const profileOrder = [...new Set([...cellsByProfile.keys(), ...INSTALL_PROFILES])].filter(Boolean);
  const aggregates = {};
  for (const profile of profileOrder) {
    const rows = (cellsByProfile.get(profile) ?? []).map((c) => ({ ...c, ...c.metrics }));
    aggregates[profile] = Object.fromEntries(headlineMetrics.map(({ key }) => [key, weightedMetric(rows, key)]));
  }
  const sourceCount = profileOrder.reduce((acc, profile) => {
    const rows = cellsByProfile.get(profile) ?? [];
    acc[profile] = [1, 3].map((count) => {
      const subset = rows.filter((row) => Number(row.factors?.simultaneous_sources) === count);
      return {
        source_count: count,
        metrics: Object.fromEntries(headlineMetrics.map(({ key }) => [key, weightedMetric(subset, key)]))
      };
    });
    return acc;
  }, {});
  const installComparison = profileOrder.map((profile) => ({ profile, metrics: aggregates[profile] ?? {} }));
  const detectable = profileOrder.map((profile) => ({
    profile,
    detectable_3_node_fraction: aggregates[profile]?.detectable_3_node_fraction ?? { value: null, ci: null },
    detectable_3_node_events_within_10m: aggregates[profile]?.detectable_3_node_events_within_10m ?? { value: null, ci: null }
  }));
  const buildingOpen = profileOrder.map((profile) => {
    const rows = cellsByProfile.get(profile) ?? [];
    const open = rows.filter((row) => row.factors?.environment === 'open');
    const building = rows.filter((row) => row.factors?.environment !== 'open');
    return {
      profile,
      open: weightedMetric(open, 'events_within_10m_misses_counted'),
      building: weightedMetric(building, 'events_within_10m_misses_counted')
    };
  });
  const tracking = profileOrder.map((profile) => ({
    profile,
    track_median_error_m: aggregates[profile]?.track_median_error_m ?? { value: null, ci: null },
    track_continuity: aggregates[profile]?.track_continuity ?? { value: null, ci: null },
    time_to_fix_s: aggregates[profile]?.time_to_fix_s ?? { value: null, ci: null }
  }));
  return {
    source: 'baseline-matrix-r3',
    headline: aggregates,
    matrix: Object.fromEntries(profileOrder.map((profile) => [profile, cellsByProfile.get(profile) ?? []])),
    source_count_split: sourceCount,
    node_count_curve: data.node_density ?? [],
    install_profile_comparison: installComparison,
    detectable_subsets: detectable,
    building_vs_open: buildingOpen,
    assumed_copy_harm: [],
    failure_attribution: [],
    tracking,
    integrity: {
      sealed_set_run: false,
      input_sha256: data.input_sha256 ?? null,
      sealed_input_sha256: data.sealed_input_sha256 ?? null,
      population: data.population ?? null
    }
  };
}

export function normaliseEngineRecord(engine, kpi, refs) {
  return {
    id: engine?.id ?? 'unknown',
    parent: engine?.parent ?? engine?.parent_id ?? null,
    date: engine?.date ?? engine?.created_at ?? null,
    status: engine?.status ?? 'candidate',
    source_hash: engine?.source_hash ?? engine?.sourceHash ?? null,
    options: optionSetFromEngine(engine),
    notes: String(engine?.notes ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    refs,
    kpi: adaptEngineKpi(kpi, engine?.id),
    refs_path: `engines/${engine?.id ?? 'unknown'}/refs.json`
  };
}

function hashEngineFromLocation(ids, fallback) {
  const search = window.location.hash.match(/engine=([^&]+)/);
  const decoded = search ? decodeURIComponent(search[1]) : null;
  if (decoded && ids.includes(decoded)) return decoded;
  return fallback ?? ids[0] ?? null;
}

function setEngineHash(id) {
  const hash = `engine=${encodeURIComponent(id)}`;
  if (window.location.hash !== `#${hash}`) window.location.hash = hash;
}

function metricCell(metricKey, metric, compareMode, compareMetric) {
  const value = fmtValue(metricKey, metric?.value);
  const ci = fmtCi(metricKey, metric?.ci);
  const tier = toTier(metricKey, metric?.value);
  const deltaText = compareMode === 'none' ? '' : `<div class="dash-delta">${fmtDelta(metricKey, deltaMetric(metric, compareMetric))}</div>`;
  return `<div class="dash-metric ${tier ? `tier-${tier}` : ''}">
    <div class="dash-metric-name">${headlineMetrics.find((item) => item.key === metricKey)?.label ?? metricKey}</div>
    <div class="dash-metric-value">${value}</div>
    <div class="dash-metric-ci">95% CI: ${ci}</div>
    <div class="dash-metric-ci">sites ${metric?.n_sites ?? 'not measured'} · runs ${metric?.n_runs ?? 'not measured'}</div>
    ${deltaText}
  </div>`;
}

function renderMatrixCells(cells, compareCells) {
  const byIndex = new Map(compareCells.map((cell) => [cell.factors ? `${cell.factors.environment}/${cell.factors.source_height}/${cell.factors.motion}/${cell.factors.simultaneous_sources}` : '', cell]));
  return cells.map((cell) => {
    const key = `${cell.factors.environment}/${cell.factors.source_height}/${cell.factors.motion}/${cell.factors.simultaneous_sources}`;
    const metric = cell.metrics?.events_within_10m_misses_counted;
    const compareMetric = byIndex.get(key)?.metrics?.events_within_10m_misses_counted ?? null;
    const insufficient = Number.isFinite(metric?.n_sites) ? metric.n_sites < 5 : cell.status === 'insufficient';
    return `<div class="dash-cell ${insufficient ? 'insufficient' : ''}">
      <div class="dash-cell-name">${cell.factors.environment}, ${cell.factors.source_height}, ${cell.factors.motion}, ${cell.factors.simultaneous_sources} src</div>
      <div class="dash-cell-value">${fmtValue('events_within_10m_misses_counted', metric?.value)}</div>
      <div class="dash-cell-meta">sites ${metric?.n_sites ?? 'not measured'} · runs ${metric?.n_runs ?? 'not measured'}</div>
      <div class="dash-cell-meta">CI ${fmtCi('events_within_10m_misses_counted', metric?.ci)}</div>
      <div class="dash-cell-meta">${fmtDelta('events_within_10m_misses_counted', deltaMetric(metric, compareMetric))}</div>
      ${insufficient ? '<div class="dash-cell-flag">insufficient</div>' : ''}
    </div>`;
  }).join('');
}

function breakdownTable(rows, columns, compareRows = [], title = '') {
  const index = new Map(compareRows.map((row) => [row.key ?? row.profile ?? row.label, row]));
  const head = columns.map((column) => `<th>${column.label}</th>`).join('');
  const body = rows.map((row) => {
    const compare = index.get(row.key ?? row.profile ?? row.label);
    const cells = columns.map((column) => {
      const metric = row[column.key];
      const compareMetric = compare ? compare[column.key] : null;
      return `<td>${fmtValue(column.key, metric?.value)}<small>CI ${fmtCi(column.key, metric?.ci)}</small><small>${fmtDelta(column.key, deltaMetric(metric, compareMetric))}</small></td>`;
    }).join('');
    return `<tr><th>${row.label ?? row.profile ?? row.key}</th>${cells}</tr>`;
  }).join('');
  return `<section class="dash-block"><h3>${title}</h3><div class="testing-table"><table><tr><th>Group</th>${head}</tr>${body || '<tr><td colspan="99">not measured</td></tr>'}</table></div></section>`;
}

function renderEngineBody(engine, compareEngine, profile) {
  const currentHeadline = engine.kpi?.headline?.[profile] ?? {};
  const compareHeadline = compareEngine?.kpi?.headline?.[profile] ?? {};
  const currentMatrix = engine.kpi?.matrix?.[profile] ?? [];
  const compareMatrix = compareEngine?.kpi?.matrix?.[profile] ?? [];
  const sourceRows = (engine.kpi?.source_count_split?.[profile] ?? []).map((row) => ({
    label: `${row.source_count} source${row.source_count === 1 ? '' : 's'}`,
    horizontal_median_m: row.metrics?.horizontal_median_m ?? {},
    horizontal_p90_m: row.metrics?.horizontal_p90_m ?? {},
    events_within_10m_misses_counted: row.metrics?.events_within_10m_misses_counted ?? {}
  }));
  const compareSourceRows = (compareEngine?.kpi?.source_count_split?.[profile] ?? []).map((row) => ({
    label: `${row.source_count} source${row.source_count === 1 ? '' : 's'}`,
    horizontal_median_m: row.metrics?.horizontal_median_m ?? {},
    horizontal_p90_m: row.metrics?.horizontal_p90_m ?? {},
    events_within_10m_misses_counted: row.metrics?.events_within_10m_misses_counted ?? {}
  }));
  const nodeRows = (engine.kpi?.node_count_curve ?? []).map((row) => ({
    label: `${row.node_count} nodes (${row.realism})`,
    events_within_10m_misses_counted: row.metrics?.events_within_10m_misses_counted ?? {},
    scene_fix_rate: row.metrics?.scene_fix_rate ?? {},
    source_fix_rate: row.metrics?.source_fix_rate ?? {}
  }));
  const compareNodeRows = (compareEngine?.kpi?.node_count_curve ?? []).map((row) => ({
    label: `${row.node_count} nodes (${row.realism})`,
    events_within_10m_misses_counted: row.metrics?.events_within_10m_misses_counted ?? {},
    scene_fix_rate: row.metrics?.scene_fix_rate ?? {},
    source_fix_rate: row.metrics?.source_fix_rate ?? {}
  }));
  const installRows = (engine.kpi?.install_profile_comparison ?? []).map((row) => ({
    label: row.profile,
    events_within_10m_misses_counted: row.metrics?.events_within_10m_misses_counted ?? {},
    horizontal_median_m: row.metrics?.horizontal_median_m ?? {},
    unflagged_wrong_fix_rate: row.metrics?.unflagged_wrong_fix_rate ?? {}
  }));
  const compareInstallRows = (compareEngine?.kpi?.install_profile_comparison ?? []).map((row) => ({
    label: row.profile,
    events_within_10m_misses_counted: row.metrics?.events_within_10m_misses_counted ?? {},
    horizontal_median_m: row.metrics?.horizontal_median_m ?? {},
    unflagged_wrong_fix_rate: row.metrics?.unflagged_wrong_fix_rate ?? {}
  }));
  const detectableRows = (engine.kpi?.detectable_subsets ?? []).map((row) => ({
    label: row.profile,
    detectable_3_node_fraction: row.detectable_3_node_fraction ?? {},
    detectable_3_node_events_within_10m: row.detectable_3_node_events_within_10m ?? {}
  }));
  const compareDetectableRows = (compareEngine?.kpi?.detectable_subsets ?? []).map((row) => ({
    label: row.profile,
    detectable_3_node_fraction: row.detectable_3_node_fraction ?? {},
    detectable_3_node_events_within_10m: row.detectable_3_node_events_within_10m ?? {}
  }));
  const buildingRows = (engine.kpi?.building_vs_open ?? []).map((row) => ({
    label: row.profile,
    events_within_10m_misses_counted: row.open ?? {},
    scene_fix_rate: row.building ?? {}
  }));
  const compareBuildingRows = (compareEngine?.kpi?.building_vs_open ?? []).map((row) => ({
    label: row.profile,
    events_within_10m_misses_counted: row.open ?? {},
    scene_fix_rate: row.building ?? {}
  }));
  const trackingRows = (engine.kpi?.tracking ?? []).map((row) => ({
    label: row.profile,
    track_median_error_m: row.track_median_error_m ?? {},
    track_continuity: row.track_continuity ?? {},
    time_to_fix_s: row.time_to_fix_s ?? {}
  }));
  const compareTrackingRows = (compareEngine?.kpi?.tracking ?? []).map((row) => ({
    label: row.profile,
    track_median_error_m: row.track_median_error_m ?? {},
    track_continuity: row.track_continuity ?? {},
    time_to_fix_s: row.time_to_fix_s ?? {}
  }));

  return `<section class="dash-block">
    <h3>Headline KPIs (${profile})</h3>
    <div class="dash-metric-grid">${headlineMetrics.map((metric) => metricCell(metric.key, currentHeadline[metric.key], compareEngine ? 'delta' : 'none', compareHeadline[metric.key])).join('')}</div>
  </section>
  <section class="dash-block">
    <h3>24-cell matrix heatmap (${profile})</h3>
    <div class="dash-heatmap">${currentMatrix.length ? renderMatrixCells(currentMatrix, compareMatrix) : `<div>${notMeasured}</div>`}</div>
  </section>
  ${breakdownTable(sourceRows, [
    { key: 'events_within_10m_misses_counted', label: 'Within 10 m' },
    { key: 'horizontal_median_m', label: 'Median error' },
    { key: 'horizontal_p90_m', label: 'P90 error' }
  ], compareSourceRows, 'Source-count split')}
  ${breakdownTable(nodeRows, [
    { key: 'events_within_10m_misses_counted', label: 'Within 10 m' },
    { key: 'scene_fix_rate', label: 'Scene fix rate' },
    { key: 'source_fix_rate', label: 'Source fix rate' }
  ], compareNodeRows, 'Node-count curve')}
  ${breakdownTable(installRows, [
    { key: 'events_within_10m_misses_counted', label: 'Within 10 m' },
    { key: 'horizontal_median_m', label: 'Median error' },
    { key: 'unflagged_wrong_fix_rate', label: 'Unflagged wrong-fix rate' }
  ], compareInstallRows, 'Install-profile comparison')}
  ${breakdownTable(detectableRows, [
    { key: 'detectable_3_node_fraction', label: 'Detectable by ≥3 nodes' },
    { key: 'detectable_3_node_events_within_10m', label: 'Detectable and within 10 m' }
  ], compareDetectableRows, 'Detectable subsets')}
  ${breakdownTable(buildingRows, [
    { key: 'events_within_10m_misses_counted', label: 'Open cells' },
    { key: 'scene_fix_rate', label: 'Building cells' }
  ], compareBuildingRows, 'Building cells vs open cells')}
  ${breakdownTable(trackingRows, [
    { key: 'track_median_error_m', label: 'Track median error' },
    { key: 'track_continuity', label: 'Track continuity' },
    { key: 'time_to_fix_s', label: 'Time to fix' }
  ], compareTrackingRows, 'Tracking KPIs')}
  <section class="dash-block">
    <h3>Failure attribution</h3>
    <p>${engine.kpi?.failure_attribution?.length ? `${engine.kpi.failure_attribution.length} categories reported.` : notMeasured}</p>
  </section>`;
}

function formatRefs(refs) {
  if (!refs) return notMeasured;
  if (Array.isArray(refs)) return `<ul>${refs.map((entry) => `<li>${entry.path ?? JSON.stringify(entry)}</li>`).join('')}</ul>`;
  if (typeof refs === 'object') return `<pre>${JSON.stringify(refs, null, 2)}</pre>`;
  return String(refs);
}

function renderPlaceholder(note) {
  return `<section class="dash-block"><h2>Later</h2><p>${note}</p></section>`;
}

function renderApp(state) {
  const engine = state.engines.find((item) => item.id === state.selectedEngineId) ?? state.engines[0];
  const engineIndex = state.engines.findIndex((item) => item.id === engine.id);
  const prevDisabled = engineIndex <= 0;
  const nextDisabled = engineIndex >= state.engines.length - 1;
  const compareEngine = state.compareMode === 'none' ? null : state.engines.find((item) => item.id === (state.compareMode === 'le0' ? state.le0Id : state.engines[engineIndex - 1]?.id));
  const placeholder = PLACEHOLDER_PAGES.find((item) => item.id === state.pageId);
  const profileOptions = INSTALL_PROFILES.map((profile) => `<option value="${profile}" ${state.profile === profile ? 'selected' : ''}>${profile}</option>`).join('');
  const compareLabel = state.compareMode === 'none' ? 'None' : state.compareMode === 'previous' ? 'Previous engine' : 'LE-0';
  return `<div class="dash-layout">
    <aside class="dash-menu">
      <button class="dash-menu-item ${state.pageId === 'engines' ? 'active' : ''}" data-dash-page="engines">Engines</button>
      ${PLACEHOLDER_PAGES.map((page) => `<button class="dash-menu-item ${state.pageId === page.id ? 'active' : ''}" data-dash-page="${page.id}">${page.label} (later)</button>`).join('')}
    </aside>
    <div class="dash-content">
      <p class="dash-banner">${DASHBOARD_BANNER}</p>
      ${state.pageId === 'engines' ? `<section class="dash-block">
        ${engine.notes ? `<p class="dash-banner">${engine.notes}</p>` : ''}
        <div class="dash-engine-head">
          <div class="dash-head-left">
            <button data-engine-nav="prev" ${prevDisabled ? 'disabled' : ''}>&larr;</button>
            <strong>${engine.id}</strong>
            <button data-engine-nav="next" ${nextDisabled ? 'disabled' : ''}>&rarr;</button>
            <select id="dashEngineSelect" aria-label="Engine selector">${state.engines.map((item) => `<option value="${item.id}" ${item.id === engine.id ? 'selected' : ''}>${item.id}</option>`).join('')}</select>
          </div>
          <div class="dash-head-right">
            <label>Install profile <select id="dashProfile">${profileOptions}</select></label>
            <label>Compare <select id="dashCompare"><option value="none" ${state.compareMode === 'none' ? 'selected' : ''}>None</option><option value="previous" ${state.compareMode === 'previous' ? 'selected' : ''}>Previous</option><option value="le0" ${state.compareMode === 'le0' ? 'selected' : ''}>LE-0</option></select></label>
          </div>
        </div>
        <div class="dash-engine-meta">
          <div><b>ID:</b> ${engine.id}</div><div><b>Parent:</b> ${engine.parent ?? 'none'}</div><div><b>Date:</b> ${engine.date ?? 'not measured'}</div>
          <div><b>Status:</b> ${engine.status}</div><div><b>Source hash:</b> ${engine.source_hash ?? 'not measured'}</div><div><b>Comparison:</b> ${compareLabel}</div>
          <div class="dash-full"><b>Option set:</b><pre>${JSON.stringify(engine.options ?? {}, null, 2)}</pre></div>
          <div class="dash-full"><b>Refs (engines/${engine.id}/refs.json):</b>${formatRefs(engine.refs)}</div>
        </div>
        <div class="dash-integrity">
          <div><b>Population:</b> ${engine.kpi?.integrity?.population ? JSON.stringify(engine.kpi.integrity.population) : 'not measured'}</div>
          <div><b>Input hash:</b> ${engine.kpi?.integrity?.input_sha256 ?? 'not measured'}</div>
          <div><b>Sealed input hash:</b> ${engine.kpi?.integrity?.sealed_input_sha256 ?? 'not measured'}</div>
          <div><b>Sealed set run:</b> ${engine.kpi?.integrity?.sealed_set_run === true ? 'yes' : 'no'}</div>
        </div>
      </section>${renderEngineBody(engine, compareEngine, state.profile)}` : renderPlaceholder(placeholder?.note ?? 'Later')}
    </div>
  </div>`;
}

async function loadEngineSet() {
  const registry = await fetchJson('/engines/registry.json');
  const ids = sortedEngineIds(registry);
  if (!ids.length) throw new Error('Engine registry contains no engines');
  const engines = [];
  for (const id of ids) {
    const [engine, kpi, refs] = await Promise.all([
      fetchJson(`/engines/${id}/engine.json`),
      fetchJson(`/engines/${id}/kpi.json`),
      fetchJson(`/engines/${id}/refs.json`)
    ]);
    engines.push(normaliseEngineRecord(engine, kpi, refs));
  }
  return engines;
}

export function createDashboards({ $ }) {
  const root = $('panelDashboards');
  root.innerHTML = '<div class="testing"><p class="note">Dashboards ready. Open the page to load engines.</p></div>';
  let mounted = false;
  let state = null;
  let onHash = null;
  let onKey = null;
  const redraw = () => {
    if (!state) return;
    root.innerHTML = `<div class="testing">${renderApp(state)}</div>`;
    for (const button of root.querySelectorAll('[data-dash-page]')) button.addEventListener('click', () => {
      state.pageId = button.dataset.dashPage;
      redraw();
    });
    const select = root.querySelector('#dashEngineSelect');
    if (select) select.addEventListener('change', () => {
      state.selectedEngineId = select.value;
      setEngineHash(state.selectedEngineId);
      redraw();
    });
    const profile = root.querySelector('#dashProfile');
    if (profile) profile.addEventListener('change', () => {
      state.profile = profile.value;
      redraw();
    });
    const compare = root.querySelector('#dashCompare');
    if (compare) compare.addEventListener('change', () => {
      state.compareMode = compare.value;
      redraw();
    });
    for (const button of root.querySelectorAll('[data-engine-nav]')) button.addEventListener('click', () => {
      const ids = state.engines.map((item) => item.id);
      const index = ids.indexOf(state.selectedEngineId);
      const offset = button.dataset.engineNav === 'prev' ? -1 : 1;
      const next = ids[index + offset];
      if (!next) return;
      state.selectedEngineId = next;
      setEngineHash(next);
      redraw();
    });
  };
  const mount = async () => {
    if (mounted) return;
    root.innerHTML = '<div class="testing"><p class="note">Loading engine dashboards...</p></div>';
    const engines = await loadEngineSet();
    mounted = true;
    const le0Id = engines.find((item) => item.id === 'LE-0')?.id ?? engines[0]?.id ?? null;
    state = {
      pageId: 'engines',
      profile: engines[0]?.kpi?.headline?.on ? 'on' : INSTALL_PROFILES.find((profile) => engines[0]?.kpi?.headline?.[profile]) ?? 'off',
      compareMode: 'none',
      selectedEngineId: hashEngineFromLocation(engines.map((item) => item.id), le0Id),
      engines,
      le0Id
    };
    onHash = () => {
      const next = hashEngineFromLocation(state.engines.map((item) => item.id), state.selectedEngineId);
      if (next !== state.selectedEngineId) {
        state.selectedEngineId = next;
        redraw();
      }
    };
    onKey = (event) => {
      if (state.pageId !== 'engines') return;
      if (event.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const ids = state.engines.map((item) => item.id);
      const index = ids.indexOf(state.selectedEngineId);
      const next = event.key === 'ArrowLeft' ? ids[index - 1] : ids[index + 1];
      if (!next) return;
      state.selectedEngineId = next;
      setEngineHash(next);
      redraw();
    };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('keydown', onKey);
    redraw();
  };
  return {
    show: () => mount().catch((error) => {
      root.innerHTML = `<div class="testing"><p class="note">Failed to load dashboard: ${error.message}</p></div>`;
    }),
    dispose: () => {
      if (onHash) window.removeEventListener('hashchange', onHash);
      if (onKey) document.removeEventListener('keydown', onKey);
    }
  };
}

export function buildStandaloneEnginesHtml(payload) {
  const script = `(() => {
  const state = ${JSON.stringify(payload)};
  const root = document.getElementById('app');
  const notMeasured = ${JSON.stringify(notMeasured)};
  const targets = ${JSON.stringify(targets)};
  const DASHBOARD_BANNER = ${JSON.stringify(DASHBOARD_BANNER)};
  const INSTALL_PROFILES = ${JSON.stringify(INSTALL_PROFILES)};
  const PLACEHOLDER_PAGES = ${JSON.stringify(PLACEHOLDER_PAGES)};
  const headlineMetrics = ${JSON.stringify(headlineMetrics)};
  const valueMetrics = new Set(${JSON.stringify([...valueMetrics])});
  ${toFixed.toString()}
  ${fmtValue.toString()}
  ${fmtCi.toString()}
  ${deltaMetric.toString()}
  ${fmtDelta.toString()}
  ${toTier.toString()}
  ${metricCell.toString()}
  ${renderMatrixCells.toString()}
  ${breakdownTable.toString()}
  ${renderEngineBody.toString()}
  ${formatRefs.toString()}
  ${renderPlaceholder.toString()}
  ${renderApp.toString()}
  const ids = state.engines.map((item) => item.id);
  if (!state.selectedEngineId || !ids.includes(state.selectedEngineId)) state.selectedEngineId = ids[0] ?? null;
  const redraw = () => {
    root.innerHTML = renderApp(state);
    for (const button of root.querySelectorAll('[data-dash-page]')) button.addEventListener('click', () => { state.pageId = button.dataset.dashPage; redraw(); });
    const select = root.querySelector('#dashEngineSelect');
    if (select) select.addEventListener('change', () => { state.selectedEngineId = select.value; redraw(); });
    const profile = root.querySelector('#dashProfile');
    if (profile) profile.addEventListener('change', () => { state.profile = profile.value; redraw(); });
    const compare = root.querySelector('#dashCompare');
    if (compare) compare.addEventListener('change', () => { state.compareMode = compare.value; redraw(); });
    for (const button of root.querySelectorAll('[data-engine-nav]')) button.addEventListener('click', () => {
      const i = ids.indexOf(state.selectedEngineId);
      const offset = button.dataset.engineNav === 'prev' ? -1 : 1;
      const next = ids[i + offset];
      if (!next) return;
      state.selectedEngineId = next;
      redraw();
    });
  };
  document.addEventListener('keydown', (event) => {
    if (state.pageId !== 'engines') return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const i = ids.indexOf(state.selectedEngineId);
    const next = event.key === 'ArrowLeft' ? ids[i - 1] : ids[i + 1];
    if (!next) return;
    state.selectedEngineId = next;
    redraw();
  });
  redraw();
})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Echo Engines Dashboard</title><style>${standaloneCss}</style></head><body><main id="app"></main><script>${script}</script></body></html>`;
}

export const standaloneCss = `
body{margin:0;background:#000;color:#fff;font:14px/1.5 system-ui,sans-serif} .dash-layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}
.dash-menu{border-right:1px solid #333;padding:16px;display:flex;flex-direction:column;gap:8px}.dash-menu-item{background:#000;color:#fff;border:1px solid #555;border-radius:6px;padding:8px;text-align:left}
.dash-menu-item.active{background:#fff;color:#000;border-color:#fff}.dash-content{padding:18px}.dash-banner{border:1px solid #555;border-radius:8px;padding:10px;background:#111}
.dash-block{border:1px solid #333;border-radius:10px;padding:12px;margin:12px 0;background:#050505}.dash-engine-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.dash-head-left,.dash-head-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dash-engine-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.dash-full{grid-column:1/-1}.dash-integrity{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
.dash-metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.dash-metric{border:1px solid #333;border-radius:8px;padding:8px}.dash-metric-name{color:#bbb;font-size:12px}.dash-metric-value{font-size:18px;font-weight:700}.dash-metric-ci,.dash-delta,.dash-cell-meta{font-size:12px;color:#bbb}
.dash-heatmap{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.dash-cell{border:1px solid #333;border-radius:8px;padding:8px}.dash-cell-name{font-size:12px;color:#bbb}.dash-cell-value{font-size:18px;font-weight:700}.dash-cell-flag{font-size:12px;color:#ccc}.dash-cell.insufficient{background:#222;border-color:#666}
.dash-muted{color:#aaa}.tier-minimum{background:#102f1f}.tier-standard{background:#0f3f3b}.tier-exceptional{background:#1d2f5f} table{width:100%;border-collapse:collapse}td,th{border:1px solid #333;padding:6px;text-align:left;vertical-align:top}small{display:block;color:#bbb}
pre{white-space:pre-wrap;overflow-wrap:anywhere}
`;
