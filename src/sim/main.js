import { defaultScenario, newNode, newSource, validateScenario, scenarioLengthS, renderLengthS, sourcePosition } from './core/scenario.js';
import { speedOfSound, dbToPa } from './core/physics.js';
import { clipGainPa } from './core/render.js';
import { analyseClip, wavefrontRings } from './core/wavefront.js';
import { micPositions } from './core/mics.js';
import { loadManifest, fetchClip, decodeToMono, clipAvailable } from './clips.js';
import { spectrogram } from './core/spectro.js';

const $ = (id) => document.getElementById(id);
const FS = 48000;
const ACCENT = '#ffb000';

let scenario = defaultScenario();
const clips = new Map(); // id -> Float32Array at FS
const analyses = new Map(); // id -> wavefront analysis
const library = []; // manifest entries plus uploads
let status = 'edit'; // edit | rendering | ready | stale
let rendered = null;
let results = null;
const hiddenNodes = new Set(); // nodes hidden from the map only; they still take part in the simulation
let tool = 'select';
let selected = null; // { type: 'node'|'source', id }
let view = { cx: 0, cy: 0, scale: 4 };
let tl = { pxPerS: 40, x0: 0 };
let t = 0;
let playing = false;
let speed = 1;
let counter = 1;
let worker = null;

const durations = () => new Map([...clips].map(([id, s]) => [id, s.length / FS]));
const lengthS = () => Math.max(1, scenarioLengthS(scenario, durations()));

function markEdited() {
  if (status === 'ready') status = 'stale';
  $('banner').hidden = status !== 'stale';
  renderInspector();
}

// ---------- clips ----------

async function ensureClip(id) {
  if (clips.has(id)) return;
  const entry = library.find((c) => c.id === id);
  if (!entry) throw new Error(`unknown clip ${id}`);
  const samples = await fetchClip(entry, FS);
  clips.set(id, samples);
  analyses.set(id, analyseClip(samples, FS));
}

let libraryError = '';

function loadDemo() {
  scenario.nodes = [newNode('n1', 0, 0), newNode('n2', 60, 0), newNode('n3', 30, 50)];
  const entry = ['gunshot', 'glass_breaking'].map((id) => library.find((c) => c.id === id && c.available)).find(Boolean) || library.find((c) => c.available);
  if (entry) {
    scenario.sources = [newSource('s1', entry.id, 25, 20, entry.level_1m_db)];
    ensureClip(entry.id).catch((err) => console.error(err));
  }
  counter = 4;
  view = { cx: 30, cy: 25, scale: 5 };
}

async function init() {
  try {
    const entries = (await loadManifest()).filter((c) => c.file);
    await Promise.all(entries.map(async (c) => (c.available = await clipAvailable(c))));
    library.push(...entries);
  } catch (err) {
    libraryError = String(err?.message || err);
  }
  loadDemo();
  for (const [k, v] of Object.entries(scenario.settings)) {
    const el = $(`s_${k}`);
    if (el && typeof v === 'number') el.value = v;
  }
  renderInspector();
  requestAnimationFrame(frame);
}

// ---------- clip picker ----------

let pendingPos = null;

function openClipPicker(x, y) {
  pendingPos = [x, y];
  const list = $('clipList');
  list.replaceChildren();
  const note = (text) => list.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: text }));
  if (!library.length) note(`No sounds could be loaded${libraryError ? `: ${libraryError}` : ''}. Upload a WAV below.`);
  for (const c of library) {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.disabled = c.available === false;
    b.addEventListener('click', () => addSource(c));
    list.append(b);
  }
  const missing = library.filter((c) => c.available === false).length;
  if (missing) note(`${missing} sound file(s) are missing on the server. Build with SIM_ENABLED=1 so the clips are downloaded, or run npm run fetch-test-audio locally.`);
  $('clipDlg').showModal();
}

async function addSource(entry) {
  $('clipDlg').close();
  const [x, y] = pendingPos;
  scenario.sources.push(newSource(`s${counter++}`, entry.id, x, y, entry.level_1m_db));
  selected = { type: 'source', id: scenario.sources.at(-1).id };
  markEdited();
  try {
    await ensureClip(entry.id);
  } catch (err) {
    $('statusLabel').textContent = err.message;
  }
  renderInspector();
}

$('clipUpload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const id = `upload_${counter++}`;
    const samples = await decodeToMono(await file.arrayBuffer(), FS);
    clips.set(id, samples);
    analyses.set(id, analyseClip(samples, FS));
    const entry = { id, name: file.name, file: null, available: true, level_1m_db: 90, confirmed: false };
    library.push(entry);
    await addSource(entry);
  } catch (err) {
    $('statusLabel').textContent = `Could not read that file: ${err.message}`;
  }
});
$('clipCancel').addEventListener('click', () => $('clipDlg').close());

// ---------- menus and dialogs ----------

document.addEventListener('click', (e) => {
  for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target)) m.open = false;
});
for (const b of document.querySelectorAll('.menu-body button')) {
  if (!b.closest('.menu-head')) b.addEventListener('click', () => (b.closest('details').open = false));
}

