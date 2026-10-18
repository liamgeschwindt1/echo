import { airAbsorptionDbPerM, dbToPa, P_REF_PA, speedOfSound } from './physics.js';
import { buildingBox, buildSurfaces, diffractionLossDb, findPaths, insideBuilding } from './geometry.js';
import { clipGainPa } from './render.js';
import { nextPow2, rfft } from './dsp.js';
import { bandWeight } from './activity.js';
import { DEFAULT_SETTINGS } from './scenario.js';

// Two-octave, non-overlapping bands. Total means 125–8000 Hz, not broadband.
export const FIELD_BANDS = Object.freeze([
  Object.freeze({ centre_hz: 250, low_hz: 125, high_hz: 500 }),
  Object.freeze({ centre_hz: 1000, low_hz: 500, high_hz: 2000 }),
  Object.freeze({ centre_hz: 4000, low_hz: 2000, high_hz: 8000 })
]);
export const FIELD_LIMITS = Object.freeze({ maxCells: 60000, maxClipSamples: 4194304, maxCandidateTests: 30000000 });
const db = (power) => power > 0 ? 10 * Math.log10(power / (P_REF_PA * P_REF_PA)) : -Infinity;
const snr = (power, noise) => power > 0 ? (noise > 0 ? 10 * Math.log10(power / noise) : Infinity) : -Infinity;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

function peakWindow(samples, fs) {
  const w = Math.min(samples.length, Math.max(1, Math.round(fs * 0.125)));
  let power = 0;
  for (let i = 0; i < w; i++) power += samples[i] ** 2;
  let best = power;
  let start = 0;
  for (let i = w; i < samples.length; i++) {
    power += samples[i] ** 2 - samples[i - w] ** 2;
    if (power > best) { best = power; start = i - w + 1; }
  }
  return samples.subarray(start, start + w);
}

// Analytic transfer function of the same Kellet filter used by rng.pinkNoise.
export function pinkNoisePowerDensity(f, fs) {
  const poles = [0.99886, 0.99332, 0.969, 0.8665, 0.55, -0.7616];
  const gains = [0.0555179, 0.0750759, 0.153852, 0.3104856, 0.5329522, -0.016898];
  const angle = 2 * Math.PI * f / fs;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let re = 0.5362 + 0.115926 * c;
  let im = -0.115926 * s;
  for (let i = 0; i < poles.length; i++) {
    const a = 1 - poles[i] * c;
    const b = poles[i] * s;
    const den = a * a + b * b;
    re += gains[i] * a / den;
    im -= gains[i] * b / den;
  }
  return re * re + im * im;
}

// Deterministic quadrature of analytic noise PSD, not a random noise realization.
export function fieldNoisePowers(settings) {
  const fs = settings.render_sample_rate;
  const bands = [0, 0, 0];
  let loc = 0;
  let norm = 0;
  let locWhite = 0;
  const white = [0, 0, 0];
  const steps = 32768;
  for (let k = 0; k < steps; k++) {
    const f = (k + 0.5) * fs / (2 * steps);
    const pink = pinkNoisePowerDensity(f, fs);
    norm += pink;
    for (let b = 0; b < 3; b++) if (f >= FIELD_BANDS[b].low_hz && f < FIELD_BANDS[b].high_hz) { bands[b] += pink; white[b]++; }
    const w = bandWeight(f, settings.localisation_band_hz) ** 2;
    loc += pink * w;
    locWhite += w;
  }
  const ambient = settings.noise_off ? 0 : dbToPa(settings.noise_floor_db_spl) ** 2;
  const self = settings.noise_off ? 0 : dbToPa(settings.mic_self_noise_db_spl) ** 2;
  return {
    band_pa2: bands.map((p, i) => ambient * p / norm + self * white[i] / steps),
    localisation_pa2: ambient * loc / norm + self * locWhite / steps,
    model: 'Analytic stationary Kellet pink ambient + white self noise; localisation raised-cosine weights squared'
  };
}

