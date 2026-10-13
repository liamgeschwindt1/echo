import { FilesetResolver, AudioClassifier } from '@mediapipe/tasks-audio';
import {
  YAMNET_WATCHLIST,
  YAMNET_WATCHLIST_BY_NAME,
  CLAP_PROMPTS,
  FAMILY_COLORS,
  QUICK_NOTE_PRESETS,
  familyColor
} from './watchlist.js';
import { Grapher } from './graph.js';
import { SessionStore } from './db.js';

const $ = (id) => document.getElementById(id);

const startStopBtn = $('startStopBtn');
const pauseBtn = $('pauseBtn');
const modelSelect = $('modelSelect');
const statusEl = $('status');
const settingsToggleBtn = $('settingsToggleBtn');
const settingsDrawer = $('settingsDrawer');
const closeSettingsBtn = $('closeSettingsBtn');
const applySettingsBtn = $('applySettingsBtn');
const clapProgress = $('clapProgress');
const clapProgressBar = $('clapProgressBar');
const clapProgressLabel = $('clapProgressLabel');
const legendEl = $('legend');
const levelCanvas = $('levelCanvas');
const scoreCanvas = $('scoreCanvas');
const scrubReadout = $('scrubReadout');
const scrubTimeEl = $('scrubTime');
const scrubModelsEl = $('scrubModels');
const resumeBtn = $('resumeBtn');
const noteInput = $('noteInput');
const markEventBtn = $('markEventBtn');
const presetNotesEl = $('presetNotes');
const logCountEl = $('logCount');
const exportCsvBtn = $('exportCsvBtn');
const exportJsonBtn = $('exportJsonBtn');
const clearLogBtn = $('clearLogBtn');

const windowSelect = $('windowSelect');
const windowInput = $('windowInput');
const hopInput = $('hopInput');
const clapCadenceInput = $('clapCadenceInput');
const promptTemplateSelect = $('promptTemplateSelect');
const windThresholdInput = $('windThresholdInput');
const themeSelect = $('themeSelect');
const logAllClassesToggle = $('logAllClassesToggle');
const clapStatusEl = $('clapStatus');
const clapYScaleSelect = $('clapYScaleSelect');

const YAMNET_RATE = 16000;
const CLAP_WINDOW_SEC = 10;
const sessionId = crypto.randomUUID();
const device = navigator.userAgent;
const sessionStore = new SessionStore();

let classMap = []; // index -> displayName
let yamnetClassifier = null;
let clapWorker = null;
let clapReady = false;
let clapBusy = false;
let clapRequestSeq = 0;
let clapLastRunAt = null; // ms epoch of the last completed CLAP run
let clapLastInferMs = null;
let clapStallTimer = null;

let audioContext = null;
let mediaStream = null;
let workletNode = null;
let sourceNode = null;
let running = false;

let latestRmsDbfs = NaN;
let latestPeakDbfs = NaN;
let latestWindScore = 0;

const log = []; // in-memory mirror of logged rows
const notes = [];

const grapher = new Grapher(levelCanvas, scoreCanvas, {
  onScrub: (t) => showScrubReadout(t)
});

function settings() {
  return {
    modelMode: modelSelect.value, // 'yamnet' | 'clap' | 'both'
    windowSec: parseFloat(windowSelect.value) || 60,
    yamnetWindowSec: parseFloat(windowInput.value) || 0.975,
    yamnetHopSec: parseFloat(hopInput.value) || 0.5,
    clapCadenceSec: parseFloat(clapCadenceInput.value) || 2.5,
    promptTemplate: promptTemplateSelect.value,
    windThreshold: parseFloat(windThresholdInput.value) || 0.4,
    logAllClasses: logAllClassesToggle.checked
  };
}

async function loadClassMap() {
  const res = await fetch('/model/yamnet_class_map.csv');
  const text = await res.text();
  const lines = text.trim().split('\n').slice(1);
  const map = [];
  for (const line of lines) {
    const match = line.match(/^(\d+),([^,]*),(.*)$/);
    if (!match) continue;
    const [, index, , rest] = match;
    map[Number(index)] = rest.replace(/^"|"$/g, '');
  }
  return map;
}

async function loadYamnetClassifier() {
  const fileset = await FilesetResolver.forAudioTasks('/wasm');
  return AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/model/yamnet.tflite' },
    maxResults: -1
  });
}