let toggleSig = '';
function renderNodeToggles() {
  const sig = `${scenario.nodes.map((n) => n.id).join(',')}|${[...hiddenNodes].join(',')}`;
  if (sig === toggleSig) return;
  toggleSig = sig;
  const box = $('nodeToggles');
  box.replaceChildren();
  if (!scenario.nodes.length) box.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: 'No nodes yet' }));
  for (const n of scenario.nodes) {
    const l = document.createElement('label');
    l.className = 'check';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !hiddenNodes.has(n.id) });
    cb.addEventListener('change', () => {
      if (cb.checked) hiddenNodes.delete(n.id);
      else hiddenNodes.add(n.id);
      toggleSig = '';
    });
    l.append(cb, ` ${n.id}`);
    box.append(l);
  }
}
$('nodesAll').addEventListener('click', () => {
  hiddenNodes.clear();
  toggleSig = '';
  renderNodeToggles();
});
$('nodesNone').addEventListener('click', () => {
  for (const n of scenario.nodes) hiddenNodes.add(n.id);
  toggleSig = '';
  renderNodeToggles();
});
$('settingsBtn').addEventListener('click', () => $('settingsDlg').showModal());
$('settingsClose').addEventListener('click', () => $('settingsDlg').close());
$('infoBtn').addEventListener('click', () => $('infoDlg').showModal());
$('infoClose').addEventListener('click', () => $('infoDlg').close());

function removeSelected() {
  if (!selected) return;
  if (selected.type === 'node') scenario.nodes = scenario.nodes.filter((n) => n.id !== selected.id);
  else scenario.sources = scenario.sources.filter((s) => s.id !== selected.id);
  selected = null;
  markEdited();
}
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) removeSelected();
});

// ---------- settings and top bar ----------

for (const el of document.querySelectorAll('[id^="s_"]')) {
  el.addEventListener('change', () => {
    scenario.settings[el.id.slice(2)] = Number(el.value);
    markEdited();
  });
}

$('speed').addEventListener('input', (e) => {
  speed = 2 ** Number(e.target.value);
  if (Math.abs(speed - 1) < 0.04) speed = 1; // snap so 1x is easy to hit
  updateSpeedLabel();
});
function updateSpeedLabel() {
  const muted = speed !== 1 && $('listen').value !== 'off';
  $('speedLabel').textContent = `${speed.toFixed(2)}x${muted ? ' (muted)' : ''}`;
}
$('playBtn').addEventListener('click', () => {
  playing = !playing;
  if (playing && t >= lengthS()) t = 0;
  $('playBtn').textContent = playing ? 'Pause' : 'Play';
});
$('saveBtn').addEventListener('click', () => download('scenario.json', JSON.stringify(scenario, null, 2)));
$('loadBtn').addEventListener('click', () => $('loadFile').click());
$('loadFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    scenario = validateScenario(JSON.parse(await file.text()));
    rendered = results = null;
    hiddenNodes.clear();
    status = 'edit';
    selected = null;
    for (const [k, v] of Object.entries(scenario.settings)) if ($(`s_${k}`)) $(`s_${k}`).value = v;
    $('banner').hidden = true;
    renderInspector();
  } catch (err) {
    alert(`Load failed: ${err.message}`);
  }
  e.target.value = '';
});
$('exportBtn').addEventListener('click', () => {
  if (!results) return;
  download('results.json', JSON.stringify({ app: 'echo-sim', scenario, results }, null, 2));
});

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

for (const b of document.querySelectorAll('[data-tool]')) {
  b.addEventListener('click', () => {
    tool = b.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x === b));
  });
}

// ---------- create ----------

$('createBtn').addEventListener('click', async () => {
  if (status === 'rendering') return;
  if (!scenario.nodes.length || !scenario.sources.length) return alert('Add at least one node and one source.');
  try {
    for (const s of scenario.sources) await ensureClip(s.clip);
  } catch (err) {
    return alert(err.message);
  }
  status = 'rendering';
  $('progress').hidden = false;
  worker ??= new Worker(new URL('./renderWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') $('progress').value = m.value;
    else if (m.type === 'done') {
      rendered = m.rendered;
      results = m.results;
      t = 0;
      status = 'ready';
      const located = results.filter((r) => r.error_3d_m != null).length;
      $('statusLabel').textContent = `Located ${located} of ${results.length} sound${results.length === 1 ? '' : 's'}`;
      $('progress').hidden = true;
      $('banner').hidden = true;
      refreshListen();
      renderInspector();
    } else if (m.type === 'error') {
      status = 'edit';
      $('progress').hidden = true;
      alert(`Render failed: ${m.message}`);
    }
  };
  worker.postMessage({ scenario, clips: [...clips].filter(([id]) => scenario.sources.some((s) => s.clip === id)), lengthS: renderLengthS(scenario, durations()), durations: [...durations()] });
});

// ---------- map ----------

