import { fft, nextPow2 } from './dsp.js';
import { MIC_PAIRS } from './mics.js';
import { distance } from './physics.js';

const UPSAMPLE = 4;

// Hann-windowed segment spectrum (half) at size n.
function segmentSpectrum(signal, start, end, n) {
  const len = end - start;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < len; i++) re[i] = signal[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / len));
  fft(re, im);
  return { re, im };
}

// Phase-transform cross-correlation, 4x up-sampled, restricted to the band. Index l (mod big) is lag l / fsUp.
function correlate(a, b, { fs, band }) {
  const len = a.end - a.start;
  const n = nextPow2(len * 2);
  const A = segmentSpectrum(a.signal, a.start, a.end, n);
  const B = segmentSpectrum(b.signal, b.start, b.end, n);
  const big = n * UPSAMPLE;
  const re = new Float64Array(big);
  const im = new Float64Array(big);
  const lo = Math.ceil((band[0] * n) / fs);
  const hi = Math.min(n / 2 - 1, Math.floor((band[1] * n) / fs));
  for (let k = Math.max(1, lo); k <= hi; k++) {
    const cr = A.re[k] * B.re[k] + A.im[k] * B.im[k];
    const ci = A.im[k] * B.re[k] - A.re[k] * B.im[k];
    const m = Math.hypot(cr, ci) || 1;
    re[k] = cr / m;
    im[k] = ci / m;
    re[big - k] = cr / m;
    im[big - k] = -ci / m;
  }
  fft(re, im, true);
  return { re, big, fsUp: fs * UPSAMPLE };
}

// Positive lag means the sound reaches mic i later than mic j (tdoa = t_i - t_j).
export function gccPhat(a, b, { fs, band, maxLagS }) {
  const { re, big, fsUp } = correlate(a, b, { fs, band });
  const maxLag = Math.ceil(maxLagS * fsUp) + UPSAMPLE;
  let best = -Infinity;
  let bestLag = 0;
  for (let l = -maxLag; l <= maxLag; l++) {
    const v = re[(l + big) % big];
    if (v > best) {
      best = v;
      bestLag = l;
    }
  }
  const y0 = re[(bestLag + big) % big];
  const ym = re[(bestLag - 1 + big) % big];
  const yp = re[(bestLag + 1 + big) % big];
  const denom = ym - 2 * y0 + yp;
  const frac = denom === 0 ? 0 : (0.5 * (ym - yp)) / denom;
  return { tdoa_s: (bestLag + frac) / fsUp, peak: best };
}

/** The whole correlation over the physical lag range, plus its local peaks, for plotting multipath. */
export function gccCurve(a, b, { fs, band, maxLagS }) {
  const { re, big, fsUp } = correlate(a, b, { fs, band });
  const maxLag = Math.ceil(maxLagS * fsUp) + UPSAMPLE;
  const lags = [];
  const values = [];
  for (let l = -maxLag; l <= maxLag; l++) {
    lags.push(l / fsUp);
    values.push(re[(l + big) % big]);
  }
  const top = Math.max(...values);
  const peaks = [];
  for (let i = 1; i < values.length - 1; i++) if (values[i] > values[i - 1] && values[i] >= values[i + 1] && values[i] > 0.3 * top) peaks.push({ lag_s: lags[i], value: values[i] });
  peaks.sort((x, y) => y.value - x.value);
  return { lags_s: lags, values, peaks: peaks.slice(0, 6), est_lag_s: peaks[0]?.lag_s ?? 0 };
}

// Spectra of the Hann-windowed segments of two real signals from ONE complex FFT (one in the real part, one in the imaginary part).
// Only bins lo..hi are kept: the correlation is band limited.
function pairSpectra(sigA, sigB, start, end, n, lo, hi) {
  const len = end - start;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / len);
    re[i] = sigA[start + i] * w;
    im[i] = sigB[start + i] * w;
  }
  fft(re, im);
  const size = hi + 1;
  const A = { re: new Float64Array(size), im: new Float64Array(size) };
  const B = { re: new Float64Array(size), im: new Float64Array(size) };
  for (let k = lo; k <= hi; k++) {
    const zr = re[k];
    const zi = im[k];
    const cr = re[(n - k) % n];
    const ci = -im[(n - k) % n];
    // Z = A + jB with A, B Hermitian: A = (Z[k] + conj(Z[n-k])) / 2, B = (Z[k] - conj(Z[n-k])) / (2j)
    A.re[k] = 0.5 * (zr + cr);
    A.im[k] = 0.5 * (zi + ci);
    B.re[k] = 0.5 * (zi - ci);
    B.im[k] = -0.5 * (zr - cr);
  }
  return { A, B };
}

