import { sourcePosition } from '../core/scenario.js';
import { sectionBuildings } from '../core/field.js';

export function createReachView({ $, getScenario, getClips, ensureClip, getBounds, getSelected, accent }) {
  let worker = null;
  let revision = 0;
  let serial = 0;
  let active = null;
  let grid = null;
  let section = null;
  let line = null;
  let stale = true;
  let sourceSignature = '';
  let sectionSignature = '';
  const cache = new Map();
  const images = new WeakMap();
  const contours = new WeakMap();
  const pending = new Map();

  function label() {
    const settings = getScenario().settings;
    return `Reach map · ${settings.diffraction_order === 1 ? 'first-order diffraction' : 'no diffraction (pessimistic)'} · ${stale ? 'STALE — recompute' : 'energy sum, no interference'}`;
  }

  function invalidate() {
    revision++;
    stale = true;
    active = null;
    worker?.terminate();
    worker = null;
    for (const request of pending.values()) request.reject(new Error('Scene edited; field calculation cancelled'));
    pending.clear();
    $('reachProgress').hidden = true;
    $('reachStatus').textContent = label();
    $('sideStatus').textContent = label();
    refreshSources();
  }

  function refreshSources() {
    const sources = getScenario().sources;
    const signature = sources.map((s) => `${s.id}:${s.clip}`).join('|');
    if (signature === sourceSignature) return;
    sourceSignature = signature;
    const control = $('reachSource');
    const previous = control.value;
    control.replaceChildren();
    for (const [value, text] of [['', 'All sources'], ['selected', 'Selected source'], ...sources.map((s) => [s.id, s.id])]) {
      control.append(Object.assign(document.createElement('option'), { value, textContent: text }));
    }
    control.value = [...control.options].some((o) => o.value === previous) ? previous : '';
  }

  function request(type, snapshot, clips, options, key) {
    worker ??= new Worker(new URL('../fieldWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const waiting = pending.get(data.id);
      if (!waiting) return;
      if (data.type === 'progress') {
        $('reachProgress').value = data.progress;
      } else {
        pending.delete(data.id);
        if (data.type === 'error') waiting.reject(new Error(data.error));
        else waiting.resolve(data.result);
      }
    };
    worker.onerror = (event) => {
      for (const waiting of pending.values()) waiting.reject(new Error(event.message || 'Field worker failed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, scenario: snapshot, clips, options, cacheKey: key });
    });
  }

  async function compute() {
    const token = {};
    active = token;
    const version = revision;
    try {
      const snapshot = structuredClone(getScenario());
      if (!snapshot.sources.length) throw new Error('Add a source before computing the reach map');
      const choice = $('reachSource').value;
      const selected = getSelected();
      const sourceId = choice === 'selected' ? (selected?.type === 'source' ? selected.id : null) : choice || null;
      if (choice === 'selected' && !sourceId) throw new Error('Select a source on the map first');
      for (const source of snapshot.sources) await ensureClip(source.clip);
      if (active !== token || version !== revision) return;
      const clips = [...getClips()].filter(([id]) => snapshot.sources.some((source) => source.clip === id));
      const b = getBounds();
      const bounds = [b.minX, b.minY, b.maxX, b.maxY];
      const sectionLine = line && structuredClone(line);
      const zMax = Number($('sectionHeight').value);
      const key = JSON.stringify([version, snapshot, bounds, sourceId, sectionLine, zMax]);
      $('reachProgress').hidden = false;
      $('reachStatus').textContent = 'Computing reach field…';
      let result = cache.get(key);
      if (!result) {
        const nextGrid = await request('grid', snapshot, clips, { bounds, sourceId }, String(version));
        if (active !== token || version !== revision) return;
        const nextSection = sectionLine ? await request('section', snapshot, clips, { start: sectionLine.a, end: sectionLine.b, zMax, sourceId }, String(version)) : null;
        result = { grid: nextGrid, section: nextSection, scenario: snapshot, line: sectionLine };
        if (cache.size >= 4) cache.clear();
        cache.set(key, result);
      }
      if (active !== token || version !== revision) return;
      grid = result.grid;
      section = result.section && { ...result.section, scenario: result.scenario };
      stale = false;
      $('showReach').checked = true;
      $('sideView').hidden = !section;
      $('reachStatus').textContent = `${label()} · ${grid.width}×${grid.height}, ${grid.cellSizeM} m${grid.capped_points ? ` · WARNING: path cap at ${grid.capped_points} cells` : ''}`;
      $('sideStatus').textContent = `${label()} · distance (m) × height (m)`;
    } catch (error) {
      if (active === token) $('reachStatus').textContent = `Reach calculation failed: ${error.message}`;
    } finally {
      if (active === token) {
        active = null;
        $('reachProgress').hidden = true;
      }
    }
  }

  function raster(result) {
    const mode = $('reachMode').value;
    let pair = images.get(result);
    if (!pair) { pair = {}; images.set(result, pair); }
    if (pair[mode]) return pair[mode];
    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(result.width, result.height);
    const values = mode === 'level' ? result.total_db_spl : result.snr_db;
    for (let i = 0; i < values.length; i++) {
      if (result.mask[i] || Number.isNaN(values[i])) continue;
      const v = Math.round(255 * Math.max(0, Math.min(1, values[i] / (mode === 'level' ? 100 : 50))));
      image.data.set([v, v, v, 190], 4 * i);
    }
    context.putImageData(image, 0, 0);
    pair[mode] = canvas;
    return canvas;
  }

  function contour(ctx, result, pointAt) {
    const threshold = getScenario().settings.min_snr_db;
    const cached = contours.get(result);
    if (cached?.threshold === threshold) {
      ctx.strokeStyle = accent;
      ctx.beginPath();
      for (const [a, b] of cached.segments) {
        ctx.moveTo(...pointAt(...a));
        ctx.lineTo(...pointAt(...b));
      }
      ctx.stroke();
      return;
    }
    const segments = [];
    ctx.strokeStyle = accent;
    ctx.beginPath();
    for (let y = 0; y < result.height - 1; y++) for (let x = 0; x < result.width - 1; x++) {
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      const ids = corners.map(([cx, cy]) => cy * result.width + cx);
      if (ids.some((i) => result.mask[i] || !Number.isFinite(result.snr_db[i]))) continue;
      const crossings = [];
      for (let k = 0; k < 4; k++) {
        const next = (k + 1) % 4;
        const a = result.snr_db[ids[k]] - threshold;
        const b = result.snr_db[ids[next]] - threshold;
        if ((a >= 0) === (b >= 0)) continue;
        const t = a / (a - b);
        crossings.push([corners[k][0] + t * (corners[next][0] - corners[k][0]), corners[k][1] + t * (corners[next][1] - corners[k][1])]);
      }
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        segments.push([crossings[k], crossings[k + 1]]);
        ctx.moveTo(...pointAt(...crossings[k]));
        ctx.lineTo(...pointAt(...crossings[k + 1]));
      }
    }
    ctx.stroke();
    contours.set(result, { threshold, segments });
  }

  function drawSection(dpr) {
    if (!section || $('sideView').hidden) return;
    const canvas = $('sideCanvas');
    const rect = canvas.getBoundingClientRect();
    const signature = JSON.stringify([section.start, section.end, section.zMax, section.width, section.height, revision, stale, rect.width, rect.height, dpr, $('reachMode').value]);
    if (sectionSignature === signature) return;
    sectionSignature = signature;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    const left = 42 * dpr, top = 12 * dpr;
    const w = canvas.width - left - 14 * dpr, h = canvas.height - top - 30 * dpr;
    const px = (distance) => left + distance / section.length_m * w;
    const py = (height) => top + h - height / section.zMax * h;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = stale ? 0.35 : 1;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, w, h);
    ctx.clip();
    ctx.translate(left, top + h);
    ctx.scale(1, -1);
    ctx.drawImage(raster(section), 0, 0, section.width * section.cellSizeM / section.length_m * w, section.height * section.cellSizeM / section.zMax * h);
    ctx.restore();
    ctx.lineWidth = dpr;
    contour(ctx, section, (x, y) => [px(Math.min((x + 0.5) * section.cellSizeM, section.length_m)), py(Math.min((y + 0.5) * section.cellSizeM, section.zMax))]);
    ctx.fillStyle = '#555';
    ctx.strokeStyle = '#fff';
    ctx.font = `${10 * dpr}px monospace`;
    for (const building of sectionBuildings(section.scenario.buildings, section.start, section.end)) {
      const roof = Math.min(section.zMax, building.height_m);
      ctx.fillRect(px(building.start_m), py(roof), px(building.end_m) - px(building.start_m), py(0) - py(roof));
      ctx.strokeRect(px(building.start_m), py(roof), px(building.end_m) - px(building.start_m), py(0) - py(roof));
    }
    const dx = section.end[0] - section.start[0], dy = section.end[1] - section.start[1];
    const mark = (id, p, source) => {
      const distance = ((p[0] - section.start[0]) * dx + (p[1] - section.start[1]) * dy) / section.length_m;
      if (distance < 0 || distance > section.length_m || p[2] > section.zMax) return;
      const offset = Math.abs((p[0] - section.start[0]) * dy - (p[1] - section.start[1]) * dx) / section.length_m;
      ctx.fillStyle = source ? accent : '#fff';
      ctx.fillRect(px(distance) - 3 * dpr, py(p[2]) - 3 * dpr, 6 * dpr, 6 * dpr);
      ctx.fillText(`${id} z=${p[2]}m (${offset.toFixed(1)}m off line)`, px(distance) + 5 * dpr, py(p[2]) - 5 * dpr);
    };
    for (const node of section.scenario.nodes) mark(node.id, node.position, false);
    for (const source of section.scenario.sources) mark(source.id, sourcePosition(source), true);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.fillText('0 m', left, canvas.height - 8 * dpr);
    ctx.fillText(`${section.length_m.toFixed(1)} m`, canvas.width - 70 * dpr, canvas.height - 8 * dpr);
    ctx.fillText(`${section.zMax} m`, 0, top + 9 * dpr);
    ctx.fillText('0 m', 0, top + h);
  }

  function drawMap(ctx, toScreen, scale, dpr) {
    refreshSources();
    if (grid && $('showReach').checked) {
      const [x, y] = toScreen(grid.bounds[0], grid.bounds[1]);
      const [right, top] = toScreen(grid.bounds[2], grid.bounds[3]);
      ctx.globalAlpha = stale ? 0.3 : 1;
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, top, right - x, y - top);
      ctx.clip();
      ctx.translate(x, y);
      ctx.scale(1, -1);
      ctx.drawImage(raster(grid), 0, 0, grid.width * grid.cellSizeM * scale, grid.height * grid.cellSizeM * scale);
      ctx.restore();
      ctx.lineWidth = 1.5 * dpr;
      contour(ctx, grid, (col, row) => toScreen(grid.bounds[0] + (col + 0.5) * grid.cellSizeM, grid.bounds[1] + (row + 0.5) * grid.cellSizeM));
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillRect(8 * dpr, 8 * dpr, Math.min(ctx.canvas.width - 16 * dpr, 680 * dpr), 42 * dpr);
      ctx.fillStyle = '#fff';
      ctx.font = `${11 * dpr}px monospace`;
      ctx.fillText(label(), 14 * dpr, 24 * dpr);
      ctx.fillText(`${$('reachMode').value === 'level' ? 'Black 0 → white 100 dB SPL' : 'Black 0 → white 50 dB SNR'}; amber = ${getScenario().settings.min_snr_db} dB SNR`, 14 * dpr, 40 * dpr);
    }
    if (line) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(...toScreen(...line.a));
      ctx.lineTo(...toScreen(...line.b));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawSection(dpr);
  }

  $('reachCompute').addEventListener('click', compute);
  $('showReach').addEventListener('change', () => { if ($('showReach').checked && !grid) compute(); });
  $('reachSource').addEventListener('change', invalidate);
  $('sectionHeight').addEventListener('change', invalidate);
  $('sideClose').addEventListener('click', () => { $('sideView').hidden = true; });
  return {
    invalidate, compute, drawMap, refreshSources,
    startLine(point) { line = { a: point, b: point }; invalidate(); },
    endLine(point) { line.b = point; stale = true; }
  };
}