const map = $('map');
const mctx = map.getContext('2d');
const toScreen = (x, y) => [map.width / 2 + (x - view.cx) * view.scale, map.height / 2 - (y - view.cy) * view.scale];
const toWorld = (sx, sy) => [view.cx + (sx - map.width / 2) / view.scale, view.cy - (sy - map.height / 2) / view.scale];

function fit(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  return dpr;
}

function niceStep(minWorld) {
  for (const m of [1, 2, 5]) for (let p = -1; p < 6; p++) if (m * 10 ** p >= minWorld) return m * 10 ** p;
  return 1e6;
}

function drawMap() {
  const dpr = fit(map);
  const W = map.width;
  const H = map.height;
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, W, H);
  const step = niceStep(40 * dpr / view.scale);
  const [x0, y1] = toWorld(0, 0);
  const [x1, y0] = toWorld(W, H);
  mctx.lineWidth = 1;
  mctx.strokeStyle = '#222';
  mctx.beginPath();
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const [sx] = toScreen(x, 0); mctx.moveTo(sx, 0); mctx.lineTo(sx, H); }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const [, sy] = toScreen(0, y); mctx.moveTo(0, sy); mctx.lineTo(W, sy); }
  mctx.stroke();

  drawRings(dpr);

  const stale = status === 'stale';
  mctx.font = `${11 * dpr}px monospace`;
  for (const n of scenario.nodes) {
    if (hiddenNodes.has(n.id)) continue;
    const [sx, sy] = toScreen(n.position[0], n.position[1]);
    mctx.strokeStyle = selected?.id === n.id ? ACCENT : '#fff';
    mctx.strokeRect(sx - 5 * dpr, sy - 5 * dpr, 10 * dpr, 10 * dpr);
    if ($('showMics').checked) drawMicGlyph(n, sx, sy, dpr);
    mctx.fillStyle = '#888';
    mctx.fillText(n.id, sx + 8 * dpr, sy - 8 * dpr);
  }
  for (const s of scenario.sources) {
    const p = sourcePosition(s);
    const [sx, sy] = toScreen(p[0], p[1]);
    mctx.fillStyle = selected?.id === s.id ? ACCENT : '#fff';
    mctx.beginPath();
    mctx.arc(sx, sy, 4 * dpr, 0, 7);
    mctx.fill();
    mctx.fillStyle = '#888';
    mctx.fillText(`${s.id} ${s.clip}`, sx + 8 * dpr, sy + 12 * dpr);
  }

  if (results) {
    mctx.globalAlpha = stale ? 0.3 : 1;
    if ($('showCones').checked) {
      for (const r of results) for (const n of r.nodes) if (!hiddenNodes.has(n.node_id)) drawCone(scenario.nodes.find((x) => x.id === n.node_id), n, dpr);
    }
    for (const r of results) {
      mctx.strokeStyle = mctx.fillStyle = ACCENT;
      if (r.fix?.position) {
        const [ex, ey] = toScreen(r.fix.position[0], r.fix.position[1]);
        const [tx, ty] = toScreen(r.true_position[0], r.true_position[1]);
        mctx.beginPath();
        mctx.moveTo(tx, ty);
        mctx.lineTo(ex, ey);
        mctx.stroke();
        mctx.beginPath();
        mctx.arc(ex, ey, 4 * dpr, 0, 7);
        mctx.stroke();
      }
    }
    mctx.globalAlpha = 1;
  }

  // Scale bar
  const barM = niceStep(80 * dpr / view.scale);
  mctx.strokeStyle = mctx.fillStyle = '#fff';
  mctx.beginPath();
  mctx.moveTo(16 * dpr, H - 16 * dpr);
  mctx.lineTo(16 * dpr + barM * view.scale, H - 16 * dpr);
  mctx.stroke();
  mctx.fillText(`${barM} m`, 16 * dpr, H - 22 * dpr);
}

// A cone from the node along the heard direction. It ends where the ray reaches the slice plane (or runs off-screen if the sound is above the horizon).
function drawCone(node, n, dpr) {
  const b = n.bearing;
  if (!node || !b || !n.heard) return;
  const d = b.direction;
  const h = Math.hypot(d[0], d[1]);
  const dz = node.position[2] - scenario.settings.slice_height_m;
  let lenM = (700 * dpr) / view.scale;
  if (d[2] < -0.02 && dz > 0) lenM = Math.min(lenM, Math.max(3, (dz / -d[2]) * h));
  const az = Math.atan2(d[1], d[0]);
  const half = (b.uncertainty_deg * Math.PI) / 180;
  const [ox, oy] = toScreen(node.position[0], node.position[1]);
  const len = lenM * view.scale;
  mctx.beginPath();
  mctx.moveTo(ox, oy);
  mctx.arc(ox, oy, len, -az - half, -az + half);
  mctx.closePath();
  mctx.fillStyle = 'rgba(255,176,0,0.16)';
  mctx.fill();
  mctx.strokeStyle = 'rgba(255,176,0,0.6)';
  mctx.lineWidth = dpr;
  mctx.stroke();
}

