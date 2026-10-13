import { FilesetResolver, AudioClassifier } from '@mediapipe/tasks-audio';
import { WATCHLIST, QUICK_NOTE_PRESETS } from './watchlist.js';

const $ = (id) => document.getElementById(id);

const startStopBtn = $('startStopBtn');
const statusEl = $('status');
const top5List = $('top5List');
const timelineEl = $('timeline');
const watchlistEl = $('watchlist');
const allClassesToggle = $('allClassesToggle');
const allClassesEl = $('allClasses');
const thresholdInput = $('thresholdInput');
const smoothingToggle = $('smoothingToggle');
const windowInput = $('windowInput');
const hopInput = $('hopInput');
const applySettingsBtn = $('applySettingsBtn');
const noteInput = $('noteInput');
const markEventBtn = $('markEventBtn');
const presetNotesEl = $('presetNotes');
const logCountEl = $('logCount');
const logTableBody = document.querySelector('#logTable tbody');
const exportCsvBtn = $('exportCsvBtn');
const exportJsonBtn = $('exportJsonBtn');
const clearLogBtn = $('clearLogBtn');

const SAMPLE_RATE = 16000;
const sessionId = crypto.randomUUID();
const device = navigator.userAgent;

let classMap = []; // index -> displayName
let classifier = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let sourceNode = null;
let running = false;
let recentTop1 = []; // for smoothing
const log = []; // { timestamp, top1_label, top1_score, ..., rms_dbfs, session_id, device, note }

function settings() {
  return {
    threshold: parseFloat(thresholdInput.value) || 0.3,
    smoothing: smoothingToggle.checked,
    windowSec: parseFloat(windowInput.value) || 0.975,
    hopSec: parseFloat(hopInput.value) || 0.5
  };
}

async function loadClassMap() {
  const res = await fetch('/model/yamnet_class_map.csv');
  const text = await res.text();
  const lines = text.trim().split('\n').slice(1); // skip header
  const map = [];
  for (const line of lines) {
    const match = line.match(/^(\d+),([^,]*),(.*)$/);
    if (!match) continue;
    const [, index, , rest] = match;
    const displayName = rest.replace(/^"|"$/g, '');
    map[Number(index)] = displayName;
  }
  return map;
}

async function loadClassifier() {
  const fileset = await FilesetResolver.forAudioTasks('/wasm');
  return AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/model/yamnet.tflite' },
    maxResults: 5
  });
}

function renderWatchlist(groupScores) {
  watchlistEl.innerHTML = '';
  for (const [group, indices] of Object.entries(WATCHLIST)) {
    const groupTitle = document.createElement('div');
    groupTitle.className = 'watch-group';
    groupTitle.textContent = group;
    watchlistEl.appendChild(groupTitle);
    for (const index of indices) {
      const name = classMap[index] || `#${index}`;
      const score = groupScores.get(index) || 0;
      const item = document.createElement('div');
      item.className = 'watch-item' + (score >= settings().threshold ? ' active' : '');
      item.innerHTML = `<span>${name}</span><span>${score.toFixed(2)}</span>`;
      watchlistEl.appendChild(item);
    }
  }
}

function renderAllClasses(categories) {
  if (allClassesEl.classList.contains('hidden')) return;
  allClassesEl.innerHTML = '';
  for (const c of categories) {
    const row = document.createElement('div');
    row.innerHTML = `<span>${c.categoryName}</span><span>${c.score.toFixed(3)}</span>`;
    allClassesEl.appendChild(row);
  }
}

function renderTop5(categories, top1Label) {
  top5List.innerHTML = '';
  for (const c of categories.slice(0, 5)) {
    const li = document.createElement('li');
    li.textContent = `${c.categoryName} — ${c.score.toFixed(3)}`;
    top5List.appendChild(li);
  }
  const chip = document.createElement('div');
  chip.className = 'timeline-item';
  chip.textContent = `${new Date().toLocaleTimeString()} ${top1Label}`;
  timelineEl.appendChild(chip);
  if (timelineEl.children.length > 120) {
    timelineEl.removeChild(timelineEl.firstChild);
  }
}

function computeRmsDbfs(samples) {
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
  const rms = Math.sqrt(sumSquares / samples.length);
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms);
}

