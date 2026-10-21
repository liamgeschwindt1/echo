import { spectrogram } from '../core/spectro.js';
import { gccCurve } from '../core/localise.js';
import { MIC_PAIRS } from '../core/mics.js';
import { airAbsorptionDbPerM, distance, speedOfSound } from '../core/physics.js';
import { findPaths, pathPressure } from '../core/geometry.js';
import { isMoving, positionAt } from '../core/motion.js';
import { arrivalsCsv, encodeWavFloat32 } from '../core/wav.js';

const SHADES = ['#ffffff', '#cfcfcf', '#a0a0a0', '#7a7a7a', '#5a5a5a'];
const PYR_BASE = 32;
const LANE_PX = 26;
const pyramids = new WeakMap();
const peaks = new WeakMap();

// Min/max pyramid so a 30 s trace draws in a handful of operations per pixel.
function pyramidOf(arr) {
  let levels = pyramids.get(arr);
  if (levels) return levels;
  let block = PYR_BASE;
  const n = Math.ceil(arr.length / block);
  let min = new Float32Array(n);
  let max = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    const e = Math.min(arr.length, (i + 1) * block);
    for (let j = i * block; j < e; j++) {
      const v = arr[j];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[i] = lo;
    max[i] = hi;
  }
  levels = [{ block, min, max }];
  while (min.length > 64) {
    const m = Math.ceil(min.length / 2);
    const nmin = new Float32Array(m);
    const nmax = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      nmin[i] = Math.min(min[2 * i], min[2 * i + 1] ?? Infinity);
      nmax[i] = Math.max(max[2 * i], max[2 * i + 1] ?? -Infinity);
    }
    min = nmin;
    max = nmax;
    block *= 2;
    levels.push({ block, min, max });
  }
  pyramids.set(arr, levels);
  return levels;
}

// Min and max of arr over [s0, s1), from the pyramid when the span is wide.
function extent(arr, s0, s1) {
  const span = s1 - s0;
  if (span < PYR_BASE * 2) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = Math.max(0, Math.floor(s0)); i < Math.min(arr.length, Math.ceil(s1)); i++) {
      if (arr[i] < lo) lo = arr[i];
      if (arr[i] > hi) hi = arr[i];
    }
    return [lo, hi];
  }
  const levels = pyramidOf(arr);
  let lv = levels[0];
  for (const l of levels) if (l.block <= span / 2) lv = l;
  let lo = Infinity;
  let hi = -Infinity;
  const i0 = Math.max(0, Math.floor(s0 / lv.block));
  const i1 = Math.min(lv.min.length, Math.ceil(s1 / lv.block));
  for (let i = i0; i < i1; i++) {
    if (lv.min[i] < lo) lo = lv.min[i];
    if (lv.max[i] > hi) hi = lv.max[i];
  }
  return [lo, hi];
}

function peakOf(arr) {
  let p = peaks.get(arr);
  if (p === undefined) {
    p = 0;
    for (let i = 0; i < arr.length; i++) p = Math.max(p, Math.abs(arr[i]));
    peaks.set(arr, p);
  }
  return p;
}

const pathLabel = (p) => (p.type === 'direct' ? 'direct' : `${p.type} ${p.surfaces.join('+')}`);

/**
 * The receiver-side view for one node. host supplies state and actions from main.js.
 */