// Mics are ~10 cm apart, far below one pixel at map scale, so a magnified top-down inset is drawn beside the node.
function drawMicGlyph(n, sx, sy, dpr) {
  const offs = micPositions(n).map((m) => [m[0] - n.position[0], m[1] - n.position[1], m[2] - n.position[2]]);
  const extent = Math.max(...offs.map((o) => Math.hypot(o[0], o[1]))) || 1e-6;
  const trueHalfPx = extent * view.scale;
  const magnified = trueHalfPx < 10 * dpr;
  const k = magnified ? (13 * dpr) / extent : view.scale;
  const cx = magnified ? sx + 24 * dpr : sx;
  const cy = magnified ? sy + 20 * dpr : sy;
  if (magnified) {
    mctx.strokeStyle = '#555';
    mctx.strokeRect(cx - 18 * dpr, cy - 18 * dpr, 36 * dpr, 36 * dpr);
    mctx.beginPath();
    mctx.moveTo(sx + 5 * dpr, sy + 5 * dpr);
    mctx.lineTo(cx - 18 * dpr, cy - 18 * dpr);
    mctx.stroke();
  }
  mctx.font = `${9 * dpr}px monospace`;
  offs.forEach((o, i) => {
    const x = cx + o[0] * k;
    const y = cy - o[1] * k;
    mctx.strokeStyle = mctx.fillStyle = '#fff';
    mctx.beginPath();
    mctx.arc(x, y, 2.5 * dpr, 0, 7);
    // Filled: at or above the node plane. Hollow: below it (tetrahedron only).
    if (o[2] >= -1e-9) mctx.fill();
    else mctx.stroke();
    mctx.fillStyle = '#888';
    mctx.fillText(String(i + 1), x + 4 * dpr, y - 3 * dpr);
  });
  if (magnified) {
    mctx.fillStyle = '#555';
    mctx.fillText(`mics x${Math.round(k / view.scale)}`, cx - 18 * dpr, cy + 28 * dpr);
  }
  mctx.font = `${11 * dpr}px monospace`;
}

function drawRings(dpr) {
  if (!scenario.sources.length) return;
  const c = speedOfSound(scenario.settings.temperature_c);
  const styled = $('grain').checked;
  const floorPa = dbToPa(scenario.settings.noise_floor_db_spl);
  for (const s of scenario.sources) {
    const a = analyses.get(s.clip);
    const samples = clips.get(s.clip);
    if (!a || !samples) continue;
    const p = sourcePosition(s);
    const [sx, sy] = toScreen(p[0], p[1]);
    const rings = wavefrontRings({
      analysis: a,
      gainPa: clipGainPa(samples, FS, s.level_1m_db),
      startS: s.start_s,
      t,
      c,
      dz: p[2] - scenario.settings.slice_height_m,
      floorPa,
      maxRings: Math.max(20, Math.round(150 / Math.max(1, speed)))
    });
    for (const r of rings) {
      const db = 20 * Math.log10(r.amp / floorPa);
      const alpha = Math.min(1, db / 60);
      if (alpha <= 0.02) continue;
      mctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      mctx.lineWidth = (styled ? 1 + 3 * (1 - Math.min(r.centroid, 4000) / 4000) : 1.5) * dpr;
      mctx.setLineDash(styled && r.flatness > 0.2 ? [2 * dpr, (1 + 4 * r.flatness) * dpr] : []);
      mctx.beginPath();
      mctx.arc(sx, sy, r.radius * view.scale, 0, 7);
      mctx.stroke();
    }
    mctx.setLineDash([]);
  }
}

function pick(sx, sy) {
  const dpr = window.devicePixelRatio || 1;
  const near = (p) => Math.hypot(toScreen(p[0], p[1])[0] - sx, toScreen(p[0], p[1])[1] - sy) < 12 * dpr;
  for (const s of scenario.sources) if (near(sourcePosition(s))) return { type: 'source', id: s.id };
  for (const n of scenario.nodes) if (!hiddenNodes.has(n.id) && near(n.position)) return { type: 'node', id: n.id };
  return null;
}

const find = (sel) => (sel.type === 'node' ? scenario.nodes : scenario.sources).find((o) => o.id === sel.id);
let drag = null;

map.addEventListener('pointerdown', async (e) => {
  const dpr = window.devicePixelRatio || 1;
  const r = map.getBoundingClientRect();
  const sx = (e.clientX - r.left) * dpr;
  const sy = (e.clientY - r.top) * dpr;
  const hit = pick(sx, sy);
  const [wx, wy] = toWorld(sx, sy);
  if (tool === 'node') {
    scenario.nodes.push(newNode(`n${counter++}`, Math.round(wx * 10) / 10, Math.round(wy * 10) / 10));
    selected = { type: 'node', id: scenario.nodes.at(-1).id };
    return markEdited();
  }
  if (tool === 'source') {
    openClipPicker(Math.round(wx * 10) / 10, Math.round(wy * 10) / 10);
    return;
  }
  selected = hit;
  drag = hit ? { kind: 'obj' } : { kind: 'pan', sx, sy, cx: view.cx, cy: view.cy };
  map.setPointerCapture(e.pointerId);
  renderInspector();
});
map.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dpr = window.devicePixelRatio || 1;
  const r = map.getBoundingClientRect();
  const sx = (e.clientX - r.left) * dpr;
  const sy = (e.clientY - r.top) * dpr;
  if (drag.kind === 'pan') {
    view.cx = drag.cx - (sx - drag.sx) / view.scale;
    view.cy = drag.cy + (sy - drag.sy) / view.scale;
  } else if (selected) {
    const [wx, wy] = toWorld(sx, sy);
    const o = find(selected);
    const pos = selected.type === 'node' ? o.position : sourcePosition(o);
    pos[0] = Math.round(wx * 10) / 10;
    pos[1] = Math.round(wy * 10) / 10;
    markEdited();
  }
});
map.addEventListener('pointerup', () => (drag = null));
map.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.scale = Math.min(200, Math.max(0.2, view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
}, { passive: false });

