// Time-resolved field data for the heatmap: per cell the strongest arrivals (delay + per-band pressure gain) from findPaths
// (direct, reflected and diffracted), and per-band 10 ms clip envelopes. Pulse and peak-hold maps are incoherent sums
// (no interference): sum over arrivals of amp^2 x clip band envelope power at (t - delay). Pure and deterministic.
import { findPaths, buildSurfaces, buildingBox, buildSourceGraph } from './geometry.js';
import { airAbsorptionDbPerM, speedOfSound, P_REF_PA } from './physics.js';
import { diffractionResponse } from './diffraction.js';
import { diffractionLossDb } from './geometry.js';
import { REACH_BANDS, gridPositions, gridSize, noiseBandPowerPa2 } from './reach.js';
import { bandWeight } from './activity.js';
import { fft, nextPow2 } from './dsp.js';
import { clipGainPa } from './render.js';
import { hatWeight, isMoving, motionSpan, pathLength, positionAt } from './motion.js';

export const FIELD_FRAME_S = 0.01;
export const FIELD_BANDS = ['250', '1k', '4k', 'loc'];
export const DEFAULT_TOP_N = 16;
export const DEFAULT_MEMORY_BUDGET_BYTES = 64 * 1024 * 1024;

/** Per-band (250 Hz, 1 kHz, 4 kHz octaves, localisation band) mean-square envelope of a clip in 10 ms frames, clip units^2. */
export function clipBandEnvelopes(samples, fs, locBand) {
  const n = nextPow2(samples.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(samples.subarray(0, Math.min(samples.length, n)));
  fft(re, im);
  const frameLen = Math.round(FIELD_FRAME_S * fs);
  const frames = Math.ceil(samples.length / frameLen);
  const bands = [];
  for (let b = 0; b < 4; b++) {
    const wr = new Float64Array(n);
    const wi = new Float64Array(n);
    for (let k = 1; k < n / 2; k++) {
      const f = (k * fs) / n;
      const w = b < 3 ? (f >= REACH_BANDS[b].lo && f < REACH_BANDS[b].hi ? 1 : 0) : bandWeight(f, locBand);
      if (!w) continue;
      wr[k] = re[k] * w;
      wi[k] = im[k] * w;
      wr[n - k] = re[n - k] * w;
      wi[n - k] = im[n - k] * w;
    }
    fft(wr, wi, true);
    const env = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0;
      const end = Math.min(samples.length, (f + 1) * frameLen);
      for (let i = f * frameLen; i < end; i++) s += wr[i] * wr[i];
      env[f] = s / frameLen;
    }
    bands.push(env);
  }
  return { frame_s: FIELD_FRAME_S, bands };
}

/** Bytes needed by the arrival store: cells x arrivals x (1 delay + 4 band amplitudes) x 4 bytes, per source. */
export const estimateFieldBytes = (cells, sources, topN) => cells * sources * topN * 5 * 4;

/** Coarsens the cell size (doubling) until the estimate fits the budget. Returns { grid, coarsened, bytes }. */
export function fitGridToBudget(grid, sources, topN = DEFAULT_TOP_N, budget = DEFAULT_MEMORY_BUDGET_BYTES) {
  let g = grid;
  let coarsened = false;
  while (estimateFieldBytes(gridSize(g).nx * gridSize(g).ny, sources, topN) > budget && g.cell < 1e4) {
    const nx = Math.ceil(g.nx / 2);
    const ny = Math.ceil(g.ny / 2);
    g = { ...g, cell: g.cell * 2, nx, ny };
    coarsened = true;
  }
  return { grid: g, coarsened, bytes: estimateFieldBytes(g.nx * g.ny, sources, topN) };
}

// Pressure-squared gain of one path in the four bands (unit source power): spreading, bounces, air, diffraction.
function pathBandGains2(path, settings, c, air) {
  const r = Math.max(path.length, 1);
  const g2 = (path.gain / r) ** 2;
  const f = [REACH_BANDS[0].fc, REACH_BANDS[1].fc, REACH_BANDS[2].fc, Math.sqrt(settings.localisation_band_hz[0] * settings.localisation_band_hz[1])];
  return f.map((fc, b) => {
    let e = g2 * 10 ** (-(air[b] * path.length) / 10);
    if (path.diffraction) {
      const [re, im] = diffractionResponse(path.diffraction, fc, c);
      e *= re * re + im * im;
    } else if (path.type === 'diffracted') e *= 10 ** (-diffractionLossDb(path.length - path.direct_distance, fc, c) / 10);
    return e;
  });
}

/**
 * Strongest topN arrivals per cell for each source. sources: [{ position, start_s, gainPa }].
 * Returns { nx, ny, mask, topN, perSource: [{ count: Uint8Array, delay: Float32Array, amp2: Float32Array (cells*topN*4) }] }.
 */