function majorityLabel(labels) {
  const counts = new Map();
  for (const l of labels) counts.set(l, (counts.get(l) || 0) + 1);
  let best = labels[labels.length - 1];
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

function addLogRow(row) {
  log.push(row);
  logCountEl.textContent = String(log.length);
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${row.timestamp}</td><td>${row.top1_label}</td><td>${row.top1_score.toFixed(
    3
  )}</td><td>${Number.isFinite(row.rms_dbfs) ? row.rms_dbfs.toFixed(1) : '—'}</td><td>${row.note || ''}</td>`;
  logTableBody.appendChild(tr);
  logTableBody.parentElement.parentElement.scrollTop = logTableBody.parentElement.scrollHeight;
}

function handleWindow(samples) {
  const { threshold, smoothing } = settings();
  const results = classifier.classify(samples, SAMPLE_RATE);
  const categories = results[0]?.classifications?.[0]?.categories || [];
  const sorted = [...categories].sort((a, b) => b.score - a.score);

  const groupScores = new Map();
  for (const indices of Object.values(WATCHLIST)) {
    for (const index of indices) {
      const cat = sorted.find((c) => c.index === index);
      if (cat) groupScores.set(index, cat.score);
    }
  }

  const rawTop = sorted[0];
  let top1Label = rawTop && rawTop.score >= threshold ? rawTop.categoryName : 'Unknown';

  if (smoothing) {
    recentTop1.push(top1Label);
    if (recentTop1.length > 3) recentTop1.shift();
    top1Label = majorityLabel(recentTop1);
  }

  renderTop5(sorted, top1Label);
  renderWatchlist(groupScores);
  renderAllClasses(sorted);

  const rmsDbfs = computeRmsDbfs(samples);
  const row = {
    timestamp: new Date().toISOString(),
    top1_label: top1Label,
    top1_score: rawTop ? rawTop.score : 0,
    top2_label: sorted[1]?.categoryName || '',
    top2_score: sorted[1]?.score || 0,
    top3_label: sorted[2]?.categoryName || '',
    top3_score: sorted[2]?.score || 0,
    top4_label: sorted[3]?.categoryName || '',
    top4_score: sorted[3]?.score || 0,
    top5_label: sorted[4]?.categoryName || '',
    top5_score: sorted[4]?.score || 0,
    rms_dbfs: rmsDbfs,
    session_id: sessionId,
    device,
    note: ''
  };
  addLogRow(row);
}

async function start() {
  startStopBtn.disabled = true;
  statusEl.textContent = 'Loading model…';

  if (!classMap.length) classMap = await loadClassMap();
  if (!classifier) classifier = await loadClassifier();

  const { windowSec, hopSec } = settings();
  const windowSamples = Math.round(windowSec * SAMPLE_RATE);
  const hopSamples = Math.round(hopSec * SAMPLE_RATE);

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1
    }
  });

  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  await audioContext.audioWorklet.addModule('/worklet/capture-processor.js');

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, 'capture-processor', {
    processorOptions: { windowSamples, hopSamples }
  });
  workletNode.port.onmessage = (event) => handleWindow(event.data);
  sourceNode.connect(workletNode);

  running = true;
  startStopBtn.textContent = 'Stop listening';
  startStopBtn.disabled = false;
  statusEl.textContent = `Listening (window ${windowSec}s, hop ${hopSec}s, ${audioContext.sampleRate} Hz)`;
}

function stop() {
  running = false;
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

applySettingsBtn.addEventListener('click', () => {
  if (running) stop();
});

allClassesToggle.addEventListener('change', () => {
  allClassesEl.classList.toggle('hidden', !allClassesToggle.checked);
});

function markEvent(note) {
  if (!note) return;
  if (log.length === 0) {
    addLogRow({
      timestamp: new Date().toISOString(),
      top1_label: '',
      top1_score: 0,
      rms_dbfs: NaN,
      session_id: sessionId,
      device,
      note
    });
    return;
  }
  const last = log[log.length - 1];
  last.note = last.note ? `${last.note}; ${note}` : note;
  const lastRow = logTableBody.lastElementChild;
  if (lastRow) lastRow.children[4].textContent = last.note;
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
  const headers = Object.keys(rows[0]);
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
});

exportJsonBtn.addEventListener('click', () => {
  download(`echo-log-${sessionId}.json`, JSON.stringify(log, null, 2), 'application/json');
});

clearLogBtn.addEventListener('click', () => {
  log.length = 0;
  logCountEl.textContent = '0';
  logTableBody.innerHTML = '';
});

loadClassMap().then((map) => {
  classMap = map;
  renderWatchlist(new Map());
});
