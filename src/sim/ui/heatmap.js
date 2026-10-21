// Heatmap controller: height-sliced time-resolved field (pulse / peak-hold / level) drawn under the map.
// Depends only on the scenario, the clips and findPaths (in the worker), never on Create. Recomputes itself (debounced, coarse then fine).
import { FIELD_BANDS, FIELD_FRAME_S, estimateFieldBytes, peakHoldPower, powerToDb, pulsePower } from '../core/field.js';

export const HEATMAP_MODES = ['pulse', 'peak', 'level'];
const BAND_LABEL = { 0: '250 Hz', 1: '1 kHz', 2: '4 kHz', 3: 'localisation band' };
const BAND_IDX = { low: 0, mid: 1, high: 2, loc: 3 };
const COARSE_CELL_M = 4;
const MAX_CACHED_HEIGHTS = 6;
const MAX_DRAW_CELLS = 60000;
const DEBOUNCE_MS = 300;
const DB_SPAN = 60;
const DB_STEP = 5;

// Google's polynomial approximation of the turbo colormap (perceptually even rainbow), x in 0..1.
export function turbo(x) {
  const v = Math.min(1, Math.max(0, x));
  const r = 0.13572138 + v * (4.6153926 + v * (-42.66032258 + v * (132.13108234 + v * (-152.94239396 + v * 59.28637943))));
  const g = 0.09140261 + v * (2.19418839 + v * (4.84296658 + v * (-14.18503333 + v * (4.27729857 + v * 2.82956604))));
  const b = 0.1066733 + v * (12.64194608 + v * (-60.58204836 + v * (110.36276771 + v * (-89.90310912 + v * 27.34824973))));
  return [r, g, b].map((c) => Math.round(255 * Math.min(1, Math.max(0, c))));
}

