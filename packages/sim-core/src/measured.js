// Measured-only multi-source localiser. Inputs are the node microphone MIXTURES, the node positions and the settings.
// It never reads per-source rendered signals, source positions, start times or any other ground truth.
// SIMULATED use only; ground model is idealised and the diffraction model is unvalidated.
import { windowTdoas } from './localise.js';
import { MIC_PAIRS } from './mics.js';
import { rfft, irfft } from './dsp.js';
import { bandWeight } from './activity.js';
import { distance } from './physics.js';

export const MEASURED_DEFAULTS = Object.freeze({
  window_ms: 50, // sliding bearing window (20-100 ms allowed)
  hop_ms: 25,
  onset_rise_db: 10, // energy rise within one 10 ms frame that marks an onset
  onset_window_ms: 40, // direct-path window after an onset (20-50 ms)
  min_peak: 0.25, // weakest PHAT peak (worst pair) in an accepted window
  max_residual_us: 15, // plane-wave fit residual
  neighbour_deg: 5, // windows within this azimuth, within neighbour_s, count as agreeing
  neighbour_s: 0.1,
  min_neighbours: 2,
  link_deg: 6, // track linking: base azimuth step, plus link_rate_deg_s * dt
  link_rate_deg_s: 60,
  gap_s: 0.3, // a track survives a gap this long
  min_track_windows: 3,
  bearing_sigma_deg: 2.5, // weight floor; stands in for the unknown per-node heading offset
  min_cross_deg: 12, // two bearings must cross at least this much to give a fix
  static_chi2: 4, // mean normalised squared bearing residual below which a source is called static
  max_onset_skew_s: 0.03
});

const FRAME_S = 0.01;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};

/** Band-limited mean-square frames of one mixture microphone. */
export function mixtureFrames(mic, band, fs, frameS = FRAME_S) {
  const n = 2 ** Math.ceil(Math.log2(mic.length));
  const x = new Float64Array(n);
  x.set(mic);
  const { re, im } = rfft(x, n);
  for (let k = 0; k < re.length; k++) {
    const w = bandWeight((k * fs) / n, band);
    re[k] *= w;
    im[k] *= w;
  }
  const y = irfft(re, im, n);
  const len = Math.round(frameS * fs);
  const out = [];
  for (let f = 0; f + len <= mic.length; f += len) {
    let s = 0;
    for (let i = f; i < f + len; i++) s += y[i] * y[i];
    out.push(s / len);
  }
  return out;
}

/** Onsets: a frame at least riseDb above the mean of the four frames before it, and above the record's quiet level. */
export function detectOnsets(frames, { riseDb, frameS = FRAME_S }) {
  const sorted = [...frames].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.2)] || 1e-30;
  const out = [];
  for (let f = 4; f < frames.length - 1; f++) {
    const pre = (frames[f - 4] + frames[f - 3] + frames[f - 2] + frames[f - 1]) / 4;
    const rise = 10 * Math.log10(Math.max(frames[f], 1e-30) / Math.max(pre, 1e-30));
    if (rise >= riseDb && frames[f] > 3 * noise) {
      if (out.length && f * frameS - out[out.length - 1].t_s < 0.1) continue;
      out.push({ t_s: f * frameS, rise_db: rise });
    }
  }
  return out;
}

