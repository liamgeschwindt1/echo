import { FilesetResolver, AudioClassifier } from '@mediapipe/tasks-audio';
import { buildCatalogue, promptsHash, isContextFamily } from '@echo/shared/catalogue.js';
import { PeriodDetector, labelPeriods } from '@echo/shared/periods.js';
import { buildReportRequest, fallbackReport } from '@echo/shared/report-core.js';
import { SessionStore } from './db.js';
import { LiveGraph } from './graph.js';
import { REPORT_CSS, reportApp, buildStandaloneHtml } from './report.js';
import { DEFAULTS, GROUPS, clapHopS, loadSettings, saveSettings } from '@echo/shared/settings.js';
import { prepareSamples, scoreSamples, expectedNight } from './sample-test.js';

const APP_VERSION = '2.2.0';
const YAMNET_RATE = 16000;
const LEVEL_BLOCK_S = 0.1;
const TAG_PRESETS = ['siren', 'train', 'plane', 'car revving', 'bang', 'music', 'other'];

const $ = (id) => document.getElementById(id);
const liveStore = new SessionStore();
let store = liveStore;
let sampleStore = null;
let sourceMode = 'microphone';
let starting = false;
let sampleFinishTimer = null;
let clapSessionId = null;
let sampleUiAt = 0;

let cat = null;
let labelsRaw = null;
let settings = loadSettings();

// Session state. Rows are mirrored in IndexedDB; audio is never kept.
let session = null;
let rows = [];
let detector = null;

let running = false;
let runStartedAt = 0;
let elapsedBeforeMs = 0;
let audio = null; // { ctx, stream, source, node }
let activeModels = { yamnet: false, clap: false };
let lastLevel = { rms: -Infinity, peak: -Infinity };
let secondBucket = null;

let yamnetClassifier = null;
let yamnetState = { status: 'off', lastRun: null, reason: '' };

let clapWorker = null;
let clapReady = false;
let clapBusy = false;
let clapSeq = 0;
let clapState = { status: 'off', lastRun: null, lastInferMs: null, reason: '', sentAt: null };

let saveTimer = null;
const graph = new LiveGraph($('levelCanvas'), $('scoreCanvas'), {
  familyColor: (f) => cat?.families[f]?.color || '#999',
  isTarget: (f) => !isContextFamily(f)
});

// ---------- session ----------

function newSession() {
  return {
    meta: {
      session_id: crypto.randomUUID(),
      started_at: null,
      ended_at: null,
      tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      tz_offset_min: -new Date().getTimezoneOffset(),
      device: navigator.userAgent,
      app_version: APP_VERSION
    },
    level_series: [],
    raw_periods: [],
    notes: [],
    errors: [],
    report: null,
    report_key: null,
    elapsed_ms: 0
  };
}

function makeDetector() {
  detector = new PeriodDetector(() => settings, onPeriodsChanged, session.raw_periods);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.saveState({ ...session, elapsed_ms: currentElapsed() }).catch((e) => console.error('save failed', e));
  }, 1000);
}

function logError(source, message) {
  session.errors.push({ timestamp: new Date().toISOString(), source, message: String(message) });
  scheduleSave();
}

function onPeriodsChanged(periods) {
  session.raw_periods = periods;
  updateCounts();
  scheduleSave();
}

function currentElapsed() {
  return elapsedBeforeMs + (running ? Date.now() - runStartedAt : 0);
}

function labelledPeriods() {
  const periods = session.sample_test
    ? session.raw_periods.map((p) => ({ ...p, time_of_day: 'night' }))
    : session.raw_periods;
  return labelPeriods(periods, rows, session.notes, session.sample_test?.settings || settings, cat);
}

function buildExport() {
  const meta = {
    ...session.meta,
    ended_at: running ? new Date().toISOString() : session.meta.ended_at,
    tz_offset_min: -new Date().getTimezoneOffset(),
    session_label: settings.session_label,
    location_text: settings.location_text,
    lat: settings.lat,
    lon: settings.lon
  };
  return {
    schema_version: '2.2',
    meta,
    settings: { ...(session.sample_test?.settings || settings) },
    label_catalogue_version: cat.version,
    rows,
    level_series: session.level_series,
    periods: labelledPeriods(),
    notes: session.notes,
    report: session.report,
    errors: session.errors,
    ...(session.sample_test ? {
      sample_test: session.sample_test,
      sample_scores: scoreSamples(session.sample_test, rows, labelledPeriods(), cat)
    } : {})
  };
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadJson() {
  const exp = buildExport();
  download(`echo-${exp.meta.session_id}.json`, 'application/json', JSON.stringify(exp, null, 1));
}

// ---------- config ----------

async function loadConfig() {
  const [labels, priorities] = await Promise.all(
    ['/config/labels.json', '/config/priorities.json'].map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      return r.json();
    })
  );
  labelsRaw = labels;
  cat = buildCatalogue(labels, priorities);
}