export function createMicView(host) {
  const $ = host.$;
  const root = $('micView');
  const traces = $('mvTraces');
  const tctx = traces.getContext('2d');
  const specC = $('mvSpec');
  const sctx = specC.getContext('2d');
  const gccC = $('mvGcc');
  const gctx = gccC.getContext('2d');

  let nodeId = null;
  let view = { t0: 0, t1: 1 };
  let mode = 'total';
  let db = false;
  let series = null; // [{id,label,mics}] for the current mode
  const cache = new Map();
  let pending = null;
  let specKey = '';
  let specTimer = null;
  let specImage = null;
  let gccState = null;

  const ctxInfo = () => {
    const rendered = host.getRendered();
    const scn = host.getScenario();
    const ni = scn?.nodes.findIndex((n) => n.id === nodeId) ?? -1;
    return rendered && scn && ni >= 0 ? { rendered, scn, ni, node: rendered.nodes[ni], fs: rendered.sample_rate, c: speedOfSound(scn.settings.temperature_c) } : null;
  };

  function fit(canvas, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(10, Math.round(r.width * dpr));
    const h = Math.max(10, Math.round((cssH ?? r.height) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return dpr;
  }

  function arrivals() {
    const info = ctxInfo();
    const results = host.getResults();
    if (!info || !results) return [];
    const rows = [];
    results.forEach((r, si) => {
      const n = r.nodes[info.ni];
      const src = info.scn.sources[si];
      (n.paths || []).forEach((p, i) => {
        rows.push({
          time_s: src.start_s + p.delay_s,
          source: src.id,
          path: p.type,
          surfaces: p.surfaces.join('+'),
          length_m: p.length_m,
          level_db_re_direct: p.level_db_re_direct,
          level_above_noise_db: (n.snr_direct_db ?? n.snr_db ?? 0) + p.level_db_re_direct,
          arrival_azimuth_deg: p.arrival_azimuth_deg,
          overlapped: n.overlapped_with?.length ? n.overlapped_with.join(',') : '',
          label: `${src.id} ${pathLabel(p)}${p.type === 'direct' ? '' : ` ${p.level_db_re_direct.toFixed(0)} dB`}`,
          picked: i === n.picked_path_index
        });
      });
    });
    return rows.sort((a, b) => a.time_s - b.time_s);
  }

  function setSeriesForMode() {
    const info = ctxInfo();
    if (!info) return;
    $('mvAudit').hidden = mode !== 'audit';
    if (mode === 'audit') {
      renderAudit();
      $('mvStatus').textContent = '';
      return;
    }
    if (mode === 'total') {
      series = [{ id: 'total', label: 'Total', mics: info.node.mics }];
      $('mvStatus').textContent = '';
      return;
    }
    const key = `${info.rendered.length}:${nodeId}:${mode}`;
    if (cache.has(key)) {
      series = cache.get(key);
      $('mvStatus').textContent = '';
      return;
    }
    series = null;
    $('mvStatus').textContent = 'Computing components...';
    pending = key;
    host.requestComponents(info.ni, mode, key);
  }

  function onComponents(msg) {
    cache.clear();
    cache.set(msg.key, msg.series);
    if (pending === msg.key) {
      series = msg.series;
      pending = null;
      $('mvStatus').textContent = '';
    }
  }

  function seek(timeS, zoom) {
    host.setT(timeS);
    if (zoom) view = { t0: timeS - 0.02, t1: timeS + 0.02 };
    specKey = '';
  }

  const colourFor = (s, i) => (s.id === 'noise' ? '#555' : s.id === 'wall' ? host.accent : s.id === 'diffracted' ? '#d8d8d8' : s.id === 'ground' ? '#9a9a9a' : s.id === 'direct' ? '#fff' : mode === 'by_source' ? (i % 5 === 3 ? host.accent : SHADES[i % SHADES.length]) : '#fff');

  function drawTraces() {
    const info = ctxInfo();
    const dpr = fit(traces);
    const W = traces.width;
    const H = traces.height;
    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, W, H);
    if (!info || !series) {
      tctx.fillStyle = '#8a8a8a';
      tctx.font = `${13 * dpr}px system-ui, sans-serif`;
      tctx.fillText(info ? 'Computing...' : 'Press Create, then select a node.', 16 * dpr, 30 * dpr);
      return;
    }
    const { fs } = info;
    const rowH = (H - LANE_PX * dpr) / 4;
    const span = view.t1 - view.t0;
    const spp = (span * fs) / W;
    let peak = 0;
    for (const s of series) for (const m of s.mics) peak = Math.max(peak, peakOf(m));
    peak = peak || 1;
    tctx.font = `${10 * dpr}px monospace`;
    for (let mi = 0; mi < 4; mi++) {
      const top = mi * rowH;
      const mid = top + rowH / 2;
      tctx.strokeStyle = '#222';
      tctx.beginPath();
      tctx.moveTo(0, top + rowH);
      tctx.lineTo(W, top + rowH);
      tctx.stroke();
      tctx.fillStyle = '#777';
      tctx.fillText(`mic ${mi + 1}`, 4 * dpr, top + 12 * dpr);
      series.forEach((s, si) => {
        const arr = s.mics[mi];
        tctx.strokeStyle = tctx.fillStyle = colourFor(s, si);
        tctx.lineWidth = dpr;
        if (spp < 1.5) {
          tctx.beginPath();
          for (let i = Math.floor(view.t0 * fs); i <= Math.ceil(view.t1 * fs) && i < arr.length; i++) {
            if (i < 0) continue;
            const x = ((i / fs - view.t0) / span) * W;
            const y = db ? top + rowH - Math.max(0, (20 * Math.log10(Math.abs(arr[i]) + 1e-9) + 100) / 100) * (rowH - 4 * dpr) : mid - (arr[i] / peak) * (rowH / 2 - 3 * dpr);
            i === Math.floor(view.t0 * fs) ? tctx.moveTo(x, y) : tctx.lineTo(x, y);
          }
          tctx.stroke();
          if (spp < 0.25) {
            for (let i = Math.max(0, Math.floor(view.t0 * fs)); i <= Math.ceil(view.t1 * fs) && i < arr.length; i++) {
              const x = ((i / fs - view.t0) / span) * W;
              const y = db ? top + rowH - 2 : mid - (arr[i] / peak) * (rowH / 2 - 3 * dpr);
              tctx.fillRect(x - dpr, y - dpr, 2 * dpr, 2 * dpr);
            }
          }
        } else {
          for (let x = 0; x < W; x++) {
            const s0 = (view.t0 + (x / W) * span) * fs;
            const [lo, hi] = extent(arr, s0, s0 + spp);
            if (lo > hi) continue;
            if (db) {
              const a = Math.max(Math.abs(lo), Math.abs(hi));
              const h = Math.max(0, (20 * Math.log10(a + 1e-9) + 100) / 100) * (rowH - 4 * dpr);
              tctx.fillRect(x, top + rowH - h, 1, h);
            } else {
              const y0 = mid - (hi / peak) * (rowH / 2 - 3 * dpr);
              const y1 = mid - (lo / peak) * (rowH / 2 - 3 * dpr);
              tctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
            }
          }
        }
      });
      // Expected direct arrival at this mic, drawn when zoomed in far enough to see inter-mic delays.
      if (span <= 0.04) {
        tctx.setLineDash([4 * dpr, 3 * dpr]);
        tctx.strokeStyle = host.accent;
        info.scn.sources.forEach((src) => {
          const t = src.start_s + distance(positionAt(src, src.start_s), info.node.mic_positions_true[mi]) / info.c;
          const x = ((t - view.t0) / span) * W;
          if (x >= 0 && x <= W) {
            tctx.beginPath();
            tctx.moveTo(x, top);
            tctx.lineTo(x, top + rowH);
            tctx.stroke();
          }
        });
        tctx.setLineDash([]);
      }
    }
    // Arrival lane
    const laneTop = H - LANE_PX * dpr;
    tctx.fillStyle = '#111';
    tctx.fillRect(0, laneTop, W, LANE_PX * dpr);
    let lastLabelX = -1e9;
    for (const a of arrivals()) {
      const x = ((a.time_s - view.t0) / span) * W;
      if (x < 0 || x > W) continue;
      tctx.strokeStyle = tctx.fillStyle = a.picked ? host.accent : '#fff';
      tctx.beginPath();
      tctx.moveTo(x, laneTop);
      tctx.lineTo(x, laneTop + 8 * dpr);
      tctx.stroke();
      if (x - lastLabelX > 90 * dpr) {
        tctx.fillText(a.label, x + 3 * dpr, laneTop + 20 * dpr);
        lastLabelX = x;
      }
    }
    // Playhead
    const px = ((host.getT() - view.t0) / span) * W;
    tctx.strokeStyle = '#fff';
    tctx.lineWidth = dpr;
    tctx.beginPath();
    tctx.moveTo(px, 0);
    tctx.lineTo(px, H);
    tctx.stroke();
    tctx.fillStyle = '#777';
    tctx.fillText(`${view.t0.toFixed(3)} s`, 4 * dpr, H - LANE_PX * dpr - 4 * dpr);
    tctx.fillText(`${view.t1.toFixed(3)} s  (span ${(span * 1000).toFixed(1)} ms)`, W - 190 * dpr, H - LANE_PX * dpr - 4 * dpr);
  }

  function scheduleSpec() {
    const key = `${nodeId}:${view.t0.toFixed(4)}:${view.t1.toFixed(4)}:${specC.clientWidth}`;
    if (key === specKey) return;
    specKey = key;
    clearTimeout(specTimer);
    specTimer = setTimeout(() => {
      const info = ctxInfo();
      if (!info) return;
      const sig = info.node.mics[0];
      const i0 = Math.max(0, Math.floor(view.t0 * info.fs));
      const i1 = Math.min(sig.length, Math.ceil(view.t1 * info.fs));
      if (i1 - i0 < 2048) {
        specImage = null;
        return;
      }
      const sp = spectrogram(sig.subarray(i0, i1), info.fs, { frames: Math.min(700, Math.floor(specC.clientWidth / 2) || 300), size: 1024, maxHz: 4000 });
      let hiDb = -Infinity;
      for (const col of sp.frames) for (const v of col) hiDb = Math.max(hiDb, v);
      const off = document.createElement('canvas');
      off.width = sp.frames.length;
      off.height = sp.bins;
      const og = off.getContext('2d');
      const img = og.createImageData(off.width, off.height);
      sp.frames.forEach((col, x) => {
        for (let k = 0; k < sp.bins; k++) {
          const g = Math.round(255 * Math.min(1, Math.max(0, (col[k] - (hiDb - 70)) / 70)));
          const o = ((sp.bins - 1 - k) * off.width + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
          img.data[o + 3] = 255;
        }
      });
      og.putImageData(img, 0, 0);
      specImage = { canvas: off, maxHz: sp.max_hz };
    }, 120);
  }

  function drawSpec() {
    const dpr = fit(specC);
    const W = specC.width;
    const H = specC.height;
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, W, H);
    if (!ctxInfo()) return;
    scheduleSpec();
    if (specImage) {
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(specImage.canvas, 0, 0, W, H);
      const band = host.getScenario().settings.localisation_band_hz;
      const y = (hz) => H - (hz / specImage.maxHz) * H;
      sctx.fillStyle = 'rgba(255,176,0,0.12)';
      sctx.fillRect(0, y(band[1]), W, y(band[0]) - y(band[1]));
      sctx.strokeStyle = 'rgba(255,176,0,0.7)';
      sctx.setLineDash([4 * dpr, 3 * dpr]);
      for (const hz of band) {
        sctx.beginPath();
        sctx.moveTo(0, y(hz));
        sctx.lineTo(W, y(hz));
        sctx.stroke();
      }
      sctx.setLineDash([]);
    }
    sctx.fillStyle = '#8a8a8a';
    sctx.font = `${10 * dpr}px monospace`;
    sctx.fillText('mic 1, 0-4 kHz; shaded = localisation band', 4 * dpr, 12 * dpr);
    const px = ((host.getT() - view.t0) / (view.t1 - view.t0)) * W;
    sctx.strokeStyle = '#fff';
    sctx.beginPath();
    sctx.moveTo(px, 0);
    sctx.lineTo(px, H);
    sctx.stroke();
  }

  // ----- delay view -----

  function computeGcc() {
    const info = ctxInfo();
    const results = host.getResults();
    if (!info || !results) return (gccState = null);
    const si = Number($('mvSrc').value);
    const [i, j] = MIC_PAIRS[Number($('mvPair').value)];
    const nr = results[si]?.nodes[info.ni];
    if (!nr) return (gccState = null);
    const a = Math.round(nr.window_s[0] * info.fs);
    const b = Math.round(nr.window_s[1] * info.fs);
    if (b - a < 64) return (gccState = null);
    const pos = info.node.mic_positions_true;
    const baseline = distance(info.node.mic_positions[i], info.node.mic_positions[j]) / info.c;
    const curve = gccCurve({ signal: info.node.mics[i], start: a, end: b }, { signal: info.node.mics[j], start: a, end: b }, { fs: info.fs, band: info.scn.settings.localisation_band_hz, maxLagS: baseline });
    const src = nr.true_position ?? info.scn.sources[si].keyframes[0].position;
    const tdoa = (img) => (distance(img, pos[i]) - distance(img, pos[j])) / info.c;
    const centre = host.getRendered().paths[info.ni].centre[si].paths;
    const pickedPath = nr.picked_path_index !== null && nr.picked_path_index !== undefined ? centre[nr.picked_path_index] : null;
    gccState = { curve, baseline, trueLag: tdoa(src), pickedLag: pickedPath ? tdoa(pickedPath.image) : null, pair: [i, j] };
  }

  function drawGcc() {
    const dpr = fit(gccC, 150);
    const W = gccC.width;
    const H = gccC.height;
    gctx.fillStyle = '#000';
    gctx.fillRect(0, 0, W, H);
    gctx.font = `${10 * dpr}px monospace`;
    if (!gccState) {
      gctx.fillStyle = '#8a8a8a';
      gctx.fillText('No correlation for this source and pair.', 8 * dpr, 20 * dpr);
      return;
    }
    const { curve, baseline } = gccState;
    const x = (lag) => ((lag + baseline) / (2 * baseline)) * (W - 20 * dpr) + 10 * dpr;
    const top = Math.max(...curve.values, 0.01);
    const lo = Math.min(...curve.values, 0);
    const y = (v) => H - 22 * dpr - ((v - lo) / (top - lo || 1)) * (H - 44 * dpr);
    gctx.strokeStyle = '#fff';
    gctx.lineWidth = dpr;
    gctx.beginPath();
    curve.lags_s.forEach((l, k) => (k ? gctx.lineTo(x(l), y(curve.values[k])) : gctx.moveTo(x(l), y(curve.values[k]))));
    gctx.stroke();
    const vline = (lag, colour, dash, label, row) => {
      gctx.strokeStyle = gctx.fillStyle = colour;
      gctx.setLineDash(dash);
      gctx.beginPath();
      gctx.moveTo(x(lag), 14 * dpr);
      gctx.lineTo(x(lag), H - 18 * dpr);
      gctx.stroke();
      gctx.setLineDash([]);
      gctx.fillStyle = gctx.strokeStyle;
      const right = x(lag) > W * 0.6;
      gctx.textAlign = right ? 'right' : 'left';
      gctx.fillText(label, x(lag) + (right ? -4 : 3) * dpr, 24 * dpr + row * 11 * dpr);
      gctx.textAlign = 'left';
    };
    gctx.fillStyle = '#777';
    for (const p of curve.peaks.slice(1)) {
      gctx.fillRect(x(p.lag_s) - dpr, y(p.value) - 5 * dpr, 2 * dpr, 4 * dpr);
    }
    vline(gccState.trueLag, '#ffffff', [5 * dpr, 3 * dpr], 'true direct', 0);
    vline(curve.est_lag_s, host.accent, [], 'estimated', 1);
    if (gccState.pickedLag !== null) vline(gccState.pickedLag, host.accent, [2 * dpr, 3 * dpr], 'picked path', 2);
    gctx.fillStyle = '#777';
    gctx.fillText(`${(-baseline * 1000).toFixed(2)} ms`, 4 * dpr, H - 4 * dpr);
    gctx.fillText(`${(baseline * 1000).toFixed(2)} ms  (lag, mic ${gccState.pair[0] + 1} vs ${gccState.pair[1] + 1})`, W - 220 * dpr, H - 4 * dpr);
  }

  // ----- audit: applied values read back from the render stage vs recomputed from geometry -----

  function renderAudit() {
    const info = ctxInfo();
    const box = $('mvAudit');
    if (!info) return (box.innerHTML = '');
    const { rendered, scn, ni, fs, c } = info;
    const applied = rendered.audit?.[ni];
    if (!applied) return (box.innerHTML = '<p class="muted">No audit data; press Create again.</p>');
    const st = scn.settings;
    const a1k = st.air_absorption ? airAbsorptionDbPerM(1000, st.temperature_c, st.humidity_pct, st.pressure_kpa) : 0;
    let rows = '';
    let worstD = 0;
    let worstG = 0;
    let droppedCount = 0;
    const dropReasons = {};
    scn.sources.forEach((src, si) => {
      if (isMoving(src)) {
        rows += `<tr><td>${src.id}</td><td colspan="8" class="muted">moving source: its paths change along the route, so it is not audited</td></tr>`;
        return;
      }
      const srcPos = src.keyframes[0].position;
      info.node.mic_positions_true.forEach((mp, mi) => {
        // Independent recomputation straight from the geometry, not from the render.
        const re = findPaths(srcPos, mp, { settings: st, buildings: scn.buildings || [], c });
        const recomputed = re.paths.map((p) => ({
          type: p.type,
          surfaces: p.surfaces,
          delay_samples: (src.start_s + p.length / c) * fs,
          gain_db_1khz: 20 * Math.log10(pathPressure(p, 1000, c)) - a1k * p.length
        }));
        for (const d of re.dropped || []) {
          droppedCount += d.count || 1;
          dropReasons[d.reason] = (dropReasons[d.reason] || 0) + (d.count || 1);
        }
        applied[mi][si].forEach((a, i) => {
          const r = recomputed[i];
          const dd = r ? a.delay_samples - r.delay_samples : NaN;
          const dg = r ? a.gain_db_1khz - r.gain_db_1khz : NaN;
          const bad = !r || Math.abs(dd) > 0.05 || Math.abs(dg) > 0.05 || a.type !== r.type || a.surfaces.join('+') !== r.surfaces.join('+');
          if (r) {
            worstD = Math.max(worstD, Math.abs(dd));
            worstG = Math.max(worstG, Math.abs(dg));
          }
          rows += `<tr${bad ? ' class="bad"' : ''}><td>${src.id}</td><td>mic ${mi + 1}</td><td title="${String(a.filter || '').replace(/"/g, '&quot;')}">${a.type}${a.surfaces.length ? ` ${a.surfaces.join('+')}` : ''}</td>` +
            `<td>${a.delay_samples.toFixed(2)}</td><td>${r ? r.delay_samples.toFixed(2) : 'missing'}</td><td>${r ? dd.toFixed(4) : '-'}</td>` +
            `<td>${a.gain_db_1khz.toFixed(2)}</td><td>${r ? r.gain_db_1khz.toFixed(2) : 'missing'}</td><td>${r ? dg.toFixed(4) : '-'}</td></tr>`;
        });
      });
    });
    const ok = worstD <= 0.05 && worstG <= 0.05;
    box.innerHTML =
      `<h4>Render audit (applied vs recomputed)</h4>` +
      `<p class="${ok ? 'ok' : ''}" style="${ok ? '' : 'color:#ff5555'}">worst |delay| diff ${worstD.toFixed(4)} samples (flag &gt; 0.05), worst |gain| diff ${worstG.toFixed(4)} dB (flag &gt; 0.05), at 1 kHz. ${droppedCount} path(s) dropped (${Object.entries(dropReasons).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}).</p>` +
      `<table><tr><th>src</th><th>mic</th><th>path</th><th>delay smp</th><th>geom</th><th>&Delta;</th><th>gain dB</th><th>geom</th><th>&Delta;</th></tr>${rows}</table>`;
  }

  function renderArrivalsTable() {
    const rows = arrivals();
    const f = (v, d = 1) => (v == null ? '' : v.toFixed(d));
    $('mvArrivals').innerHTML = `<table><tr><th>t (s)</th><th>source</th><th>path</th><th>re direct</th><th>over noise</th><th>az</th><th>overlap</th></tr>${rows
      .map((r, i) => `<tr data-i="${i}"${r.picked ? ' class="picked"' : ''}><td>${f(r.time_s, 4)}</td><td>${r.source}</td><td>${r.path}${r.surfaces ? ` ${r.surfaces}` : ''}</td><td>${f(r.level_db_re_direct)}</td><td>${f(r.level_above_noise_db)}</td><td>${f(r.arrival_azimuth_deg, 0)}</td><td>${r.overlapped}</td></tr>`)
      .join('')}</table>`;
    for (const tr of $('mvArrivals').querySelectorAll('tr[data-i]')) tr.addEventListener('click', () => seek(rows[Number(tr.dataset.i)].time_s, true));
  }

  function fillSelectors() {
    const scn = host.getScenario();
    $('mvSrc').innerHTML = (scn?.sources || []).map((s, i) => `<option value="${i}">${s.id}</option>`).join('');
    $('mvPair').innerHTML = MIC_PAIRS.map(([a, b], i) => `<option value="${i}">mic ${a + 1}-${b + 1}</option>`).join('');
  }

  function renderLegend() {
    if (!series) return ($('mvLegend').textContent = '');
    $('mvLegend').innerHTML = series.map((s, i) => `<span style="color:${colourFor(s, i)}">&#9632; ${s.label}</span>`).join(' &nbsp; ');
  }

  function open(id) {
    nodeId = id;
    const info = ctxInfo();
    if (!info) return;
    root.hidden = false;
    $('mvTitle').textContent = `Mic's-eye view: node ${id} (${(info.fs / 1000).toFixed(1)} kHz render; traces and analysis use this rate)`;
    view = { t0: 0, t1: info.rendered.length / info.fs };
    specKey = '';
    fillSelectors();
    setSeriesForMode();
    renderArrivalsTable();
    renderLegend();
    computeGcc();
  }

  function refresh() {
    if (root.hidden || !nodeId) return;
    renderArrivalsTable();
    setSeriesForMode();
    renderLegend();
    computeGcc();
  }

  function draw() {
    if (root.hidden) return;
    root.classList.toggle('stale', host.getStatus() === 'stale');
    drawTraces();
    drawSpec();
    drawGcc();
    if (series && !$('mvLegend').firstChild) renderLegend();
  }

  // ----- interaction -----

  let pan = null;
  traces.addEventListener('wheel', (e) => {
    e.preventDefault();
    const info = ctxInfo();
    if (!info) return;
    const r = traces.getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    const span = view.t1 - view.t0;
    const total = info.rendered.length / info.fs;
    const next = Math.min(total, Math.max(0.0005, span * (e.deltaY < 0 ? 0.8 : 1.25)));
    const centre = view.t0 + frac * span;
    view = { t0: centre - frac * next, t1: centre + (1 - frac) * next };
  }, { passive: false });
  traces.addEventListener('pointerdown', (e) => {
    traces.setPointerCapture(e.pointerId);
    pan = { x: e.clientX, y: e.clientY, view: { ...view }, moved: false };
  });
  traces.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const r = traces.getBoundingClientRect();
    if (Math.abs(e.clientX - pan.x) > 3) pan.moved = true;
    const dt = ((e.clientX - pan.x) / r.width) * (pan.view.t1 - pan.view.t0);
    view = { t0: pan.view.t0 - dt, t1: pan.view.t1 - dt };
    specKey = '';
  });
  traces.addEventListener('pointerup', (e) => {
    if (pan && !pan.moved) {
      const r = traces.getBoundingClientRect();
      const frac = (e.clientX - r.left) / r.width;
      const t = view.t0 + frac * (view.t1 - view.t0);
      const inLane = e.clientY - r.top > r.height - LANE_PX;
      const hit = inLane ? arrivals().find((a) => Math.abs(((a.time_s - view.t0) / (view.t1 - view.t0) - frac) * r.width) < 7) : null;
      if (hit) seek(hit.time_s, true);
      else host.setT(Math.max(0, t));
    }
    pan = null;
  });
  specC.addEventListener('pointerdown', (e) => {
    const r = specC.getBoundingClientRect();
    host.setT(Math.max(0, view.t0 + ((e.clientX - r.left) / r.width) * (view.t1 - view.t0)));
  });

  $('mvMode').addEventListener('change', (e) => {
    mode = e.target.value;
    setSeriesForMode();
    renderLegend();
  });
  $('mvScale').addEventListener('change', (e) => (db = e.target.value === 'db'));
  $('mvSrc').addEventListener('change', computeGcc);
  $('mvPair').addEventListener('change', computeGcc);
  $('mvClose').addEventListener('click', () => (root.hidden = true));
  $('mvExpand').addEventListener('click', () => root.classList.toggle('expanded'));
  $('mvWav').addEventListener('click', () => {
    const info = ctxInfo();
    if (!info) return;
    host.download(`node-${nodeId}-4ch.wav`, encodeWavFloat32(info.node.mics, info.fs), 'audio/wav');
  });
  $('mvCsv').addEventListener('click', () => host.download(`node-${nodeId}-arrivals.csv`, arrivalsCsv(arrivals()), 'text/csv'));

  return { open, refresh, draw, onComponents, isOpen: () => !root.hidden, nodeId: () => nodeId };
}