export function prepareField(scenario, clips, { sourceId } = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...scenario.settings };
  if (!Number.isInteger(settings.reach_reflection_order) || settings.reach_reflection_order < 0 || settings.reach_reflection_order > 2) throw new Error('reach_reflection_order must be 0, 1 or 2');
  if (!Number.isFinite(settings.render_sample_rate) || settings.render_sample_rate < 4000 || settings.render_sample_rate > 192000) throw new Error('invalid render_sample_rate');
  const band = settings.localisation_band_hz;
  if (!Array.isArray(band) || band.length !== 2 || !band.every(Number.isFinite) || band[0] <= 0 || band[1] <= band[0] || band[1] >= settings.render_sample_rate / 2) throw new Error('invalid localisation_band_hz');
  const fs = settings.render_sample_rate;
  const selected = scenario.sources.filter((s) => sourceId == null || s.id === sourceId);
  if (sourceId != null && !selected.length) throw new Error(`unknown source ${sourceId}`);
  const sources = selected.map((source) => {
    const samples = clips.get(source.clip);
    if (!samples?.length) throw new Error(`clip ${source.clip} not loaded or empty`);
    if (samples.length > FIELD_LIMITS.maxClipSamples) throw new Error(`clip ${source.clip} exceeds ${FIELD_LIMITS.maxClipSamples} samples`);
    const position = source.keyframes?.[0]?.position;
    if (!Number.isFinite(source.level_1m_db) || !Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) || position[2] < 0) throw new Error(`invalid source ${source.id}`);
    const gain = clipGainPa(samples, fs, source.level_1m_db);
    const window = peakWindow(samples, fs);
    const n = nextPow2(window.length);
    const X = rfft(window, n);
    const powers = [0, 0, 0];
    const locPower = new Float64Array(24);
    const locFreq = Array.from({ length: 24 }, (_, i) => band[0] * 0.8 * (band[1] * 1.2 / (band[0] * 0.8)) ** ((i + 0.5) / 24));
    for (let k = 1; k < X.re.length; k++) {
      const f = k * fs / n;
      const p = (k === n / 2 ? 1 : 2) * (X.re[k] ** 2 + X.im[k] ** 2) * gain ** 2 / (n * window.length);
      for (let b = 0; b < 3; b++) if (f >= FIELD_BANDS[b].low_hz && f < FIELD_BANDS[b].high_hz) powers[b] += p;
      const w = bandWeight(f, band);
      if (w > 0) {
        const i = Math.min(23, Math.max(0, Math.floor(24 * Math.log(f / (band[0] * 0.8)) / Math.log(band[1] * 1.2 / (band[0] * 0.8)))));
        locPower[i] += p * w * w;
      }
    }
    return { source, band_pa2: powers, locPower, locFreq };
  });
  const buildings = scenario.buildings || [];
  const surfaces = buildSurfaces(buildings);
  const frequencies = [...FIELD_BANDS.map((b) => b.centre_hz), ...(sources[0]?.locFreq || [])];
  const absorption = frequencies.map((f) => settings.air_absorption ? airAbsorptionDbPerM(f, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa) : 0);
  return {
    settings, sources, buildings, surfaces, c: speedOfSound(settings.temperature_c), frequencies, absorption,
    pathSettings: { ...settings, reflection_order: settings.reach_reflection_order },
    noise: fieldNoisePowers(settings),
    metadata: {
      bands: FIELD_BANDS,
      level_definition: 'Loudest 125 ms source window; incoherent path/source energy sum; band-centre attenuation',
      snr_definition: '125–8000 Hz signal / analytic same-band noise',
      localisation_snr_definition: 'Incoherent peak-125-ms localisation-band estimate at point, not analyseScenario coherent active-window mic-1 snr_db',
      reflection_order: settings.reach_reflection_order
    }
  };
}

export function evaluatePoint(ctx, position) {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) || position[2] < 0) throw new Error('field point must be finite [x,y,z] above ground');
  if (insideBuilding(position, ctx.buildings)) return { masked: true, total_db_spl: NaN, snr_db: NaN, localisation_snr_db: NaN, band_db_spl: [NaN, NaN, NaN], noise_db_spl: NaN, path_count: 0, capped: false };
  const powers = [0, 0, 0];
  let localisation = 0;
  let count = 0;
  let capped = false;
  for (const source of ctx.sources) {
    const result = findPaths(source.source.keyframes[0].position, position, { settings: ctx.pathSettings, buildings: ctx.buildings, surfaces: ctx.surfaces, c: ctx.c, audit: false });
    capped ||= result.capped;
    count += result.paths.length;
    for (const path of result.paths) {
      const geometric = (path.gain / Math.max(1, path.length)) ** 2;
      for (let i = 0; i < ctx.frequencies.length; i++) {
        const diffraction = path.type === 'diffracted' ? diffractionLossDb(path.length - path.direct_distance, ctx.frequencies[i], ctx.c) : 0;
        const transfer = geometric * 10 ** (-(ctx.absorption[i] * path.length + diffraction) / 10);
        if (i < 3) powers[i] += source.band_pa2[i] * transfer;
        else localisation += source.locPower[i - 3] * transfer;
      }
    }
  }
  const total = sum(powers);
  const noise = sum(ctx.noise.band_pa2);
  return { masked: false, total_db_spl: db(total), snr_db: snr(total, noise), localisation_snr_db: snr(localisation, ctx.noise.localisation_pa2), band_db_spl: powers.map(db), noise_db_spl: db(noise), band_pa2: powers, localisation_pa2: localisation, path_count: count, capped };
}