// ---------- YAMNet ----------

async function loadYamnet() {
  if (yamnetClassifier) return;
  const fileset = await FilesetResolver.forAudioTasks('/wasm');
  yamnetClassifier = await AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/model/yamnet.tflite' },
    maxResults: -1
  });
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

function topFields(list) {
  const out = {};
  for (let i = 0; i < 5; i++) {
    out[`top${i + 1}_label`] = list[i]?.label ?? '';
    out[`top${i + 1}_score`] = list[i] ? r4(list[i].score) : 0;
  }
  return out;
}

function addRow(row) {
  rows.push(row);
  store.addRow(row).catch((e) => console.error('row persist failed', e));
  updateCounts();
}

function onYamnetWindow(samples) {
  if (!yamnetClassifier || !running) return;
  const t = Date.now();
  let cats;
  const t0 = performance.now();
  try {
    const res = yamnetClassifier.classify(samples, YAMNET_RATE);
    cats = res[0]?.classifications?.[0]?.categories || [];
  } catch (e) {
    yamnetState = { ...yamnetState, status: 'err', reason: e.message || 'classify failed' };
    logError('yamnet', yamnetState.reason);
    return;
  }
  const inferMs = Math.round(performance.now() - t0);
  const sorted = cats.map((c) => ({ label: c.categoryName || c.displayName, score: c.score })).sort((a, b) => b.score - a.score);
  const scores = {};
  for (const c of sorted) if (c.score >= 0.001) scores[c.label] = r4(c.score);
  addRow({
    timestamp: new Date(t).toISOString(),
    session_id: session.meta.session_id,
    device: session.meta.device,
    model: 'yamnet',
    window_s: settings.yamnet_window_s,
    infer_ms: inferMs,
    rms_dbfs: r1(lastLevel.rms),
    peak_dbfs: r1(lastLevel.peak),
    ...topFields(sorted),
    top1_family: sorted[0] ? cat.yamnetByName.get(sorted[0].label)?.family ?? 'other' : 'other',
    scores_json: scores,
    note: ''
  });
  graph.addScores(
    'yamnet',
    t,
    sorted.filter((c) => c.score >= 0.01).map((c) => ({ label: c.label, score: c.score, family: cat.yamnetByName.get(c.label)?.family ?? 'other' }))
  );
  yamnetState = { status: 'ok', lastRun: t, reason: '' };
}

// ---------- CLAP ----------

function setClapError(reason) {
  clapBusy = false;
  clapState = { ...clapState, status: 'err', reason };
  logError('clap', reason);
}

function initClap() {
  if (clapReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!clapWorker) {
      clapWorker = new Worker(new URL('./clapWorker.js', import.meta.url), { type: 'module' });
      clapWorker.onerror = (e) => setClapError(e.message || 'worker crashed');
      clapWorker.onmessage = (e) => onClapMessage(e.data);
    }
    const onInit = (e) => {
      if (e.data.type === 'ready') {
        cleanup();
        clapReady = true;
        session.meta.clap_short_window = e.data.padMode;
        resolve();
      } else if (e.data.type === 'error') {
        cleanup();
        reject(new Error(e.data.message));
      }
    };
    const onError = (e) => {
      cleanup();
      reject(new Error(e.message || 'CLAP worker crashed during loading'));
    };
    const cleanup = () => {
      clapWorker.removeEventListener('message', onInit);
      clapWorker.removeEventListener('error', onError);
    };
    clapWorker.addEventListener('message', onInit);
    clapWorker.addEventListener('error', onError);
    clapWorker.postMessage({
      type: 'init',
      classMeta: cat.classes.map((c) => ({ id: c.id, family: c.family })),
      embeddingsUrl: '/config/clap_text_embeddings.json',
      promptsHash: promptsHash(labelsRaw)
    });
  });
}

function onClapWindow(samples, nativeRate) {
  if (!clapReady || !running) return;
  // Never queue: skip the tick while a run is in progress.
  if (clapBusy) return;
  clapBusy = true;
  clapSessionId = session.meta.session_id;
  clapState.sentAt = Date.now();
  clapWorker.postMessage(
    { type: 'classify', requestId: ++clapSeq, audio: samples.buffer, nativeRate, timestamp: Date.now(), windowS: settings.clap_window_s, logitScale: settings.clap_logit_scale },
    [samples.buffer]
  );
}

