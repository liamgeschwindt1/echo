// Direction focus (sound-disaggregation step 3): far-field delay-and-sum of one node's mics towards a bearing.
// A plane wave from unit direction u reaches mic m earlier than the array centre by (p_m - mean p) . u / c, so delaying
// each mic by d_m = (p_m - mean p) . u / c lines the copies up; the average keeps the steered source and partly cancels
// sound from elsewhere. Fractional delays are applied in the frequency domain (exp(-j 2 pi f d_m)).
import { irfft, nextPow2, rfft } from './dsp.js';

/** Beamformed signal over samples [a, b) of the node's mics (positions in metres, direction a unit 3-vector). */
export function delayAndSum(mics, positions, direction, { c, fs, a = 0, b = mics[0].length }) {
  const len = b - a;
  const n = nextPow2(len + 64);
  const mean = [0, 1, 2].map((k) => positions.reduce((s, p) => s + p[k], 0) / positions.length);
  const accRe = new Float64Array(n / 2 + 1);
  const accIm = new Float64Array(n / 2 + 1);
  for (let m = 0; m < mics.length; m++) {
    const d = ((positions[m][0] - mean[0]) * direction[0] + (positions[m][1] - mean[1]) * direction[1] + (positions[m][2] - mean[2]) * direction[2]) / c;
    const X = rfft(mics[m].subarray(a, b), n);
    for (let k = 0; k <= n / 2; k++) {
      const ph = (-2 * Math.PI * k * fs * d) / n;
      const cr = Math.cos(ph);
      const ci = Math.sin(ph);
      accRe[k] += X.re[k] * cr - X.im[k] * ci;
      accIm[k] += X.re[k] * ci + X.im[k] * cr;
    }
  }
  const y = irfft(accRe, accIm, n);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = y[i] / mics.length;
  return out;
}