function validateSampling(ctx, width, height) {
  const cells = width * height;
  if (!Number.isSafeInteger(cells) || cells > FIELD_LIMITS.maxCells) throw new Error(`field requests ${cells} samples; limit ${FIELD_LIMITS.maxCells}; increase cellSizeM or reduce bounds`);
  const n = ctx.surfaces.length;
  const order = ctx.settings.reach_reflection_order;
  const candidates = order === 0 ? 1 : n + (order === 2 ? n * (n - 1) : 0);
  if (cells * ctx.sources.length * candidates > FIELD_LIMITS.maxCandidateTests) throw new Error('field path search exceeds work limit; reduce bounds, reflection order or building count');
}

function sample(ctx, width, height, pointAt, onProgress) {
  validateSampling(ctx, width, height);
  const count = width * height;
  const result = {
    width, height, total_db_spl: new Float32Array(count), snr_db: new Float32Array(count),
    localisation_snr_db: new Float32Array(count), band_db_spl: Array.from({ length: 3 }, () => new Float32Array(count)),
    mask: new Uint8Array(count), capped_points: 0, metadata: ctx.metadata
  };
  onProgress?.(0);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const point = evaluatePoint(ctx, pointAt(col, row));
      for (const key of ['total_db_spl', 'snr_db', 'localisation_snr_db']) result[key][i] = point[key];
      for (let b = 0; b < 3; b++) result.band_db_spl[b][i] = point.band_db_spl[b];
      result.mask[i] = point.masked ? 1 : 0;
      if (point.capped) result.capped_points++;
    }
    onProgress?.((row + 1) / height);
  }
  return result;
}

function cellSize(ctx, value) {
  const cell = value ?? ctx.settings.reach_cell_m;
  if (!Number.isFinite(cell) || cell <= 0) throw new Error('cellSizeM must be positive');
  return cell;
}

const cellCentre = (index, step, extent) => index * step + Math.min(step, extent - index * step) / 2;

export function computeGrid(ctx, { bounds, cellSizeM, z = ctx.settings.slice_height_m, onProgress } = {}) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new Error('bounds must be [xmin,ymin,xmax,ymax] with positive extents');
  if (!Number.isFinite(z) || z < 0) throw new Error('slice height must be nonnegative');
  const cell = cellSize(ctx, cellSizeM);
  const width = Math.ceil((bounds[2] - bounds[0]) / cell);
  const height = Math.ceil((bounds[3] - bounds[1]) / cell);
  const result = sample(ctx, width, height, (x, y) => [bounds[0] + cellCentre(x, cell, bounds[2] - bounds[0]), bounds[1] + cellCentre(y, cell, bounds[3] - bounds[1]), z], onProgress);
  return { ...result, bounds, cellSizeM: cell, z, sampling: 'cell centres, including partial boundary cells; row 0 at minimum y' };
}

export function computeSection(ctx, { start, end, zMin = 0, zMax, cellSizeM, onProgress } = {}) {
  if (![start, end].every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) || !Number.isFinite(zMin) || !Number.isFinite(zMax) || zMin < 0 || zMax <= zMin) throw new Error('section needs finite start/end [x,y] and 0 <= zMin < zMax');
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (!length) throw new Error('section endpoints must differ');
  const cell = cellSize(ctx, cellSizeM);
  const width = Math.ceil(length / cell);
  const height = Math.ceil((zMax - zMin) / cell);
  const result = sample(ctx, width, height, (x, y) => {
    const t = cellCentre(x, cell, length) / length;
    return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t, zMin + cellCentre(y, cell, zMax - zMin)];
  }, onProgress);
  return { ...result, start, end, zMin, zMax, length_m: length, cellSizeM: cell };
}

export function sectionBuildings(buildings, start, end) {
  if (![start, end].every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) throw new Error('section endpoints must be finite [x,y]');
  const delta = [end[0] - start[0], end[1] - start[1]];
  const length = Math.hypot(...delta);
  if (!length) throw new Error('section endpoints must differ');
  const result = [];
  for (const building of buildings || []) {
    const box = buildingBox(building);
    let lo = 0;
    let hi = 1;
    for (let axis = 0; axis < 2; axis++) {
      if (Math.abs(delta[axis]) < 1e-12) {
        if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) { hi = -1; break; }
      } else {
        const a = (box.min[axis] - start[axis]) / delta[axis];
        const b = (box.max[axis] - start[axis]) / delta[axis];
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
    }
    if (hi > lo) result.push({ id: building.id, start_m: lo * length, end_m: hi * length, height_m: box.max[2] });
  }
  return result.sort((a, b) => a.start_m - b.start_m);
}
