// Interleaved IEEE-float WAV, for exporting simulated mic channels.
export function encodeWavFloat32(channels, sampleRate) {
  const nCh = channels.length;
  const len = channels[0].length;
  const dataBytes = len * nCh * 4;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // IEEE float
  v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nCh * 4, true);
  v.setUint16(32, nCh * 4, true);
  v.setUint16(34, 32, true);
  str(36, 'data');
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      v.setFloat32(o, channels[c][i], true);
      o += 4;
    }
  }
  return buf;
}

export function arrivalsCsv(rows) {
  const head = ['time_s', 'source', 'path', 'surfaces', 'length_m', 'level_db_re_direct', 'level_above_noise_db', 'arrival_azimuth_deg', 'overlapped'];
  const esc = (x) => (typeof x === 'string' && /[",\n]/.test(x) ? `"${x.replaceAll('"', '""')}"` : x ?? '');
  return [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
}
