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

// Positive lag means the sound reaches mic i later than mic j (tdoa = t_i - t_j).
export function gccPhat(a, b, { fs, band, maxLagS }) {
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
  const fsUp = fs * UPSAMPLE;
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
  for (const [i, j] of MIC_PAIRS) {
    const { tdoa_s } = gccPhat(
      { signal: mics[i], start: startSample, end: endSample },
      { signal: mics[j], start: startSample, end: endSample },
      { fs, band, maxLagS: spacing / c }
    );
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
  if (planar) {
    const h = solve3([[ata[0][0], ata[0][1], 0], [ata[1][0], ata[1][1], 0], [0, 0, 1]], [atb[0], atb[1], 0]);
    if (!h) return null;
    const horiz = Math.hypot(h[0], h[1]);
    const scale = horiz > 1 ? 1 / horiz : 1;
    d = [h[0] * scale, h[1] * scale, -Math.sqrt(Math.max(0, 1 - (horiz * scale) ** 2))];
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
  return {
    direction: d,
    azimuth_deg: (Math.atan2(d[1], d[0]) * 180) / Math.PI,
    elevation_deg: (Math.asin(Math.max(-1, Math.min(1, d[2]))) * 180) / Math.PI,
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
  let maxAngle = 0;
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      const ang = angleBetweenDeg(rays[i].direction, rays[j].direction);
      maxAngle = Math.max(maxAngle, Math.min(ang, 180 - ang));
    }
  }
  const position = solve3(m, v);
  const poorly_conditioned = !position || maxAngle < minAngleDeg;
  return { position, max_angle_deg: maxAngle, poorly_conditioned };
}