// ---------- inspector ----------

function numField(label, value, onSet, step = 0.1) {
  const l = document.createElement('label');
  l.textContent = label;
  const i = document.createElement('input');
  i.type = 'number';
  i.step = step;
  i.value = value;
  i.addEventListener('change', () => { onSet(Number(i.value)); markEdited(); });
  l.append(i);
  return l;
}

function updateHint() {
  $('hint').textContent = !scenario.nodes.length ? 'Add a node, then add a sound' : !scenario.sources.length ? 'Now add a sound with Add source' : '';
}

function advanced(...children) {
  const d = document.createElement('details');
  d.append(Object.assign(document.createElement('summary'), { textContent: 'Advanced' }), ...children);
  return d;
}

function removeButton() {
  const b = Object.assign(document.createElement('button'), { className: 'remove', textContent: 'Delete' });
  b.addEventListener('click', removeSelected);
  return b;
}

function renderInspector() {
  const el = $('inspector');
  el.replaceChildren();
  const o = selected && find(selected);
  $('app').classList.toggle('has-inspector', !!o);
  updateHint();
  renderNodeToggles();
  if (!o) return;
  const h = (text) => Object.assign(document.createElement('h3'), { textContent: text });
  if (selected.type === 'node') {
    el.append(h(`Node ${o.id}`));
    el.append(numField('x (m)', o.position[0], (v) => (o.position[0] = v)), numField('y (m)', o.position[1], (v) => (o.position[1] = v)));
    const layout = document.createElement('label');
    layout.textContent = 'Layout';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="flat_square">flat square</option><option value="tetrahedron">tetrahedron</option>';
    sel.value = o.mic_layout;
    sel.addEventListener('change', () => { o.mic_layout = sel.value; markEdited(); });
    layout.append(sel);
    el.append(advanced(
      numField('height z (m)', o.position[2], (v) => (o.position[2] = v)),
      numField('rotation (\u00b0)', o.rotation_deg, (v) => (o.rotation_deg = v), 1),
      numField('mic spacing (m)', o.mic_spacing_m, (v) => (o.mic_spacing_m = v), 0.01),
      layout
    ));
    el.append(removeButton());
    const rn = rendered?.nodes.find((n) => n.id === o.id);
    if (rn) el.append(nodeResultPanel(rn));
  } else {
    const entry = library.find((c) => c.id === o.clip);
    el.append(h(`${entry?.name ?? o.clip} (${o.id})`));
    const p = sourcePosition(o);
    el.append(
      numField('x (m)', p[0], (v) => (p[0] = v)),
      numField('y (m)', p[1], (v) => (p[1] = v)),
      numField('level at 1 m (dB)', o.level_1m_db, (v) => (o.level_1m_db = v), 1),
      numField('start (s)', o.start_s, (v) => (o.start_s = Math.max(0, v)))
    );
    if (entry && !entry.confirmed) el.append(Object.assign(document.createElement('div'), { className: 'muted', textContent: 'Level is a placeholder (unconfirmed).' }));
    el.append(advanced(numField('height z (m)', p[2], (v) => (p[2] = v))));
    el.append(removeButton());
    const r = results?.find((x) => x.source_id === o.id);
    if (r) el.append(resultPanel(r));
  }
}

function nodeResultPanel(rn) {
  const box = document.createElement('div');
  if (status === 'stale') box.className = 'stale';
  box.append(Object.assign(document.createElement('h3'), { textContent: 'Mic waveforms' }));
  const cv = document.createElement('canvas');
  cv.width = 250;
  cv.height = 120;
  cv.style.height = '120px';
  const g = cv.getContext('2d');
  rn.mics.forEach((m, k) => {
    const y = 15 + k * 30;
    const per = Math.ceil(m.length / cv.width);
    g.strokeStyle = k === 0 ? '#fff' : '#888';
    g.beginPath();
    for (let x = 0; x < cv.width; x++) {
      let lo = 0;
      let hi = 0;
      for (let i = x * per; i < Math.min(m.length, (x + 1) * per); i++) {
        if (m[i] < lo) lo = m[i];
        if (m[i] > hi) hi = m[i];
      }
      g.moveTo(x, y - Math.min(1, hi) * 14);
      g.lineTo(x, y - Math.max(-1, lo) * 14);
    }
    g.stroke();
  });
  box.append(cv);
  box.append(Object.assign(document.createElement('h3'), { textContent: 'Spectrogram, mic 1 (0-8 kHz)' }));
  const sp = spectrogram(rn.mics[0], rendered.sample_rate);
  const sc = document.createElement('canvas');
  sc.width = sp.frames.length;
  sc.height = sp.bins;
  sc.style.height = '100px';
  const sg = sc.getContext('2d');
  let peak = -Infinity;
  for (const col of sp.frames) for (const v of col) peak = Math.max(peak, v);
  sp.frames.forEach((col, x) => {
    for (let k = 0; k < sp.bins; k++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, (col[k] - (peak - 70)) / 70)));
      sg.fillStyle = `rgb(${v},${v},${v})`;
      sg.fillRect(x, sp.bins - 1 - k, 1, 1);
    }
  });
  box.append(sc);
  return box;
}

