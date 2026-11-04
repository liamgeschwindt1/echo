import { SCENES } from '@echo/sim-core/benchmark/scenes.js';
import { VARIABLES, PRESETS, estimateExperiment, presetExperiment, reduceExperiment, buildJobs, normaliseExperiment } from '@echo/sim-core/benchmark/experiment.js';
import { METRICS, rankingFlips } from '@echo/sim-core/benchmark/metrics.js';
import { reportCsv, reportHtml, plainSummary, metricTable, lineChart, heatmap, tornado, escapeHtml as esc, formatNumber } from '@echo/sim-core/benchmark/report.js';
import { BUILTIN_ARRAYS } from '@echo/sim-core/arrays.js';
import { testingStore } from './testing-store.js';
import targets from '../../../../docs/targets.json' with { type: 'json' };

export function parseVariableValues(variable, text) {
  const strings = variable.values.every((v) => typeof v === 'string');
  const values = text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => strings ? s : Number(s));
  if (!values.length || values.some((v) => typeof v === 'number' && !Number.isFinite(v))) throw new Error(`${variable.id}: enter comma-separated values`);
  return values;
}

export function testingExperiment({ scenes, seeds = 5, mode = 'one-at-a-time', samples = 20, sweeps = [], current, analysis_modes = ['measured_only'], realism = ['off', 'on'], name = 'Testing sweep', pairedConfigs, max_runs = 2000 }) {
  const e = { name, scenes, seeds, mode, samples, sweeps, analysis_modes, realism, max_runs, base_settings: {}, ...(current ? { custom_scenes: { current } } : {}) };
  if (mode === 'paired') {
    e.configs = pairedConfigs ?? (sweeps.length ? [
      { name: 'A (first values)', values: Object.fromEntries(sweeps.map((s) => [s.variable, s.values?.[0] ?? s.range.min])) },
      { name: 'B (last values)', values: Object.fromEntries(sweeps.map((s) => [s.variable, s.values?.at(-1) ?? s.range.max])) }
    ] : presetExperiment('Realism on vs off').configs);
    if (!sweeps.length) e.realism = ['custom'];
  }
  return normaliseExperiment(e);
}

