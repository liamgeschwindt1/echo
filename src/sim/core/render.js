import { airAbsorptionDbPerM, dbToPa, digitalPerPa, speedOfSound } from './physics.js';
import { irfft, nextPow2, rfft } from './dsp.js';
import { micPositions } from './mics.js';
import { gaussian, pinkNoise, streamFor, whiteNoise } from './rng.js';
import { buildSourceGraph, buildSurfaces, computePathTable, diffractionLossDb, findPaths } from './geometry.js';
import { hatWeight, isMoving, motionKnots, positionAt, referencePosition } from './motion.js';
import { diffractionGrid, diffractionOnGrid, gridMap, WEDGE_DESCRIPTION } from './diffraction.js';
import { computeActivity } from './activity.js';
import { timed } from './profile.js';

const LEVEL_WINDOW_S = 0.125;

// Largest 125 ms RMS of the clip, in clip units.
export function loudestWindowRms(samples, sampleRate) {
  const w = Math.max(1, Math.round(LEVEL_WINDOW_S * sampleRate));
  const prefix = new Float64Array(samples.length + 1);
  for (let i = 0; i < samples.length; i++) prefix[i + 1] = prefix[i] + samples[i] * samples[i];
  if (samples.length <= w) return Math.sqrt(prefix[samples.length] / Math.max(1, samples.length));
  let best = 0;
  for (let i = w; i <= samples.length; i++) best = Math.max(best, prefix[i] - prefix[i - w]);
  return Math.sqrt(best / w);
}

// Pascals per clip unit so the loudest 125 ms window sits at level_1m_db.
export function clipGainPa(samples, sampleRate, level1mDb) {
  const rms = loudestWindowRms(samples, sampleRate);
  return rms > 0 ? dbToPa(level1mDb) / rms : 0;
}

// Direct plus the single ground bounce, no buildings; for callers that only need free-field geometry.
export function pathsTo(srcPos, micPos, settings) {
  const c = speedOfSound(settings.temperature_c);
  const free = { ...settings, reflection_order: 0, block_direct_behind_buildings: true };
  return findPaths(srcPos, micPos, { settings: free, buildings: [], c }).paths.map((p) => ({ ...p, r: p.length, kind: p.type }));
}

function absorptionTable(bins, fs, n, settings) {
  const t = new Float64Array(bins);
  if (!settings.air_absorption) return t;
  for (let k = 0; k < bins; k++) t[k] = airAbsorptionDbPerM((k * fs) / n, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa);
  return t;
}

// Optional realism: the simulated array differs from the one the estimator assumes. All zero by default.
function trueMicPositions(node, ni, settings) {
  const nominal = micPositions(node);
  const heading = settings.heading_error_sigma_deg || 0;
  const posSigma = (settings.mic_position_sigma_mm || 0) / 1000;
  if (!heading && !posSigma) return nominal;
  const rot = heading ? micPositions({ ...node, rotation_deg: (node.rotation_deg || 0) + heading * gaussian(streamFor(settings.seed, ni, 0, 11)) }) : nominal;
  return rot.map((p, mi) => {
    if (!posSigma) return p;
    const r = streamFor(settings.seed, ni, mi, 12);
    return [p[0] + posSigma * gaussian(r), p[1] + posSigma * gaussian(r), p[2] + posSigma * gaussian(r)];
  });
}

const micGain = (settings, ni, mi) => (settings.mic_gain_sigma_db ? 10 ** ((settings.mic_gain_sigma_db * gaussian(streamFor(settings.seed, ni, mi, 13))) / 20) : 1);

