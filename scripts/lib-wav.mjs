import { readFileSync } from 'node:fs';
import { resampleSinc } from '../src/sim/core/dsp.js';

// Minimal PCM16 / float32 WAV reader, mono mix, resampled to 48 kHz. For scripts and tests only.
export function readWavMono48k(path) {
  const buf = readFileSync(path);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = v.getUint32(pos + 4, true);
    if (id === 'fmt ') fmt = { format: v.getUint16(pos + 8, true), channels: v.getUint16(pos + 10, true), rate: v.getUint32(pos + 12, true), bits: v.getUint16(pos + 22, true) };
    if (id === 'data') data = { start: pos + 8, size };
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`not a WAV file: ${path}`);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.size / (bytes * fmt.channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = data.start + (i * fmt.channels + c) * bytes;
      s += fmt.format === 3 ? v.getFloat32(o, true) : v.getInt16(o, true) / 32768;
    }
    mono[i] = s / fmt.channels;
  }
  return resampleSinc(mono, fmt.rate, 48000);
}
