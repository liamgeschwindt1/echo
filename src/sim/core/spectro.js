import { fft } from './dsp.js';

// Magnitude spectrogram in dB: frames x bins (0..maxHz), for drawing.
export function spectrogram(signal, fs, { frames = 250, size = 1024, maxHz = 8000 } = {}) {
  const hop = Math.max(1, Math.floor((signal.length - size) / frames));
  const bins = Math.floor((maxHz * size) / fs);
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const out = [];
  for (let f = 0; f < frames; f++) {
    const a = f * hop;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < size; i++) re[i] = (signal[a + i] || 0) * win[i];
    fft(re, im);
    const col = new Float32Array(bins);
    for (let k = 0; k < bins; k++) col[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20);
    out.push(col);
  }
  return { frames: out, hop_s: hop / fs, bins, max_hz: maxHz };
}