function onClapMessage(msg) {
  if (msg.type === 'progress') {
    const p = msg.progress;
    if (p?.status === 'progress' && p.total) $('loadStatus').textContent = `Loading CLAP: ${Math.round((p.loaded / p.total) * 100)}%`;
  } else if (msg.type === 'skipped') {
    clapBusy = false;
  } else if (msg.type === 'error') {
    if (msg.requestId && clapSessionId !== session.meta.session_id) {
      clapBusy = false;
      return;
    }
    if (clapReady) setClapError(msg.message);
  } else if (msg.type === 'result') {
    clapBusy = false;
    if (!running || clapSessionId !== session.meta.session_id) return;
    const sum = msg.scores.reduce((a, s) => a + s.softmax, 0);
    if (Math.abs(sum - 1) > 0.001) logError('clap', `softmax sums to ${sum.toFixed(4)}`);
    const sorted = [...msg.scores].sort((a, b) => b.softmax - a.softmax);
    const scores = {};
    // All classes kept so softmax can be recomputed offline at any scale.
    for (const s of sorted) scores[s.id] = { softmax: r4(s.softmax), cosine: r4(s.cosine) };
    addRow({
      timestamp: new Date(msg.timestamp).toISOString(),
      session_id: session.meta.session_id,
      device: session.meta.device,
      model: 'clap',
      window_s: msg.windowS,
      infer_ms: msg.inferMs,
      clap_logit_scale: msg.logitScale,
      rms_dbfs: r1(lastLevel.rms),
      peak_dbfs: r1(lastLevel.peak),
      ...topFields(sorted.map((s) => ({ label: s.id, score: s.softmax }))),
      top1_family: sorted[0]?.family ?? 'other',
      scores_json: scores,
      note: ''
    });
    graph.addScores('clap', msg.timestamp, sorted.map((s) => ({ label: s.id, score: s.softmax, family: s.family })));
    clapState = { ...clapState, status: 'ok', lastRun: Date.now(), lastInferMs: msg.inferMs, reason: '' };
  }
}

// ---------- level ----------

function onLevel(rms, peak) {
  const t = Date.now();
  lastLevel = { rms, peak };
  detector.push(t, rms, peak);
  graph.addLevel(t, Number.isFinite(rms) ? rms : -120);

  // 1 Hz series for the export: power-mean RMS and max peak per second.
  const sec = Math.floor(t / 1000);
  if (!secondBucket || secondBucket.sec !== sec) {
    if (secondBucket) flushSecond();
    secondBucket = { sec, pow: 0, n: 0, peak: -Infinity };
  }
  if (Number.isFinite(rms)) secondBucket.pow += 10 ** (rms / 10);
  secondBucket.n++;
  secondBucket.peak = Math.max(secondBucket.peak, peak);

  const pct = Number.isFinite(rms) ? Math.max(0, Math.min(100, ((rms + 90) / 90) * 100)) : 0;
  $('meterFill').style.width = `${pct}%`;
  $('meterText').textContent = Number.isFinite(rms) ? `${rms.toFixed(1)} dBFS` : '-- dBFS';
}

function flushSecond() {
  const b = secondBucket;
  const rms = b.pow > 0 ? 10 * Math.log10(b.pow / b.n) : null;
  session.level_series.push({ t: new Date(b.sec * 1000).toISOString(), rms_dbfs: r1(rms), peak_dbfs: r1(b.peak) });
  if (session.level_series.length % 10 === 0) scheduleSave();
}

// ---------- start / stop ----------

async function activateSource(mode) {
  clearTimeout(saveTimer);
  if (sourceMode === mode && mode === 'microphone') return;
  await store.saveState({ ...session, elapsed_ms: currentElapsed() });
  let nextStore;
  let nextSession;
  let nextRows;
  if (mode === 'sample') {
    sampleStore ||= new SessionStore('echo-sample-tests');
    nextStore = sampleStore;
    await nextStore.clear();
    nextSession = newSession();
    nextSession.meta.source = 'sample';
    nextRows = [];
  } else {
    nextStore = liveStore;
    const saved = await nextStore.loadState();
    nextSession = saved || newSession();
    nextRows = await nextStore.allRows();
  }
  store = nextStore;
  session = nextSession;
  rows = nextRows;
  sourceMode = mode;
  elapsedBeforeMs = session.elapsed_ms || 0;
  secondBucket = null;
  lastLevel = { rms: -Infinity, peak: -Infinity };
  graph.clear();
  graph.windowS = settings.graph_window_s;
  $('graphWindow').value = String(settings.graph_window_s);
  makeDetector();
  $('sampleProgress').classList.toggle('hidden', mode !== 'sample');
  updateCounts();
}