// PHAT-weighted correlation at integer up-sampled lags -maxLag..maxLag (inclusive) by direct summation over the band bins.
// Identical to the inverse transform of the zero-padded, up-sampled band spectrum, without computing the whole transform.
function bandCorrelation(X, Y, { n, fs, band, lo, hi, maxLag }) {
  const big = n * UPSAMPLE;
  const count = 2 * maxLag + 1;
  const out = new Float64Array(count);
  for (let k = Math.max(1, lo); k <= hi; k++) {
    const cr = X.re[k] * Y.re[k] + X.im[k] * Y.im[k];
    const ci = X.im[k] * Y.re[k] - X.re[k] * Y.im[k];
    const m = Math.hypot(cr, ci) || 1;
    const xr = cr / m;
    const xi = ci / m;
    const theta = (2 * Math.PI * k) / big;
    const dr = Math.cos(theta);
    const di = Math.sin(theta);
    let pr = Math.cos(theta * maxLag);
    let pi = -Math.sin(theta * maxLag);
    for (let l = 0; l < count; l++) {
      out[l] += xr * pr - xi * pi;
      const nr = pr * dr - pi * di;
      pi = pr * di + pi * dr;
      pr = nr;
    }
  }
  const scale = 2 / big;
  for (let l = 0; l < count; l++) out[l] *= scale;
  return out;
}

// Peak of a lag correlation (lags -maxLag-1 .. maxLag+1 stored) with parabolic refinement, as gccPhat does.
function peakTdoa(corr, maxLag, fsUp) {
  let best = -Infinity;
  let bestLag = 0;
  for (let l = -maxLag; l <= maxLag; l++) {
    const v = corr[l + maxLag + 1];
    if (v > best) {
      best = v;
      bestLag = l;
    }
  }
  const ym = corr[bestLag - 1 + maxLag + 1];
  const yp = corr[bestLag + 1 + maxLag + 1];
  const denom = ym - 2 * best + yp;
  const frac = denom === 0 ? 0 : (0.5 * (ym - yp)) / denom;
  return { tdoa_s: (bestLag + frac) / fsUp, peak: best };
}

/** TDOAs of the six mic pairs for one window: two packed FFTs for four mics, band-limited direct correlation at the needed lags. */
export function windowTdoas(mics, startSample, endSample, { fs, band, maxLagS }) {
  const len = endSample - startSample;
  const n = nextPow2(len * 2);
  const lo = Math.max(1, Math.ceil((band[0] * n) / fs));
  const hi = Math.min(n / 2 - 1, Math.floor((band[1] * n) / fs));
  const fsUp = fs * UPSAMPLE;
  const maxLag = Math.ceil(maxLagS * fsUp) + UPSAMPLE;
  const p01 = pairSpectra(mics[0], mics[1], startSample, endSample, n, lo, hi);
  const p23 = pairSpectra(mics[2], mics[3], startSample, endSample, n, lo, hi);
  const spec = [p01.A, p01.B, p23.A, p23.B];
  return MIC_PAIRS.map(([i, j]) => peakTdoa(bandCorrelation(spec[i], spec[j], { n, fs, band, lo, hi, maxLag: maxLag + 1 }), maxLag, fsUp));
}

function solve3(m, v) {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (Math.abs(a[p][i]) < 1e-12) return null;
    [a[i], a[p]] = [a[p], a[i]];
    for (let r = i + 1; r < 3; r++) {
      const f = a[r][i] / a[i][i];
      for (let c = i; c < 4; c++) a[r][c] -= f * a[i][c];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = a[i][3];
    for (let c = i + 1; c < 3; c++) s -= a[i][c] * x[c];
    x[i] = s / a[i][i];
  }
  return x;
}

/**
 * Far-field bearing for one node and one event window.
 * mics: 4 Float32Arrays; positions: 4 [x,y,z]. Direction points toward the source.
 * A coplanar array cannot resolve up/down, so the source is assumed below the node.
 */
