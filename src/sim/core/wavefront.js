import { fft } from './dsp.js';

const HOP_S = 0.01;

// Per 10 ms frame: rms (clip units), spectral centroid (Hz) and flatness (0..1).
export function analyseClip(samples, sampleRate) {
  const hop = Math.round(HOP_S * sampleRate);
  const frames = Math.ceil(samples.length / hop);
  const rms = new Float32Array(frames);
  const centroid = new Float32Array(frames);
  const flatness = new Float32Array(frames);
  const n = 512;
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let f = 0; f < frames; f++) {
    const a = f * hop;
    const b = Math.min(samples.length, a + hop);
    let s = 0;
    for (let i = a; i < b; i++) s += samples[i] * samples[i];
    rms[f] = Math.sqrt(s / Math.max(1, b - a));
    if (rms[f] === 0) continue;
    re.fill(0);
    im.fill(0);
    const mid = Math.max(0, Math.min(samples.length - n, a + (hop >> 1) - (n >> 1)));
    for (let i = 0; i < n; i++) re[i] = (samples[mid + i] || 0) * win[i];
    fft(re, im);
    let sum = 0;
    let weighted = 0;
    let logSum = 0;
    const bins = n / 2;
    for (let k = 1; k < bins; k++) {
      const p = re[k] * re[k] + im[k] * im[k] + 1e-20;
      sum += p;
      weighted += p * ((k * sampleRate) / n);
      logSum += Math.log(p);
    }
    centroid[f] = weighted / sum;
    flatness[f] = Math.exp(logSum / (bins - 1)) / (sum / (bins - 1));
  }
  return { hop_s: HOP_S, rms, centroid, flatness };
}

// Radius of the sphere cross-section on the slice plane; null before arrival.
export function sliceRadius(c, dt, dz) {
  if (dt <= 0) return null;
  const r2 = (c * dt) ** 2 - dz * dz;
  return r2 > 0 ? Math.sqrt(r2) : null;
}

/**
 * Rings on the slice plane at time t. Each carries the clip frame that left the source
 * at t - r/c, scaled by 1/r exactly as the render does. gainPa is clipGainPa for the source.
 */
export function wavefrontRings({ analysis, gainPa, startS, t, c, dz, floorPa, maxRings = 150 }) {
  const { hop_s, rms, centroid, flatness } = analysis;
  const age = t - startS;
  if (age <= 0) return [];
  const last = Math.min(rms.length - 1, Math.floor(age / hop_s));
  const candidates = [];
  for (let f = 0; f <= last; f++) {
    const r3 = c * (age - f * hop_s);
    const rho = sliceRadius(c, (age - f * hop_s), dz);
    if (rho === null) continue;
    const amp = (rms[f] * gainPa) / Math.max(r3, 1);
    if (amp < floorPa) continue;
    candidates.push({ radius: rho, amp, centroid: centroid[f], flatness: flatness[f] });
  }
  if (candidates.length <= maxRings) return candidates;
  const stride = Math.ceil(candidates.length / maxRings);
  const out = [];
  for (let i = 0; i < candidates.length; i += stride) {
    let best = candidates[i];
    for (let j = i; j < Math.min(candidates.length, i + stride); j++) if (candidates[j].amp > best.amp) best = candidates[j];
    out.push(best);
  }
  return out;
}