function resultPanel(r) {
  const box = document.createElement('div');
  if (status === 'stale') box.className = 'stale';
  const f = (v, d = 1) => (v == null ? 'n/a' : v.toFixed(d));
  const rows = r.nodes.map((n) => {
    const b = n.bearing;
    const azErr = b ? Math.abs(((b.azimuth_deg - n.true_azimuth_deg + 540) % 360) - 180) : null;
    return `<tr><td>${n.node_id}</td><td>${f(n.range_m, 0)}</td><td>${f(n.snr_db)}</td><td>${n.heard ? 'yes' : 'no'}</td><td>${f(azErr)}</td></tr>`;
  });
  const positionText = r.fix?.position
    ? r.fix.position.map((v) => v.toFixed(1)).join(', ')
    : r.heard_nodes === 0
      ? 'not heard by any node'
      : r.heard_nodes === 1
        ? 'heard by one node: direction only'
        : 'poorly conditioned (directions nearly parallel)';
  box.innerHTML = `<h3>Result</h3>
    <table><tr><th>node</th><th>m</th><th>SNR dB</th><th>used</th><th>az err \u00b0</th></tr>${rows.join('')}</table>
    <p>Position: <span class="accent">${positionText}</span><br>
    Error: ${f(r.error_horizontal_m, 2)} m horizontal, ${f(r.error_3d_m, 2)} m 3D<br>
    Ray angle: ${f(r.fix?.max_angle_deg, 0)}\u00b0</p>`;
  return box;
}

// ---------- timeline ----------

const tlc = $('timeline');
const tctx = tlc.getContext('2d');
const ROW = 28;
const RULER = 24;
let tlDrag = null;

function drawTimeline() {
  const dpr = fit(tlc);
  const W = tlc.width;
  const H = tlc.height;
  tctx.fillStyle = '#000';
  tctx.fillRect(0, 0, W, H);
  if (!scenario.sources.length) {
    tctx.fillStyle = '#8a8a8a';
    tctx.font = `${14 * dpr}px system-ui, sans-serif`;
    tctx.fillText('Sounds appear here as blocks once you add a source. Drag a block to change when it starts.', 18 * dpr, 60 * dpr);
  }
  const px = tl.pxPerS * dpr;
  tctx.font = `${10 * dpr}px monospace`;
  tctx.strokeStyle = '#444';
  tctx.fillStyle = '#888';
  const tick = niceStep(60 / tl.pxPerS);
  for (let s = 0; s * px < W; s += tick) {
    const x = s * px;
    tctx.beginPath();
    tctx.moveTo(x, 0);
    tctx.lineTo(x, H);
    tctx.stroke();
    tctx.fillText(`${s}s`, x + 3, 12 * dpr);
  }
  scenario.sources.forEach((s, i) => {
    const y = (RULER + i * ROW) * dpr;
    const dur = (clips.get(s.clip)?.length || FS) / FS;
    tctx.fillStyle = selected?.id === s.id ? ACCENT : '#fff';
    tctx.fillRect(s.start_s * px, y + 2 * dpr, dur * px, (ROW - 6) * dpr);
    tctx.fillStyle = '#000';
    tctx.fillText(`${s.id} ${s.clip}`, s.start_s * px + 4, y + 17 * dpr);
  });
  if (results && status !== 'rendering') {
    const y0 = (RULER + scenario.sources.length * ROW + 8) * dpr;
    tctx.globalAlpha = status === 'stale' ? 0.3 : 1;
    tctx.fillStyle = ACCENT;
    results.forEach((r) => r.nodes.forEach((n, k) => {
      tctx.fillRect(n.first_arrival_s * px - 1, y0 + k * 8 * dpr, 3, 6 * dpr);
    }));
    tctx.globalAlpha = 1;
  }
  drawErrorLane(px, dpr);
  tctx.strokeStyle = '#fff';
  tctx.beginPath();
  tctx.moveTo(t * px, 0);
  tctx.lineTo(t * px, H);
  tctx.stroke();
}

