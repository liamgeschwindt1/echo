import { resampleSinc } from '../dsp.js';

// Use identical PCM decoding and resampling in Node and browsers. Native browser decoders can change bearings.
export function decodeBenchmarkWav(buffer) {
  const view = new DataView(buffer);
  const text = (offset, length) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  if (buffer.byteLength < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('Not a RIFF WAV recording');
  let format, data;
  for (let pos = 12; pos + 8 <= buffer.byteLength;) {
    const id = text(pos, 4), size = view.getUint32(pos + 4, true);
    if (pos + 8 + size > buffer.byteLength) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV format chunk');
      format = { kind: view.getUint16(pos + 8, true), channels: view.getUint16(pos + 10, true), rate: view.getUint32(pos + 12, true), bits: view.getUint16(pos + 22, true) };
    }
    if (id === 'data') data = { start: pos + 8, size };
    pos += 8 + size + size % 2;
  }
  if (!format || !data || !format.channels || !format.rate || !((format.kind === 1 && format.bits === 16) || (format.kind === 3 && format.bits === 32))) throw new Error('Benchmark needs PCM16 or float32 WAV');
  const bytes = format.bits / 8, frames = Math.floor(data.size / (bytes * format.channels)), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < format.channels; ch++) {
      const offset = data.start + (i * format.channels + ch) * bytes;
      sum += format.kind === 3 ? view.getFloat32(offset, true) : view.getInt16(offset, true) / 32768;
    }
    mono[i] = sum / format.channels;
  }
  return resampleSinc(mono, format.rate, 48000);
}
