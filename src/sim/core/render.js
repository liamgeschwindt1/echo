import { airAbsorptionDbPerM, dbToPa, digitalPerPa, distance, speedOfSound } from './physics.js';
import { irfft, nextPow2, rfft } from './dsp.js';
import { micPositions } from './mics.js';
import { pinkNoise, streamFor, whiteNoise } from './rng.js';
import { sourcePosition } from './scenario.js';

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

// Direct plus ground-reflected path descriptors from a source to one mic.
export function pathsTo(srcPos, micPos, settings) {
  const c = speedOfSound(settings.temperature_c);
  const paths = [{ r: distance(srcPos, micPos), gain: 1, kind: 'direct' }];
  if (settings.ground_reflectivity > 0) {
    paths.push({ r: distance([srcPos[0], srcPos[1], -srcPos[2]], micPos), gain: settings.ground_reflectivity, kind: 'ground' });
  }
  return paths.map((p) => ({ ...p, delay_s: p.r / c }));
}

function absorptionTable(bins, fs, n, settings) {
  const t = new Float64Array(bins);
  if (!settings.air_absorption) return t;
  for (let k = 0; k < bins; k++) t[k] = airAbsorptionDbPerM((k * fs) / n, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa);
  return t;
}

/**
 * Renders every mic signal for every node. Clips must already be at render_sample_rate.
 * clips: Map clipId -> Float32Array. Returns digital-float signals.
 */
export function renderScenario(scenario, clips, { lengthS, onProgress } = {}) {
  const { settings } = scenario;
  const fs = settings.render_sample_rate;
  const total = Math.ceil(lengthS * fs);
  const n = nextPow2(total);
  const bins = n / 2 + 1;
  const toDigital = digitalPerPa(settings.spl_ref_db, settings.dbfs_ref_db);
  const absorb = absorptionTable(bins, fs, n, settings);

  const spectra = scenario.sources.map((src) => {
    const samples = clips.get(src.clip);
    if (!samples) throw new Error(`clip ${src.clip} not loaded`);
    const gain = clipGainPa(samples, fs, src.level_1m_db);
    const scaled = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) scaled[i] = samples[i] * gain;
    return rfft(scaled, n);
  });

  const nodes = [];
  const jobs = scenario.nodes.length * 4;
  let done = 0;
  scenario.nodes.forEach((node, ni) => {
    const positions = micPositions(node);
    const mics = positions.map((mp, mi) => {
      const accRe = new Float64Array(bins);
      const accIm = new Float64Array(bins);
      scenario.sources.forEach((src, si) => {
        const X = spectra[si];
        const sp = sourcePosition(src);
        for (const path of pathsTo(sp, mp, settings)) {
          const g0 = path.gain / Math.max(path.r, 1);
          const tau = src.start_s + path.delay_s;
          const lnAtt = (path.r * Math.LN10) / 20;
          const step = (2 * Math.PI * fs * tau) / n;
          const dr = Math.cos(step);
          const di = Math.sin(step);
          let cr = 1;
          let ci = 0;
          for (let k = 1; k < bins - 1; k++) {
            // Rotate incrementally, re-anchoring often enough to keep rounding drift negligible.
            if (((k - 1) & 1023) === 0) {
              cr = Math.cos(k * step);
              ci = Math.sin(k * step);
            } else {
              const nr = cr * dr - ci * di;
              ci = cr * di + ci * dr;
              cr = nr;
            }
            const g = g0 * Math.exp(-absorb[k] * lnAtt);
            const c = cr * g;
            const s = ci * g;
            accRe[k] += X.re[k] * c + X.im[k] * s;
            accIm[k] += X.im[k] * c - X.re[k] * s;
          }
          accRe[0] += X.re[0] * g0;
        }
      });
      const full = irfft(accRe, accIm, n);
      const out = new Float32Array(total);
      for (let i = 0; i < total; i++) out[i] = full[i];

      const amb = pinkNoise(streamFor(settings.seed, ni, mi, 1), total, dbToPa(settings.noise_floor_db_spl));
      const self = whiteNoise(streamFor(settings.seed, ni, mi, 2), total, dbToPa(settings.mic_self_noise_db_spl));
      for (let i = 0; i < total; i++) out[i] = (out[i] + amb[i] + self[i]) * toDigital;
      onProgress?.(++done / jobs);
      return out;
    });
    nodes.push({ id: node.id, mic_positions: positions, mics });
  });
  return { sample_rate: fs, length: total, nodes };
}
