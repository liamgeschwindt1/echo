import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildExport } from '@echo/sim-core/export.js';
import { defaultScenario, newNode, newSource } from '@echo/sim-core/scenario.js';
import { bindReport, openResultsReport, renderResultsReport } from '../src/ui/report.js';

function fixture() {
  const scenario = defaultScenario();
  scenario.nodes = [newNode('n1', 0, 0), newNode('n2', 40, 0)];
  scenario.sources = [newSource('drone', 'drone', 20, 20, 80)];
  const nodes = scenario.nodes.map((n) => ({ id: n.id, mic_layout: n.mic_layout, mic_positions_assumed: [[0, 0, 0], [1, 0, 0]] }));
  const results = [{
    source_id: 'drone', true_position: [20, 20, 75], usable_nodes: 2, heard_nodes: 2,
    nodes: scenario.nodes.map((n) => ({
      node_id: n.id, heard: true, usable: true, localisation_status: 'direct', snr_db: 20,
      window_snr_db: 0, window_s: [3, 3.1], active_window_s: [3, 4],
      bearing: { direction: [1, 0, 0], azimuth_deg: 0, elevation_deg: 40, elevation_sign_assumed: false, elevation_confidence: 'ok', residual_s: 0 },
      weight_terms: { uncertainty_deg: 1, overlap_deg: 0, reflector_deg: 0, total_deg: 1 },
      weight: 1, progressive: { steps: [{ t_end_s: 3.05, azimuth_deg: 0 }] },
      paths: [{ type: 'direct', length_m: 30, delay_s: 0.1, level_db_re_direct: 0, arrival_azimuth_deg: 0, arrival_elevation_deg: 40 }]
    })),
    fix: {
      method: '3d_two_ray', position: [20, 20, 75], max_crossing_angle_horizontal_deg: 2.4, max_angle_3d_deg: 42,
      inlier_nodes: ['n1', 'n2'], rejected_nodes: [], loo_residuals: [], z_clamped: false, fix_suspect: false, suspect_reasons: [], poorly_conditioned: false
    },
    error_horizontal_m: 0, error_3d_m: 0,
    track: { alignment: 'common_emission_time', filter: 'alpha_beta', window_s: 0.1, interval_s: 0.1, rejected_count: 4, dominated_count: 0, observations: [{ node_id: 'n1', azimuth_deg: 0 }], fixes: [{ position: [20, 20, 75], error_m: 0 }, { position: [20, 22, 75], error_m: 2 }] },
    backtrace: { traces: {}, candidates: [], top: [], edge_hypotheses: {} }
  }];
  return buildExport({ scenario, nodes, results });
}

function embeddedData(html) {
  return JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
}

function fakeDocument(data) {
  const ids = new Map();
  function element() {
    return {
      textContent: '', disabled: false, open: false, dataset: {}, events: {},
      addEventListener(name, fn) { this.events[name] = fn; },
      querySelector() { return this.content ??= element(); },
      scrollIntoView() { this.scrolled = true; }
    };
  }
  for (const id of ['report-data', 'copy-status', 'copy-json', 'print-report', 'expand-steps', 'collapse-steps', 'complete-json']) ids.set(id, element());
  ids.get('report-data').textContent = JSON.stringify(data);
  const stages = [element(), element()];
  stages[0].open = true;
  const raw = element();
  raw.dataset.path = JSON.stringify(['results', 0, 'track', 'fixes']);
  const doc = { getElementById: (id) => ids.get(id), querySelectorAll: (selector) => selector === '.raw' ? [raw] : stages };
  return { doc, ids, stages, raw };
}