/** Everything the per-mic spectra need, computed once per render. */
export function prepareRender(scenario, clips, lengthS, profile = null) {
  const { settings } = scenario;
  const fs = settings.render_sample_rate;
  const total = Math.ceil(lengthS * fs);
  const n = nextPow2(total);
  const bins = n / 2 + 1;
  const c = speedOfSound(settings.temperature_c);
  const scaledClips = scenario.sources.map((src) => {
    const samples = clips.get(src.clip);
    if (!samples) throw new Error(`clip ${src.clip} not loaded`);
    const gain = clipGainPa(samples, fs, src.level_1m_db);
    const scaled = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) scaled[i] = samples[i] * gain;
    return scaled;
  });
  // Moving sources are rendered piecewise from the clip itself (see movingSignal), so they need no full spectrum.
  const spectra = timed(profile, 'clip_spectra', () => scenario.sources.map((src, si) => (isMoving(src) ? null : rfft(scaledClips[si], n))));
  // The path table (diagnostics, plots) of a moving source is taken half way through its clip.
  const sourcePositions = scenario.sources.map((src, si) => referencePosition(src, scaledClips[si].length / fs));
  const truePositions = scenario.nodes.map((node, ni) => trueMicPositions(node, ni, settings));
  const table = timed(profile, 'path_table', () => computePathTable(scenario, (node) => truePositions[scenario.nodes.indexOf(node)], c, (_, si) => sourcePositions[si]));
  return {
    scenario, settings, fs, total, n, bins, c, spectra, scaled: scaledClips, sourcePositions, table, truePositions,
    toDigital: digitalPerPa(settings.spl_ref_db, settings.dbfs_ref_db),
    absorb: absorptionTable(bins, fs, n, settings)
  };
}

// Complex diffraction filter of a wedge path: evaluated once on a 1/12-octave grid, interpolated to the render bins.
function diffractionFilterBins(ctx, path) {
  if (!ctx.diffMap) {
    ctx.diffFreqs = diffractionGrid(ctx.fs);
    ctx.diffMap = gridMap(ctx.bins, ctx.fs, ctx.n, ctx.diffFreqs);
  }
  return diffractionOnGrid(path.diffraction, ctx.diffFreqs, ctx.c);
}

function addWedgePath(ctx, X, path, tau, accRe, accIm, kMax, record, k1k) {
  const { fs, n, absorb } = ctx;
  const g0 = path.gain / Math.max(path.length, 1);
  const lnAtt = (path.length * Math.LN10) / 20;
  const { re: gRe, im: gIm } = diffractionFilterBins(ctx, path);
  const { idx, frac } = ctx.diffMap;
  const step = (2 * Math.PI * fs * tau) / n;
  const dr = Math.cos(step);
  const di = Math.sin(step);
  let cr = 1;
  let ci = 0;
  let g1k = null;
  const top = Math.min(kMax, ctx.bins - 2);
  for (let k = 0; k <= top; k++) {
    if (k === 0 || ((k - 1) & 1023) === 0) {
      cr = Math.cos(k * step);
      ci = Math.sin(k * step);
    } else {
      const nr = cr * dr - ci * di;
      ci = cr * di + ci * dr;
      cr = nr;
    }
    const i = idx[k];
    const t = frac[k];
    const Dr = gRe[i] + t * (gRe[i + 1] - gRe[i]);
    const Di = gIm[i] + t * (gIm[i + 1] - gIm[i]);
    const g = g0 * Math.exp(-absorb[k] * lnAtt);
    if (k === k1k) g1k = g * Math.hypot(Dr, Di);
    // (cos - j sin) * D * g
    const wr = g * (cr * Dr + ci * Di);
    const wi = g * (cr * Di - ci * Dr);
    if (k === 0) {
      accRe[0] += X.re[0] * wr;
      continue;
    }
    accRe[k] += X.re[k] * wr - X.im[k] * wi;
    accIm[k] += X.re[k] * wi + X.im[k] * wr;
  }
  record?.push({
    type: path.type,
    surfaces: path.surfaces,
    delay_samples: tau * fs,
    gain_db_1khz: 20 * Math.log10(g1k ?? g0),
    filter: `spreading ${path.diffraction.chain} r=${path.length.toFixed(3)} m; bounce gain ${path.gain.toFixed(4)} (incl. UTD spreading); air absorption ${ctx.settings.air_absorption ? 'ISO 9613-1' : 'off'}; ${WEDGE_DESCRIPTION}; ${path.diffraction.terms.length} edge(s) ${path.surfaces.join('+')}`
  });
}