export function createTesting({ $, getScenario, getClips, getArrays, onDrilldown }) {
  const root = $('panelTesting');
  root.innerHTML = `
    <div class="testing">
      <div class="lib-head"><h2>Testing</h2><span class="grow"></span><select id="testPreset" aria-label="Test preset">${Object.keys(PRESETS).map((name) => `<option>${esc(name)}</option>`).join('')}</select><button id="testApplyPreset">Apply preset</button></div>
      <p class="note">SIMULATED only. Measured-only uses mixtures, not source windows. Realism-on matters. Missing metrics are unavailable, never zero. Held-out results are reporting-only.</p>
      <div class="testing-setup">
        <section class="set-card">
          <h3>Scenes</h3><div class="row"><button id="testAll">All</button><button id="testHeldOut">Held-out only</button><button id="testNone">Clear</button></div>
          <div id="testScenes" class="testing-scenes">${SCENES.map((s) => `<label class="check"><input type="checkbox" value="${s.id}" ${s.id === 'sparse_20' ? 'checked' : ''}>${esc(s.name)} ${s.split === 'held-out' ? '(held-out)' : ''}</label>`).join('')}
          <label class="check"><input type="checkbox" value="current">Current scene in editor (snapshot)</label></div>
          <label>Seeds per scene<input id="testSeeds" type="number" min="1" max="1000" value="5"></label>
          <p class="note">With 2+ seeds, at least 30% are held out (IDs 101+). Eight random sites are permanently held out.</p>
        </section>
        <section class="set-card">
          <h3>Run</h3>
          <label>Name<input id="testName" value="Testing sweep"></label>
          <label>Mode<select id="testMode"><option value="one-at-a-time">One-at-a-time</option><option value="grid">Grid</option><option value="random">Random sample</option><option value="latin-hypercube">Latin hypercube</option><option value="paired">Paired A/B</option></select></label>
          <label>Samples (random/LHS)<input id="testSamples" type="number" min="1" value="20"></label>
          <label>Run cap<input id="testCap" type="number" min="1" value="2000"></label>
          <label>Analysis<select id="testAnalysis"><option value="measured_only">Measured only (honest default)</option><option value="both">Both: measured + truth-assisted</option><option value="truth_assisted">Truth-assisted upper bound</option></select></label>
          <label>Realism<select id="testRealism"><option value="both">Off and on</option><option value="on">On only</option><option value="off">Off only</option></select></label>
          <p class="note">Paired A/B uses first/last chosen values. Without variables, pairs realism off/on. Legacy algorithm gates affect truth-assisted only.</p>
          <p id="testEstimate" role="status"></p><button id="testReduce">Reduce samples / values</button>
          <div class="row"><button id="testStart" class="primary">Test</button><button id="testPause" disabled>Pause</button><button id="testCancel" disabled>Cancel</button></div>
          <progress id="testProgress" max="1" value="0"></progress>
          <p id="testStatus" role="status" aria-live="polite">Ready.</p>
        </section>
      </div>
      <section class="set-card"><h3>Variable groups</h3><p class="note">Pick variables; use default values, enter a list, or set min/max/steps. Base is the chosen scene's settings. Swept values override realism settings. Clock, drift and wind are not modelled.</p><div id="testVariables"></div></section>
      <section class="set-card" id="testResults" hidden>
        <h3>Results</h3><p id="testSummary"></p>
        <div class="row"><button id="testJson">Download JSON</button><button id="testCsv">Download CSV</button><button id="testHtml">Download HTML</button><button id="testCopy">Copy summary</button><label class="upload">Compare baseline JSON<input id="testBaseline" type="file" accept=".json" hidden></label></div>
        <p class="note">Colours use provisional targets from docs/targets.json. Range-mixed results are indicative; targets apply to 50 m. Click metric cells to choose an exact run for editor drill-down.</p>
        <div id="testMetricTable" class="testing-table"></div>
        <div class="row"><label>Metric<select id="testMetric">${Object.keys(METRICS).map((k) => `<option>${k}</option>`).join('')}</select></label><label>Variable X<select id="testX"></select></label><label>Variable Y<select id="testY"></select></label><label>Context<select id="testContext"></select></label></div>
        <h4>Line plot with confidence bands</h4><div id="testLine"></div>
        <h4>Two-variable heatmap</h4><div id="testHeatmap" class="testing-table"></div>
        <h4>One-at-a-time sensitivity</h4><div id="testTornado"></div>
        <h4>Ranking and RANKING-FLIP</h4><div id="testRanking"></div>
        <h4>Paired significance / baseline deltas</h4><div id="testComparison"></div>
        <h4>Failure atlas and limits</h4><details><summary>Show failures, detection by range and limitations</summary><pre id="testAtlas"></pre><div id="testLimits"></div></details>
        <div id="testDrilldown"></div>
      </section>
      <section class="set-card"><div class="lib-head"><h3>Saved runs (this browser)</h3><span class="grow"></span><button id="testRefreshSaved">Refresh</button></div><p class="note">IndexedDB keeps settings, audio/result caches and completed jobs. Resume reruns only unfinished work with matching code/audio. Pause finishes in-flight jobs; closing tab interrupts them. Storage errors stop the run visibly.</p><div id="testSaved"></div></section>
    </div>`;
  const groups = [...new Set(VARIABLES.map((v) => v.group))];
  $('testVariables').innerHTML = groups.map((group) => `<details class="testing-group"><summary>${esc(group)}</summary><button data-reset-group="${esc(group)}">Reset to base</button>${VARIABLES.filter((v) => v.group === group).map((v) => `
    <div class="testing-variable" data-variable="${v.id}">
      <label class="check"><input type="checkbox" data-pick="${v.id}"><b>${esc(v.id)}</b> (${esc(v.unit)})</label>
      <p class="note">${esc(v.description)} <span class="muted">${v.affects}-affecting.</span></p>
      <div class="row"><select data-kind="${v.id}" aria-label="${v.id} value entry"><option value="list">Values list</option>${typeof v.values[0] === 'number' ? '<option value="range">Min/max/steps</option>' : ''}</select>
      ${v.id === 'mic_array' ? `<select multiple data-values="${v.id}" aria-label="Selected mic arrays">${BUILTIN_ARRAYS.map((a) => `<option value="${a.id}" selected>${esc(a.name)}</option>`).join('')}</select>` : `<input data-values="${v.id}" aria-label="${v.id} values" value="${esc(v.values.join(', '))}">`}
      <input data-min="${v.id}" type="number" step="any" value="${typeof v.values[0] === 'number' ? Math.min(...v.values) : 0}" aria-label="${v.id} minimum" hidden>
      <input data-max="${v.id}" type="number" step="any" value="${typeof v.values[0] === 'number' ? Math.max(...v.values) : 1}" aria-label="${v.id} maximum" hidden>
      <input data-steps="${v.id}" type="number" min="1" value="3" aria-label="${v.id} steps" hidden>
      <button data-default="${v.id}">Default range</button></div>
    </div>`).join('')}</details>`).join('');
  const find = (attr, id) => root.querySelector(`[data-${attr}="${id}"]`);
  let worker = null, active = false, paused = false, report = null, baseline = null;
  let started = 0, lastDone = 0, record = null, csv, html;
  const status = (text) => { $('testStatus').textContent = text; };
  const error = (err) => status(`Error: ${err?.message ?? err}`);
  const scenes = () => [...$('testScenes').querySelectorAll('input:checked')].map((e) => e.value);
  const read = () => {
    const sweeps = VARIABLES.filter((v) => find('pick', v.id).checked).map((v) => {
      if (find('kind', v.id).value === 'range') return { variable: v.id, group: v.group, range: { min: Number(find('min', v.id).value), max: Number(find('max', v.id).value), steps: Number(find('steps', v.id).value) } };
      return { variable: v.id, group: v.group, values: v.id === 'mic_array' ? [...find('values', v.id).selectedOptions].map((o) => o.value) : parseVariableValues(v, find('values', v.id).value) };
    });
    const picked = scenes(), current = picked.includes('current') ? structuredClone(getScenario()) : null;
    return testingExperiment({ scenes: picked, seeds: Number($('testSeeds').value), mode: $('testMode').value, samples: Number($('testSamples').value), sweeps, current, name: $('testName').value,
      analysis_modes: $('testAnalysis').value === 'both' ? ['measured_only', 'truth_assisted'] : [$('testAnalysis').value],
      realism: $('testRealism').value === 'both' ? ['off', 'on'] : [$('testRealism').value], max_runs: Number($('testCap').value) });
  };
  const refreshEstimate = () => {
    try {
      const e = estimateExperiment(read());
      $('testEstimate').textContent = `${e.runs} runs; about ${Math.ceil(e.milliseconds / 60000 / 2)} min with 2 workers (rough, before cache).${e.above_cap ? ` Above cap ${e.cap}; reduce before Test.` : ''}`;
      $('testEstimate').classList.toggle('accent', e.above_cap);
      $('testStart').disabled = active || e.above_cap;
    } catch (err) { $('testEstimate').textContent = err.message; $('testStart').disabled = true; }
  };
  const write = (e) => {
    $('testName').value = e.name; $('testMode').value = e.mode; $('testSeeds').value = Array.isArray(e.seeds) ? e.seeds.length : e.seeds;
    $('testSamples').value = e.samples ?? 20; $('testCap').value = e.max_runs ?? 2000;
    $('testAnalysis').value = e.analysis_modes.length > 1 ? 'both' : e.analysis_modes[0];
    $('testRealism').value = e.realism.length > 1 || e.realism[0] === 'custom' ? 'both' : e.realism[0];
    for (const input of $('testScenes').querySelectorAll('input')) input.checked = e.scenes.includes(input.value);
    for (const v of VARIABLES) {
      const s = e.sweeps.find((s) => s.variable === v.id);
      find('pick', v.id).checked = !!s;
      find('kind', v.id).value = 'list';
      if (s) {
        if (v.id === 'mic_array') for (const option of find('values', v.id).options) option.selected = s.values.includes(option.value);
        else find('values', v.id).value = s.values.join(', ');
      }
      updateKind(v.id);
    }
    refreshEstimate();
  };
  function updateKind(id) {
    const range = find('kind', id).value === 'range';
    find('values', id).hidden = range;
    for (const attr of ['min', 'max', 'steps']) find(attr, id).hidden = !range;
  }
  const setBusy = (busy) => {
    active = busy; $('testPause').disabled = $('testCancel').disabled = !busy;
    for (const el of root.querySelectorAll('.testing-setup input,.testing-setup select,#testVariables input,#testVariables select,#testVariables button,#testAll,#testHeldOut,#testNone,#testApplyPreset,#testReduce')) el.disabled = busy;
    refreshEstimate();
  };
  function makeWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('../benchmarkWorker.js', import.meta.url), { type: 'module' });
    worker.onerror = (event) => { error(event.message); setBusy(false); worker.terminate(); worker = null; };
    worker.onmessage = ({ data }) => {
      if (data.type === 'error') { error(data.message); setBusy(false); refreshSaved().catch(error); }
      if (data.type === 'progress') {
        lastDone = data.done;
        const remaining = data.done > 0 ? Math.ceil((performance.now() - started) / data.done * (data.total - data.done) / 1000) : null;
        $('testProgress').value = data.done / data.total;
        status(`${data.done}/${data.total} runs${remaining !== null ? `; about ${remaining} s left` : ''}${data.job ? `; ${data.job.scene}; ${data.job.config.name}; ${data.job.realism}/${data.job.analysis_mode}` : ''}${paused ? '; paused after active jobs' : ''}`);
      }
      if (data.type === 'paused') { paused = true; $('testPause').textContent = 'Resume'; status(`Paused dispatch; ${lastDone} runs done. Active jobs finish.`); }
      if (data.type === 'resumed') { paused = false; $('testPause').textContent = 'Pause'; status('Resuming.'); }
      if (data.type === 'done') {
        record = data.record; csv = data.csv; html = data.html; showReport(record.report);
        status(`${record.status}: ${record.report.runs.length} runs. Saved in this browser.`); setBusy(false);
        refreshSaved().catch(error);
      }
      if (data.type === 'comparison') showComparison(data.comparison);
    };
    return worker;
  }
  async function launch(saved) {
    if (active) throw new Error('Cancel current run before starting another');
    const experiment = saved?.experiment ?? read();
    buildJobs(experiment);
    record = saved ?? { id: crypto.randomUUID(), name: experiment.name, notes: '', experiment, created: new Date().toISOString(), status: 'pending' };
    await testingStore.set('runs', record.id, record);
    const currentClips = experiment.scenes.includes('current') ? await getClips() : [];
    started = performance.now(); lastDone = 0; paused = false; $('testPause').textContent = 'Pause'; $('testProgress').value = 0;
    setBusy(true); status('Loading recorded audio in worker...');
    makeWorker().postMessage({ type: 'start', record, clips: currentClips, arrays: getArrays(), manifest: __BENCHMARK_MANIFEST__, targets });
  }
  function showReport(next) {
    report = next; $('testResults').hidden = false; $('testResults').dataset.runs = next.runs.length;
    $('testSummary').textContent = plainSummary(next);
    $('testMetricTable').innerHTML = metricTable(next, targets);
    $('testAtlas').textContent = JSON.stringify(next.failure_atlas, null, 2);
    $('testLimits').replaceChildren(...next.notes.map((textContent) => Object.assign(document.createElement('p'), { textContent, className: 'note' })));
    const variables = [...new Set(next.experiment.sweeps.map((s) => s.variable))];
    const options = variables.map((v) => `<option>${esc(v)}</option>`).join('') || '<option value="">No sweep</option>';
    $('testX').innerHTML = $('testY').innerHTML = options;
    if (variables.length > 1) $('testY').selectedIndex = 1;
    const contexts = [...new Set(next.summary.map((r) => `${r.split}|${r.realism}|${r.analysis_mode}`))];
    $('testContext').innerHTML = contexts.map((v) => `<option>${esc(v)}</option>`).join('');
    const preferred = contexts.find((c) => c === 'train|on|measured_only');
    if (preferred) $('testContext').value = preferred;
    $('testComparison').textContent = next.paired.length ? JSON.stringify(next.paired, null, 2) : 'Compare saved run or upload baseline. Paired mode reports significance from matched runs.';
    redraw();
    if (baseline) compare(baseline);
  }
  function redraw() {
    if (!report) return;
    const context = $('testContext').value, metric = $('testMetric').value;
    const rows = report.summary.filter((r) => `${r.split}|${r.realism}|${r.analysis_mode}` === context);
    $('testLine').innerHTML = lineChart(rows, $('testX').value, metric);
    $('testHeatmap').innerHTML = heatmap(rows, $('testX').value, $('testY').value, metric);
    $('testTornado').innerHTML = tornado(rows, metric);
    const ranking = rankingFlips(rows, metric);
    $('testRanking').innerHTML = `<p>${ranking.flips.length ? `RANKING-FLIP: ${esc([...new Set(ranking.flips.map((f) => f.variable))].join(', '))}` : 'No ranking flip demonstrated in selected context.'}</p>${ranking.rankings.length ? `<table><tr><th>Context</th><th>Winner (point estimate)</th><th>Ranking</th></tr>${ranking.rankings.map((r) => `<tr><td>${esc(JSON.stringify(r.context))}</td><td>${esc(r.winner ?? (r.winners.length ? `Tie: ${r.winners.join(', ')}` : 'Unavailable'))}</td><td>${r.rows.map((row) => `${esc(row.values.mic_array)}: ${formatNumber(row.metrics[metric].value)}`).join('; ')}</td></tr>`).join('')}</table>` : '<p>Sweep mic_array to rank arrays.</p>'}`;
  }
  function showComparison(comparison) {
    $('testComparison').innerHTML = `<p>${comparison.pass ? 'PASS: no tracked metric worsened beyond tolerance.' : `FAIL: ${comparison.regressions.length} regressions.`} Saved-run deltas are not paired significance.</p>${comparison.regressions.filter((r) => r.reason).map((r) => `<p class="accent">${esc(r.key)}: ${esc(r.reason)}</p>`).join('')}<div class="testing-table"><table><tr><th>Context</th><th>Metric</th><th>Before</th><th>After</th><th>Delta</th></tr>${comparison.differences.map((r) => `<tr class="${r.regression ? 'fail' : 'pass'}"><td>${esc(r.key)}</td><td>${esc(r.metric)}</td><td>${formatNumber(r.before)}</td><td>${formatNumber(r.after)}</td><td>${formatNumber(r.delta)}</td></tr>`).join('')}</table></div>`;
  }
  const compare = (other) => { baseline = other; makeWorker().postMessage({ type: 'compare', current: report, baseline: other }); };
  const download = (name, data, type) => {
    const url = URL.createObjectURL(new Blob([data], { type })), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function refreshSaved() {
    const runs = (await testingStore.all('runs')).sort((a, b) => b.created.localeCompare(a.created));
    $('testSaved').replaceChildren(...runs.map((saved) => {
      const row = document.createElement('div'); row.className = 'testing-saved';
      const name = Object.assign(document.createElement('input'), { value: saved.name, ariaLabel: 'Saved run name' });
      const notes = Object.assign(document.createElement('input'), { value: saved.notes, placeholder: 'Notes', ariaLabel: 'Saved run notes' });
      const text = Object.assign(document.createElement('span'), { textContent: `${new Date(saved.created).toLocaleString()} / ${saved.status}` });
      const button = (textContent, action) => { const b = Object.assign(document.createElement('button'), { textContent }); b.onclick = () => Promise.resolve().then(action).catch(error); return b; };
      name.onchange = notes.onchange = async () => {
        try { const latest = await testingStore.get('runs', saved.id); await testingStore.set('runs', saved.id, { ...latest, name: name.value, notes: notes.value }); }
        catch (err) { error(err); }
      };
      row.append(name, notes, text, button(saved.report ? 'Open' : 'Resume', () => {
        if (active) throw new Error('Finish or cancel active run before opening another');
        if (saved.report) { csv = html = null; showReport(saved.report); }
        else return launch(saved);
      }));
      if (saved.status !== 'complete') row.append(button('Resume unfinished', () => launch(saved)));
      if (saved.report) row.append(button('Compare', () => { if (!report) throw new Error('Open a current run first'); compare(saved.report); }));
      return row;
    }));
  }
  $('testStart').onclick = () => launch().catch(error);
  $('testPause').onclick = () => makeWorker().postMessage({ type: paused ? 'resume' : 'pause' });
  $('testCancel').onclick = () => { makeWorker().postMessage({ type: 'cancel' }); status('Cancelling dispatch; active jobs finish and save.'); };
  $('testApplyPreset').onclick = () => { try { write(presetExperiment($('testPreset').value)); } catch (err) { error(err); } };
  $('testReduce').onclick = () => { try { write(reduceExperiment(read())); } catch (err) { error(err); } };
  $('testAll').onclick = () => { for (const input of $('testScenes').querySelectorAll('input')) input.checked = input.value !== 'current'; refreshEstimate(); };
  $('testNone').onclick = () => { for (const input of $('testScenes').querySelectorAll('input')) input.checked = false; refreshEstimate(); };
  $('testHeldOut').onclick = () => { for (const input of $('testScenes').querySelectorAll('input')) input.checked = SCENES.some((s) => s.id === input.value && s.split === 'held-out'); refreshEstimate(); };
  for (const v of VARIABLES) {
    find('kind', v.id).onchange = () => { updateKind(v.id); refreshEstimate(); };
    find('default', v.id).onclick = () => {
      find('kind', v.id).value = 'list';
      if (v.id === 'mic_array') for (const o of find('values', v.id).options) o.selected = true;
      else find('values', v.id).value = v.values.join(', ');
      updateKind(v.id); refreshEstimate();
    };
  }
  for (const b of root.querySelectorAll('[data-reset-group]')) b.onclick = () => { for (const v of VARIABLES.filter((v) => v.group === b.dataset.resetGroup)) find('pick', v.id).checked = false; refreshEstimate(); };
  root.addEventListener('change', refreshEstimate);
  for (const id of ['testMetric', 'testX', 'testY', 'testContext']) $(id).addEventListener('change', redraw);
  $('testRefreshSaved').onclick = () => refreshSaved().catch(error);
  $('testJson').onclick = () => download('benchmark.json', JSON.stringify(report, null, 2), 'application/json');
  $('testCsv').onclick = () => download('benchmark.csv', csv ?? reportCsv(report), 'text/csv');
  $('testHtml').onclick = () => download('benchmark.html', html ?? reportHtml(report, targets), 'text/html');
  $('testCopy').onclick = async () => { try { await navigator.clipboard.writeText(plainSummary(report)); status('Summary copied.'); } catch (err) { error(err); } };
  $('testBaseline').onchange = async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (data.kind !== 'echo-sim-benchmark' || !Array.isArray(data.summary)) throw new Error('Not a benchmark report');
      compare(data);
    } catch (err) { error(err); }
    e.target.value = '';
  };
  root.addEventListener('click', (e) => {
    const cell = e.target.closest('td[data-config]');
    if (!cell || !report) return;
    const runs = report.runs.filter((r) => r.job.config.id === cell.dataset.config && r.job.split === cell.dataset.split && r.job.realism === cell.dataset.realism && r.job.analysis_mode === cell.dataset.mode);
    const box = $('testDrilldown'); box.replaceChildren(Object.assign(document.createElement('h4'), { textContent: 'Open exact run in editor' }));
    for (const run of runs) {
      const b = Object.assign(document.createElement('button'), { textContent: `${run.job.scene}, seed ${run.job.seed}, ${run.job.realism}, ${run.job.analysis_mode}` });
      b.onclick = () => { try { onDrilldown(run); } catch (err) { error(err); } };
      box.append(b);
    }
    box.scrollIntoView({ block: 'nearest' });
  });
  refreshEstimate(); refreshSaved().catch(error);
  return { show: () => {
    const select = find('values', 'mic_array');
    for (const array of getArrays()) if (![...select.options].some((option) => option.value === array.id)) {
      select.add(Object.assign(document.createElement('option'), { value: array.id, textContent: array.name }));
    }
    refreshSaved().catch(error);
  } };
}