async function start(mode = 'microphone') {
  if (starting || running) return;
  starting = true;
  const btn = $('startBtn');
  btn.disabled = true;
  $('sampleBtn').disabled = true;
  $('newSessionBtn').disabled = true;
  $('sampleStop').disabled = true;
  $('settingsBtn').disabled = true;
  activeModels = { yamnet: settings.yamnet_enabled, clap: settings.clap_enabled };
  try {
    if (!activeModels.yamnet && !activeModels.clap) throw new Error('Enable at least one model in Settings.');
    // Native rate (usually 48 kHz) keeps full bandwidth for CLAP; YAMNet is resampled to 16 kHz in the worklet.
    const ctx = new AudioContext();
    audio = { ctx, stream: null, source: null, node: null };
    await ctx.resume();
    await activateSource(mode);
    if (mode === 'microphone') {
      audio.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
      });
    }
    await ctx.audioWorklet.addModule('/worklet/capture-processor.js');

    $('loadStatus').textContent = 'Loading models...';
    const loads = [];
    if (activeModels.yamnet) {
      yamnetState = { status: 'loading', lastRun: null, reason: '' };
      loads.push(
        loadYamnet().catch((e) => {
          yamnetState = { status: 'err', lastRun: null, reason: e.message || 'load failed' };
          logError('yamnet', yamnetState.reason);
        })
      );
    } else yamnetState = { status: 'off', lastRun: null, reason: '' };
    if (activeModels.clap) {
      clapState = { status: 'loading', lastRun: null, lastInferMs: null, reason: '', sentAt: null };
      loads.push(initClap().catch((e) => setClapError(e.message || 'load failed')));
    } else clapState = { status: 'off', lastRun: null, lastInferMs: null, reason: '', sentAt: null };
    await Promise.all(loads);
    $('loadStatus').textContent = '';
    if (yamnetState.status === 'loading') yamnetState.status = 'ok';
    if (clapState.status === 'loading') clapState.status = 'ok';
    if (mode === 'sample' && ((activeModels.yamnet && yamnetState.status === 'err') || (activeModels.clap && clapState.status === 'err'))) {
      throw new Error('A selected model failed to load. Check the model status above, or disable it in Settings.');
    }

    let prepared = null;
    if (mode === 'sample') {
      const response = await fetch('/test-audio/manifest.json');
      if (!response.ok) throw new Error(`Sample manifest: HTTP ${response.status}`);
      const files = new Map();
      for (const id of ['gunshot', 'scream']) {
        const file = $(`${id}File`).files[0];
        if (file) files.set(id, file);
      }
      prepared = await prepareSamples(ctx, await response.json(), files,
        Math.max(settings.yamnet_window_s, activeModels.clap ? settings.clap_window_s : 0),
        (text) => { $('loadStatus').textContent = text; });
      session.sample_test = prepared.test;
      session.sample_test.models = { ...activeModels };
      session.sample_test.settings = { ...settings };
    }

    const rate = ctx.sampleRate;
    const node = new AudioWorkletNode(ctx, 'capture-processor', {
      processorOptions: {
        nativeRate: rate,
        yamnetWindowSamples: Math.round(settings.yamnet_window_s * rate),
        yamnetHopSamples: Math.round(settings.yamnet_hop_s * rate),
        yamnetTargetRate: YAMNET_RATE,
        yamnetTargetLength: Math.round(settings.yamnet_window_s * YAMNET_RATE),
        clapWindowSamples: Math.round(settings.clap_window_s * rate),
        clapHopSamples: Math.round(clapHopS(settings) * rate),
        levelBlockSamples: Math.round(LEVEL_BLOCK_S * rate)
      }
    });
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'level') onLevel(m.rmsDbfs, m.peakDbfs);
      else if (m.type === 'yamnet' && activeModels.yamnet) onYamnetWindow(m.samples);
      else if (m.type === 'clap' && activeModels.clap) onClapWindow(m.samples, m.nativeRate);
    };
    const source = mode === 'sample' ? ctx.createBufferSource() : ctx.createMediaStreamSource(audio.stream);
    if (prepared) source.buffer = prepared.buffer;
    source.connect(node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    audio.source = source;
    audio.node = node;
    audio.mute = mute;

    if (!session.meta.started_at) session.meta.started_at = new Date().toISOString();
    session.meta.sample_rate_hz = rate;
    detector.reset();
    running = true;
    runStartedAt = Date.now();
    if (prepared) {
      session.sample_test.started_ms = runStartedAt;
      source.connect(ctx.destination);
      source.onended = () => {
        if (!running || sourceMode !== 'sample') return;
        audio.node.port.onmessage = null;
        const deadline = Date.now() + 60_000;
        const finish = () => {
          if (!running || sourceMode !== 'sample') return;
          if (clapBusy && Date.now() < deadline) {
            sampleFinishTimer = setTimeout(finish, 100);
            return;
          }
          if (clapBusy) logError('sample', 'Timed out waiting for the final CLAP result');
          stop();
        };
        sampleFinishTimer = setTimeout(finish, 200);
      };
      source.start();
      graph.windowS = 300;
      $('graphWindow').value = '300';
      $('graphOverlay').classList.remove('hidden');
      if (!graph.visible) graph.show();
      updateSampleUi(true);
    }
    $('loadStatus').textContent = '';
    btn.textContent = 'Stop';
    btn.classList.add('running');
    scheduleSave();
  } catch (e) {
    logError('capture', e.message || e);
    $('loadStatus').textContent = `Could not start: ${e.message || e}`;
    if (running) stop();
    else teardownAudio();
  } finally {
    starting = false;
    btn.disabled = false;
    $('sampleBtn').disabled = running;
    $('newSessionBtn').disabled = false;
    $('sampleStop').disabled = !running || sourceMode !== 'sample';
    $('settingsBtn').disabled = running && sourceMode === 'sample';
    updateStatus();
  }
}