// Localisation error per source, drawn over the clip's audible span at the first node.
function drawErrorLane(px, dpr) {
  if (!results || status === 'rendering') return;
  const top = (RULER + scenario.sources.length * ROW + 8 + 3 * 8 + 12) * dpr;
  const h = 40 * dpr;
  tctx.globalAlpha = status === 'stale' ? 0.3 : 1;
  tctx.strokeStyle = '#444';
  tctx.strokeRect(0, top, tlc.width, h);
  tctx.fillStyle = '#888';
  tctx.fillText('error m (0-20)', 4, top + 10 * dpr);
  tctx.strokeStyle = tctx.fillStyle = ACCENT;
  for (const r of results) {
    if (r.error_3d_m == null) continue;
    const src = scenario.sources.find((s) => s.id === r.source_id);
    const n = r.nodes[0];
    if (!src || !n) continue;
    const dur = (clips.get(src.clip)?.length || FS) / FS;
    const y = top + h - Math.min(1, r.error_3d_m / 20) * h;
    tctx.beginPath();
    tctx.moveTo(n.first_arrival_s * px, y);
    tctx.lineTo((n.first_arrival_s + dur) * px, y);
    tctx.stroke();
    tctx.fillText(`${r.error_3d_m.toFixed(1)} m`, n.first_arrival_s * px + 2, y - 3 * dpr);
  }
  tctx.globalAlpha = 1;
}

const tlPos = (e) => {
  const r = tlc.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

tlc.addEventListener('pointerdown', (e) => {
  const { x, y } = tlPos(e);
  tlc.setPointerCapture(e.pointerId);
  const sec = x / tl.pxPerS;
  const row = Math.floor((y - RULER) / ROW);
  const src = y > RULER ? scenario.sources[row] : null;
  if (src && sec >= src.start_s && sec <= src.start_s + (clips.get(src.clip)?.length || FS) / FS) {
    selected = { type: 'source', id: src.id };
    tlDrag = { kind: 'clip', src, grab: sec - src.start_s };
    renderInspector();
  } else {
    tlDrag = { kind: 'head' };
    t = Math.max(0, sec);
  }
});
tlc.addEventListener('pointermove', (e) => {
  if (!tlDrag) return;
  const sec = tlPos(e).x / tl.pxPerS;
  if (tlDrag.kind === 'head') t = Math.max(0, Math.min(lengthS(), sec));
  else {
    tlDrag.src.start_s = Math.max(0, Math.round((sec - tlDrag.grab) * 100) / 100);
    markEdited();
  }
});
tlc.addEventListener('pointerup', () => (tlDrag = null));
tlc.addEventListener('wheel', (e) => {
  e.preventDefault();
  tl.pxPerS = Math.min(400, Math.max(4, tl.pxPerS * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
}, { passive: false });

// ---------- repeats and sweeps ----------

let sweepWorker = null;

$('sweepBtn').addEventListener('click', () => $('sweepDlg').showModal());
$('sweepClose').addEventListener('click', () => $('sweepDlg').close());

$('sweepRun').addEventListener('click', async () => {
  if (!scenario.nodes.length || !scenario.sources.length) return alert('Add at least one node and one source.');
  try {
    for (const s of scenario.sources) await ensureClip(s.clip);
  } catch (err) {
    return alert(err.message);
  }
  const param = $('sweepParam').value;
  const values = $('sweepValues').value.split(',').map(Number).filter(Number.isFinite);
  if (param && !values.length) return alert('Enter comma-separated values.');
  $('sweepRun').disabled = true;
  $('sweepProgress').hidden = false;
  $('sweepOut').textContent = '';
  sweepWorker ??= new Worker(new URL('./sweepWorker.js', import.meta.url), { type: 'module' });
  sweepWorker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') $('sweepProgress').value = m.value;
    else {
      $('sweepRun').disabled = false;
      $('sweepProgress').hidden = true;
      if (m.type === 'error') $('sweepOut').textContent = `Failed: ${m.message}`;
      else showSweep(param, m.rows);
    }
  };
  const used = [...clips].filter(([id]) => scenario.sources.some((s) => s.clip === id));
  sweepWorker.postMessage({ scenario, clips: used, durations: [...durations()], param: param || null, values, seeds: Math.max(1, Number($('sweepSeeds').value) || 1) });
});

function showSweep(param, rows) {
  const f = (v, d = 2) => (v == null ? 'n/a' : v.toFixed(d));
  $('sweepOut').innerHTML = `<table><tr><th>${param || 'repeat'}</th><th>trials</th><th>fix rate</th><th>err med m</th><th>err p90 m</th><th>bearing med \u00b0</th><th>bearing p90 \u00b0</th></tr>${rows
    .map((r) => `<tr><td>${r.value ?? '-'}</td><td>${r.trials}</td><td>${f(r.fix_rate)}</td><td>${f(r.error_3d_median_m)}</td><td>${f(r.error_3d_p90_m)}</td><td>${f(r.bearing_median_deg)}</td><td>${f(r.bearing_p90_deg)}</td></tr>`)
    .join('')}</table>`;
  const cv = $('sweepPlot');
  cv.hidden = rows.length < 2;
  if (cv.hidden) return;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);
  const xs = rows.map((r) => r.value);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const yMax = Math.max(1, ...rows.map((r) => r.error_3d_p90_m ?? 0));
  const px = (v) => 40 + ((v - x0) / (x1 - x0 || 1)) * (cv.width - 60);
  const series = (key, scale, color, dash) => {
    g.strokeStyle = color;
    g.setLineDash(dash);
    g.beginPath();
    rows.forEach((r, i) => {
      const y = cv.height - 20 - ((r[key] ?? 0) / scale) * (cv.height - 40);
      i ? g.lineTo(px(r.value), y) : g.moveTo(px(r.value), y);
    });
    g.stroke();
  };
  series('error_3d_median_m', yMax, '#ffb000', []);
  series('error_3d_p90_m', yMax, '#ffb000', [4, 4]);
  series('fix_rate', 1, '#fff', []);
  g.setLineDash([]);
  g.fillStyle = '#888';
  g.font = '10px monospace';
  g.fillText(`amber: 3D error median / p90 (0-${yMax.toFixed(1)} m)   white: fix rate (0-1)`, 40, 12);
  g.fillText(String(x0), 40, cv.height - 5);
  g.fillText(String(x1), cv.width - 40, cv.height - 5);
}

// ---------- sound during playback ----------

// 'dry' plays each source's clip as recorded (works before Create); a mic id plays that rendered mic signal.
let audio = null; // { srcs, key, t0, c0 }
let listenCtx = null;
const bufferCache = new Map();

function stopListen() {
  for (const s of audio?.srcs || []) {
    try { s.stop(); } catch { /* already stopped */ }
  }
  audio = null;
}

function listenKey() {
  const mode = $('listen').value;
  if (mode === 'off') return '';
  if (mode === 'dry') return `dry|${scenario.sources.map((s) => `${s.id}:${s.clip}:${s.start_s}:${s.level_1m_db}`).join(',')}`;
  return rendered && status !== 'rendering' ? mode : '';
}

function bufferFor(ctx, key, samples, rate) {
  let buf = bufferCache.get(key);
  if (!buf) {
    buf = ctx.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    bufferCache.set(key, buf);
  }
  return buf;
}

function peakOf(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]));
  return p || 1;
}