export function estimateBearing({ mics, positions, startSample, endSample, fs, c, band }) {
  const spacing = Math.max(...MIC_PAIRS.map(([i, j]) => distance(positions[i], positions[j])));
  const rows = [];
  const rhs = [];
  const tdoas = windowTdoas(mics, startSample, endSample, { fs, band, maxLagS: spacing / c });
  for (const [pairIdx, [i, j]] of MIC_PAIRS.entries()) {
    const { tdoa_s } = tdoas[pairIdx];
    // t_i - t_j = -(p_i - p_j).u / c  =>  (p_j - p_i).u = c * tdoa
    rows.push([positions[j][0] - positions[i][0], positions[j][1] - positions[i][1], positions[j][2] - positions[i][2]]);
    rhs.push(c * tdoa_s);
  }
  const planar = rows.every((r) => Math.abs(r[2]) < 1e-9);
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb = [0, 0, 0];
  rows.forEach((r, k) => {
    for (let a = 0; a < 3; a++) {
      atb[a] += r[a] * rhs[k];
      for (let b = 0; b < 3; b++) ata[a][b] += r[a] * r[b];
    }
  });
  let d;
  let horizMag = null; // flat arrays only: length of the fitted horizontal direction before any clamping
  if (planar) {
    const h = solve3([[ata[0][0], ata[0][1], 0], [ata[1][0], ata[1][1], 0], [0, 0, 1]], [atb[0], atb[1], 0]);
    if (!h) return null;
    horizMag = Math.hypot(h[0], h[1]);
    const scale = horizMag > 1 ? 1 / horizMag : 1;
    d = [h[0] * scale, h[1] * scale, -Math.sqrt(Math.max(0, 1 - (horizMag * scale) ** 2))];
  } else {
    d = solve3(ata, atb);
    if (!d) return null;
    const norm = Math.hypot(...d) || 1;
    d = d.map((v) => v / norm);
  }
  let sq = 0;
  rows.forEach((r, k) => {
    const e = (r[0] * d[0] + r[1] * d[1] + r[2] * d[2] - rhs[k]) / c;
    sq += e * e;
  });
  const elevation = (Math.asin(Math.max(-1, Math.min(1, d[2]))) * 180) / Math.PI;
  // Flat array: elevation magnitude is acos(|h|), its sign is an assumption (below), and |h| > 1 is impossible and was clamped.
  const elevationRaw = planar ? (horizMag <= 1 ? (Math.acos(horizMag) * 180) / Math.PI : null) : elevation;
  const elevationConfidence = planar ? (horizMag > 1 || Math.abs(elevation) < 15 ? 'low' : 'ok') : Math.abs(elevation) > 80 ? 'low' : 'ok';
  return {
    direction: d,
    azimuth_deg: (Math.atan2(d[1], d[0]) * 180) / Math.PI,
    elevation_deg: elevation,
    elevation_raw_deg: elevationRaw,
    elevation_sign_assumed: planar,
    elevation_confidence: elevationConfidence,
    residual_s: Math.sqrt(sq / rows.length),
    assumed_below: planar
  };
}

export const angleBetweenDeg = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

/**
 * Least-squares point closest to all rays. rays: [{origin, direction, weight}].
 * Poorly conditioned when no pair of rays differs by at least minAngleDeg.
 */
export function intersectRays(rays, { minAngleDeg = 10 } = {}) {
  if (rays.length < 2) return null;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [0, 0, 0];
  for (const { origin, direction: d, weight = 1 } of rays) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const q = weight * ((a === b ? 1 : 0) - d[a] * d[b]);
        m[a][b] += q;
        v[a] += q * origin[b];
      }
    }
  }
  // Angle between the lines (0..90), so antiparallel directions count as parallel.
  let maxAngle = 0;
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      const d1 = rays[i].direction;
      const d2 = rays[j].direction;
      const c = Math.abs(d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]);
      maxAngle = Math.max(maxAngle, (Math.acos(Math.min(1, c)) * 180) / Math.PI);
    }
  }
  const solved = solve3(m, v);
  // Range along each ray must be positive, otherwise the point lies behind a node.
  const ranges = solved ? rays.map((r) => (solved[0] - r.origin[0]) * r.direction[0] + (solved[1] - r.origin[1]) * r.direction[1] + (solved[2] - r.origin[2]) * r.direction[2]) : [];
  const negative_range = ranges.some((t) => !(t > 0));
  const position = negative_range ? null : solved;
  const poorly_conditioned = !position || maxAngle < minAngleDeg;
  return { position, max_angle_deg: maxAngle, poorly_conditioned, negative_range, ranges_m: ranges };
}
