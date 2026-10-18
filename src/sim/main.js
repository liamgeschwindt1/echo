import { defaultScenario, newNode, newSource, newBuilding, placementErrors, validateScenario, scenarioLengthS, renderLengthS, sourcePosition } from './core/scenario.js';
import { insideBuilding, buildingBox, simConstants, segmentBlocked, traceReflection, reflectionImages } from './core/geometry.js';
import { speedOfSound, dbToPa } from './core/physics.js';
import { clipGainPa } from './core/render.js';
import { analyseClip, wavefrontRings } from './core/wavefront.js';
import { sourceBandLevels } from './core/reach.js';
import { micPositions } from './core/mics.js';
import { loadManifest, fetchClip, decodeToMono, clipAvailable } from './clips.js';
import { spectrogram } from './core/spectro.js';
import { createMicView } from './ui/micview.js';

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
let selected = null; // { type: 'node'|'source'|'building', id }
let selected2 = null; // shift-click: second selection, so a node and a source can be shown together
let pathFocus = null; // { nodeId, sourceId } chosen by clicking a result row
let view = { cx: 0, cy: 0, scale: 4 };
let tl = { pxPerS: 40, x0: 0 };
let t = 0;
let playing = false;
let speed = 1;
let counter = 1;
let worker = null;
let lastCreate = null; // snapshot of what was rendered, so component views match the results even after edits
let autoOpened = null;

const micView = createMicView({
  $,
  accent: ACCENT,
  getScenario: () => lastCreate?.scenario,
  getRendered: () => rendered,
  getResults: () => results,
  getStatus: () => status,
  getT: () => t,
  setT: (v) => (t = Math.max(0, v)),
  download,
  requestComponents: (nodeIndex, mode, key) => worker?.postMessage({ type: 'components', scenario: lastCreate.scenario, clips: lastCreate.clips, lengthS: lastCreate.lengthS, nodeIndex, mode, key })
});

const durations = () => new Map([...clips].map(([id, s]) => [id, s.length / FS]));
const lengthS = () => Math.max(1, scenarioLengthS(scenario, durations()));

function markEdited() {
  if (status === 'ready') status = 'stale';
  $('banner').hidden = status !== 'stale';
  reachStale();
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
  syncSettingsInputs();
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
  else if (selected.type === 'building') scenario.buildings = scenario.buildings.filter((b) => b.id !== selected.id);
  else scenario.sources = scenario.sources.filter((s) => s.id !== selected.id);
  selected = selected2 = pathFocus = null;
  markEdited();
}
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) removeSelected();
});

// ---------- settings and top bar ----------

for (const el of document.querySelectorAll('[id^="s_"]')) {
  el.addEventListener('change', () => {
    scenario.settings[el.id.slice(2)] = el.type === 'checkbox' ? el.checked : Number(el.value);
    markEdited();
  });
}

function syncSettingsInputs() {
  for (const [k, v] of Object.entries(scenario.settings)) {
    const el = $(`s_${k}`);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (typeof v === 'number') el.value = v;
  }
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
    selected = selected2 = pathFocus = null;
    syncSettingsInputs();
    for (const s of scenario.sources) ensureClip(s.clip).catch((err) => console.error(err));
    $('banner').hidden = true;
    renderInspector();
  } catch (err) {
    alert(`Load failed: ${err.message}`);
  }
  e.target.value = '';
});
$('exportBtn').addEventListener('click', () => {
  if (!results) return;
  download('results.json', JSON.stringify({ app: 'echo-sim', schema: '0.2', constants: simConstants(), scenario, results }, null, 2));
});

