const twiddleCache = new Map();

function twiddles(n) {
  let t = twiddleCache.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    t = { cos, sin };
    twiddleCache.set(n, t);
  }
  return t;
}

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

// In-place radix-2 FFT on Float64Arrays; the inverse is scaled by 1/n.
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const { cos, sin } = twiddles(n);
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const wr = cos[w];
        const wi = sign * sin[w];
        const a = i + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

// Half spectrum (bins 0..n/2) of a real signal zero-padded to n.
export function rfft(signal, n) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const m = Math.min(signal.length, n);
  for (let i = 0; i < m; i++) re[i] = signal[i];
  fft(re, im);
  return { re: re.subarray(0, n / 2 + 1), im: im.subarray(0, n / 2 + 1) };
}

// Inverse of a half spectrum back to n real samples.
export function irfft(halfRe, halfIm, n) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const h = n / 2;
  for (let k = 0; k <= h; k++) {
    re[k] = halfRe[k];
    im[k] = halfIm[k];
    if (k > 0 && k < h) {
      re[n - k] = halfRe[k];
      im[n - k] = -halfIm[k];
    }
  }
  im[0] = 0;
  im[h] = 0;
  fft(re, im, true);
  return re;
}

export function resampleLinear(input, srcRate, dstRate) {
  if (srcRate === dstRate) return input;
  const len = Math.round((input.length * dstRate) / srcRate);
  const out = new Float32Array(len);
  const ratio = srcRate / dstRate;
  for (let i = 0; i < len; i++) {
    const p = i * ratio;
    const idx = Math.floor(p);
    const s0 = input[idx] || 0;
    const s1 = idx + 1 < input.length ? input[idx + 1] : s0;
    out[i] = s0 + (s1 - s0) * (p - idx);
  }
  return out;
}

// Windowed-sinc low-pass then decimate, for model-rate downsampling after mixing.
export function resampleSinc(input, srcRate, dstRate, taps = 32) {
  if (srcRate === dstRate) return input;
  const ratio = srcRate / dstRate;
  const cutoff = Math.min(1, dstRate / srcRate) * 0.95;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  const half = Math.ceil(taps * Math.max(1, ratio));
  for (let i = 0; i < len; i++) {
    const c = i * ratio;
    const lo = Math.max(0, Math.ceil(c - half));
    const hi = Math.min(input.length - 1, Math.floor(c + half));
    let acc = 0;
    let norm = 0;
    for (let j = lo; j <= hi; j++) {
      const x = (j - c) / ratio;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * (j - c)) / half);
      const s = x === 0 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
      acc += input[j] * s * w;
      norm += s * w;
    }
    out[i] = norm ? acc / norm : 0;
  }
  return out;
}
