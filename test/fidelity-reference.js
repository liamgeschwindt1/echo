import { findPaths } from '../src/sim/core/geometry.js';
import { micPositions } from '../src/sim/core/mics.js';
import { airAbsorptionDbPerM, speedOfSound } from '../src/sim/core/physics.js';

export function convolveSlow(signal, kernel) {
  const out = new Float64Array(signal.length + kernel.length - 1);
  for (let i = 0; i < signal.length; i++) for (let j = 0; j < kernel.length; j++) out[i + j] += signal[i] * kernel[j];
  return out;
}

const sinc = (x) => Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);

// Explicit finite IR; no production FFT, spectra, delay rotation, or render helpers.
export function referenceMic(scenario, clips, lengthS, ni = 0, mi = 0, radius = 256) {
  const settings = scenario.settings;
  const fs = settings.render_sample_rate;
  const c = speedOfSound(settings.temperature_c);
  const out = new Float64Array(Math.ceil(lengthS * fs));
  const mic = micPositions(scenario.nodes[ni])[mi];
  for (const src of scenario.sources) {
    const clip = clips.get(src.clip);
    const width = Math.max(1, Math.round(0.125 * fs));
    let best = 0;
    for (let start = 0; start <= Math.max(0, clip.length - width); start++) {
      let energy = 0;
      for (let i = start; i < Math.min(clip.length, start + width); i++) energy += clip[i] ** 2;
      best = Math.max(best, energy / Math.min(width, clip.length));
    }
    const scale = 20e-6 * 10 ** (src.level_1m_db / 20) / Math.sqrt(best);
    const digital = 10 ** (settings.dbfs_ref_db / 20) / (20e-6 * 10 ** (settings.spl_ref_db / 20));
    const paths = findPaths(src.keyframes[0].position, mic, { settings, buildings: scenario.buildings || [], c }).paths;
    for (const path of paths) {
      const delay = (src.start_s + path.delay_s) * fs;
      const integer = Math.floor(delay);
      const fraction = delay - integer;
      const delayIR = Float64Array.from({ length: 2 * radius + 1 }, (_, j) => {
        const x = j - radius - fraction;
        return sinc(x) * (0.5 + 0.5 * Math.cos(Math.PI * x / (radius + 1)));
      });
      const filterIR = new Float64Array(2 * radius + 1);
      if (!settings.air_absorption && path.type !== 'diffracted') filterIR[radius] = 1;
      else {
        const steps = 2048;
        for (let k = 0; k <= steps; k++) {
          const f = k * fs / (2 * steps);
          const airDb = settings.air_absorption ? path.length * airAbsorptionDbPerM(f, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa) : 0;
          const delta = Math.max(0, path.length - (path.direct_distance ?? path.length));
          const diffDb = path.type === 'diffracted' ? Math.min(20, 10 * Math.log10(3 + 40 * delta * f / c)) : 0;
          const amplitude = 10 ** (-(airDb + diffDb) / 20);
          const weight = k === 0 || k === steps ? 0.5 : 1;
          for (let j = 0; j < filterIR.length; j++) filterIR[j] += weight * amplitude * Math.cos(Math.PI * k * (j - radius) / steps) / steps;
        }
        for (let j = 0; j < filterIR.length; j++) filterIR[j] *= 0.5 + 0.5 * Math.cos(Math.PI * (j - radius) / (radius + 1));
      }
      const ir = convolveSlow(filterIR, delayIR);
      const wet = convolveSlow(clip, ir);
      const gain = scale * digital * path.gain / Math.max(path.length, 1);
      for (let j = 0; j < wet.length; j++) {
        const index = integer + j - 2 * radius;
        if (index >= 0 && index < out.length) out[index] += wet[j] * gain;
      }
    }
  }
  return out;
}

export function relativeError(actual, expected) {
  let error = 0;
  let energy = 0;
  for (let i = 0; i < actual.length; i++) {
    error += (actual[i] - expected[i]) ** 2;
    energy += expected[i] ** 2;
  }
  return Math.sqrt(error / Math.max(energy, Number.MIN_VALUE));
}