// One non-moving path: delay by tau seconds, spreading, absorption and (for edge paths) diffraction, added into acc.
function addPath(ctx, X, path, tau, accRe, accIm, kMax, record, k1k) {
  const { fs, n, absorb } = ctx;
  const g0 = path.gain / Math.max(path.length, 1);
  const lnAtt = (path.length * Math.LN10) / 20;
  if (path.diffraction) {
    addWedgePath(ctx, X, path, tau, accRe, accIm, kMax, record, k1k);
    return;
  }
  const diffracted = path.type === 'diffracted';
  const delta = diffracted ? path.length - path.direct_distance : 0;
  const step = (2 * Math.PI * fs * tau) / n;
  const dr = Math.cos(step);
  const di = Math.sin(step);
  let cr = 1;
  let ci = 0;
  let g1k = null;
  const top = Math.min(kMax, ctx.bins - 2);
  for (let k = 1; k <= top; k++) {
    // Rotate incrementally, re-anchoring often enough to keep rounding drift negligible.
    if (((k - 1) & 1023) === 0) {
      cr = Math.cos(k * step);
      ci = Math.sin(k * step);
    } else {
      const nr = cr * dr - ci * di;
      ci = cr * di + ci * dr;
      cr = nr;
    }
    let g = g0 * Math.exp(-absorb[k] * lnAtt);
    if (diffracted) g *= 10 ** (-diffractionLossDb(delta, (k * fs) / n, ctx.c) / 20);
    if (k === k1k) g1k = g;
    const c = cr * g;
    const s = ci * g;
    accRe[k] += X.re[k] * c + X.im[k] * s;
    accIm[k] += X.im[k] * c - X.re[k] * s;
  }
  // DC goes through the same filter chain: skipping the losses here would put a single-bin step
  // in the magnitude response, which spreads as a constant pedestal across the whole impulse
  // response (measured: -32 dB IR tail, which broke the reference-renderer comparison).
  let gDC = g0 * Math.exp(-absorb[0] * lnAtt);
  if (diffracted) gDC *= 10 ** (-diffractionLossDb(delta, 0, ctx.c) / 20);
  accRe[0] += X.re[0] * gDC;
  record?.push({
    type: path.type,
    surfaces: path.surfaces,
    delay_samples: tau * fs,
    gain_db_1khz: 20 * Math.log10(g1k ?? g0),
    filter: `spreading 1/max(r,1), r=${path.length.toFixed(3)} m; bounce gain ${path.gain}; air absorption ${ctx.settings.air_absorption ? 'ISO 9613-1' : 'off'}${diffracted ? `; diffraction 10log10(3+20N) cap 20 dB, delta=${delta.toFixed(3)} m` : ''}`
  });
}

/**
 * Adds one source's spectrum, through the chosen paths, into the accumulators.
 * pathFilter(path) selects which paths count (all, direct only, one type...). kMax limits the highest bin.
 * When record is given, every applied path is pushed as the render stage actually applies it:
 * { type, surfaces, delay_samples, gain_db_1khz, filter } — the audit reads these back, never geometry.
 * at = { ni, mi } names the receiving mic; it is required for a moving source, whose paths change along its
 * route and are found here (pathList, the paths at the reference position, is then ignored and nothing is recorded).
 */
export function addSourceSpectrum(ctx, si, pathList, accRe, accIm, pathFilter = null, kMax = ctx.bins - 2, record = null, at = null) {
  const src = ctx.scenario.sources[si];
  if (isMoving(src)) {
    if (!at) throw new Error(`source ${src.id} moves: addSourceSpectrum needs the receiving mic`);
    addMovingSource(ctx, si, at, accRe, accIm, pathFilter, kMax);
    return;
  }
  const X = ctx.spectra[si];
  const k1k = Math.round((1000 * ctx.n) / ctx.fs);
  for (const path of pathList) {
    if (pathFilter && !pathFilter(path)) continue;
    addPath(ctx, X, path, src.start_s + path.delay_s, accRe, accIm, kMax, record, k1k);
  }
}

const MOVING_PAD = 2048;
const MOVING_SPREAD = 2048;