function download(name, data, mime = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: mime }));
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
  const bad = placementErrors(scenario);
  if (bad.length) return alert(bad.join('\n'));
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
    else if (m.type === 'components') micView.onComponents(m);
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
      if (micView.isOpen()) micView.open(micView.nodeId());
    } else if (m.type === 'error') {
      status = 'edit';
      $('progress').hidden = true;
      alert(`Render failed: ${m.message}`);
    }
  };
  const used = [...clips].filter(([id]) => scenario.sources.some((s) => s.clip === id));
  lastCreate = { scenario: structuredClone(scenario), clips: used, lengthS: renderLengthS(scenario, durations()) };
  worker.postMessage({ scenario, clips: used, lengthS: lastCreate.lengthS, durations: [...durations()] });
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

  drawReach(dpr);
  drawRings(dpr);
  drawBuildings(dpr);

  const stale = status === 'stale';
  mctx.font = `${11 * dpr}px monospace`;
  for (const n of scenario.nodes) {
    if (hiddenNodes.has(n.id)) continue;
    const [sx, sy] = toScreen(n.position[0], n.position[1]);
    mctx.strokeStyle = selected?.id === n.id || selected2?.id === n.id ? ACCENT : '#fff';
    mctx.strokeRect(sx - 5 * dpr, sy - 5 * dpr, 10 * dpr, 10 * dpr);
    if ($('showMics').checked) drawMicGlyph(n, sx, sy, dpr);
    mctx.fillStyle = '#888';
    mctx.fillText(n.id, sx + 8 * dpr, sy - 8 * dpr);
  }
  for (const s of scenario.sources) {
    const p = sourcePosition(s);
    const [sx, sy] = toScreen(p[0], p[1]);
    mctx.fillStyle = selected?.id === s.id || selected2?.id === s.id ? ACCENT : '#fff';
    mctx.beginPath();
    mctx.arc(sx, sy, 4 * dpr, 0, 7);
    mctx.fill();
    mctx.fillStyle = '#888';
    mctx.fillText(`${s.id} ${s.clip}`, sx + 8 * dpr, sy + 12 * dpr);
  }

  if ($('showPaths').checked) drawPaths(dpr);

  if (sectionLine) {
    const [ax, ay] = toScreen(sectionLine.a[0], sectionLine.a[1]);
    const [bx, by] = toScreen(sectionLine.b[0], sectionLine.b[1]);
    mctx.strokeStyle = ACCENT;
    mctx.lineWidth = 2 * dpr;
    mctx.setLineDash([10 * dpr, 5 * dpr]);
    mctx.beginPath();
    mctx.moveTo(ax, ay);
    mctx.lineTo(bx, by);
    mctx.stroke();
    mctx.setLineDash([]);
    mctx.lineWidth = 1;
    mctx.fillStyle = ACCENT;
    mctx.fillText('side view', (ax + bx) / 2 + 6 * dpr, (ay + by) / 2 - 6 * dpr);
  }

  if (results) {
    mctx.globalAlpha = stale ? 0.3 : 1;
    if ($('showCones').checked) {
      for (const r of results) for (const n of r.nodes) if (!hiddenNodes.has(n.node_id)) drawCone(scenario.nodes.find((x) => x.id === n.node_id), n, dpr);
    }
    for (const r of results) {
      mctx.strokeStyle = mctx.fillStyle = ACCENT;
      if (r.fix?.position && t >= r.fix.ready_s) {
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

function drawBuildings(dpr) {
  mctx.font = `${11 * dpr}px monospace`;
  const rect = (b) => {
    const { min, max } = buildingBox(b);
    const [x0, y0] = toScreen(min[0], max[1]);
    const [x1, y1] = toScreen(max[0], min[1]);
    return [x0, y0, x1 - x0, y1 - y0];
  };
  for (const b of scenario.buildings) {
    const [x, y, w, h] = rect(b);
    const sel = selected?.type === 'building' && selected.id === b.id;
    mctx.fillStyle = 'rgba(60,60,60,0.92)';
    mctx.fillRect(x, y, w, h);
    mctx.strokeStyle = sel ? ACCENT : '#fff';
    mctx.lineWidth = dpr;
    mctx.strokeRect(x, y, w, h);
    mctx.fillStyle = '#ddd';
    mctx.fillText(`${b.id}  ${b.size[2]} m`, x + 4 * dpr, y + 13 * dpr);
    if (sel) {
      mctx.fillStyle = ACCENT;
      for (const [cx, cy] of buildingCorners(b)) {
        const [px, py] = toScreen(cx, cy);
        mctx.fillRect(px - 4 * dpr, py - 4 * dpr, 8 * dpr, 8 * dpr);
      }
    }
  }
  if (drag?.kind === 'bnew') {
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.max(drag.y0, drag.y1);
    const [sx, sy] = toScreen(x, y);
    mctx.setLineDash([6 * dpr, 4 * dpr]);
    mctx.strokeStyle = '#fff';
    mctx.strokeRect(sx, sy, Math.abs(drag.x1 - drag.x0) * view.scale, Math.abs(drag.y1 - drag.y0) * view.scale);
    mctx.setLineDash([]);
  }
}

// Which node/source pair to draw paths for: a clicked result row, or a shift-click pair of one node and one source.
function focusedPair() {
  if (pathFocus) return pathFocus;
  const pair = [selected, selected2].filter(Boolean);
  const node = pair.find((s) => s.type === 'node');
  const source = pair.find((s) => s.type === 'source');
  return node && source ? { nodeId: node.id, sourceId: source.id } : null;
}

// Every valid path source -> reflection points -> node. Brightness shows level relative to the strongest; the picked path is amber.
function drawPaths(dpr) {
  const pair = focusedPair();
  if (!pair || !results || !rendered?.paths) return;
  const ni = scenario.nodes.findIndex((n) => n.id === pair.nodeId);
  const si = scenario.sources.findIndex((s) => s.id === pair.sourceId);
  if (ni < 0 || si < 0 || hiddenNodes.has(pair.nodeId)) return;
  const table = rendered.paths[ni]?.centre[si]?.paths;
  const nodeResult = results[si]?.nodes[ni];
  if (!table || !nodeResult) return;
  const start = sourcePosition(scenario.sources[si]);
  const end = scenario.nodes[ni].position;
  mctx.globalAlpha = status === 'stale' ? 0.3 : 1;
  table.forEach((p, i) => {
    const picked = i === nodeResult.picked_path_index;
    const level = nodeResult.paths?.[i]?.level_db_re_direct ?? 0;
    const alpha = Math.min(1, Math.max(0.2, 1 + level / 30));
    const pts = [start, ...p.hits, end].map((q) => toScreen(q[0], q[1]));
    mctx.strokeStyle = picked ? ACCENT : `rgba(255,255,255,${alpha.toFixed(2)})`;
    mctx.lineWidth = (picked ? 2.5 : 1) * dpr;
    // Diffracted paths are dashed so they differ from the solid reflection polylines.
    mctx.setLineDash(p.type === 'diffracted' ? [8 * dpr, 4 * dpr] : []);
    mctx.beginPath();
    pts.forEach(([x, y], k) => (k ? mctx.lineTo(x, y) : mctx.moveTo(x, y)));
    mctx.stroke();
    mctx.setLineDash([]);
    if (p.type === 'diffracted') {
      const [ex, ey] = toScreen(p.image[0], p.image[1]);
      mctx.strokeStyle = picked ? ACCENT : '#ddd';
      mctx.lineWidth = dpr;
      mctx.strokeRect(ex - 3 * dpr, ey - 3 * dpr, 6 * dpr, 6 * dpr);
    } else if (p.type !== 'direct') {
      const [ix, iy] = toScreen(p.image[0], p.image[1]);
      mctx.strokeStyle = picked ? ACCENT : '#aaa';
      mctx.lineWidth = dpr;
      mctx.beginPath();
      mctx.arc(ix, iy, 3 * dpr, 0, 7);
      mctx.stroke();
    }
  });
  mctx.lineWidth = 1;
  mctx.globalAlpha = 1;
}

// Every wedge has the same on-screen length and no end cap, so its length never implies range. Truth stays on the source dot.
// Label: stated uncertainty and actual azimuth error; "!" when the error exceeds the stated uncertainty.
// The wedge is generated over time: it appears once the sound has been at the node for the first analysis step, then tightens.
function currentStep(n) {
  if (!n.bearing) return null;
  if (!n.progressive) return { direction: n.bearing.direction, uncertainty_deg: n.bearing.uncertainty_deg, azimuth_error_deg: n.azimuth_error_deg, snr_db: n.snr_db };
  let step = null;
  for (const s of n.progressive) if (s.t_end_s <= t) step = s;
  return step;
}

function drawCone(node, n, dpr) {
  const step = currentStep(n);
  if (!node || !step || step.snr_db < scenario.settings.min_snr_db) return;
  const d = step.direction;
  const az = Math.atan2(d[1], d[0]);
  const u = step.uncertainty_deg;
  // Drawn at least 1.5 degrees wide so a very confident wedge is still visible; the label always shows the real value.
  const half = (Math.max(u, 1.5) * Math.PI) / 180;
  const [ox, oy] = toScreen(node.position[0], node.position[1]);
  const len = 170 * dpr;
  const wrong = step.azimuth_error_deg > u;
  const overlapped = n.overlapped_with?.length > 0;
  const invalid = !n.uncertainty_valid;
  const tip = [ox + Math.cos(-az) * len, oy + Math.sin(-az) * len];
  const grad = (a0, a1) => {
    const g = mctx.createLinearGradient(ox, oy, tip[0], tip[1]);
    g.addColorStop(0, `rgba(255,176,0,${a0})`);
    g.addColorStop(1, `rgba(255,176,0,${a1})`);
    return g;
  };
  mctx.beginPath();
  mctx.moveTo(ox, oy);
  mctx.arc(ox, oy, len, -az - half, -az + half);
  mctx.closePath();
  mctx.fillStyle = grad(0.28, 0.02);
  mctx.fill();
  // Edges only: the far end stays open.
  mctx.strokeStyle = grad(0.9, 0.15);
  mctx.lineWidth = (wrong ? 2.5 : 1) * dpr;
  mctx.setLineDash(overlapped || invalid ? [6 * dpr, 4 * dpr] : []);
  for (const s of [-1, 1]) {
    mctx.beginPath();
    mctx.moveTo(ox, oy);
    mctx.lineTo(ox + Math.cos(-az - s * half) * len, oy + Math.sin(-az - s * half) * len);
    mctx.stroke();
  }
  mctx.setLineDash([]);
  mctx.lineWidth = 1;

  const deg = (v) => (v < 10 ? v.toFixed(1) : v.toFixed(0));
  const text = `\u00b1${deg(u)}\u00b0  err ${deg(step.azimuth_error_deg)}\u00b0${wrong ? ' !' : ''}${overlapped ? '  \u26a0 overlap' : invalid ? '  (\u00b1 not valid)' : ''}`;
  const lx = ox + Math.cos(-az) * len * 0.62;
  const ly = oy + Math.sin(-az) * len * 0.62;
  mctx.font = `${11 * dpr}px monospace`;
  const w = mctx.measureText(text).width + 8 * dpr;
  const x = lx - w / 2;
  const y = ly - 8 * dpr;
  mctx.fillStyle = wrong ? ACCENT : 'rgba(0,0,0,0.75)';
  mctx.fillRect(x, y, w, 16 * dpr);
  mctx.fillStyle = wrong ? '#000' : ACCENT;
  mctx.fillText(text, x + 4 * dpr, y + 12 * dpr);
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

const reflCache = new Map();
// Image sources from the same enumeration the render uses (ground included when enabled).
function reflectionsFor(s) {
  const key = `${s.id}|${sourcePosition(s)}|${JSON.stringify(scenario.settings)}|${JSON.stringify(scenario.buildings)}`;
  if (!reflCache.has(key)) {
    if (reflCache.size > 40) reflCache.clear();
    reflCache.set(key, reflectionImages(sourcePosition(s), scenario.settings, scenario.buildings));
  }
  return reflCache.get(key);
}

// One wavefront ring about (cx, cy) in world metres; valid(P) says which parts of the circle exist (null = all of it).
function strokeRing(cx, cy, rho, valid, dpr) {
  const [sx, sy] = toScreen(cx, cy);
  const rpx = rho * view.scale;
  mctx.beginPath();
  if (!valid) {
    mctx.arc(sx, sy, rpx, 0, 7);
    mctx.stroke();
    return;
  }
  const step = Math.max((2 * Math.PI) / 720, (5 * dpr) / Math.max(rpx, 1));
  const W = map.width;
  const H = map.height;
  let run = false;
  for (let th = 0; th <= 2 * Math.PI + step; th += step) {
    const px = cx + rho * Math.cos(th);
    const py = cy + rho * Math.sin(th);
    const [x, y] = toScreen(px, py);
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40 || !valid([px, py])) {
      run = false;
      continue;
    }
    if (run) mctx.lineTo(x, y);
    else mctx.moveTo(x, y);
    run = true;
  }
  mctx.stroke();
}

// Direct rings are cut off behind buildings (no diffraction); reflected rings start at the wall faces and travel out from the mirror image.
function drawRings(dpr) {
  if (!scenario.sources.length) return;
  const c = speedOfSound(scenario.settings.temperature_c);
  const styled = $('grain').checked;
  const floorPa = dbToPa(scenario.settings.noise_floor_db_spl);
  const slice = scenario.settings.slice_height_m;
  const boxes = scenario.buildings.map(buildingBox);
  const showRefl = $('showReflWaves').checked;
  for (const s of scenario.sources) {
    const a = analyses.get(s.clip);
    const samples = clips.get(s.clip);
    if (!a || !samples) continue;
    const p = sourcePosition(s);
    const gainPa = clipGainPa(samples, FS, s.level_1m_db);
    const maxRings = Math.max(20, Math.round(150 / Math.max(1, speed)));
    const style = (r, tint, scale) => {
      const db = 20 * Math.log10(r.amp / floorPa);
      const alpha = Math.min(1, db / 60) * scale;
      if (alpha <= 0.02) return false;
      mctx.strokeStyle = `rgba(${tint},${alpha.toFixed(3)})`;
      mctx.lineWidth = (styled ? 1 + 3 * (1 - Math.min(r.centroid, 4000) / 4000) : 1.5) * dpr;
      mctx.setLineDash(styled && r.flatness > 0.2 ? [2 * dpr, (1 + 4 * r.flatness) * dpr] : []);
      return true;
    };
    const base = { analysis: a, startS: s.start_s, t, c, floorPa };
    const direct = wavefrontRings({ ...base, gainPa, dz: p[2] - slice, maxRings });
    const visible = boxes.length ? (P) => !segmentBlocked(p, [P[0], P[1], slice], boxes) : null;
    for (const r of direct) if (style(r, '255,255,255', 1)) strokeRing(p[0], p[1], r.radius, visible, dpr);
    if (showRefl) {
      for (const img of reflectionsFor(s)) {
        // dz uses the image height: the ground image sits at -z_source, wall images at their mirrored heights.
        const rings = wavefrontRings({ ...base, gainPa: gainPa * img.gain, dz: img.image[2] - slice, maxRings: Math.round(maxRings / 2) });
        const ground = img.seq.length === 1 && img.seq[0].kind === 'ground';
        // An arc exists only where the specular reflection point lies on the finite face, height range included.
        const valid = (P) => !!traceReflection(p, [P[0], P[1], slice], img.seq, img.images, boxes);
        const tint = ground ? '150,150,150' : '200,200,200';
        for (const r of rings) if (style(r, tint, ground ? 0.7 : 0.85)) strokeRing(img.image[0], img.image[1], r.radius, valid, dpr);
      }
    }
    mctx.setLineDash([]);
  }
}

const snap = (v, q = 0.5) => Math.round(v / q) * q;
const note = (msg) => ($('statusLabel').textContent = msg);

// ---------- reach map and side view (same path finder as the render, energetic sum) ----------

let reachWorker = null;
let reach = null; // { key, grid, nx, ny, levelDb, snrDb, mask, maxLevel }
let reachStaleFlag = false;
let reachTimer = null;
const reachImages = new Map(); // key|mode -> canvas

let sectionLine = null; // { a: [x, y], b: [x, y] }
let sectionResult = null; // { key, grid, nx, ny, levelDb, snrDb, mask }
const sectionImages = new Map();

function reachExtent() {
  const xs = [];
  const ys = [];
  for (const n of scenario.nodes) {
    xs.push(n.position[0]);
    ys.push(n.position[1]);
  }
  for (const s of scenario.sources) {
    const p = sourcePosition(s);
    xs.push(p[0]);
    ys.push(p[1]);
  }
  for (const b of scenario.buildings) {
    const { min, max } = buildingBox(b);
    xs.push(min[0], max[0]);
    ys.push(min[1], max[1]);
  }
  if (!xs.length) return null;
  const pad = 15;
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

function reachGridSpec() {
  const ext = reachExtent();
  if (!ext) return null;
  let cell = Math.max(0.5, scenario.settings.reach_cell_m || 2);
  let nx = Math.ceil((ext.x1 - ext.x0) / cell);
  let ny = Math.ceil((ext.y1 - ext.y0) / cell);
  while (nx * ny > 250000) {
    cell *= 1.5;
    nx = Math.ceil((ext.x1 - ext.x0) / cell);
    ny = Math.ceil((ext.y1 - ext.y0) / cell);
  }
  return { kind: 'plan', x0: ext.x0, y0: ext.y0, cell, nx, ny, z: scenario.settings.slice_height_m };
}

async function reachSourceLevels() {
  for (const s of scenario.sources) await ensureClip(s.clip);
  const sel = selected?.type === 'source' ? selected.id : null;
  return scenario.sources
    .filter((s) => !sel || s.id === sel)
    .map((s) => ({ id: s.id, position: sourcePosition(s), bandPa2: [...sourceBandLevels(clips.get(s.clip), FS, s.level_1m_db, scenario.settings.localisation_band_hz)] }));
}

function reachWorkerInit() {
  if (reachWorker) return;
  reachWorker = new Worker(new URL('./renderWorker.js', import.meta.url), { type: 'module' });
  reachWorker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'reach_progress') {
      if (status !== 'rendering') {
        $('progress').hidden = false;
        $('progress').value = m.value;
      }
      return;
    }
    if (m.type === 'reach_done') {
      if (status !== 'rendering') $('progress').hidden = true;
      const rec = { key: m.key, grid: m.grid, nx: m.nx, ny: m.ny, levelDb: m.levelDb, snrDb: m.snrDb, mask: m.mask };
      if (m.grid.kind === 'section') {
        sectionResult = rec;
        sectionImages.clear();
      } else {
        reach = { ...rec, maxLevel: Math.max(...[...m.levelDb].filter(Number.isFinite), -119) };
        reachStaleFlag = false;
        reachImages.clear();
      }
      updateReachLabel();
    } else if (m.type === 'error') {
      if (status !== 'rendering') $('progress').hidden = true;
      note(`Reach map failed: ${m.message}`);
    }
  };
}

async function requestReach() {
  if (!$('showReach').checked || !scenario.sources.length || !scenario.nodes.length) return;
  const grid = reachGridSpec();
  if (!grid) return;
  let sourceLevels;
  try {
    sourceLevels = await reachSourceLevels();
  } catch (err) {
    return note(err.message);
  }
  const key = JSON.stringify({ grid, sourceLevels, settings: scenario.settings, buildings: scenario.buildings });
  if (reach && reach.key === key && !reachStaleFlag) return; // cache hit
  reachWorkerInit();
  reachStaleFlag = true;
  updateReachLabel('computing...');
  reachWorker.postMessage({ type: 'reach', scenario, grid, sourceLevels, key });
}

async function requestSection() {
  if (!sectionLine || !scenario.sources.length) return;
  const [ax, ay] = sectionLine.a;
  const [bx, by] = sectionLine.b;
  const L = Math.hypot(bx - ax, by - ay);
  if (L < 2) return;
  let sourceLevels;
  try {
    sourceLevels = await reachSourceLevels();
  } catch (err) {
    return note(err.message);
  }
  const top = Math.max(10, ...scenario.buildings.map((b) => b.size[2]), ...scenario.nodes.map((n) => n.position[2]), ...scenario.sources.map((s) => sourcePosition(s)[2])) * 1.3;
  const grid = { kind: 'section', a: [ax, ay], b: [bx, by], ns: Math.min(400, Math.max(20, Math.round(L / 1))), nz: Math.min(300, Math.max(20, Math.round(top / 0.5))), zmax: top };
  const key = JSON.stringify({ grid, sourceLevels, settings: scenario.settings, buildings: scenario.buildings });
  if (sectionResult && sectionResult.key === key) return;
  reachWorkerInit();
  $('sectionStatus').textContent = 'computing...';
  reachWorker.postMessage({ type: 'reach', scenario, grid, sourceLevels, key });
}

function reachStale() {
  if (reach) reachStaleFlag = true;
  if (sectionResult) sectionResult = { ...sectionResult, stale: true };
  clearTimeout(reachTimer);
  reachTimer = setTimeout(() => {
    requestReach();
    if (!$('sectionView').hidden) requestSection();
  }, 400);
}

function updateReachLabel(extra = '') {
  const el = $('reachLabel');
  const on = $('showReach').checked && reach;
  el.hidden = !on;
  if (!on) return;
  const order = scenario.settings.reach_reflection_order ?? 2;
  const dif = (scenario.settings.diffraction_order ?? 0) >= 1 ? 'diffraction order 1' : 'no diffraction (pessimistic)';
  const mode = $('reachMode').value === 'snr' ? 'SNR over noise' : 'level dB SPL';
  el.textContent = `Reach map: ${mode}, cell ${reach.grid.cell.toFixed(1)} m, order ${order}, ${dif}${reachStaleFlag ? ' — out of date' : ''}${extra ? ` ${extra}` : ''}`;
  if (reachStaleFlag) el.textContent += ' ';
}

// Greyscale image for a field grid, cached per key+mode. SNR: -10..30 dB. Level: (max-50)..max dB.
function fieldImage(rec, mode) {
  const key = `${rec.key}|${mode}`;
  let cv = reachImages.get(key) || sectionImages.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = rec.nx;
  cv.height = rec.ny;
  const g = cv.getContext('2d');
  const img = g.createImageData(rec.nx, rec.ny);
  const data = mode === 'snr' ? rec.snrDb : rec.levelDb;
  const lo = mode === 'snr' ? -10 : rec.maxLevel - 50;
  const span = mode === 'snr' ? 40 : 50;
  for (let iy = 0; iy < rec.ny; iy++) {
    for (let ix = 0; ix < rec.nx; ix++) {
      const i = iy * rec.nx + ix;
      if (rec.mask[i]) continue;
      const v = data[i];
      const g8 = Math.round(255 * Math.min(1, Math.max(0, (v - lo) / span)));
      // Plan grids run y-up; flip rows so north is up.
      const o = ((rec.ny - 1 - iy) * rec.nx + ix) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = g8;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  reachImages.set(key, cv);
  return cv;
}

// One accent contour at min_snr_db on the SNR grid (marching squares, linear crossing points).
function strokeContour(rec, toXY, threshold, ctx, dpr) {
  const { nx, ny, snrDb, mask } = rec;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  const val = (ix, iy) => (mask[iy * nx + ix] ? NaN : snrDb[iy * nx + ix]);
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const v = [val(ix, iy), val(ix + 1, iy), val(ix + 1, iy + 1), val(ix, iy + 1)];
      if (v.some(Number.isNaN)) continue;
      const inside = v.map((x) => x >= threshold);
      if (inside.every(Boolean) || inside.every((b) => !b)) continue;
      // Corner order: sw, se, ne, nw. Edges: 0 bottom, 1 right, 2 top, 3 left.
      const cross = [];
      const lerp = (a, b, va, vb) => a + ((threshold - va) / (vb - va)) * (b - a);
      if (inside[0] !== inside[1]) cross.push([lerp(ix, ix + 1, v[0], v[1]), iy]);
      if (inside[1] !== inside[2]) cross.push([ix + 1, lerp(iy, iy + 1, v[1], v[2])]);
      if (inside[2] !== inside[3]) cross.push([lerp(ix, ix + 1, v[3], v[2]), iy + 1]);
      if (inside[3] !== inside[0]) cross.push([ix, lerp(iy, iy + 1, v[0], v[3])]);
      for (let k = 0; k + 1 < cross.length; k += 2) {
        const [x0, y0] = toXY(cross[k][0], cross[k][1]);
        const [x1, y1] = toXY(cross[k + 1][0], cross[k + 1][1]);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
    }
  }
  ctx.stroke();
}

function drawReach(dpr) {
  if (!$('showReach').checked) {
    $('reachLabel').hidden = true;
    return;
  }
  if (!reach || !reach.levelDb) {
    updateReachLabel('computing...');
    return;
  }
  const g = reach.grid;
  const mode = $('reachMode').value;
  const img = fieldImage(reach, mode);
  const [sx0, sy0] = toScreen(g.x0, g.y0);
  const [sx1, sy1] = toScreen(g.x0 + g.nx * g.cell, g.y0 + g.ny * g.cell);
  mctx.globalAlpha = reachStaleFlag ? 0.2 : 0.55;
  mctx.imageSmoothingEnabled = true;
  mctx.drawImage(img, sx0, sy1, sx1 - sx0, sy0 - sy1);
  mctx.globalAlpha = 1;
  mctx.imageSmoothingEnabled = false;
  strokeContour(reach, (ix, iy) => toScreen(g.x0 + (ix + 0.5) * g.cell, g.y0 + (iy + 0.5) * g.cell), scenario.settings.min_snr_db, mctx, dpr);
  updateReachLabel();
}

// ---------- side view ----------

function openSection() {
  $('sectionView').hidden = false;
  requestSection();
}
$('sectionClose').addEventListener('click', () => ($('sectionView').hidden = true));

// Segment vs building rectangle (plan): [u0, u1] along the line, or null.
function lineBoxRange(a, b, box) {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 2; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-12) {
      if (a[i] < box.min[i] || a[i] > box.max[i]) return null;
      continue;
    }
    let ta = (box.min[i] - a[i]) / d;
    let tb = (box.max[i] - a[i]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0 < t1 ? [t0, t1] : null;
}

function drawSection() {
  const root = $('sectionView');
  if (root.hidden) return;
  const cv = $('sectionCanvas');
  const dpr = fit(cv);
  const W = cv.width;
  const H = cv.height;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.font = `${10 * dpr}px monospace`;
  if (!sectionLine) return;
  const [ax, ay] = sectionLine.a;
  const [bx, by] = sectionLine.b;
  const L = Math.hypot(bx - ax, by - ay);
  if (!sectionResult || !sectionResult.levelDb) {
    g.fillStyle = '#8a8a8a';
    g.fillText('Computing cross-section...', 16 * dpr, 30 * dpr);
    return;
  }
  const rec = sectionResult;
  const padL = 44 * dpr;
  const padB = 22 * dpr;
  const padT = 8 * dpr;
  const pw = W - padL - 10 * dpr;
  const ph = H - padT - padB;
  const X = (s) => padL + (s / L) * pw;
  const Y = (z) => padT + ph - (z / rec.grid.zmax) * ph;
  if (!rec.maxLevel) rec.maxLevel = Math.max(...[...rec.levelDb].filter(Number.isFinite), -119);
  const img = fieldImage(rec, 'level');
  g.globalAlpha = rec.stale ? 0.25 : 0.85;
  g.drawImage(img, padL, padT, pw, ph);
  g.globalAlpha = 1;
  strokeContour(rec, (ix, iy) => [X(((ix + 0.5) / rec.nx) * L), Y(((iy + 0.5) / rec.ny) * rec.grid.zmax)], scenario.settings.min_snr_db, g, dpr);
  // Buildings as rectangles where the line crosses them.
  g.fillStyle = 'rgba(60,60,60,0.95)';
  g.strokeStyle = '#fff';
  for (const b of scenario.buildings) {
    const r = lineBoxRange(sectionLine.a, sectionLine.b, buildingBox(b));
    if (!r) continue;
    g.fillRect(X(r[0] * L), Y(b.size[2]), (r[1] - r[0]) * L * (pw / L), Y(0) - Y(b.size[2]));
    g.strokeRect(X(r[0] * L), Y(b.size[2]), (r[1] - r[0]) * L * (pw / L), Y(0) - Y(b.size[2]));
  }
  // Node and source heights, projected when within 5 m of the line.
  const dir = [(bx - ax) / L, (by - ay) / L];
  const project = (p) => {
    const s = (p[0] - ax) * dir[0] + (p[1] - ay) * dir[1];
    const perp = Math.abs((p[0] - ax) * dir[1] - (p[1] - ay) * dir[0]);
    return s >= 0 && s <= L && perp <= 5 ? s : null;
  };
  g.strokeStyle = g.fillStyle = '#fff';
  for (const n of scenario.nodes) {
    const s = project(n.position);
    if (s === null) continue;
    g.strokeRect(X(s) - 3 * dpr, Y(n.position[2]) - 3 * dpr, 6 * dpr, 6 * dpr);
    g.fillText(n.id, X(s) + 5 * dpr, Y(n.position[2]));
  }
  g.fillStyle = ACCENT;
  for (const src of scenario.sources) {
    const p = sourcePosition(src);
    const s = project(p);
    if (s === null) continue;
    g.beginPath();
    g.arc(X(s), Y(p[2]), 3.5 * dpr, 0, 7);
    g.fill();
    g.fillText(src.id, X(s) + 6 * dpr, Y(p[2]));
  }
  // Axes.
  g.strokeStyle = '#444';
  g.strokeRect(padL, padT, pw, ph);
  g.fillStyle = '#888';
  const stepM = niceStep(L / 6);
  for (let s = 0; s <= L; s += stepM) {
    g.fillText(`${Math.round(s)}`, X(s) - 6 * dpr, H - 8 * dpr);
    g.strokeStyle = '#222';
    g.beginPath();
    g.moveTo(X(s), padT);
    g.lineTo(X(s), padT + ph);
    g.stroke();
  }
  const stepZ = niceStep(rec.grid.zmax / 4);
  for (let z = 0; z <= rec.grid.zmax; z += stepZ) g.fillText(`${Math.round(z)} m`, 4 * dpr, Y(z) + 3 * dpr);
  g.fillText('distance (m) / height (m)', padL + 4 * dpr, padT + 12 * dpr);
  $('sectionStatus').textContent = `${L.toFixed(0)} m line, levels are an energy sum (no interference)${rec.stale ? ' — out of date, recomputing...' : ''}`;
}

$('showReach').addEventListener('change', () => {
  reachImages.clear();
  if ($('showReach').checked) requestReach();
  else $('reachLabel').hidden = true;
});
$('reachMode').addEventListener('change', () => updateReachLabel());


const buildingCorners = (b) => {
  const { min, max } = buildingBox(b);
  return [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]]; // sw, se, ne, nw
};

function pickBuilding(sx, sy, dpr) {
  if (selected?.type === 'building') {
    const b = scenario.buildings.find((x) => x.id === selected.id);
    if (b) {
      const i = buildingCorners(b).findIndex(([x, y]) => Math.hypot(toScreen(x, y)[0] - sx, toScreen(x, y)[1] - sy) < 9 * dpr);
      if (i >= 0) return { type: 'building', id: b.id, corner: i };
    }
  }
  for (let i = scenario.buildings.length - 1; i >= 0; i--) {
    const { min, max } = buildingBox(scenario.buildings[i]);
    const [x0, y0] = toScreen(min[0], max[1]);
    const [x1, y1] = toScreen(max[0], min[1]);
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return { type: 'building', id: scenario.buildings[i].id };
  }
  return null;
}

function pick(sx, sy) {
  const dpr = window.devicePixelRatio || 1;
  const near = (p) => Math.hypot(toScreen(p[0], p[1])[0] - sx, toScreen(p[0], p[1])[1] - sy) < 12 * dpr;
  for (const s of scenario.sources) if (near(sourcePosition(s))) return { type: 'source', id: s.id };
  for (const n of scenario.nodes) if (!hiddenNodes.has(n.id) && near(n.position)) return { type: 'node', id: n.id };
  return pickBuilding(sx, sy, dpr);
}

const collections = () => ({ node: scenario.nodes, source: scenario.sources, building: scenario.buildings });
const find = (sel) => collections()[sel.type].find((o) => o.id === sel.id);
let drag = null;

// Applies a building change only if no node or source would end up inside it.
function applyBuilding(b, candidate) {
  const list = scenario.buildings.map((x) => (x === b ? candidate : x));
  if (placementErrors({ ...scenario, buildings: list }).length) return false;
  Object.assign(b, candidate);
  markEdited();
  return true;
}

const pointerWorld = (e) => {
  const dpr = window.devicePixelRatio || 1;
  const r = map.getBoundingClientRect();
  const sx = (e.clientX - r.left) * dpr;
  const sy = (e.clientY - r.top) * dpr;
  return { sx, sy, w: toWorld(sx, sy) };
};

map.addEventListener('pointerdown', (e) => {
  const { sx, sy, w: [wx, wy] } = pointerWorld(e);
  const px = Math.round(wx * 10) / 10;
  const py = Math.round(wy * 10) / 10;
  if (tool === 'node') {
    if (insideBuilding([px, py, 5], scenario.buildings)) return note('A node cannot be placed inside a building.');
    scenario.nodes.push(newNode(`n${counter++}`, px, py));
    selected = { type: 'node', id: scenario.nodes.at(-1).id };
    selected2 = pathFocus = null;
    return markEdited();
  }
  if (tool === 'source') {
    if (insideBuilding([px, py, 1.5], scenario.buildings)) return note('A source cannot be placed inside a building.');
    return openClipPicker(px, py);
  }
  if (tool === 'building') {
    drag = { kind: 'bnew', x0: snap(wx), y0: snap(wy), x1: snap(wx), y1: snap(wy) };
    map.setPointerCapture(e.pointerId);
    return;
  }
  if (tool === 'section') {
    drag = { kind: 'section', x0: wx, y0: wy };
    sectionLine = { a: [wx, wy], b: [wx, wy] };
    map.setPointerCapture(e.pointerId);
    return;
  }
  const hit = pick(sx, sy);
  if (e.shiftKey && hit && hit.type !== 'building' && selected && selected.type !== 'building' && selected.type !== hit.type) {
    selected2 = hit;
    pathFocus = null;
    return renderInspector();
  }
  selected2 = pathFocus = null;
  selected = hit ? { type: hit.type, id: hit.id } : null;
  if (!hit) drag = { kind: 'pan', sx, sy, cx: view.cx, cy: view.cy };
  else if (hit.type !== 'building') drag = { kind: 'obj' };
  else if (hit.corner !== undefined) {
    const b = find(selected);
    drag = { kind: 'bresize', fixed: buildingCorners(b)[(hit.corner + 2) % 4] };
  } else {
    const b = find(selected);
    drag = { kind: 'bmove', dx: wx - b.position[0], dy: wy - b.position[1] };
  }
  map.setPointerCapture(e.pointerId);
  renderInspector();
});
map.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const { sx, sy, w: [wx, wy] } = pointerWorld(e);
  if (drag.kind === 'bnew') {
    drag.x1 = snap(wx);
    drag.y1 = snap(wy);
  } else if (drag.kind === 'section') {
    sectionLine = { a: [drag.x0, drag.y0], b: [wx, wy] };
  } else if (drag.kind === 'pan') {
    view.cx = drag.cx - (sx - drag.sx) / view.scale;
    view.cy = drag.cy + (sy - drag.sy) / view.scale;
  } else if (drag.kind === 'bmove') {
    const b = find(selected);
    applyBuilding(b, { ...b, position: [snap(wx - drag.dx), snap(wy - drag.dy)] });
  } else if (drag.kind === 'bresize') {
    const b = find(selected);
    const [fx, fy] = drag.fixed;
    const w = Math.max(1, Math.abs(snap(wx) - fx));
    const d = Math.max(1, Math.abs(snap(wy) - fy));
    const cx = fx + (snap(wx) >= fx ? w / 2 : -w / 2);
    const cy = fy + (snap(wy) >= fy ? d / 2 : -d / 2);
    applyBuilding(b, { ...b, position: [cx, cy], size: [w, d, b.size[2]] });
  } else if (selected) {
    const o = find(selected);
    const pos = selected.type === 'node' ? o.position : sourcePosition(o);
    const nx = Math.round(wx * 10) / 10;
    const ny = Math.round(wy * 10) / 10;
    if (insideBuilding([nx, ny, pos[2]], scenario.buildings)) return;
    pos[0] = nx;
    pos[1] = ny;
    markEdited();
  }
});
map.addEventListener('pointerup', () => {
  if (drag?.kind === 'section') {
    const [ax, ay] = sectionLine.a;
    const [bx, by] = sectionLine.b;
    if (Math.hypot(bx - ax, by - ay) >= 3) openSection();
    else sectionLine = null;
  }
  if (drag?.kind === 'bnew') {
    const w = Math.abs(drag.x1 - drag.x0);
    const d = Math.abs(drag.y1 - drag.y0);
    if (w >= 2 && d >= 2) {
      const nb = newBuilding(`b${counter++}`, (drag.x0 + drag.x1) / 2, (drag.y0 + drag.y1) / 2, w, d);
      if (placementErrors({ ...scenario, buildings: [...scenario.buildings, nb] }).length) note('A building cannot cover a node or source.');
      else {
        scenario.buildings.push(nb);
        selected = { type: 'building', id: nb.id };
        markEdited();
      }
    }
  }
  drag = null;
});
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
  i.addEventListener('change', () => {
    onSet(Number(i.value));
    const bad = placementErrors(scenario);
    if (bad.length) {
      onSet(value);
      note(`Rejected: ${bad[0]}`);
      return renderInspector();
    }
    markEdited();
  });
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
  if (!o || selected.type !== 'node') autoOpened = null;
  updateHint();
  renderNodeToggles();
  if (!o) return;
  const h = (text) => Object.assign(document.createElement('h3'), { textContent: text });
  if (selected.type === 'building') {
    el.append(h(`Building ${o.id}`));
    el.append(
      numField('x (m)', o.position[0], (v) => (o.position[0] = v)),
      numField('y (m)', o.position[1], (v) => (o.position[1] = v)),
      numField('width (m)', o.size[0], (v) => (o.size[0] = Math.max(1, v))),
      numField('depth (m)', o.size[1], (v) => (o.size[1] = Math.max(1, v))),
      numField('height (m)', o.size[2], (v) => (o.size[2] = Math.max(1, v)))
    );
    el.append(Object.assign(document.createElement('div'), { className: 'muted', textContent: 'Concrete, absorption 0.03 (placeholder).' }));
    el.append(removeButton());
    return;
  }
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
    if (rn) {
      const mv = Object.assign(document.createElement('button'), { className: 'remove', textContent: "Mic's-eye view" });
      mv.addEventListener('click', () => micView.open(o.id));
      el.append(mv);
      if (autoOpened !== o.id) {
        autoOpened = o.id;
        micView.open(o.id);
      }
      el.append(nodeResultPanel(rn));
    }
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
    const flags = [
      n.azimuth_error_deg > b?.uncertainty_deg ? 'wrong' : '',
      n.overlapped_with?.length ? `overlap ${n.overlapped_with.join(',')}` : '',
      n.uncertainty_valid === false ? '\u00b1 invalid' : '',
      n.reliable === false ? n.localisation_status : '',
      n.direct_blocked ? 'direct blocked' : ''
    ].filter(Boolean).join(', ');
    const focus = pathFocus?.nodeId === n.node_id && pathFocus?.sourceId === r.source_id ? ' class="focus"' : '';
    return `<tr data-node="${n.node_id}"${focus}><td>${n.node_id}</td><td>${f(n.range_m, 0)}</td><td>${f(n.snr_db)}</td><td>${n.heard ? 'yes' : 'no'}</td><td>${f(b?.uncertainty_deg, 0)}</td><td>${f(n.azimuth_error_deg)}</td><td>${n.picked_path_type ?? '-'}</td><td>${flags}</td></tr>`;
  });
  const positionText = r.fix?.position
    ? r.fix.position.map((v) => v.toFixed(1)).join(', ')
    : r.heard_nodes === 0
      ? 'not heard by any node'
      : r.heard_nodes === 1
        ? 'heard by one node: direction only'
        : 'poorly conditioned (directions nearly parallel)';
  box.innerHTML = `<h3>Result</h3>
    <table><tr><th>node</th><th>m</th><th>SNR dB</th><th>used</th><th>\u00b1\u00b0</th><th>az err \u00b0</th><th>path</th><th></th></tr>${rows.join('')}</table>
    <p class="muted">Click a row to draw that node's paths on the map.</p>
    <p>Position: <span class="accent">${positionText}</span>${r.fix?.fix_suspect ? ' <b>(suspect: a contributing node picked a reflection or has its direct path blocked)</b>' : ''}<br>
    Error: ${f(r.error_horizontal_m, 2)} m horizontal, ${f(r.error_3d_m, 2)} m 3D<br>
    Ray angle: ${f(r.fix?.max_angle_deg, 0)}\u00b0</p>`;
  for (const tr of box.querySelectorAll('tr[data-node]')) {
    tr.addEventListener('click', () => {
      pathFocus = { nodeId: tr.dataset.node, sourceId: r.source_id };
      renderInspector();
    });
  }
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
  $('sweepOut').innerHTML = `<table><tr><th>${param || 'repeat'}</th><th>trials</th><th>fix rate</th><th>reflection picked</th><th>err med m</th><th>err p90 m</th><th>bearing med \u00b0</th><th>bearing p90 \u00b0</th></tr>${rows
    .map((r) => `<tr><td>${r.value ?? '-'}</td><td>${r.trials}</td><td>${f(r.fix_rate)}</td><td>${f(r.picked_not_direct_rate)}</td><td>${f(r.error_3d_median_m)}</td><td>${f(r.error_3d_p90_m)}</td><td>${f(r.bearing_median_deg)}</td><td>${f(r.bearing_p90_deg)}</td></tr>`)
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
  micView.draw();
  drawMap();
  drawTimeline();
  drawSection();
  requestAnimationFrame(frame);
}

init();