function ensureClapWorker() {
  if (clapWorker) return clapWorker;
  clapWorker = new Worker(new URL('./clapWorker.js', import.meta.url), { type: 'module' });
  clapWorker.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'progress') {
      const p = msg.progress;
      if (p && p.status === 'progress' && p.total) {
        const pct = Math.round((p.loaded / p.total) * 100);
        clapProgressBar.style.width = `${pct}%`;
        clapProgressLabel.textContent = `Loading CLAP model: ${p.file || ''} ${pct}%`;
      }
    } else if (msg.type === 'ready') {
      clapReady = true;
      clapProgress.classList.add('hidden');
    } else if (msg.type === 'error') {
      // §2/§3.1: never leave the UI showing a frozen last result — surface
      // the failure and un-gate `clapBusy` so the worker can recover on the
      // next tick rather than silently stalling forever.
      clapBusy = false;
      clapProgress.classList.add('hidden');
      clapStatusEl.textContent = `CLAP stopped: ${msg.message}`;
    } else if (msg.type === 'result') {
      clapBusy = false;
      clapLastRunAt = Date.now();
      clapLastInferMs = msg.inferMs ?? null;
      updateClapStatus();
      handleClapResult(msg);
    }
  };
  // Catches worker-thread crashes (e.g. an uncaught WASM OOM) that never
  // make it to onmessage at all, so the UI doesn't just go quiet.
  clapWorker.onerror = (event) => {
    clapBusy = false;
    clapProgress.classList.add('hidden');
    clapStatusEl.textContent = `CLAP stopped: ${event.message || 'worker crashed'}`;
  };
  return clapWorker;
}

// §3.1 + §2 "do not leave the last result frozen": shows last-run time and
// infer_ms on screen, and flags a stall if no run has completed recently.
function updateClapStatus() {
  if (!clapLastRunAt) return;
  const ago = ((Date.now() - clapLastRunAt) / 1000).toFixed(1);
  const inferPart = clapLastInferMs != null ? `, ${clapLastInferMs} ms` : '';
  clapStatusEl.textContent = `CLAP last run: ${new Date(clapLastRunAt).toLocaleTimeString()} (${ago}s ago${inferPart})`;
}

function startClapWatchdog() {
  if (clapStallTimer) clearInterval(clapStallTimer);
  clapStallTimer = setInterval(() => {
    if (!running || !clapReady) return;
    const { clapCadenceSec } = settings();
    if (clapLastRunAt && Date.now() - clapLastRunAt > Math.max(10, clapCadenceSec * 5) * 1000) {
      clapStatusEl.textContent = `CLAP stopped: stalled (no run in ${Math.round((Date.now() - clapLastRunAt) / 1000)}s)`;
    } else if (clapLastRunAt) {
      updateClapStatus();
    }
  }, 1000);
}

function initClapWorker() {
  return new Promise((resolve, reject) => {
    const worker = ensureClapWorker();
    if (clapReady) return resolve();
    clapProgress.classList.remove('hidden');
    clapProgressBar.style.width = '0%';
    clapProgressLabel.textContent = 'Loading CLAP model…';
    const onMsg = (event) => {
      if (event.data.type === 'ready') {
        worker.removeEventListener('message', onMsg);
        resolve();
      } else if (event.data.type === 'error') {
        worker.removeEventListener('message', onMsg);
        reject(new Error(event.data.message));
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'init', prompts: CLAP_PROMPTS, promptTemplate: settings().promptTemplate });
  });
}

function buildLegend() {
  legendEl.innerHTML = '';
  for (const [family, color] of Object.entries(FAMILY_COLORS)) {
    const chip = document.createElement('div');
    chip.className = 'legend-chip';
    chip.innerHTML = `<span class="legend-swatch" style="background:${color}"></span>${family}`;
    chip.addEventListener('click', () => {
      grapher.toggleFamily(family);
      chip.classList.toggle('off');
    });
    legendEl.appendChild(chip);
  }
}

function addLogRow(row) {
  log.push(row);
  logCountEl.textContent = String(log.length);
  sessionStore.addRow(row).catch((err) => console.error('log persist failed', err));
}

