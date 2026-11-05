import { streamFor, gaussian, whiteNoise } from './rng.js';
import { dbToPa } from './physics.js';

export const REALISM_DEFAULTS = Object.freeze({
  clock_offset_sigma_ms: 0, clock_drift_sigma_ppm: 0,
  wind_speed_mps: 0, wind_correlation: 0.8,
  urban_noise_db_spl: 0, rain_noise_db_spl: 0, noise_variation_db: 0
});
export const REALISM_NOTE = 'Opt-in PLACEHOLDER clocks/weather/urban noise; not calibrated to recordings. Wind pressure scales with speed squared, 55 dB SPL at 5 m/s; 140 Hz low-pass. Urban: 250 Hz low-pass plus 75 Hz tone. Rain: broadband plus sparse impacts. Shared-node slow level envelopes and clock resampling are approximations. No inter-node TDOA, housing scattering or phase-response model.';

export function validateRealism(settings) {
  const maximum = { clock_offset_sigma_ms: 60000, clock_drift_sigma_ppm: 10000, wind_speed_mps: 100,
    wind_correlation: 1, urban_noise_db_spl: 160, rain_noise_db_spl: 160, noise_variation_db: 80 };
  for (const [k, fallback] of Object.entries(REALISM_DEFAULTS)) {
    const v = settings[k] ?? fallback;
    if (!Number.isFinite(v) || v < 0 || v > maximum[k]) throw new Error(`Invalid realism setting ${k}`);
  }
}

export function nodeClock(settings, ni) {
  const offset = settings.clock_offset_sigma_ms ?? 0, drift = settings.clock_drift_sigma_ppm ?? 0;
  if (!offset && !drift) return { offset_ms: 0, drift_ppm: 0 };
  const rng = streamFor(settings.seed, ni, 1001);
  const a = gaussian(rng), b = gaussian(rng);
  return {
    offset_ms: offset ? offset * a : 0,
    drift_ppm: drift ? drift * b : 0
  };
}

export function clockSignal(signal, fs, clock) {
  if (!clock.offset_ms && !clock.drift_ppm) return signal;
  const rate = 1 + clock.drift_ppm * 1e-6;
  if (!(rate > 0) || !Number.isFinite(clock.offset_ms) || !Number.isFinite(rate)) throw new Error('Invalid node clock');
  const out = new Float32Array(signal.length), offset = clock.offset_ms * fs / 1000;
  for (let i = 0; i < out.length; i++) {
    const p = (i - offset) / rate, j = Math.floor(p), f = p - j;
    const a = j >= 0 && j < signal.length ? signal[j] : 0;
    const b = j + 1 >= 0 && j + 1 < signal.length ? signal[j + 1] : 0;
    out[i] = a + f * (b - a);
  }
  return out;
}

function rescale(signal, rms) {
  let power = 0;
  for (const x of signal) power += x * x;
  const scale = rms / Math.sqrt(power / signal.length);
  if (!Number.isFinite(scale)) throw new Error('Cannot scale empty/zero realism noise');
  for (let i = 0; i < signal.length; i++) signal[i] *= scale;
  return signal;
}

function lowpassNoise(rng, n, fs, cutoff, rms) {
  const out = whiteNoise(rng, n, 1), a = Math.exp(-2 * Math.PI * cutoff / fs);
  let state = 0;
  for (let i = 0; i < n; i++) { state = a * state + (1 - a) * out[i]; out[i] = state; }
  return rescale(out, rms);
}

export function noiseEnvelope(settings, ni, n, fs) {
  const depth = settings.noise_variation_db ?? 0;
  if (!depth) return null;
  const rng = streamFor(settings.seed, ni, 1002), p = rng() * 2 * Math.PI, q = rng() * 2 * Math.PI;
  return Float32Array.from({ length: n }, (_, i) =>
    10 ** (depth * 0.5 * (Math.sin(2 * Math.PI * 0.19 * i / fs + p) + Math.sin(2 * Math.PI * 0.071 * i / fs + q)) / 20));
}

export function realismNoise(settings, ni, mi, n, fs, cache = new Map()) {
  const speed = settings.wind_speed_mps ?? 0, urban = settings.urban_noise_db_spl ?? 0, rain = settings.rain_noise_db_spl ?? 0;
  if (!speed && !urban && !rain) return null;
  const out = new Float32Array(n);
  if (speed) {
    const rms = dbToPa(55) * (speed / 5) ** 2, correlation = settings.wind_correlation ?? 0.8;
    const key = `${ni}:${n}:${fs}:${speed}`;
    if (!cache.has(key)) cache.set(key, lowpassNoise(streamFor(settings.seed, ni, 1003), n, fs, 140, rms));
    const common = cache.get(key), privateNoise = lowpassNoise(streamFor(settings.seed, ni, mi, 1004), n, fs, 140, rms);
    for (let i = 0; i < n; i++) out[i] += Math.sqrt(correlation) * common[i] + Math.sqrt(1 - correlation) * privateNoise[i];
  }
  if (urban) {
    const x = lowpassNoise(streamFor(settings.seed, ni, mi, 1005), n, fs, 250, 1);
    const phase = streamFor(settings.seed, ni, 1006)() * 2 * Math.PI;
    for (let i = 0; i < n; i++) x[i] += 0.2 * Math.sin(2 * Math.PI * 75 * i / fs + phase);
    rescale(x, dbToPa(urban));
    for (let i = 0; i < n; i++) out[i] += x[i];
  }
  if (rain) {
    const rng = streamFor(settings.seed, ni, mi, 1007), x = whiteNoise(rng, n, 0.5), decay = Math.exp(-1 / (0.004 * fs));
    let impact = 0;
    for (let i = 0; i < n; i++) {
      impact = impact * decay + (rng() < 30 / fs ? gaussian(rng) * 5 : 0);
      x[i] += impact;
    }
    rescale(x, dbToPa(rain));
    for (let i = 0; i < n; i++) out[i] += x[i];
  }
  return out;
}