function teardownAudio() {
  if (!audio) return;
  if (audio.node) audio.node.port.onmessage = null;
  if (sourceMode === 'sample' && audio.source) {
    audio.source.onended = null;
    audio.source.stop();
    audio.source.buffer = null;
  }
  audio.source?.disconnect();
  audio.node?.disconnect();
  audio.mute?.disconnect();
  audio.stream?.getTracks().forEach((t) => t.stop());
  audio.ctx?.close();
  audio = null;
}

function stop() {
  if (!running) return;
  const now = Date.now();
  elapsedBeforeMs += now - runStartedAt;
  running = false;
  teardownAudio();
  detector.flush(now);
  if (secondBucket) flushSecond();
  secondBucket = null;
  clearTimeout(sampleFinishTimer);
  if (session.sample_test) session.sample_test.finished_ms = now;
  session.meta.ended_at = new Date(now).toISOString();
  $('startBtn').textContent = 'Start';
  $('startBtn').classList.remove('running');
  $('sampleBtn').disabled = false;
  $('sampleStop').disabled = true;
  $('settingsBtn').disabled = false;
  updateSampleUi(true);
  scheduleSave();
  updateStatus();
}

// ---------- status ----------

function ago(t) {
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  return s < 60 ? `${Math.round(s)} s ago` : `${Math.round(s / 60)} min ago`;
}

function chip(el, name, st, extra = '') {
  el.className = 'status-chip';
  if (st.status === 'off') {
    el.classList.add('off');
    el.textContent = `${name} off`;
  } else if (st.status === 'err') {
    el.classList.add('err');
    el.textContent = `${name} stopped: ${st.reason}`;
  } else if (st.status === 'loading') {
    el.textContent = `${name} loading`;
  } else if (!running) {
    el.classList.add('off');
    el.textContent = `${name} idle${st.lastRun ? ` (last ${ago(st.lastRun)})` : ''}`;
  } else {
    el.classList.add('ok');
    el.textContent = `${name} running${st.lastRun ? `, ${ago(st.lastRun)}` : ', waiting'}${extra}`;
  }
}

