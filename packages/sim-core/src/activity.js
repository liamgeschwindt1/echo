// Per-source, band-limited power at the reference mic (mic 1), without rendering full-rate signals per source.
import { irfft, rfft } from './dsp.js';
import { addSourceSpectrum, commonNoise, micGainFor, noiseForMic } from './render.js';

export const FRAME_S = 0.01;
const DEC = 8;

// Raised-cosine band edges (20% wide) so a hard cut-off does not ring for seconds and stretch the active windows.
export function bandWeight(f, band) {
  const [lo, hi] = band;
  const loStart = lo * 0.8;
  const hiEnd = hi * 1.2;
  if (f <= loStart || f >= hiEnd) return 0;
  if (f < lo) return 0.5 - 0.5 * Math.cos((Math.PI * (f - loStart)) / (lo - loStart));
  if (f > hi) return 0.5 + 0.5 * Math.cos((Math.PI * (f - hi)) / (hiEnd - hi));
  return 1;
}

// Own-contribution power per 10 ms frame in the localisation band: all paths, and the direct path alone.
export function computeActivity(ctx, ni) {
  const { settings, n, fs, bins, scenario, total } = ctx;
  const band = settings.localisation_band_hz;
  const m = n / DEC;
  const kMax = m / 2;
  const frameLen = Math.round((FRAME_S * fs) / DEC);
  const frames = Math.floor(total / (fs * FRAME_S));
  const g = micGainFor(ctx, ni, 0);
  const lo = Math.max(1, Math.ceil((band[0] * 0.8 * n) / fs));
  const hi = Math.min(m / 2 - 1, Math.floor((band[1] * 1.2 * n) / fs));

  const powerFrames = (filter, si) => {
    const accRe = new Float64Array(bins);
    const accIm = new Float64Array(bins);
    addSourceSpectrum(ctx, si, ctx.table[ni].perMic[0][si].paths, accRe, accIm, filter, kMax, null, { ni, mi: 0 });
    const hRe = new Float64Array(m / 2 + 1);
    const hIm = new Float64Array(m / 2 + 1);
    for (let k = lo; k <= hi; k++) {
      const w = bandWeight((k * fs) / n, band);
      hRe[k] = accRe[k] * w;
      hIm[k] = accIm[k] * w;
    }
    // The size-m inverse transform scales by 1/m instead of 1/n, so the decimated samples are DEC times too large.
    const x = irfft(hRe, hIm, m);
    const out = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0;
      for (let i = f * frameLen; i < (f + 1) * frameLen; i++) {
        const v = (x[i] / DEC) * g;
        s += v * v;
      }
      out[f] = s / frameLen;
    }
    return out;
  };

  const perSource = scenario.sources.map((_, si) => ({ all: powerFrames(null, si), direct: powerFrames((p) => p.type === 'direct', si) }));

  // Noise power in the same band, measured on the generated noise itself.
  const { amb, self } = noiseForMic(ctx, ni, 0, commonNoise(ctx, ni));
  const noise = new Float32Array(total);
  for (let i = 0; i < total; i++) noise[i] = (amb[i] + self[i]) * g;
  const X = rfft(noise, n);
  const nlo = Math.max(1, Math.ceil((band[0] * 0.8 * n) / fs));
  const nhi = Math.min(n / 2 - 1, Math.floor((band[1] * 1.2 * n) / fs));
  let acc = 0;
  for (let k = nlo; k <= nhi; k++) {
    const w = bandWeight((k * fs) / n, band);
    acc += w * w * (X.re[k] * X.re[k] + X.im[k] * X.im[k]);
  }
  return { frame_s: FRAME_S, per_source: perSource, noise_band_power: (2 * acc) / (n * total) };
}