export function computeFieldArrivals({ sources, settings, buildings = [], grid, topN = DEFAULT_TOP_N, onProgress }) {
  const c = speedOfSound(settings.temperature_c);
  const mapSettings = { ...settings, reflection_order: settings.reach_reflection_order ?? 2 };
  const surfaces = buildSurfaces(buildings);
  const boxes = buildings.map(buildingBox);
  const pts = gridPositions(grid);
  const { nx, ny } = gridSize(grid);
  const air = [...REACH_BANDS.map((b) => b.fc), Math.sqrt(settings.localisation_band_hz[0] * settings.localisation_band_hz[1])].map((fc) =>
    settings.air_absorption ? airAbsorptionDbPerM(fc, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa) : 0
  );
  const mask = new Uint8Array(pts.length);
  pts.forEach((p, i) => {
    if (boxes.some((b) => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] < b.max[2])) mask[i] = 1;
  });
  const wedgeOn = mapSettings.diffraction_model === 'wedge' && (mapSettings.diffraction_order ?? 0) >= 1;
  const perSource = sources.map((src, si) => {
    const count = new Uint8Array(pts.length);
    const delay = new Float32Array(pts.length * topN);
    const amp2 = new Float32Array(pts.length * topN * 4);
    const imagesCache = new Map();
    const graph = wedgeOn ? buildSourceGraph(src.position, { settings: mapSettings, buildings, surfaces }) : undefined;
    pts.forEach((p, i) => {
      if (mask[i]) return;
      const { paths } = findPaths(src.position, p, { settings: mapSettings, buildings, surfaces, c, imagesCache, graph });
      const rows = paths.map((path) => {
        const a = pathBandGains2(path, mapSettings, c, air);
        return { d: path.length / c, a, w: a[0] + a[1] + a[2] };
      });
      rows.sort((x, y) => y.w - x.w);
      const keep = rows.slice(0, topN);
      count[i] = keep.length;
      keep.forEach((row, k) => {
        delay[i * topN + k] = row.d;
        for (let b = 0; b < 4; b++) amp2[(i * topN + k) * 4 + b] = row.a[b];
      });
    });
    onProgress?.((si + 1) / sources.length);
    return { start_s: src.start_s, gainPa: src.gainPa, count, delay, amp2 };
  });
  return { nx, ny, mask, topN, perSource };
}


/** Power in Pa^2 per cell at time t in one band, summed over sources and arrivals. envelopes[si] = clipBandEnvelopes(...). */
export function pulsePower(field, envelopes, band, t, out = new Float64Array(field.nx * field.ny)) {
  out.fill(0);
  const { topN } = field;
  field.perSource.forEach((s, si) => {
    const env = envelopes[si].bands[band];
    const g2 = s.gainPa * s.gainPa;
    for (let i = 0; i < out.length; i++) {
      const n = s.count[i];
      let acc = 0;
      for (let k = 0; k < n; k++) {
        const f = Math.floor((t - s.start_s - s.delay[i * topN + k]) / FIELD_FRAME_S);
        if (f < 0 || f >= env.length) continue;
        acc += s.amp2[(i * topN + k) * 4 + band] * env[f];
      }
      out[i] += g2 * acc;
    }
  });
  return out;
}

/** Running maximum of the pulse power over all frame times up to tEnd. */
export function peakHoldPower(field, envelopes, band, tEnd) {
  const out = new Float64Array(field.nx * field.ny);
  const cur = new Float64Array(out.length);
  for (let t = 0; t <= tEnd + 1e-9; t += FIELD_FRAME_S) {
    pulsePower(field, envelopes, band, t, cur);
    for (let i = 0; i < out.length; i++) if (cur[i] > out[i]) out[i] = cur[i];
  }
  return out;
}

/** Pa^2 to dB SPL, or dB above the noise power when noisePa2 is given. Masked cells are NaN. */
export function powerToDb(power, mask, noisePa2 = null) {
  const out = new Float32Array(power.length);
  for (let i = 0; i < power.length; i++) {
    if (mask[i]) out[i] = NaN;
    else if (noisePa2) out[i] = 10 * Math.log10(Math.max(power[i], 1e-30) / noisePa2);
    else out[i] = 10 * Math.log10(Math.max(power[i], 1e-30) / (P_REF_PA * P_REF_PA));
  }
  return out;
}

/**
 * Source descriptors for the field from a scenario and clip map. A moving source becomes a few sub-sources at points
 * along its route (one per knot, at most 5), each carrying the knots so its clip envelope can be crossfaded with
 * weightEnvelopes. Every descriptor keeps the scenario source id.
 */
export function fieldSources(scenario, clips, onlyIndex = null) {
  const fs = scenario.settings.render_sample_rate;
  return scenario.sources
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => onlyIndex === null || i === onlyIndex)
    .flatMap(({ s }) => {
      const clip = clips.get(s.clip);
      const base = { id: s.id, start_s: s.start_s, gainPa: clipGainPa(clip, fs, s.level_1m_db), clip: s.clip };
      if (!isMoving(s)) return [{ ...base, position: s.keyframes[0].position }];
      const S = s.start_s;
      const E = S + clip.length / fs;
      const [t0, t1] = motionSpan(s);
      const a = Math.max(S, t0);
      const b = Math.min(E, t1);
      const knots = [S, E];
      if (b > a) {
        const k = Math.min(5, Math.max(2, Math.ceil(pathLength(s) / 20) + 1));
        for (let i = 0; i < k; i++) knots.push(a + ((b - a) * i) / (k - 1));
      }
      knots.sort((x, y) => x - y);
      const uniq = knots.filter((t, i) => i === 0 || t - knots[i - 1] > 1e-6);
      const positions = uniq.map((t) => positionAt(s, t));
      if (positions.every((p) => p.every((v, k) => v === positions[0][k]))) return [{ ...base, position: positions[0] }];
      return uniq.map((t, j) => ({ ...base, position: positions[j], knots: uniq, knot: j }));
    });
}

/** Clip envelopes for the field sources: crossfaded (power weights summing to 1) for the parts of moving sources. */
export function fieldEnvelopes(sources, clips, fs, locBand) {
  const cache = new Map();
  return sources.map((s) => {
    let env = cache.get(s.clip);
    if (!env) cache.set(s.clip, (env = clipBandEnvelopes(clips.get(s.clip), fs, locBand)));
    if (!s.knots) return env;
    const w = (f) => hatWeight(s.knots, s.knot, s.start_s + (f + 0.5) * env.frame_s);
    return { frame_s: env.frame_s, bands: env.bands.map((band) => band.map((v, f) => v * w(f))) };
  });
}

export { noiseBandPowerPa2 };
