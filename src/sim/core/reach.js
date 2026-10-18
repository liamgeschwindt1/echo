// Reach map and side-view cross-sections: where a source's sound actually reaches, in 3D.
// Every path comes from findPaths (the same finder the mic render, the map and the rings use);
// paths are summed energetically (incoherent) per band. No interference, no phase.
import { findPaths, buildSurfaces, buildingBox, diffractionLossDb } from './geometry.js';
import { airAbsorptionDbPerM, dbToPa, speedOfSound, P_REF_PA } from './physics.js';
import { rfft, nextPow2 } from './dsp.js';
import { clipGainPa } from './render.js';
import { bandWeight } from './activity.js';
import { pinkNoise, whiteNoise, streamFor } from './rng.js';

// Octave bands for the map. Air absorption and diffraction are evaluated at the band centre.
export const REACH_BANDS = [
  { id: '250', fc: 250, lo: 250 / Math.SQRT2, hi: 250 * Math.SQRT2 },
  { id: '1k', fc: 1000, lo: 1000 / Math.SQRT2, hi: 1000 * Math.SQRT2 },
  { id: '4k', fc: 4000, lo: 4000 / Math.SQRT2, hi: 4000 * Math.SQRT2 }
];

// Mean power per band (clip units squared) of the whole clip, Parseval on the zero-padded spectrum.
// Index 3 is the localisation band with the same raised-cosine weighting the analyser uses, so the
// SNR view is directly comparable to a node's snr_db.
export function clipBandPowers(samples, fs, locBand) {
  const n = nextPow2(samples.length);
  const X = rfft(samples, n);
  const out = [0, 0, 0, 0];
  for (let k = 1; k < n / 2; k++) {
    const p = X.re[k] * X.re[k] + X.im[k] * X.im[k];
    if (p === 0) continue;
    const f = (k * fs) / n;
    for (let b = 0; b < 3; b++) if (f >= REACH_BANDS[b].lo && f < REACH_BANDS[b].hi) out[b] += p;
    const w = bandWeight(f, locBand);
    if (w > 0) out[3] += w * w * p;
  }
  return out.map((s) => (2 * s) / (n * samples.length));
}

/**
 * Band levels for one source, in Pa^2 at 1 m: whole-clip mean band power scaled by clipGainPa,
 * exactly the gain the render applies. (For a stationary clip the mean equals the loudest 125 ms
 * window that level_1m_db calibrates; impulsive clips read lower here than their loudest moment.)
 */
export function sourceBandLevels(samples, fs, level1mDb, locBand) {
  const g = clipGainPa(samples, fs, level1mDb);
  return clipBandPowers(samples, fs, locBand).map((p) => p * g * g);
}

/**
 * Mean in-band power of the ambient plus self noise, in Pa^2, measured on noise generated with the
 * same algorithm and weighting as the analyser (fixed reference stream). Deterministic.
 */
export function noiseBandPowerPa2(settings, fs = 48000, seconds = 4) {
  const total = seconds * fs;
  const n = nextPow2(total);
  const band = settings.localisation_band_hz;
  const amb = pinkNoise(streamFor(settings.seed ?? 1, 0, 0, 1), total, dbToPa(settings.noise_floor_db_spl));
  const self = whiteNoise(streamFor(settings.seed ?? 1, 0, 0, 2), total, dbToPa(settings.mic_self_noise_db_spl));
  const mix = new Float32Array(total);
  for (let i = 0; i < total; i++) mix[i] = amb[i] + self[i];
  const X = rfft(mix, n);
  const lo = Math.max(1, Math.ceil((band[0] * 0.8 * n) / fs));
  const hi = Math.min(n / 2 - 1, Math.floor((band[1] * 1.2 * n) / fs));
  let acc = 0;
  for (let k = lo; k <= hi; k++) {
    const w = bandWeight((k * fs) / n, band);
    acc += w * w * (X.re[k] * X.re[k] + X.im[k] * X.im[k]);
  }
  return (2 * acc) / (n * total);
}

// Positions for a grid spec, row-major. plan: {kind:'plan', x0, y0, cell, nx, ny, z}. section: {kind:'section', a, b, ns, nz, zmax}.
export function gridPositions(grid) {
  if (grid.kind === 'plan') {
    const pts = [];
    for (let iy = 0; iy < grid.ny; iy++) for (let ix = 0; ix < grid.nx; ix++) pts.push([grid.x0 + (ix + 0.5) * grid.cell, grid.y0 + (iy + 0.5) * grid.cell, grid.z]);
    return pts;
  }
  const [ax, ay] = grid.a;
  const [bx, by] = grid.b;
  const pts = [];
  for (let iz = 0; iz < grid.nz; iz++) {
    const z = ((iz + 0.5) / grid.nz) * grid.zmax;
    for (let is = 0; is < grid.ns; is++) {
      const u = (is + 0.5) / grid.ns;
      pts.push([ax + u * (bx - ax), ay + u * (by - ay), z]);
    }
  }
  return pts;
}

