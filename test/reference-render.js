// Independent reference renderer, used only by tests. Slow and simple on purpose:
// an explicit impulse response per (source, mic, path) — a windowed-sinc fractional delay
// convolved with a linear-phase FIR for the path's frequency-dependent filter (air absorption,
// diffraction) — applied by direct time-domain convolution and summed. The production render
// (frequency-domain accumulation) must agree with this to below -60 dB.
// Shared with production (the model, not the method): geometry/path list, the absorption and
// diffraction formulas, the level chain constants and the noise generators.
import { findPaths, buildSurfaces, diffractionLossDb } from '../src/sim/core/geometry.js';
import { micPositions } from '../src/sim/core/mics.js';
import { airAbsorptionDbPerM, digitalPerPa, dbToPa, speedOfSound } from '../src/sim/core/physics.js';
import { clipGainPa, noiseForMic, commonNoise } from '../src/sim/core/render.js';
import { irfft } from '../src/sim/core/dsp.js';

// Long on purpose: the zero-phase magnitude response of a diffracted path has a 1/t^1-ish tail
// (the loss curve's cusp at 0 Hz), so a short FIR truncates real energy. Measured truncation
// error of the path IR: +/-2048 taps -54 dB, +/-8192 taps -71 dB, +/-16384 taps -78 dB.
const FIR_LEN = 16384; // magnitude FIR per path (~340 ms at 48 kHz)
const SINC_TAPS = 256; // windowed-sinc fractional delay kernel

// Linear-phase FIR for the path's per-frequency gain (air absorption, diffraction), centred at FIR_LEN/2.
function magnitudeFir(path, fs, settings, c) {
  const M = FIR_LEN;
  const re = new Float64Array(M / 2 + 1);
  const im = new Float64Array(M / 2 + 1);
  const g0 = path.gain / Math.max(path.length, 1);
  const delta = path.type === 'diffracted' ? path.length - path.direct_distance : 0;
  // DC through the same filter chain as every other bin (the production render does this too):
  // a single-bin step at DC would smear a constant pedestal across the whole impulse response.
  re[0] = g0 * (delta ? 10 ** (-diffractionLossDb(delta, 0, c) / 20) : 1);
  for (let k = 1; k < M / 2; k++) {
    const f = (k * fs) / M;
    let g = g0;
    if (settings.air_absorption) g *= 10 ** (-(airAbsorptionDbPerM(f, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa) * path.length) / 20);
    if (delta) g *= 10 ** (-diffractionLossDb(delta, f, c) / 20);
    re[k] = g;
  }
  const ir = irfft(re, im, M); // zero-phase, peak at index 0
  const h = new Float64Array(M);
  for (let i = 0; i < M; i++) h[i] = ir[(i - M / 2 + M) % M]; // shift the peak to M/2
  return h;
}

// Windowed-sinc kernel delaying by frac samples, centred at SINC_TAPS/2.
// Blackman-Harris window: passband ripple stays below about -90 dB up to ~0.9 Nyquist,
// so the delay agrees with the production phase-ramp delay to well under -60 dB for
// in-band signals. (A short Hann kernel rings at -30 dB; measured, hence this length.)
function fracDelayKernel(frac) {
  const h = new Float64Array(SINC_TAPS);
  const half = SINC_TAPS / 2;
  let sum = 0;
  for (let i = 0; i < SINC_TAPS; i++) {
    const x = i - half - frac;
    const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const u = i / (SINC_TAPS - 1);
    const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * u) + 0.14128 * Math.cos(4 * Math.PI * u) - 0.01168 * Math.cos(6 * Math.PI * u);
    h[i] = s * w;
    sum += h[i];
  }
  for (let i = 0; i < SINC_TAPS; i++) h[i] /= sum;
  return h;
}

const convolve = (a, b) => {
  const out = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
};

/**
 * Reference render of every mic of every node. Assumes the default mic-position/gain realism
 * sigmas (0), so the true positions are the nominal ones. Returns Float32Array mics like
 * renderScenario. clips: Map id -> Float32Array at settings.render_sample_rate.
 */
export function referenceRender(scenario, clips, lengthS) {
  const { settings } = scenario;
  const fs = settings.render_sample_rate;
  const total = Math.ceil(lengthS * fs);
  const c = speedOfSound(settings.temperature_c);
  const buildings = scenario.buildings || [];
  const surfaces = buildSurfaces(buildings);
  const toDigital = digitalPerPa(settings.spl_ref_db, settings.dbfs_ref_db);
  const noiseCtx = { settings, total };
  const nodes = scenario.nodes.map((node, ni) => {
    const common = commonNoise(noiseCtx, ni);
    const mics = micPositions(node).map((mp, mi) => {
      const out = new Float64Array(total);
      scenario.sources.forEach((src, si) => {
        const clip = clips.get(src.clip);
        const g = clipGainPa(clip, fs, src.level_1m_db);
        const { paths } = findPaths(src.keyframes[0].position, mp, { settings, buildings, surfaces, c });
        for (const path of paths) {
          const D = (src.start_s + path.delay_s) * fs;
          const Dint = Math.floor(D);
          const h = convolve(magnitudeFir(path, fs, settings, c), fracDelayKernel(D - Dint));
          let peak = 0;
          for (const v of h) peak = Math.max(peak, Math.abs(v));
          // Sparse tap list once per path: the per-sample check would dominate the convolution cost.
          const taps = [];
          for (let j = 0; j < h.length; j++) if (Math.abs(h[j]) >= peak * 1e-8) taps.push(j);
          const base = Dint - (FIR_LEN / 2 + SINC_TAPS / 2);
          for (let i = 0; i < clip.length; i++) {
            const x = clip[i] * g;
            if (x === 0) continue;
            const o = i + base;
            for (const j of taps) {
              const k = o + j;
              if (k >= 0 && k < total) out[k] += x * h[j];
            }
          }
        }
      });
      const { amb, self } = noiseForMic(noiseCtx, ni, mi, common);
      const sig = new Float32Array(total);
      for (let i = 0; i < total; i++) sig[i] = (out[i] + amb[i] + self[i]) * toDigital;
      return sig;
    });
    return { id: node.id, mics };
  });
  return { sample_rate: fs, length: total, nodes };
}

// Relative difference in dB: 20 log10(rms(a-b) / rms(b)).
export function diffDb(a, b) {
  let num = 0;
  let den = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    num += (a[i] - b[i]) ** 2;
    den += b[i] * b[i];
  }
  return 10 * Math.log10(Math.max(num, 1e-30) / Math.max(den, 1e-30));
}