function handleLevel(rmsDbfs, peakDbfs) {
  latestRmsDbfs = rmsDbfs;
  latestPeakDbfs = peakDbfs;
  grapher.addLevelPoint({ t: Date.now(), rms: rmsDbfs, peak: peakDbfs, wind: latestWindScore });
}

function handleYamnetWindow(samples) {
  if (!yamnetClassifier) return;
  const { yamnetWindowSec, logAllClasses } = settings();
  const inferStart = performance.now();
  const results = yamnetClassifier.classify(samples, YAMNET_RATE);
  const inferMs = Math.round(performance.now() - inferStart);
  const categories = results[0]?.classifications?.[0]?.categories || [];
  const sorted = [...categories].sort((a, b) => b.score - a.score);
  const byName = new Map(sorted.map((c) => [c.categoryName, c.score]));
  const now = Date.now();

  const watchlistScores = {};
  let windScore = 0;
  for (const entry of YAMNET_WATCHLIST) {
    const score = byName.get(entry.name) || 0;
    watchlistScores[entry.name] = score;
    grapher.addScorePoint(`yamnet:${entry.name}`, {
      t: now,
      score,
      family: entry.family,
      relevant: true,
      model: 'yamnet'
    });
    if (entry.family === 'Context' && /wind/i.test(entry.name)) {
      windScore = Math.max(windScore, score);
    }
  }
  latestWindScore = windScore;

  const top5 = sorted.slice(0, 5);
  for (const c of top5) {
    if (!YAMNET_WATCHLIST_BY_NAME.has(c.categoryName)) {
      grapher.addScorePoint(`yamnet:${c.categoryName}`, {
        t: now,
        score: c.score,
        family: 'Non-relevant',
        relevant: false,
        model: 'yamnet'
      });
    }
  }

  const row = {
    timestamp: new Date(now).toISOString(),
    session_id: sessionId,
    device,
    model: 'yamnet',
    window_s: yamnetWindowSec,
    infer_ms: inferMs,
    rms_dbfs: latestRmsDbfs,
    peak_dbfs: latestPeakDbfs,
    top1_label: top5[0]?.categoryName || '',
    top1_score: top5[0]?.score || 0,
    top2_label: top5[1]?.categoryName || '',
    top2_score: top5[1]?.score || 0,
    top3_label: top5[2]?.categoryName || '',
    top3_score: top5[2]?.score || 0,
    top4_label: top5[3]?.categoryName || '',
    top4_score: top5[3]?.score || 0,
    top5_label: top5[4]?.categoryName || '',
    top5_score: top5[4]?.score || 0,
    scores_json: JSON.stringify(watchlistScores),
    all_classes_json: logAllClasses ? JSON.stringify(Object.fromEntries(byName)) : undefined,
    note: ''
  };
  addLogRow(row);
}

function handleClapWindow(samples, nativeRate) {
  if (!clapReady || clapBusy) return;
  clapBusy = true;
  const requestId = ++clapRequestSeq;
  const copy = samples.slice();
  ensureClapWorker().postMessage(
    { type: 'classify', requestId, audio: copy.buffer, nativeRate, timestamp: Date.now() },
    [copy.buffer]
  );
}

function handleClapResult(msg) {
  const { logAllClasses } = settings();
  const now = msg.timestamp || Date.now();
  const sorted = [...msg.scores].sort((a, b) => b.softmax - a.softmax);
  const allScores = {};
  for (const s of sorted) {
    allScores[s.id] = { softmax: s.softmax, cosine: s.cosine };
    if (s.relevant) {
      grapher.addScorePoint(`clap:${s.id}`, {
        t: now,
        score: s.softmax,
        family: s.family,
        relevant: true,
        model: 'clap',
        dashed: true
      });
    }
  }
  const top5 = sorted.slice(0, 5);
  for (const s of top5) {
    if (!s.relevant) {
      grapher.addScorePoint(`clap:${s.id}`, {
        t: now,
        score: s.softmax,
        family: 'Non-relevant',
        relevant: false,
        model: 'clap',
        dashed: true
      });
    }
  }

  const row = {
    timestamp: new Date(now).toISOString(),
    session_id: sessionId,
    device,
    model: 'clap',
    window_s: CLAP_WINDOW_SEC,
    infer_ms: msg.inferMs ?? null,
    rms_dbfs: latestRmsDbfs,
    peak_dbfs: latestPeakDbfs,
    top1_label: top5[0]?.id || '',
    top1_score: top5[0]?.softmax || 0,
    top2_label: top5[1]?.id || '',
    top2_score: top5[1]?.softmax || 0,
    top3_label: top5[2]?.id || '',
    top3_score: top5[2]?.softmax || 0,
    top4_label: top5[3]?.id || '',
    top4_score: top5[3]?.softmax || 0,
    top5_label: top5[4]?.id || '',
    top5_score: top5[4]?.softmax || 0,
    scores_json: logAllClasses ? JSON.stringify(allScores) : JSON.stringify(allScores),
    note: ''
  };
  addLogRow(row);
}