function syncListen() {
  const key = listenKey();
  if (!(playing && speed === 1 && key)) return stopListen();
  if (audio && audio.key === key && Math.abs(t - (audio.t0 + listenCtx.currentTime - audio.c0)) < 0.15) return;
  stopListen();
  const ctx = (listenCtx ??= new AudioContext());
  ctx.resume();
  const out = ctx.createDynamicsCompressor();
  out.connect(ctx.destination);
  const srcs = [];
  if (key.startsWith('dry|')) {
    const maxLevel = Math.max(...scenario.sources.map((s) => s.level_1m_db));
    for (const s of scenario.sources) {
      const samples = clips.get(s.clip);
      if (!samples || t >= s.start_s + samples.length / FS) continue;
      const node = ctx.createBufferSource();
      node.buffer = bufferFor(ctx, `dry:${s.clip}`, samples, FS);
      const gain = ctx.createGain();
      // Peak-normalise, then keep louder sources louder (floor of -20 dB so quiet ones stay audible).
      gain.gain.value = (0.6 / peakOf(samples)) * Math.min(1, Math.max(0.1, 10 ** ((s.level_1m_db - maxLevel) / 20)));
      node.connect(gain).connect(out);
      node.start(ctx.currentTime + Math.max(0, s.start_s - t), Math.max(0, t - s.start_s));
      srcs.push(node);
    }
  } else {
    const [nodeId, mic] = key.split(':');
    const sig = rendered.nodes.find((n) => n.id === nodeId)?.mics[Number(mic)];
    if (!sig) return;
    const node = ctx.createBufferSource();
    node.buffer = bufferFor(ctx, key, sig, rendered.sample_rate);
    const gain = ctx.createGain();
    gain.gain.value = 8; // rendered level is well below full scale
    node.connect(gain).connect(out);
    node.start(0, t);
    srcs.push(node);
  }
  audio = { srcs, key, t0: t, c0: ctx.currentTime };
}

function refreshListen() {
  const prev = $('listen').value || 'dry';
  const opts = ['<option value="dry">Sources, as recorded</option>'];
  for (const n of rendered?.nodes || []) for (let m = 0; m < 4; m++) opts.push(`<option value="${n.id}:${m}">${n.id} mic ${m + 1} (rendered)</option>`);
  opts.push('<option value="off">Off</option>');
  bufferCache.clear();
  $('listen').innerHTML = opts.join('');
  $('listen').value = [...$('listen').options].some((o) => o.value === prev) ? prev : 'dry';
}
$('listen').addEventListener('change', updateSpeedLabel);

// ---------- loop ----------

let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (playing) {
    t += dt * speed;
    if (t >= lengthS()) {
      t = lengthS();
      playing = false;
      $('playBtn').textContent = 'Play';
    }
  }
  $('timeLabel').textContent = `${t.toFixed(2)} s`;
  syncListen();
  drawMap();
  drawTimeline();
  requestAnimationFrame(frame);
}

init();