// Smaller render context for one crossfaded piece of a moving source (same filters, transform size m).
function pieceContext(ctx, m) {
  ctx.pieceCtx ??= new Map();
  let p = ctx.pieceCtx.get(m);
  if (!p) {
    const bins = m / 2 + 1;
    p = { fs: ctx.fs, n: m, bins, c: ctx.c, settings: ctx.settings, absorb: absorptionTable(bins, ctx.fs, m, ctx.settings) };
    ctx.pieceCtx.set(m, p);
  }
  return p;
}

function movingPaths(ctx, pos, mic) {
  const { settings } = ctx;
  ctx.geom ??= { buildings: ctx.scenario.buildings || [], surfaces: buildSurfaces(ctx.scenario.buildings || []), graphs: new Map() };
  const { buildings, surfaces, graphs } = ctx.geom;
  let graph;
  if (settings.diffraction_model === 'wedge' && (settings.diffraction_order ?? 0) >= 1) {
    const key = pos.join(',');
    graph = graphs.get(key);
    if (!graph) graphs.set(key, (graph = buildSourceGraph(pos, { settings, buildings, surfaces })));
  }
  return findPaths(pos, mic, { settings, buildings, surfaces, c: ctx.c, graph }).paths;
}

/**
 * Time signal (length ctx.n) of a moving source at one mic. The clip is split into overlapping pieces with linear
 * crossfades (weights summing to 1) between knots along the route; each piece goes through the paths found from the
 * source position at its knot, so delays, levels and occlusion follow the motion (Doppler arises from the changing
 * delays, approximated piecewise).
 */
function movingSignal(ctx, si, at, pathFilter) {
  const { fs, n, scenario } = ctx;
  const src = scenario.sources[si];
  const clip = ctx.scaled[si];
  const L = clip.length;
  const S = src.start_s;
  const knots = motionKnots(src, S, S + L / fs);
  const mic = at.mi == null ? scenario.nodes[at.ni].position : ctx.truePositions[at.ni][at.mi];
  const out = new Float64Array(n);
  const pathCache = new Map();
  for (let j = 0; j < knots.length; j++) {
    const a = j === 0 ? 0 : Math.max(0, Math.ceil((knots[j - 1] - S) * fs));
    const b = j === knots.length - 1 ? L : Math.min(L, Math.floor((knots[j + 1] - S) * fs) + 1);
    if (b <= a) continue;
    const pos = positionAt(src, knots[j]);
    const key = pos.join(',');
    let paths = pathCache.get(key);
    if (!paths) pathCache.set(key, (paths = movingPaths(ctx, pos, mic)));
    const used = pathFilter ? paths.filter(pathFilter) : paths;
    if (!used.length) continue;
    const tA = S + a / fs;
    const seg = new Float32Array(b - a);
    for (let i = a; i < b; i++) seg[i - a] = clip[i] * hatWeight(knots, j, S + i / fs);
    // Late echoes spread the delays far beyond one piece: rather than one transform long enough for all of them,
    // paths are grouped by delay so each group fits a transform of size m (one forward FFT, one inverse per group).
    const m = nextPow2(b - a + 2 * MOVING_PAD + 1 + MOVING_SPREAD);
    const room = m - (b - a) - 2 * MOVING_PAD - 1;
    const piece = pieceContext(ctx, m);
    const X = rfft(seg, m);
    const sorted = [...used].sort((p, q) => p.delay_s - q.delay_s);
    for (let g0 = 0; g0 < sorted.length; ) {
      const minTau = sorted[g0].delay_s;
      let g1 = g0 + 1;
      while (g1 < sorted.length && Math.ceil((sorted[g1].delay_s - minTau) * fs) <= room) g1++;
      const B = Math.floor((tA + minTau) * fs) - MOVING_PAD;
      const accRe = new Float64Array(piece.bins);
      const accIm = new Float64Array(piece.bins);
      for (let pi = g0; pi < g1; pi++) addPath(piece, X, sorted[pi], tA + sorted[pi].delay_s - B / fs, accRe, accIm, piece.bins - 2, null, -1);
      const y = irfft(accRe, accIm, m);
      const q0 = Math.max(0, -B);
      const q1 = Math.min(m, n - B);
      for (let q = q0; q < q1; q++) out[B + q] += y[q];
      g0 = g1;
    }
  }
  return out;
}