/** Plane-wave bearing of one window (flat array, horizontal azimuth) with quality figures from the correlation itself. */
export function windowBearing(mics, positions, startSample, endSample, { fs, c, band }) {
  const spacing = Math.max(...MIC_PAIRS.map(([i, j]) => distance(positions[i], positions[j])));
  const t = windowTdoas(mics, startSample, endSample, { fs, band, maxLagS: spacing / c });
  let a = 0, b = 0, d = 0, p = 0, q = 0;
  const rows = MIC_PAIRS.map(([i, j], k) => {
    const dx = positions[j][0] - positions[i][0];
    const dy = positions[j][1] - positions[i][1];
    const r = c * t[k].tdoa_s;
    a += dx * dx;
    b += dx * dy;
    d += dy * dy;
    p += dx * r;
    q += dy * r;
    return [dx, dy, r];
  });
  const det = a * d - b * b;
  if (Math.abs(det) < 1e-12) return null;
  const hx = (d * p - b * q) / det;
  const hy = (a * q - b * p) / det;
  let sq = 0;
  for (const [dx, dy, r] of rows) sq += ((dx * hx + dy * hy - r) / c) ** 2;
  return {
    az_deg: toDeg(Math.atan2(hy, hx)),
    h_mag: Math.hypot(hx, hy),
    residual_s: Math.sqrt(sq / rows.length),
    peak_min: Math.min(...t.map((x) => x.peak)),
    peak_mean: t.reduce((s, x) => s + x.peak, 0) / t.length
  };
}

const goodWindow = (w, o) => w && w.peak_min >= o.min_peak && w.residual_s * 1e6 <= o.max_residual_us;

/**
 * Per node: sliding windows -> quality gate -> neighbour agreement -> tracks. Uses the mixture only.
 * Returns { windows, onsets, tracks }. A window "dominated" by one source is one whose bearing agrees with its
 * neighbours; windows mixing two sources disagree and are dropped. No SNR is used for accept/reject.
 */
export function nodeTracks(rn, node, { fs, c, band, options = {} }) {
  const o = { ...MEASURED_DEFAULTS, ...options };
  const frames = mixtureFrames(rn.mics[0], band, fs);
  const sorted = [...frames].sort((a, b) => a - b);
  const quiet = sorted[Math.floor(sorted.length * 0.2)] || 1e-30;
  const winS = o.window_ms / 1000;
  const hopS = o.hop_ms / 1000;
  const positions = rn.mic_positions;
  const total = rn.mics[0].length;
  const cand = [];
  for (let t = 0; t + winS <= total / fs; t += hopS) {
    // Skip empty time only to save work: the mixture is already at the quiet level there.
    const f0 = Math.floor(t / FRAME_S);
    const f1 = Math.min(frames.length, Math.ceil((t + winS) / FRAME_S));
    let e = 0;
    for (let f = f0; f < f1; f++) e += frames[f];
    if (e / Math.max(1, f1 - f0) < 1.5 * quiet) continue;
    const w = windowBearing(rn.mics, positions, Math.round(t * fs), Math.round((t + winS) * fs), { fs, c, band });
    if (goodWindow(w, o)) cand.push({ t_s: t + winS / 2, ...w });
  }
  // Neighbour agreement: keep windows with enough near-in-time windows at nearly the same bearing.
  const windows = cand.filter((w, i) => {
    let n = 0;
    for (let j = 0; j < cand.length; j++) {
      if (j === i) continue;
      if (Math.abs(cand[j].t_s - w.t_s) <= o.neighbour_s && Math.abs(wrapDeg(cand[j].az_deg - w.az_deg)) <= o.neighbour_deg) n++;
    }
    return n >= o.min_neighbours;
  });
  // Greedy linking into tracks, tolerating gaps.
  const tracks = [];
  for (const w of windows) {
    let best = null;
    let bestD = Infinity;
    for (const tr of tracks) {
      const last = tr.windows[tr.windows.length - 1];
      const dt = w.t_s - last.t_s;
      if (dt > o.gap_s) continue;
      const dAz = Math.abs(wrapDeg(w.az_deg - last.az_deg));
      if (dAz <= o.link_deg + o.link_rate_deg_s * Math.max(dt, 0) && dAz < bestD) {
        best = tr;
        bestD = dAz;
      }
    }
    if (best) best.windows.push(w);
    else tracks.push({ windows: [w] });
  }
  const kept = tracks.filter((tr) => tr.windows.length >= o.min_track_windows);
  // Onsets from the mixture; localise the first 20-50 ms (direct path) and keep it only if a track confirms the bearing.
  const onsets = [];
  for (const on of detectOnsets(frames, { riseDb: o.onset_rise_db })) {
    const w = windowBearing(rn.mics, positions, Math.round(on.t_s * fs), Math.round((on.t_s + o.onset_window_ms / 1000) * fs), { fs, c, band });
    if (!goodWindow(w, { ...o, min_peak: o.min_peak })) continue;
    const tr = kept.find((k) => k.windows.some((x) => x.t_s >= on.t_s && x.t_s <= on.t_s + 0.4 && Math.abs(wrapDeg(x.az_deg - w.az_deg)) <= o.link_deg));
    if (!tr) continue;
    const entry = { ...on, ...w, t_s: on.t_s + o.onset_window_ms / 2000, onset: true };
    (tr.onsets ||= []).push(entry);
    onsets.push(entry);
  }
  return { windows, candidates: cand, onsets, tracks: kept, quiet_power: quiet, node_id: node.id, node_position: node.position };
}