export function createHeatmap(host) {
  let worker = null;
  let timer = null;
  let jobId = 0;
  const cache = new Map(); // height key -> field record
  let current = null; // record shown
  let computing = null; // text for the indicator
  let pendingPeak = null; // { key, band, frame, power }
  const images = new Map();

  const settingsKey = () => {
    const s = host.getScenario();
    const src = host.sourceFilter();
    return JSON.stringify({ b: s.buildings, n: s.sources.map((x) => [x.clip, x.keyframes, x.level_1m_db, x.start_s]), st: s.settings, src });
  };
  const hKey = (z, cell, base) => `${base}|${z}|${cell}`;

  function gridFor(cell, z) {
    const ext = host.extent();
    if (!ext) return null;
    let c = cell;
    let nx = Math.ceil((ext.x1 - ext.x0) / c);
    let ny = Math.ceil((ext.y1 - ext.y0) / c);
    while (nx * ny > MAX_DRAW_CELLS) {
      c *= 1.25;
      nx = Math.ceil((ext.x1 - ext.x0) / c);
      ny = Math.ceil((ext.y1 - ext.y0) / c);
    }
    return { kind: 'plan', x0: ext.x0, y0: ext.y0, cell: c, nx, ny, z };
  }

  function init() {
    if (worker) return;
    worker = new Worker(new URL('../renderWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'field_error') {
        computing = null;
        host.note(`Heatmap failed: ${m.message}`);
        return;
      }
      if (m.type !== 'field_done' || m.job !== jobId) return;
      const rec = { ...m.rec, key: m.key, z: m.z, base: m.base };
      cache.set(hKey(m.z, m.cell, m.base), rec);
      while (cache.size > MAX_CACHED_HEIGHTS * 2) cache.delete(cache.keys().next().value);
      if (m.z === host.height()) {
        current = rec;
        images.clear();
        pendingPeak = null;
      }
      computing = m.fine ? null : 'refining...';
      host.redraw();
    };
  }

  async function request(z, { fine = true } = {}) {
    const scn = host.getScenario();
    if (!host.enabled() || !scn.sources.length) return;
    const clips = await host.loadClips();
    const base = settingsKey();
    const grid = gridFor(fine ? Math.max(0.5, scn.settings.reach_cell_m || 2) : COARSE_CELL_M, z);
    if (!grid) return;
    const hit = cache.get(hKey(z, grid.cell, base));
    if (hit) {
      current = hit;
      images.clear();
      host.redraw();
      return;
    }
    init();
    computing = fine ? 'computing...' : 'preview...';
    worker.postMessage({ type: 'field', job: jobId, scenario: scn, clips: [...clips], grid, z, cell: grid.cell, fine, base, sourceFilter: host.sourceFilter(), key: `${base}|${z}` });
    host.redraw();
  }

  // Coarse preview first, then the configured cell size. A new request terminates the worker, which cancels any superseded job.
  function schedule(delay = DEBOUNCE_MS) {
    clearTimeout(timer);
    cache.clear();
    images.clear();
    pendingPeak = null;
    timer = setTimeout(async () => {
      if (!host.enabled()) return;
      if (worker) {
        worker.terminate();
        worker = null;
      }
      jobId++;
      const z = host.height();
      await request(z, { fine: false });
      await request(z, { fine: true });
    }, delay);
  }

  function onHeightInput(z) {
    // While dragging show the nearest cached height; the exact one is computed on release.
    let best = null;
    for (const rec of cache.values()) if (!best || Math.abs(rec.z - z) < Math.abs(best.z - z)) best = rec;
    if (best) {
      current = best;
      images.clear();
      pendingPeak = null;
    }
  }
  function onHeightCommit(z) {
    clearTimeout(timer);
    jobId++;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    request(z, { fine: false }).then(() => request(z, { fine: true }));
  }

  const bandIdx = () => BAND_IDX[host.band()];

  // Estimated loudest level in the band (dB SPL) so the colour scale is fixed across frames.
  function scaleTop(rec, band) {
    if (rec._top?.[band] !== undefined) return rec._top[band];
    let top = 0;
    rec.perSource.forEach((s, si) => {
      const env = rec.envelopes[si].bands[band];
      let envMax = 0;
      for (const v of env) envMax = Math.max(envMax, v);
      const g2 = s.gainPa * s.gainPa;
      for (let i = 0; i < s.count.length; i++) {
        if (rec.mask[i] || !s.count[i]) continue;
        let a = 0;
        for (let k = 0; k < s.count[i]; k++) a += s.amp2[(i * rec.topN + k) * 4 + band];
        top = Math.max(top, g2 * a * envMax);
      }
    });
    rec._top = rec._top || {};
    rec._top[band] = top > 0 ? 10 * Math.log10(top / (20e-6 * 20e-6)) : 0;
    return rec._top[band];
  }

  function levelPower(rec, band, peak) {
    if (peak) return peakAt(rec, band, Infinity);
    const out = new Float64Array(rec.nx * rec.ny);
    rec.perSource.forEach((s, si) => {
      const env = rec.envelopes[si].bands[band];
      let mean = 0;
      for (const v of env) mean += v;
      mean /= Math.max(1, env.length);
      const g2 = s.gainPa * s.gainPa;
      for (let i = 0; i < out.length; i++) {
        let a = 0;
        for (let k = 0; k < s.count[i]; k++) a += s.amp2[(i * rec.topN + k) * 4 + band];
        out[i] += g2 * a * mean;
      }
    });
    return out;
  }

  // Peak-hold up to time t, computed incrementally frame by frame and restarted on any seek backwards.
  function peakAt(rec, band, t) {
    const end = rec.perSource.reduce((m, s, si) => Math.max(m, s.start_s + (rec.envelopes[si].bands[0].length * FIELD_FRAME_S) + 2), 0);
    const tt = Math.min(t, end);
    const frame = Math.floor(tt / FIELD_FRAME_S);
    if (!pendingPeak || pendingPeak.key !== rec.key || pendingPeak.band !== band || frame < pendingPeak.frame) {
      pendingPeak = { key: rec.key, band, frame: -1, power: new Float64Array(rec.nx * rec.ny), cur: new Float64Array(rec.nx * rec.ny) };
    }
    const p = pendingPeak;
    if (frame - p.frame > 400) {
      p.power = peakHoldPower(rec, rec.envelopes, band, tt);
      p.frame = frame;
      return p.power;
    }
    for (let f = p.frame + 1; f <= frame; f++) {
      pulsePower(rec, rec.envelopes, band, f * FIELD_FRAME_S, p.cur);
      for (let i = 0; i < p.power.length; i++) if (p.cur[i] > p.power[i]) p.power[i] = p.cur[i];
    }
    p.frame = frame;
    return p.power;
  }

  function colourise(rec, dbValues, hi, alpha) {
    const cv = document.createElement('canvas');
    cv.width = rec.nx;
    cv.height = rec.ny;
    const g = cv.getContext('2d');
    const img = g.createImageData(rec.nx, rec.ny);
    const lo = hi - DB_SPAN;
    for (let iy = 0; iy < rec.ny; iy++) {
      for (let ix = 0; ix < rec.nx; ix++) {
        const i = iy * rec.nx + ix;
        const v = dbValues[i];
        if (rec.mask[i] || !(v >= lo)) continue;
        const [r, gg, b] = turbo((v - lo) / DB_SPAN);
        const o = ((rec.ny - 1 - iy) * rec.nx + ix) * 4;
        img.data[o] = r;
        img.data[o + 1] = gg;
        img.data[o + 2] = b;
        img.data[o + 3] = alpha;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  /** Draws the map under the buildings. Returns nothing; shows the indicator through host.label. */
  function draw(ctx, dpr) {
    if (!host.enabled()) return host.label('');
    if (!current) return host.label(computing ? `Heatmap ${computing}` : 'Heatmap: waiting');
    const rec = current;
    const band = bandIdx();
    const mode = host.mode();
    const noise = host.showAboveNoise() && band === 3 && rec.noisePa2 ? rec.noisePa2 : null;
    const conv = (pw) => powerToDb(pw, rec.mask, noise);
    const top = noise ? scaleTop(rec, band) - 10 * Math.log10(noise / (20e-6 * 20e-6)) : scaleTop(rec, band);
    const hi = Math.ceil(top / DB_STEP) * DB_STEP;
    const t = host.time();
    const layers = [];
    // Faint level backdrop so the map never looks empty before the first arrival (Pulse only).
    if (mode === 'pulse') layers.push([colourise(rec, conv(levelPower(rec, band, false)), hi, Math.round(255 * host.backdrop())), 1]);
    let main;
    if (mode === 'pulse') main = pulsePower(rec, rec.envelopes, band, t);
    else if (mode === 'peak') main = peakAt(rec, band, t);
    else main = levelPower(rec, band, host.levelPeak());
    const mainDb = conv(main);
    layers.push([colourise(rec, mainDb, hi, 235), 1]);
    const g = rec.grid;
    const [sx0, sy0] = host.toScreen(g.x0, g.y0);
    const [sx1, sy1] = host.toScreen(g.x0 + g.nx * g.cell, g.y0 + g.ny * g.cell);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const [cv] of layers) ctx.drawImage(cv, sx0, sy1, sx1 - sx0, sy0 - sy1);
    if (noise) host.contour({ nx: rec.nx, ny: rec.ny, snrDb: mainDb, mask: rec.mask }, (ix, iy) => host.toScreen(g.x0 + (ix + 0.5) * g.cell, g.y0 + (iy + 0.5) * g.cell), host.minSnr());
    drawLegend(ctx, dpr, hi, noise !== null);
    const warn = rec.coarsened ? ` — cells coarsened to ${g.cell.toFixed(1)} m to fit ${(rec.budget / 1048576).toFixed(0)} MB` : '';
    host.label(`Heatmap ${mode}, ${BAND_LABEL[band]}, z = ${rec.z.toFixed(1)} m${rec.z !== host.height() ? ` (cached, showing ${rec.z.toFixed(1)} m)` : ''}, cell ${g.cell.toFixed(1)} m, ${computing ? computing : 'incoherent sum'}${warn}`);
  }

  function drawLegend(ctx, dpr, hi, aboveNoise) {
    const x = 12 * dpr;
    const h = 12 * dpr;
    const bands = DB_SPAN / DB_STEP;
    const y0 = 40 * dpr;
    ctx.font = `${10 * dpr}px monospace`;
    const gradient = ctx.createLinearGradient(x, y0 + bands * h, x, y0);
    for (let i = 0; i <= DB_SPAN; i++) {
      const [r, g, b] = turbo(i / DB_SPAN);
      gradient.addColorStop(i / DB_SPAN, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y0, 14 * dpr, bands * h);
    for (let i = 0; i < bands; i++) {
      const v = hi - DB_SPAN + i * DB_STEP;
      if (i % 2 === 0) {
        ctx.fillStyle = '#fff';
        const y = y0 + (bands - i) * h;
        ctx.fillText(`${v}`, x + 18 * dpr, y + 3 * dpr);
      }
    }
    ctx.fillStyle = '#fff';
    ctx.fillText(aboveNoise ? 'dB above noise' : 'dB SPL', x, y0 - 4 * dpr);
  }

  return { draw, schedule, onHeightInput, onHeightCommit, estimateFieldBytes, FIELD_BANDS, isComputing: () => !!computing, current: () => current };
}