async function start() {
  startStopBtn.disabled = true;
  statusEl.textContent = 'Loading model…';

  const { modelMode, yamnetWindowSec, yamnetHopSec, clapCadenceSec } = settings();
  const needsYamnet = modelMode === 'yamnet' || modelMode === 'both';
  const needsClap = modelMode === 'clap' || modelMode === 'both';

  if (needsYamnet) {
    if (!classMap.length) classMap = await loadClassMap();
    if (!yamnetClassifier) yamnetClassifier = await loadYamnetClassifier();
  }
  if (needsClap) {
    await initClapWorker();
    clapLastRunAt = null;
    clapLastInferMs = null;
    clapStatusEl.textContent = 'CLAP last run: —';
    startClapWatchdog();
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
  });

  audioContext = new AudioContext();
  const nativeRate = audioContext.sampleRate;
  await audioContext.audioWorklet.addModule('/worklet/capture-processor.js');

  const yamnetWindowSamples = Math.round(yamnetWindowSec * nativeRate);
  const yamnetHopSamples = Math.round(yamnetHopSec * nativeRate);
  const yamnetTargetLength = Math.round(yamnetWindowSec * YAMNET_RATE);
  const clapWindowSamples = Math.round(CLAP_WINDOW_SEC * nativeRate);
  const clapHopSamples = Math.round(clapCadenceSec * nativeRate);
  const levelBlockSamples = Math.round(0.25 * nativeRate);

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, 'capture-processor', {
    processorOptions: {
      nativeRate,
      yamnetWindowSamples,
      yamnetHopSamples,
      yamnetTargetRate: YAMNET_RATE,
      yamnetTargetLength,
      clapWindowSamples,
      clapHopSamples,
      levelBlockSamples
    }
  });
  workletNode.port.onmessage = (event) => {
    const msg = event.data;
    if (msg.type === 'level') {
      handleLevel(msg.rmsDbfs, msg.peakDbfs);
    } else if (msg.type === 'yamnet' && needsYamnet) {
      handleYamnetWindow(msg.samples);
    } else if (msg.type === 'clap' && needsClap) {
      handleClapWindow(msg.samples, msg.nativeRate);
    }
  };
  sourceNode.connect(workletNode);

  running = true;
  startStopBtn.textContent = 'Stop listening';
  startStopBtn.disabled = false;
  pauseBtn.disabled = false;
  statusEl.textContent = `Listening (${modelMode}, ${nativeRate} Hz native)`;
}

function stop() {
  running = false;
  if (clapStallTimer) {
    clearInterval(clapStallTimer);
    clapStallTimer = null;
  }
  if (workletNode) workletNode.port.onmessage = null;
  if (sourceNode) sourceNode.disconnect();
  if (workletNode) workletNode.disconnect();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (audioContext) audioContext.close();
  audioContext = null;
  mediaStream = null;
  workletNode = null;
  sourceNode = null;
  startStopBtn.textContent = 'Start listening';
  pauseBtn.disabled = true;
  statusEl.textContent = 'Stopped';
}