// --- Bearing-only filter -----------------------------------------------------------------------------------
const emissionTime = (tArrival, nodePos, est, c) => tArrival - Math.hypot(est[0] - nodePos[0], est[1] - nodePos[1]) / c;

/** Intersection of two horizontal bearing lines from nodes pa, pb; null if parallel or behind a node. */
export function intersect2(pa, azA, pb, azB, minCrossDeg) {
  const da = [Math.cos(toRad(azA)), Math.sin(toRad(azA))];
  const db = [Math.cos(toRad(azB)), Math.sin(toRad(azB))];
  const cross = Math.abs(wrapDeg(azA - azB));
  if (Math.min(cross, 180 - cross) < minCrossDeg) return null;
  const det = da[0] * -db[1] - da[1] * -db[0];
  const rx = pb[0] - pa[0];
  const ry = pb[1] - pa[1];
  const s = (rx * -db[1] - ry * -db[0]) / det;
  const u = (da[0] * ry - da[1] * rx) / det;
  if (s <= 0 || u <= 0) return null;
  return [pa[0] + s * da[0], pa[1] + s * da[1]];
}

function solveStatic(obs, start, sigmaRad) {
  // Gauss-Newton on a single point; obs: { pos, az_deg, w }
  let p = [...start];
  for (let it = 0; it < 15; it++) {
    let a = 0, b = 0, d = 0, g0 = 0, g1 = 0;
    for (const m of obs) {
      const dx = p[0] - m.pos[0];
      const dy = p[1] - m.pos[1];
      const r2 = dx * dx + dy * dy || 1e-9;
      const res = toRad(wrapDeg(m.az_deg - toDeg(Math.atan2(dy, dx))));
      const h0 = -dy / r2;
      const h1 = dx / r2;
      const w = m.w / sigmaRad ** 2;
      a += w * h0 * h0;
      b += w * h0 * h1;
      d += w * h1 * h1;
      g0 += w * h0 * res;
      g1 += w * h1 * res;
    }
    const det = a * d - b * b;
    if (Math.abs(det) < 1e-18) break;
    const s0 = (d * g0 - b * g1) / det;
    const s1 = (a * g1 - b * g0) / det;
    p = [p[0] + s0, p[1] + s1];
    if (Math.hypot(s0, s1) < 1e-3) break;
  }
  let chi = 0;
  for (const m of obs) {
    const res = toRad(wrapDeg(m.az_deg - toDeg(Math.atan2(p[1] - m.pos[1], p[0] - m.pos[0]))));
    chi += (m.w * res * res) / sigmaRad ** 2;
  }
  return { position: p, chi2_mean: chi / Math.max(1, obs.length) };
}