test('standalone report explains all eleven pipeline stages and preserves every export field', () => {
  const data = fixture();
  const html = renderResultsReport(data);
  for (const id of ['setup', 'physics', 'render', 'windows-0', 'bearings-0', 'weights-0', 'fix-0', 'track-0', 'backtrace-0', 'labels-0', 'settings']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  for (const text of ['GCC-PHAT', 'Σᵢ', '3d_two_ray', '42', '1 / 1² = 1', 'Median filtered horizontal error', 'not a full execution trace', 'Simulator truth comparison', 'Every track fix', 'Copy JSON']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('>1</td>'), 'even-count median is averaged');
  assert.deepEqual(embeddedData(html), data);
  assert.ok(!html.includes('<script src='));
  assert.ok(!html.includes('stylesheet" href='));
});

test('zero outputs, false flags and missing fields are not hidden by truthy fallbacks', () => {
  const data = fixture();
  const html = renderResultsReport(data);
  assert.match(html, /3D position error<\/span><strong>0 m/);
  assert.match(html, /Elevation sign assumed<\/td><td>No/);
  assert.match(html, /Height clamped to prior<\/td><td>No/);
  assert.match(html, /Chosen-window SNR = 0 dB/);
  assert.match(html, /Cross-mic residual \(s\)<\/td><td>0/);
  assert.match(html, /rendered audio|Rendered audio/);
});

test('no-fix, no-bearing and enabled-but-incomplete labels have clear explanations', () => {
  const data = fixture();
  data.scenario.settings.labelling_enabled = true;
  const r = data.results[0];
  r.fix.position = null;
  r.fix.poorly_conditioned = true;
  r.nodes[0].bearing = null;
  r.track = null;
  const html = renderResultsReport(data);
  assert.match(html, /No fix: ray geometry is poorly conditioned/);
  assert.match(html, /No bearing was retained/);
  assert.match(html, /no completed labelling block/);
  assert.match(html, /may still be running, have failed/);
  assert.equal('labelling' in embeddedData(html), false);
});

test('completed labels and actual render audits are included without waveform data', () => {
  const data = fixture();
  data.labelling = { mode: 'model', clap_mode: 'clap5', events: [{ source_id: 'drone', node_id: 'n1', input: 'omni', detected: true, label: 'drone', confidence: 0.9 }] };
  data.rendering = { sample_rate_hz: 48000, samples_per_mic: 48000, duration_s: 1, fft_size: 65536, frequency_bins: 32769, nodes: [{ node_id: 'n1', microphones: [{ mic_index: 0, sources: [{ source_id: 'drone', applied_paths: [] }] }] }] };
  const html = renderResultsReport(data);
  assert.match(html, /1 node\/input label records/);
  assert.match(html, /48,000/);
  assert.match(html, /not recorded.*not.*no sound/);
  assert.deepEqual(embeddedData(html), data);
});

test('untrusted scene strings cannot inject markup or terminate embedded JSON scripts', () => {
  const data = fixture();
  const attack = '</script><img src=x onerror="alert(1)"><script>';
  data.results[0].source_id = attack;
  data.scenario.sources[0].id = attack;
  const html = renderResultsReport(data, { title: attack });
  assert.equal((html.match(/<script\b/g) ?? []).length, 2);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.deepEqual(embeddedData(html), data);
});

test('legacy sparse saved results remain reportable and stale reports are identified', () => {
  const data = fixture();
  data.schema = '0.3';
  data.results = [{ source_id: 'drone', nodes: [], fix: null }];
  delete data.thresholds;
  const html = renderResultsReport(data, { stale: true });
  assert.match(html, /original result snapshot/);
  assert.match(html, /not available for these saved results/);
  assert.match(html, /Sources located<\/span><strong>0 \/ 1/);
  assert.deepEqual(embeddedData(html), data);
  assert.throws(() => renderResultsReport({}), /no simulation results/);
});

test('report opens a detached tab; popup and document failures are explicit', () => {
  let content;
  let closed = false;
  const tab = { opener: {}, document: { open() {}, write(html) { content = html; }, close() {} }, close() { closed = true; } };
  const host = { open(url, target) { assert.equal(url, ''); assert.equal(target, '_blank'); return tab; } };
  assert.equal(openResultsReport(fixture(), { host }), tab);
  assert.equal(tab.opener, null);
  assert.deepEqual(embeddedData(content), fixture());
  assert.throws(() => openResultsReport(fixture(), { host: { open: () => null } }), /blocked.*Allow pop-ups/);
  tab.document.write = () => { throw new Error('Document denied'); };
  assert.throws(() => openResultsReport(fixture(), { host }), /Document denied/);
  assert.equal(closed, true);
});

test('Copy JSON matches the complete payload and can run as a self-contained inline script', async () => {
  const data = fixture();
  const { doc, ids } = fakeDocument(data);
  let copied;
  const html = renderResultsReport(data);
  const script = html.match(/<\/script><script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { document: doc, navigator: { clipboard: { async writeText(text) { copied = text; } } }, window: {} });
  await ids.get('copy-json').events.click();
  assert.equal(copied, JSON.stringify(data, null, 2));
  assert.deepEqual(JSON.parse(copied), embeddedData(html));
  assert.match(ids.get('copy-status').textContent, /JSON copied/);
  assert.equal(ids.get('copy-json').disabled, false);
});

test('clipboard denial or missing API shows visible failure and selectable JSON fallback', async () => {
  for (const nav of [{}, { clipboard: { async writeText() { throw new Error('Permission denied'); } } }]) {
    const data = fixture();
    const { doc, ids } = fakeDocument(data);
    bindReport(doc, nav, {});
    await ids.get('copy-json').events.click();
    assert.match(ids.get('copy-status').textContent, /Could not copy JSON/);
    assert.match(ids.get('copy-status').textContent, /manually/);
    assert.equal(ids.get('complete-json').open, true);
    assert.equal(ids.get('complete-json').querySelector('pre').textContent, JSON.stringify(data, null, 2));
    assert.equal(ids.get('copy-json').disabled, false);
  }
});

test('dropdown records are populated lazily; expand, collapse and print preserve behavior', () => {
  const data = fixture();
  const { doc, ids, stages, raw } = fakeDocument(data);
  let printed = false;
  bindReport(doc, {}, { print() { assert.ok(stages.every((s) => s.open)); printed = true; } });
  raw.events.toggle();
  assert.equal(raw.querySelector().textContent, '');
  raw.open = true;
  raw.events.toggle();
  assert.equal(raw.querySelector().textContent, JSON.stringify(data.results[0].track.fixes, null, 2));
  ids.get('print-report').events.click();
  assert.ok(printed);
  assert.equal(stages[0].open, true);
  assert.equal(stages[1].open, false);
  ids.get('expand-steps').events.click();
  assert.ok(stages.every((s) => s.open));
  ids.get('collapse-steps').events.click();
  assert.ok(stages.every((s) => !s.open));
  raw.dataset.loaded = '';
  raw.dataset.path = JSON.stringify(['results', 0, 'nonexistent']);
  raw.events.toggle();
  assert.equal(raw.querySelector().textContent, 'Not recorded in this export.');
});
