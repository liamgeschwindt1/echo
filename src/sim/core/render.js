import { airAbsorptionDbPerM, dbToPa, digitalPerPa, speedOfSound } from './physics.js';
import { irfft, nextPow2, rfft } from './dsp.js';
import { micPositions } from './mics.js';
import { gaussian, pinkNoise, streamFor, whiteNoise } from './rng.js';
import { computePathTable, diffractionLossDb, findPaths } from './geometry.js';
import { computeActivity } from './activity.js';

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
export function prepareRender(scenario, clips, lengthS) {
  const { settings } = scenario;
  const fs = settings.render_sample_rate;
  const total = Math.ceil(lengthS * fs);
  const n = nextPow2(total);
  const bins = n / 2 + 1;
  const c = speedOfSound(settings.temperature_c);
  const spectra = scenario.sources.map((src) => {
    const samples = clips.get(src.clip);
    if (!samples) throw new Error(`clip ${src.clip} not loaded`);
    const gain = clipGainPa(samples, fs, src.level_1m_db);
    const scaled = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) scaled[i] = samples[i] * gain;
    return rfft(scaled, n);
  });
  const truePositions = scenario.nodes.map((node, ni) => trueMicPositions(node, ni, settings));
  const table = computePathTable(scenario, (node) => truePositions[scenario.nodes.indexOf(node)], c);
  return {
    scenario, settings, fs, total, n, bins, c, spectra, table, truePositions,
    toDigital: digitalPerPa(settings.spl_ref_db, settings.dbfs_ref_db),
    absorb: absorptionTable(bins, fs, n, settings)
  };
}

/**
 * Adds one source's spectrum, through the chosen paths, into the accumulators.
 * pathFilter(path) selects which paths count (all, direct only, one type...). kMax limits the highest bin.
 * When record is given, every applied path is pushed as the render stage actually applies it:
 * { type, surfaces, delay_samples, gain_db_1khz, filter } — the audit reads these back, never geometry.
 */
export function addSourceSpectrum(ctx, si, pathList, accRe, accIm, pathFilter = null, kMax = ctx.bins - 2, record = null) {
  const { fs, n, absorb } = ctx;
  const src = ctx.scenario.sources[si];
  const X = ctx.spectra[si];
  const k1k = Math.round((1000 * n) / fs);
  for (const path of pathList) {
    if (pathFilter && !pathFilter(path)) continue;
    const g0 = path.gain / Math.max(path.length, 1);
    const tau = src.start_s + path.delay_s;
    const lnAtt = (path.length * Math.LN10) / 20;
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
export function renderScenario(scenario, clips, { lengthS, onProgress } = {}) {
  const ctx = prepareRender(scenario, clips, lengthS);
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
      scenario.sources.forEach((_, si) => addSourceSpectrum(ctx, si, ctx.table[ni].perMic[mi][si].paths, accRe, accIm, null, ctx.bins - 2, auditMic[si]));
      auditNode.push(auditMic);
      const full = irfft(accRe, accIm, n);
      const out = new Float32Array(total);
      for (let i = 0; i < total; i++) out[i] = full[i];
      const { amb, self } = noiseForMic(ctx, ni, mi, common);
      const g = micGainFor(ctx, ni, mi);
      for (let i = 0; i < total; i++) out[i] = (out[i] + amb[i] + self[i]) * g;
      onProgress?.(++done / jobs);
      return out;
    });
    nodes.push({ id: node.id, mic_positions: micPositions(node), mic_positions_true: ctx.truePositions[ni], mics });
    activity.push(computeActivity(ctx, ni));
    audit.push(auditNode);
  });
  return { sample_rate: ctx.fs, length: total, nodes, paths: ctx.table, activity, audit };
}