/** Extended Kalman filter, constant velocity, bearing-only; tolerates gaps by predicting through them. */
function trackFilter(obs, init, { c, sigmaRad, accel = 3 }) {
  let x = [init[0], init[1], 0, 0];
  let P = [[100, 0, 0, 0], [0, 100, 0, 0], [0, 0, 100, 0], [0, 0, 0, 100]];
  const out = [];
  let tPrev = null;
  for (const m of obs) {
    const t = m.t_e;
    if (tPrev !== null) {
      const dt = Math.max(0, t - tPrev);
      // predict
      x = [x[0] + x[2] * dt, x[1] + x[3] * dt, x[2], x[3]];
      const q = accel * accel;
      const F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
      const FP = F.map((r) => [0, 1, 2, 3].map((j) => r.reduce((s, v, k) => s + v * P[k][j], 0)));
      P = FP.map((r) => [0, 1, 2, 3].map((j) => r.reduce((s, v, k) => s + v * F[j][k], 0)));
      P[0][0] += (q * dt ** 4) / 4;
      P[1][1] += (q * dt ** 4) / 4;
      P[2][2] += q * dt * dt;
      P[3][3] += q * dt * dt;
      P[0][2] += (q * dt ** 3) / 2;
      P[2][0] += (q * dt ** 3) / 2;
      P[1][3] += (q * dt ** 3) / 2;
      P[3][1] += (q * dt ** 3) / 2;
    }
    tPrev = t;
    const dx = x[0] - m.pos[0];
    const dy = x[1] - m.pos[1];
    const r2 = dx * dx + dy * dy || 1e-9;
    const H = [-dy / r2, dx / r2, 0, 0];
    const innov = toRad(wrapDeg(m.az_deg - toDeg(Math.atan2(dy, dx))));
    const PH = P.map((row) => row.reduce((s, v, k) => s + v * H[k], 0));
    const S = H.reduce((s, v, k) => s + v * PH[k], 0) + (sigmaRad ** 2) / Math.max(m.w, 1e-3);
    const K = PH.map((v) => v / S);
    x = x.map((v, i) => v + K[i] * innov);
    P = P.map((row, i) => row.map((v, j) => v - K[i] * PH[j]));
    out.push({ t_e: t, position: [x[0], x[1]], velocity: [x[2], x[3]], sigma_m: Math.sqrt(Math.max(0, (P[0][0] + P[1][1]) / 2)), nis: (innov * innov) / S });
  }
  return out;
}

/**
 * Associates tracks across nodes, filters them, stamps emission time. Only measured quantities are used.
 * Returns fixes: { tracks, positions[], static, final_position, reliable, low_confidence, ... }.
 */