function updateStatus() {
  // Stall watchdog: a run that never returns, or no runs at all, turns the chip red.
  if (running && activeModels.yamnet && yamnetState.status === 'ok' && yamnetState.lastRun && Date.now() - yamnetState.lastRun > 10_000) {
    yamnetState = { ...yamnetState, status: 'err', reason: 'stalled (no run in 10 s)' };
    logError('yamnet', yamnetState.reason);
  }
  if (running && activeModels.clap && clapState.status === 'ok') {
    const stallMs = Math.max(30_000, clapHopS(settings) * 8000);
    const since = clapState.lastRun || runStartedAt + settings.clap_window_s * 1000;
    if (Date.now() - since > stallMs) setClapError(`stalled (no run in ${Math.round((Date.now() - since) / 1000)} s)`);
  }
  chip($('chipYamnet'), 'YAMNet', yamnetState);
  chip($('chipClap'), 'CLAP', clapState, clapState.lastInferMs ? ` (${clapState.lastInferMs} ms)` : '');
  const e = Math.floor(currentElapsed() / 1000);
  $('elapsed').textContent = [Math.floor(e / 3600), Math.floor((e % 3600) / 60), e % 60].map((v) => String(v).padStart(2, '0')).join(':');
  updateSampleUi();
}

function updateSampleUi(force = false) {
  const test = session.sample_test;
  if (!test) return;
  const elapsed = ((test.finished_ms ?? Date.now()) - test.started_ms) / 1000;
  const current = test.clips.find((c) => elapsed >= c.start_s && elapsed < c.end_s);
  const next = test.clips.find((c) => c.start_s > elapsed);
  $('samplePlayback').value = Math.min(1, elapsed / test.duration_s);
  const phase = running ? current ? `Playing: ${current.name}` : next ? `Silence / window clearance. Next: ${next.name}` : 'Finishing / waiting for final model result'
    : elapsed >= test.duration_s ? 'Test complete' : 'Test stopped early';
  const expected = current ? expectedNight(current, cat) : null;
  $('sampleStatus').textContent = `${phase}${current ? ` · Night expectation: ${expected || 'unmapped (inspect manually)'}` : ''}. ${test.clips.length}/15 clips loaded. Missing: ${test.missing.join(', ') || 'none'}.`;
  $('samplePredictions').textContent = ['yamnet', 'clap'].map((model) => {
    const last = rows.findLast((r) => r.model === model);
    return `${model === 'yamnet' ? 'YAMNet' : 'CLAP'}: ${last ? Array.from({ length: 5 }, (_, i) => `${last[`top${i + 1}_label`]} ${(last[`top${i + 1}_score`] * 100).toFixed(1)}%`).join(' · ') : 'waiting for a full window'}`;
  }).join(' | ');
  if (!force && Date.now() - sampleUiAt < 2000) return;
  sampleUiAt = Date.now();
  const periods = labelledPeriods();
  const latest = periods.at(-1);
  $('sampleDetection').textContent = `${detector.current(Date.now()) ? 'Event in progress. ' : ''}Latest closed detection: ${latest ? `${latest.label_text || latest.label || 'unlabelled'} · ${latest.default_priority}` : 'none yet'}`;
  const results = scoreSamples(test, rows, periods, cat);
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const text of ['Sample', 'Expected night', 'YAMNet', 'CLAP', 'Detected priority / labels', 'Check']) {
    const cell = document.createElement('th');
    cell.textContent = text;
    head.appendChild(cell);
  }
  for (const result of results) {
    const row = table.insertRow();
    const check = !result.complete ? running ? 'pending' : 'not completed'
      : !result.has_readings ? 'no model readings'
      : result.excessive_priority ? 'EXCESS PRIORITY'
      : result.priority_match === false ? 'expected label/priority missed'
      : result.priority_match ? 'match' : 'inspect manually';
    for (const text of [
      result.name, result.expected_night || 'unmapped / cap only',
      `${result.models.yamnet.recognition} (${result.models.yamnet.windows} windows)`,
      `${result.models.clap.recognition} (${result.models.clap.windows} windows)`,
      `${result.observed_priority}: ${result.detected.map((p) => p.label || 'unlabelled').join(', ') || 'no period'}`, check
    ]) {
      const cell = row.insertCell();
      cell.textContent = text;
    }
  }
  $('sampleOutcomes').replaceChildren(table);
}

function updateCounts() {
  const y = rows.filter((r) => r.model === 'yamnet').length;
  $('counts').textContent = `Rows logged: ${rows.length} (YAMNet ${y}, CLAP ${rows.length - y}) · Periods: ${session.raw_periods.length} · Notes: ${session.notes.length}`;
  $('resultsBtn').disabled = session.raw_periods.length === 0;
}

// ---------- clip tags ----------

function addNote(text) {
  const clean = String(text).trim().slice(0, 200);
  if (!clean) return;
  session.notes.push({ timestamp: new Date().toISOString(), text: clean });
  $('tagToast').textContent = `Tagged "${clean}" at ${new Date().toLocaleTimeString()}`;
  updateCounts();
  scheduleSave();
}