function addMovingSource(ctx, si, at, accRe, accIm, pathFilter, kMax) {
  // The activity pass re-reads mic 0 with all paths right after the main render produced it: keep that one spectrum.
  const key = !pathFilter && at.mi === 0 ? `${si}:${at.ni}` : null;
  ctx.movingCache ??= new Map();
  let X = key ? ctx.movingCache.get(key) : null;
  if (!X) {
    X = rfft(movingSignal(ctx, si, at, pathFilter), ctx.n);
    if (key) ctx.movingCache.set(key, X);
  }
  const top = Math.min(kMax, ctx.bins - 2);
  accRe[0] += X.re[0];
  for (let k = 1; k <= top; k++) {
    accRe[k] += X.re[k];
    accIm[k] += X.im[k];
  }
}

/** Ambient and self noise for one mic, in Pascals, kept separate so sums keep the original order. */
export function noiseForMic(ctx, ni, mi, common = null) {
  const { settings, total } = ctx;
  if (settings.noise_enabled === false) return { amb: new Float32Array(total), self: new Float32Array(total) };
  const amb = pinkNoise(streamFor(settings.seed, ni, mi, 1), total, dbToPa(settings.noise_floor_db_spl));
  const rho = settings.noise_correlation || 0;
  if (rho > 0 && common) {
    const a = Math.sqrt(rho);
    const b = Math.sqrt(1 - rho);
    for (let i = 0; i < total; i++) amb[i] = a * common[i] + b * amb[i];
  }
  const self = whiteNoise(streamFor(settings.seed, ni, mi, 2), total, dbToPa(settings.mic_self_noise_db_spl));
  return { amb, self };
}

export const commonNoise = (ctx, ni) =>
  ctx.settings.noise_enabled !== false && ctx.settings.noise_correlation > 0 ? pinkNoise(streamFor(ctx.settings.seed, ni, 0, 14), ctx.total, dbToPa(ctx.settings.noise_floor_db_spl)) : null;

export const micGainFor = (ctx, ni, mi) => ctx.toDigital * micGain(ctx.settings, ni, mi);

/**
 * Renders every mic signal for every node. Clips must already be at render_sample_rate.
 * clips: Map clipId -> Float32Array. Returns digital-float signals.
 */
export function renderScenario(scenario, clips, { lengthS, onProgress, profile = null } = {}) {
  const ctx = prepareRender(scenario, clips, lengthS, profile);
  const { total, n, bins } = ctx;
  const nodes = [];
  const activity = [];
  const audit = [];
  const jobs = scenario.nodes.length * 4;
  let done = 0;
  scenario.nodes.forEach((node, ni) => {
    const common = commonNoise(ctx, ni);
    const auditNode = [];
    const mics = ctx.truePositions[ni].map((_, mi) => {
      const accRe = new Float64Array(bins);
      const accIm = new Float64Array(bins);
      const auditMic = scenario.sources.map(() => []);
      const out = timed(profile, 'mic_render', () => {
        scenario.sources.forEach((_, si) => addSourceSpectrum(ctx, si, ctx.table[ni].perMic[mi][si].paths, accRe, accIm, null, ctx.bins - 2, auditMic[si], { ni, mi }));
        const full = irfft(accRe, accIm, n);
        const o = new Float32Array(total);
        for (let i = 0; i < total; i++) o[i] = full[i];
        return o;
      });
      auditNode.push(auditMic);
      const { amb, self } = timed(profile, 'noise', () => noiseForMic(ctx, ni, mi, common));
      const g = micGainFor(ctx, ni, mi);
      for (let i = 0; i < total; i++) out[i] = (out[i] + amb[i] + self[i]) * g;
      onProgress?.(++done / jobs);
      return out;
    });
    nodes.push({ id: node.id, mic_positions: micPositions(node), mic_positions_true: ctx.truePositions[ni], mics });
    activity.push(timed(profile, 'activity', () => computeActivity(ctx, ni)));
    audit.push(auditNode);
  });
  return { sample_rate: ctx.fs, length: total, nodes, paths: ctx.table, source_positions: ctx.sourcePositions, activity, audit };
}