export function fuseTracks(nodeResults, { c, options = {} }) {
  const o = { ...MEASURED_DEFAULTS, ...options };
  const sigmaRad = toRad(o.bearing_sigma_deg);
  const flat = [];
  nodeResults.forEach((nr, ni) => nr.tracks.forEach((tr, ti) => flat.push({ ni, ti, tr, nr })));
  const pairs = [];
  for (let a = 0; a < flat.length; a++) {
    for (let b = a + 1; b < flat.length; b++) {
      const A = flat[a];
      const B = flat[b];
      if (A.ni === B.ni) continue;
      const baseline = distance(A.nr.node_position, B.nr.node_position);
      const aw = A.tr.windows;
      const bw = B.tr.windows;
      const pad = baseline / c + 0.1;
      if (aw[aw.length - 1].t_s < bw[0].t_s - pad || bw[bw.length - 1].t_s < aw[0].t_s - pad) continue;
      // First guess: the pair of windows closest in time.
      let best = null;
      for (const wa of aw) for (const wb of bw) {
        const dt = Math.abs(wa.t_s - wb.t_s);
        if (dt <= pad && (!best || dt < best.dt)) best = { wa, wb, dt };
      }
      if (!best) continue;
      const guess = intersect2(A.nr.node_position, best.wa.az_deg, B.nr.node_position, best.wb.az_deg, o.min_cross_deg);
      if (!guess) continue;
      const obs = [];
      for (const [F, ws] of [[A, aw], [B, bw]]) {
        for (const w of ws) obs.push({ pos: F.nr.node_position, az_deg: w.az_deg, w: 1, t_a: w.t_s });
        for (const w of F.tr.onsets || []) obs.push({ pos: F.nr.node_position, az_deg: w.az_deg, w: 2, t_a: w.t_s, onset: true });
      }
      const st = solveStatic(obs, guess, sigmaRad);
      // Onset timing check: emission times of both nodes' onsets must agree after removing propagation.
      let skew = null;
      const oa = (A.tr.onsets || [])[0];
      const ob = (B.tr.onsets || [])[0];
      if (oa && ob) skew = Math.abs(emissionTime(oa.t_s, A.nr.node_position, st.position, c) - emissionTime(ob.t_s, B.nr.node_position, st.position, c));
      pairs.push({ A, B, guess, obs, st, skew });
    }
  }
  const staticOk = (p) => p.st.chi2_mean <= o.static_chi2;
  // Score: static fit quality, or for a moving source the filter's mean NIS.
  for (const p of pairs) {
    const sorted = [...p.obs].sort((x, y) => x.t_a - y.t_a);
    const run = (start) => {
      const withT = sorted.map((m) => ({ ...m, t_e: emissionTime(m.t_a, m.pos, start, c) })).sort((x, y) => x.t_e - y.t_e);
      return trackFilter(withT, start, { c, sigmaRad });
    };
    let est = run(p.guess);
    // Second pass: re-stamp with the filtered positions.
    const stamped = sorted.map((m) => {
      let e = est[Math.min(est.length - 1, Math.max(0, Math.round(((m.t_a - sorted[0].t_a) / Math.max(1e-6, sorted[sorted.length - 1].t_a - sorted[0].t_a)) * (est.length - 1))))];
      return { ...m, t_e: emissionTime(m.t_a, m.pos, e.position, c) };
    }).sort((x, y) => x.t_e - y.t_e);
    est = trackFilter(stamped, p.guess, { c, sigmaRad });
    p.est = est;
    p.nisMean = est.reduce((s, e) => s + e.nis, 0) / Math.max(1, est.length);
    p.score = staticOk(p) ? p.st.chi2_mean : Math.max(p.nisMean, p.st.chi2_mean) + 5;
    p.static = staticOk(p);
  }
  pairs.sort((x, y) => x.score - y.score);
  const used = new Set();
  const fixes = [];
  for (const p of pairs) {
    const ka = `${p.A.ni}:${p.A.ti}`;
    const kb = `${p.B.ni}:${p.B.ti}`;
    if (used.has(ka) || used.has(kb)) continue;
    if (p.skew != null && p.skew > o.max_onset_skew_s) continue;
    if (p.score > 25) continue;
    used.add(ka);
    used.add(kb);
    const rivals = pairs.filter((q) => q !== p && (`${q.A.ni}:${q.A.ti}` === ka || `${q.B.ni}:${q.B.ti}` === kb) && q.score < Math.max(2 * p.score, p.score + 3) && (q.skew == null || q.skew <= o.max_onset_skew_s));
    const last = p.est[p.est.length - 1];
    const finalPos = p.static ? p.st.position : last.position;
    fixes.push({
      node_tracks: [ka, kb],
      static: p.static,
      final_position: finalPos,
      positions: p.static
        ? p.est.map((e) => ({ t_e: e.t_e, position: p.st.position, sigma_m: e.sigma_m }))
        : p.est.map((e) => ({ t_e: e.t_e, position: e.position, sigma_m: e.sigma_m, velocity: e.velocity })),
      chi2_mean: p.st.chi2_mean,
      nis_mean: p.nisMean,
      onset_skew_s: p.skew,
      n_windows: p.obs.length,
      n_nodes: 2,
      low_confidence: true, // two nodes only
      ambiguous: rivals.length > 0,
      reliable: rivals.length === 0 && p.score <= 6 && p.est.length >= o.min_track_windows
    });
  }
  return fixes;
}

/** Whole pipeline on a rendered scenario: { nodes, fixes }. */
export function analyseMeasured(scenario, rendered, { c, options = {} } = {}) {
  const fs = rendered.sample_rate;
  const band = scenario.settings.localisation_band_hz;
  const nodes = scenario.nodes.map((node, ni) => nodeTracks(rendered.nodes[ni], node, { fs, c, band, options }));
  return { nodes, fixes: fuseTracks(nodes, { c, options }) };
}