function setupTags() {
  const presets = $('tagPresets');
  for (const p of TAG_PRESETS) {
    const b = document.createElement('button');
    b.className = 'secondary';
    b.textContent = p;
    b.addEventListener('click', () => addNote(p));
    presets.appendChild(b);
  }
  $('tagBtn').addEventListener('click', () => $('tagPanel').classList.toggle('hidden'));
  const save = () => {
    addNote($('tagText').value);
    $('tagText').value = '';
  };
  $('tagSave').addEventListener('click', save);
  $('tagText').addEventListener('keydown', (e) => e.key === 'Enter' && save());
}

// ---------- settings ----------

function applyTheme() {
  if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}

function renderSettings() {
  const form = $('settingsForm');
  form.textContent = '';
  for (const g of GROUPS) {
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = g.title;
    fs.appendChild(lg);
    for (const f of g.fields) {
      const row = document.createElement('label');
      row.className = 'field';
      const name = document.createElement('span');
      name.textContent = f.label;
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const [v, t] of f.options) {
          const o = document.createElement('option');
          o.value = String(v);
          o.textContent = t;
          input.appendChild(o);
        }
        input.value = String(settings[f.key]);
      } else {
        input = document.createElement('input');
        input.type = f.type === 'bool' ? 'checkbox' : f.type;
        if (f.type === 'bool') input.checked = !!settings[f.key];
        else input.value = settings[f.key] ?? '';
        for (const a of ['min', 'max', 'step']) if (f[a] !== undefined) input.setAttribute(a, f[a]);
        if (f.readonly) input.disabled = true;
      }
      input.addEventListener('change', () => {
        let v;
        if (f.type === 'bool') v = input.checked;
        else if (f.type === 'number') {
          v = input.value === '' ? (f.nullable ? null : DEFAULTS[f.key]) : Number(input.value);
          if (v !== null && (!Number.isFinite(v) || (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))) {
            input.value = settings[f.key] ?? '';
            return;
          }
        } else if (f.type === 'select') v = typeof DEFAULTS[f.key] === 'number' ? Number(input.value) : input.value;
        else v = input.value;
        settings = { ...settings, [f.key]: v };
        saveSettings(settings);
        applyTheme();
        if (running && ['yamnet_enabled', 'clap_enabled', 'clap_window_s', 'clap_hop_s', 'yamnet_hop_s'].includes(f.key)) {
          $('settingsNote').textContent = 'Model changes take effect at the next Start.';
        }
      });
      row.append(name, input);
      if (f.help) {
        const h = document.createElement('span');
        h.className = 'help';
        h.textContent = f.help;
        row.appendChild(h);
      }
      fs.appendChild(row);
    }
    form.appendChild(fs);
  }
}

function previewRequest() {
  const req = buildReportRequest(buildExport(), cat);
  const text = JSON.stringify(req, null, 2);
  $('previewSize').textContent = `${new Blob([JSON.stringify(req)]).size.toLocaleString()} bytes will be posted to /api/report. No audio, embeddings or per-window scores.`;
  $('previewOut').textContent = text;
  $('previewOut').classList.remove('hidden');
}

async function clearSession() {
  if (!confirm('Delete all rows, periods, notes and the report for this session?')) return;
  if (running) stop();
  await store.clear();
  session = newSession();
  rows = [];
  elapsedBeforeMs = 0;
  graph.clear();
  $('sampleProgress').classList.add('hidden');
  makeDetector();
  updateCounts();
  updateStatus();
}

// ---------- results ----------

function reportKey(exp) {
  const last = exp.periods[exp.periods.length - 1];
  return `${exp.periods.length}|${last?.end}|${exp.notes.length}|${rows.length}`;
}

function reportData(exp) {
  return {
    meta: exp.meta,
    device: exp.meta.device,
    settings: exp.settings,
    periods: exp.periods,
    level_series: exp.level_series,
    notes: exp.notes,
    report: exp.report,
    families: Object.fromEntries(Object.entries(cat.families).map(([k, v]) => [k, { name: v.name, color: v.color }])),
    time_display: settings.time_display,
    theme: settings.theme
  };
}

async function fetchReport(request) {
  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return fallbackReport(request, body.reason || body.error || `Server returned HTTP ${res.status}`);
    return body;
  } catch {
    return fallbackReport(request, 'Could not reach the report server');
  }
}