export const gridSize = (grid) => (grid.kind === 'plan' ? { nx: grid.nx, ny: grid.ny } : { nx: grid.ns, ny: grid.nz });

/**
 * Energetic (incoherent) band powers at a receiver, given the shared path list.
 * bandPa2: [p250, p1k, p4k, pLoc] source powers in Pa^2 at 1 m. Returns the same four, at the receiver.
 * Per path and band: spreading 1/r^2 (1 m floor), per-bounce pressure gains squared, air absorption
 * at the band centre, diffraction loss at the band centre.
 */
export function pathsBandPowers(paths, bandPa2, settings, c) {
  const absorb = REACH_BANDS.map((b) => (settings.air_absorption ? airAbsorptionDbPerM(b.fc, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa) : 0));
  const locFc = Math.sqrt(settings.localisation_band_hz[0] * settings.localisation_band_hz[1]);
  const absorbLoc = settings.air_absorption ? airAbsorptionDbPerM(locFc, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa) : 0;
  const out = [0, 0, 0, 0];
  for (const path of paths) {
    const r = Math.max(path.length, 1);
    const g2 = (path.gain / r) ** 2;
    const delta = path.type === 'diffracted' ? path.length - path.direct_distance : 0;
    for (let b = 0; b < 3; b++) {
      let e = bandPa2[b] * g2 * 10 ** (-(absorb[b] * path.length) / 10);
      if (delta) e *= 10 ** (-diffractionLossDb(delta, REACH_BANDS[b].fc, c) / 10);
      out[b] += e;
    }
    let e = bandPa2[3] * g2 * 10 ** (-(absorbLoc * path.length) / 10);
    if (delta) e *= 10 ** (-diffractionLossDb(delta, locFc, c) / 10);
    out[3] += e;
  }
  return out;
}

/**
 * The energetic field over a grid. sources: [{ position, bandPa2: [p250, p1k, p4k, pLoc] }].
 * Returns { levelDb, snrDb, mask, nx, ny }. Masked cells (inside a building) are NaN.
 * levelDb: 10 log10(sum of the three octave bands) in dB SPL. snrDb: localisation-band power
 * over noisePa2 (60 dB when noise is switched off). The map's reflection order is
 * settings.reach_reflection_order (default 2); diffraction follows settings.diffraction_order.
 */
export function computeReachField({ sources, settings, buildings = [], grid, noisePa2, onProgress }) {
  const c = speedOfSound(settings.temperature_c);
  const mapSettings = { ...settings, reflection_order: settings.reach_reflection_order ?? 2 };
  const surfaces = buildSurfaces(buildings);
  const boxes = buildings.map(buildingBox);
  const pts = gridPositions(grid);
  const { nx, ny } = gridSize(grid);
  const levelDb = new Float32Array(pts.length);
  const snrDb = new Float32Array(pts.length);
  const mask = new Uint8Array(pts.length);
  pts.forEach((p, i) => {
    if (boxes.some((b) => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] < b.max[2])) {
      mask[i] = 1;
      levelDb[i] = snrDb[i] = NaN;
    }
  });
  const pw = new Float64Array(pts.length);
  const pwLoc = new Float64Array(pts.length);
  for (const [si, src] of sources.entries()) {
    // Per-source image cache so findPaths does not re-mirror the same sequences for every cell.
    const imagesCache = new Map();
    pts.forEach((p, i) => {
      if (mask[i]) return;
      const { paths } = findPaths(src.position, p, { settings: mapSettings, buildings, surfaces, c, imagesCache });
      const e = pathsBandPowers(paths, src.bandPa2, mapSettings, c);
      pw[i] += e[0] + e[1] + e[2];
      pwLoc[i] += e[3];
    });
    onProgress?.((si + 1) / sources.length);
  }
  pts.forEach((_, i) => {
    if (mask[i]) return;
    levelDb[i] = pw[i] > 0 ? 10 * Math.log10(pw[i] / (P_REF_PA * P_REF_PA)) : -120;
    snrDb[i] = noisePa2 > 0 ? 10 * Math.log10(Math.max(pwLoc[i], 1e-30) / noisePa2) : 60;
  });
  return { levelDb, snrDb, mask, nx, ny };
}