startStopBtn.addEventListener('click', async () => {
  try {
    if (running) {
      stop();
    } else {
      await start();
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Error: ${err.message}`;
    startStopBtn.disabled = false;
    startStopBtn.textContent = 'Start listening';
  }
});

pauseBtn.addEventListener('click', () => {
  const nowPaused = !grapher.paused;
  grapher.setPaused(nowPaused);
  pauseBtn.textContent = nowPaused ? 'Resume' : 'Pause';
  if (!nowPaused) scrubReadout.classList.add('hidden');
});

resumeBtn.addEventListener('click', () => {
  grapher.setPaused(false);
  pauseBtn.textContent = 'Pause';
  scrubReadout.classList.add('hidden');
});

settingsToggleBtn.addEventListener('click', () => settingsDrawer.classList.toggle('hidden'));
closeSettingsBtn.addEventListener('click', () => settingsDrawer.classList.add('hidden'));

applySettingsBtn.addEventListener('click', () => {
  if (running) stop();
  settingsDrawer.classList.add('hidden');
});

windowSelect.addEventListener('change', () => grapher.setWindowSec(parseFloat(windowSelect.value)));
windThresholdInput.addEventListener('change', () => {
  grapher.windThreshold = parseFloat(windThresholdInput.value) || 0.4;
});
clapYScaleSelect.addEventListener('change', () => {
  grapher.setClapYScaleMode(clapYScaleSelect.value);
});
promptTemplateSelect.addEventListener('change', () => {
  if (clapWorker) clapWorker.postMessage({ type: 'setPromptTemplate', promptTemplate: promptTemplateSelect.value });
});
themeSelect.addEventListener('change', () => {
  document.body.classList.remove('theme-light', 'theme-dark');
  if (themeSelect.value !== 'system') document.body.classList.add(`theme-${themeSelect.value}`);
});

function showScrubReadout(t) {
  scrubReadout.classList.remove('hidden');
  pauseBtn.textContent = 'Resume';
  scrubTimeEl.textContent = new Date(t).toLocaleTimeString();
  const yamnetTop = grapher.topAt(t, 'yamnet');
  const clapTop = grapher.topAt(t, 'clap');
  scrubModelsEl.innerHTML = '';
  for (const [label, rows] of [
    ['YAMNet', yamnetTop],
    ['CLAP', clapTop]
  ]) {
    const col = document.createElement('div');
    col.className = 'scrub-col';
    const name = (key) => key.split(':').slice(1).join(':');
    col.innerHTML = `<strong>${label}</strong><ol>${rows
      .map(
        (r) =>
          `<li style="color:${r.relevant ? familyColor(r.family) : '#9ca3af'}">${name(r.key)} — ${r.score.toFixed(3)}</li>`
      )
      .join('')}</ol>`;
    scrubModelsEl.appendChild(col);
  }
}

function markEvent(note) {
  if (!note) return;
  const t = Date.now();
  grapher.addMarker(t, note);
  const entry = { timestamp: new Date(t).toISOString(), note };
  notes.push(entry);
  sessionStore.addNote(entry).catch((err) => console.error('note persist failed', err));
}

markEventBtn.addEventListener('click', () => {
  markEvent(noteInput.value.trim());
  noteInput.value = '';
});

noteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') markEventBtn.click();
});

for (const preset of QUICK_NOTE_PRESETS) {
  const btn = document.createElement('button');
  btn.textContent = preset;
  btn.addEventListener('click', () => markEvent(preset));
  presetNotesEl.appendChild(btn);
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const headerSet = new Set();
  for (const row of rows) Object.keys(row).forEach((k) => headerSet.add(k));
  const headers = Array.from(headerSet);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const val = row[h] ?? '';
          const str = String(val).replace(/"/g, '""');
          return /[",\n]/.test(str) ? `"${str}"` : str;
        })
        .join(',')
    );
  }
  return lines.join('\n');
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

exportCsvBtn.addEventListener('click', () => {
  download(`echo-log-${sessionId}.csv`, toCsv(log), 'text/csv');
  if (notes.length) download(`echo-notes-${sessionId}.csv`, toCsv(notes), 'text/csv');
});

exportJsonBtn.addEventListener('click', () => {
  download(`echo-log-${sessionId}.json`, JSON.stringify({ rows: log, notes }, null, 2), 'application/json');
});

clearLogBtn.addEventListener('click', async () => {
  log.length = 0;
  notes.length = 0;
  logCountEl.textContent = '0';
  await sessionStore.clear();
});

async function restoreSession() {
  try {
    const [rows, savedNotes] = await Promise.all([sessionStore.allRows(), sessionStore.allNotes()]);
    for (const row of rows) log.push(row);
    for (const n of savedNotes) notes.push(n);
    logCountEl.textContent = String(log.length);
  } catch (err) {
    console.error('failed to restore session', err);
  }
}

buildLegend();
restoreSession();
loadClassMap().then((map) => {
  classMap = map;
});