async function showResults(regenerate = false) {
  const overlay = $('reportOverlay');
  overlay.classList.remove('hidden');
  const root = $('reportRoot');
  const exp = buildExport();
  const key = reportKey(exp);
  if (!session.report || session.report_key !== key || regenerate) {
    root.textContent = '';
    $('reportLoading').classList.remove('hidden');
    const request = buildReportRequest(exp, cat);
    session.report = session.sample_test
      ? fallbackReport(request, 'Sample test: local report only; no data sent to the server')
      : await fetchReport(request);
    session.report_key = key;
    $('reportLoading').classList.add('hidden');
    scheduleSave();
  }
  exp.report = session.report;
  const data = reportData(exp);
  root.className = '';
  reportApp(root, data, {
    onRegenerate: () => showResults(true),
    onDownloadJson: downloadJson,
    onDownloadHtml: () => download(`echo-report-${exp.meta.session_id}.html`, 'text/html', buildStandaloneHtml(data))
  });
}

// ---------- wiring ----------

function wire() {
  $('startBtn').addEventListener('click', () => (running ? stop() : start()));
  $('sampleBtn').addEventListener('click', () => start('sample'));
  $('sampleStop').addEventListener('click', stop);
  $('sampleExport').addEventListener('click', downloadJson);
  $('jsonBtn').addEventListener('click', downloadJson);
  $('resultsBtn').addEventListener('click', () => showResults(false));
  $('reportClose').addEventListener('click', () => $('reportOverlay').classList.add('hidden'));

  $('settingsBtn').addEventListener('click', () => {
    $('settingsNote').textContent = '';
    $('previewOut').classList.add('hidden');
    $('previewSize').textContent = '';
    renderSettings();
    $('settingsOverlay').classList.remove('hidden');
  });
  $('settingsClose').addEventListener('click', () => $('settingsOverlay').classList.add('hidden'));
  $('previewBtn').addEventListener('click', previewRequest);
  $('resetBtn').addEventListener('click', () => {
    settings = { ...DEFAULTS };
    saveSettings(settings);
    applyTheme();
    renderSettings();
  });
  $('newSessionBtn').addEventListener('click', clearSession);

  $('graphModel').value = settings.graph_model;
  $('graphWindow').value = String(settings.graph_window_s);
  $('graphYAxis').value = settings.clap_y_axis;
  const syncGraph = () => {
    graph.model = $('graphModel').value;
    graph.windowS = Number($('graphWindow').value);
    graph.yAxis = $('graphYAxis').value;
    settings = { ...settings, graph_model: graph.model, graph_window_s: graph.windowS, clap_y_axis: graph.yAxis };
    saveSettings(settings);
  };
  for (const id of ['graphModel', 'graphWindow', 'graphYAxis']) $(id).addEventListener('change', syncGraph);
  graph.model = settings.graph_model;
  graph.windowS = settings.graph_window_s;
  graph.yAxis = settings.clap_y_axis;
  graph.bands = (now) => {
    const out = session.raw_periods.map((p) => ({ start: Date.parse(p.start), end: Date.parse(p.end) }));
    const cur = detector.current(now);
    if (cur) out.push(cur);
    return out;
  };
  graph.clock = () => session.sample_test?.finished_ms ?? Date.now();
  graph.markers = () => session.sample_test?.clips.map((clip) => ({
    start: session.sample_test.started_ms + clip.start_s * 1000,
    end: session.sample_test.started_ms + clip.end_s * 1000,
    name: clip.name
  })) || [];
  $('graphBtn').addEventListener('click', () => {
    $('graphOverlay').classList.remove('hidden');
    graph.show();
  });
  $('graphClose').addEventListener('click', () => {
    graph.hide();
    $('graphOverlay').classList.add('hidden');
  });

  setupTags();
  setInterval(updateStatus, 500);
}

async function init() {
  const style = document.createElement('style');
  style.textContent = REPORT_CSS;
  document.head.appendChild(style);
  applyTheme();
  try {
    await loadConfig();
  } catch (e) {
    $('loadStatus').textContent = `Could not load label config: ${e.message}`;
    $('startBtn').disabled = true;
    $('sampleBtn').disabled = true;
    return;
  }
  const saved = await store.loadState().catch(() => null);
  if (saved?.meta?.session_id) {
    session = { ...newSession(), ...saved };
    rows = await store.allRows().catch(() => []);
    elapsedBeforeMs = saved.elapsed_ms || 0;
  } else {
    session = newSession();
  }
  makeDetector();
  wire();
  updateCounts();
  updateStatus();
}

init();
