import { analyseMeasured, MEASURED_DEFAULTS } from './measured.js';
import { speedOfSound } from './physics.js';
import { EXPORT_SCHEMA } from './export.js';

const point = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const wrap = (d) => ((d + 540) % 360) - 180;
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];

export function decodeMultichannelWav(buffer) {
  const view = new DataView(buffer);
  const text = (offset, n) => String.fromCharCode(...new Uint8Array(buffer, offset, n));
  if (buffer.byteLength < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw new Error('Expected little-endian RIFF WAV');
  if (view.getUint32(4, true) + 8 !== buffer.byteLength) throw new Error('WAV RIFF length mismatch');
  let format, data;
  for (let p = 12; p + 8 <= buffer.byteLength;) {
    const id = text(p, 4), size = view.getUint32(p + 4, true), start = p + 8;
    if (start + size > buffer.byteLength) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ') {
      if (size < 16 || format) throw new Error('Invalid or duplicate WAV format');
      format = { kind: view.getUint16(start, true), channels: view.getUint16(start + 2, true), sample_rate: view.getUint32(start + 4, true), block: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) };
      if (format.kind === 0xfffe) {
        const guidTail = [0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
        if (size < 40 || view.getUint16(start + 16, true) < 22 || guidTail.some((b, i) => view.getUint8(start + 28 + i) !== b) ||
            view.getUint16(start + 18, true) > format.bits) throw new Error('Unsupported extensible WAV subtype');
        format.kind = view.getUint32(start + 24, true);
      }
    }
    if (id === 'data') {
      if (data) throw new Error('Multiple WAV data chunks are unsupported');
      data = { start, size };
    }
    p = start + size + size % 2;
  }
  if (!format || !data || format.channels < 1 || format.channels > 256 || format.sample_rate < 8000 || format.sample_rate > 192000 ||
      !((format.kind === 1 && [16, 24, 32].includes(format.bits)) || (format.kind === 3 && format.bits === 32))) throw new Error('WAV needs PCM16/24/32 or float32, 8-192 kHz, 1-256 channels');
  const bytes = format.bits / 8;
  if (format.block !== bytes * format.channels || !data.size || data.size % format.block) throw new Error('Invalid WAV frame alignment');
  const frames = data.size / format.block;
  const channels = Array.from({ length: format.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels.length; ch++) {
    const p = data.start + i * format.block + ch * bytes;
    let value;
    if (format.kind === 3) value = view.getFloat32(p, true);
    else if (bytes === 2) value = view.getInt16(p, true) / 32768;
    else if (bytes === 4) value = view.getInt32(p, true) / 2147483648;
    else {
      const integer = view.getUint8(p) | view.getUint8(p + 1) << 8 | view.getInt8(p + 2) << 16;
      value = integer / 8388608;
    }
    if (!Number.isFinite(value)) throw new Error(`Nonfinite WAV sample at frame ${i}, channel ${ch}`);
    channels[ch][i] = value;
  }
  return { sample_rate: format.sample_rate, channels, frames, bits: format.bits, format: format.kind === 3 ? 'float' : 'PCM' };
}

export function encodeFloat32Wav(channels, sampleRate) {
  if (!channels.length || channels.length > 256 || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      !channels[0].length || channels.some((c) => c.length !== channels[0].length || !c.every(Number.isFinite))) throw new Error('Invalid WAV export channels');
  const size = channels[0].length * channels.length * 4;
  if (size > 0xffffffff - 36) throw new Error('Recording exceeds RIFF WAV limit');
  const buffer = new ArrayBuffer(44 + size), v = new DataView(buffer);
  const text = (p, s) => [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + size, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); v.setUint16(22, channels.length, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels.length * 4, true); v.setUint16(32, channels.length * 4, true); v.setUint16(34, 32, true);
  text(36, 'data'); v.setUint32(40, size, true);
  for (let i = 0; i < channels[0].length; i++) for (let ch = 0; ch < channels.length; ch++) v.setFloat32(44 + 4 * (i * channels.length + ch), channels[ch][i], true);
  return buffer;
}

export function recordingInputs(wav, geometry) {
  if (!Array.isArray(geometry.nodes) || !geometry.nodes.length || geometry.nodes.some((n) => !n.id || !point(n.position) ||
      !Array.isArray(n.channels) || n.channels.length < 3 || n.channels.length !== n.mic_positions?.length || !n.mic_positions.every(point) ||
      n.channels.some((ch) => !Number.isInteger(ch) || ch < 0 || ch >= wav.channels.length))) throw new Error('Geometry needs node IDs, XYZ, world-space mic_positions and valid zero-based channels');
  const used = geometry.nodes.flatMap((n) => n.channels);
  if (new Set(used).size !== used.length || new Set(geometry.nodes.map((n) => n.id)).size !== geometry.nodes.length) throw new Error('Duplicate recording channel or node ID');
  if (geometry.sample_rate !== undefined && geometry.sample_rate !== wav.sample_rate) throw new Error('Geometry sample rate does not match recording');
  const settings = { temperature_c: 15, localisation_band_hz: [200, 1600], ...geometry.settings, render_sample_rate: wav.sample_rate };
  const band = settings.localisation_band_hz;
  if (!Array.isArray(band) || band.length !== 2 || !band.every(Number.isFinite) || !(0 < band[0] && band[0] < band[1] && band[1] < wav.sample_rate / 2) ||
      !Number.isFinite(settings.temperature_c) || settings.temperature_c < -50 || settings.temperature_c > 60) throw new Error('Invalid recording band or temperature');
  const options = Object.fromEntries(Object.entries(MEASURED_DEFAULTS).map(([k, value]) => [k, settings[`measured_${k}`] ?? value]));
  if (Object.entries(options).some(([key, value]) => key !== 'fusion_mode' && (!Number.isFinite(value) || value < 0)) ||
      !['legacy', 'joint'].includes(options.fusion_mode) || options.joint_dedupe_m <= 0 ||
      Math.round(options.hop_ms * wav.sample_rate / 1000) < 1 || Math.round(options.window_ms * wav.sample_rate / 1000) < 1 ||
      !Number.isInteger(options.min_track_windows) || options.min_track_windows < 1) throw new Error('Invalid recording measured options');
  return {
    sensor: { nodes: geometry.nodes.map(({ id, position }) => ({ id, position })), settings, buildings: geometry.buildings ?? [] },
    data: { sample_rate: wav.sample_rate, nodes: geometry.nodes.map((n) => ({ id: n.id, mic_positions: n.mic_positions, mics: n.channels.map((ch) => wav.channels[ch]) })) },
    options
  };
}

export function analyseRecording(wav, geometry) {
  const { sensor, data, options } = recordingInputs(wav, geometry);
  const inference = analyseMeasured(sensor, data, { c: speedOfSound(sensor.settings.temperature_c), options });
  return {
    kind: 'echo-recording-inference', schema: EXPORT_SCHEMA, geometry, sample_rate: wav.sample_rate, frames: wav.frames,
    inference: { ...inference, options },
    notes: [
      'Measured mixtures and nominal geometry only. No simulator sources or truth used for inference.',
      'Horizontal legacy association and provisional uncertainty. No validated real-data accuracy, elevation or inter-node TDOA.',
      'Defaults are placeholders when temperature/band/gates are not supplied. Independent clocks must be externally aligned; no sync is inferred.',
      'PCM full-scale is not pressure. No SPL is claimed without a measured Pa/full-scale calibration.'
    ]
  };
}

function csvRows(text) {
  const rows = [], row = [];
  let value = '', quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i] ?? '\n';
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(value.replace(/\r$/, '')); value = '';
      if (c === '\n') { if (row.some((v) => v.trim())) rows.push([...row]); row.length = 0; }
    } else value += c;
  }
  if (quoted) throw new Error('Unclosed quote in truth CSV');
  return rows;
}

export function geodeticToEnu(latitude, longitude, altitude, origin) {
  const rad = (d) => d * Math.PI / 180;
  const ecef = (lat, lon, alt) => {
    const p = rad(lat), l = rad(lon), n = 6378137 / Math.sqrt(1 - 0.00669437999014 * Math.sin(p) ** 2);
    return [(n + alt) * Math.cos(p) * Math.cos(l), (n + alt) * Math.cos(p) * Math.sin(l), (n * (1 - 0.00669437999014) + alt) * Math.sin(p)];
  };
  const p = rad(origin.latitude_deg), l = rad(origin.longitude_deg);
  const a = ecef(latitude, longitude, altitude), b = ecef(origin.latitude_deg, origin.longitude_deg, origin.altitude_m);
  const [x, y, z] = a.map((v, i) => v - b[i]);
  return [-Math.sin(l) * x + Math.cos(l) * y, -Math.sin(p) * Math.cos(l) * x - Math.sin(p) * Math.sin(l) * y + Math.cos(p) * z,
    Math.cos(p) * Math.cos(l) * x + Math.cos(p) * Math.sin(l) * y + Math.sin(p) * z];
}

export function parseTruthCsv(text, geometry) {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error('Truth CSV has no samples');
  const headers = rows.shift().map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const column = (...names) => names.map((n) => headers.indexOf(n)).find((i) => i >= 0);
  const ti = column('ts', 'times'), timestamp = column('timestamp', 'utc', 'time');
  const xi = column('xm'), yi = column('ym'), zi = column('zm');
  const lati = column('latitude', 'lat'), loni = column('longitude', 'lon', 'lng'), posi = column('position');
  const alti = column('altitudem', 'altitude');
  const cartesian = xi !== undefined && yi !== undefined;
  if (ti === undefined && timestamp === undefined) throw new Error('Truth CSV needs t_s/time_s or UTC/timestamp');
  const start = Date.parse(geometry.start_time_utc);
  if (ti === undefined && !Number.isFinite(start)) throw new Error('Absolute truth times require geometry.start_time_utc');
  if (!cartesian && (!geometry.origin || ![geometry.origin.latitude_deg, geometry.origin.longitude_deg, geometry.origin.altitude_m].every(Number.isFinite) ||
      !['m', 'ft'].includes(geometry.truth_altitude_unit))) throw new Error('Geodetic truth requires origin and explicit truth_altitude_unit m|ft');
  const numeric = (value) => value !== undefined && value.trim() !== '' ? Number(value) : NaN;
  const points = rows.map((row, i) => {
    if (row.length !== headers.length) throw new Error(`Truth CSV row ${i + 2} has wrong column count`);
    const rawTime = row[timestamp];
    const time = ti !== undefined ? numeric(row[ti]) : ((/^\d+(\.\d+)?$/.test(rawTime) ? Number(rawTime) * 1000 : Date.parse(rawTime)) - start) / 1000;
    let position;
    if (cartesian) position = [numeric(row[xi]), numeric(row[yi]), zi === undefined ? 0 : numeric(row[zi])];
    else {
      const coordinates = posi !== undefined ? row[posi].split(',').map((x) => numeric(x)) : [numeric(row[lati]), numeric(row[loni])];
      const altitude = numeric(row[alti]) * (geometry.truth_altitude_unit === 'ft' ? 0.3048 : 1);
      if (coordinates.length !== 2 || Math.abs(coordinates[0]) > 90 || Math.abs(coordinates[1]) > 180) throw new Error(`Invalid truth latitude/longitude at row ${i + 2}`);
      position = geodeticToEnu(...coordinates, altitude, geometry.origin);
    }
    if (!Number.isFinite(time) || !point(position)) throw new Error(`Nonfinite truth sample at row ${i + 2}`);
    return { t_s: time, position };
  }).sort((a, b) => a.t_s - b.t_s);
  if (points.some((p, i) => i && p.t_s <= points[i - 1].t_s)) throw new Error('Duplicate truth timestamps; select one source track first');
  return points;
}

export function scoreRecording(recording, truth, { max_gap_s = 5 } = {}) {
  if (!Number.isFinite(max_gap_s) || max_gap_s <= 0) throw new Error('Invalid truth interpolation gap');
  const at = (t) => {
    const exact = truth.find((p) => p.t_s === t);
    if (exact) return exact.position;
    const i = truth.findIndex((p) => p.t_s > t);
    if (i <= 0 || truth[i].t_s - truth[i - 1].t_s > max_gap_s) return null;
    const a = truth[i - 1], b = truth[i], w = (t - a.t_s) / (b.t_s - a.t_s);
    return a.position.map((v, k) => v + w * (b.position[k] - v));
  };
  const fixes = recording.inference.fixes.map((f) => {
    const time = f.positions.at(-1)?.t_e, p = Number.isFinite(time) ? at(time) : null;
    return { t_e: time ?? null, horizontal_error_m: p ? Math.hypot(f.final_position[0] - p[0], f.final_position[1] - p[1]) : null };
  });
  return { kind: 'echo-recording-score', fixes, scored_fixes: fixes.filter((f) => Number.isFinite(f.horizontal_error_m)).length,
    max_gap_s, notes: ['External truth is read only after inference. One selected truth source; other sources/association must be resolved independently.', 'No extrapolation across missing truth or large gaps. Horizontal projection only; not 3D aircraft validation.'] };
}

export function calibrateRecording(wav, geometry, spec) {
  recordingInputs(wav, geometry);
  const interval = (range) => {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] < 0 || range[0] >= range[1] || range[1] > wav.frames / wav.sample_rate) throw new Error('Calibration intervals must lie inside recording');
    const samples = range.map((t) => Math.round(t * wav.sample_rate));
    if (samples[0] >= samples[1]) throw new Error('Calibration interval must contain at least one sample');
    return samples;
  };
  const quiet = interval(spec.quiet_s), signal = interval(spec.signal_s);
  if (quiet[0] < signal[1] && signal[0] < quiet[1]) throw new Error('Quiet and signal calibration intervals overlap');
  if (!point(spec.source_position)) throw new Error('Calibration needs surveyed source_position XYZ');
  if (geometry.pa_per_fullscale !== undefined && !(Number.isFinite(geometry.pa_per_fullscale) && geometry.pa_per_fullscale > 0)) throw new Error('Invalid Pa/full-scale calibration');
  const power = (pcm, [a, b]) => {
    let sum = 0;
    for (let i = a; i < b; i++) sum += pcm[i] ** 2;
    return sum / (b - a);
  };
  const channels = wav.channels.map((pcm, channel) => {
    const noise = power(pcm, quiet), total = power(pcm, signal);
    if (noise <= 0 || total <= noise) throw new Error(`Channel ${channel} calibration lacks nonzero quiet noise or positive source excess power`);
    return { channel, noise_floor_dbfs: 10 * Math.log10(noise), noise_floor_db_spl: geometry.pa_per_fullscale
      ? 10 * Math.log10(noise * geometry.pa_per_fullscale ** 2 / (20e-6) ** 2) : null, source_power: total - noise };
  });
  const inference = analyseRecording(wav, geometry).inference;
  const nodes = geometry.nodes.map((node, i) => {
    const expected = Math.atan2(spec.source_position[1] - node.position[1], spec.source_position[0] - node.position[0]) * 180 / Math.PI;
    const windows = inference.nodes[i].windows.filter((w) => w.t_s >= spec.signal_s[0] && w.t_s <= spec.signal_s[1]);
    const offsets = windows.map((w) => wrap(w.az_deg - expected));
    const centre = offsets.length ? offsets[0] : 0;
    const heading = offsets.length ? wrap(centre + median(offsets.map((o) => wrap(o - centre)))) : null;
    const received = node.channels.map((ch, mi) => {
      const range = Math.hypot(...spec.source_position.map((v, k) => v - node.mic_positions[mi][k]));
      if (range <= 0) throw new Error('Calibration source coincides with a microphone');
      return 10 * Math.log10(channels[ch].source_power * range ** 2);
    });
    const average = mean(received);
    return { id: node.id, heading_offset_deg: heading, heading_windows: windows.length,
      heading_status: windows.length ? 'fit from surveyed calibration source; validate on independent bearings' : 'unavailable: no accepted bearing windows',
      relative_gain_db: received.map((p) => p - average) };
  });
  return { kind: 'echo-recording-calibration', channels, nodes, spec,
    notes: ['Fit helpers, not real-data validation. Tested only on synthetic render exports.', 'Gain fit assumes free-field inverse-distance spreading, stationary common calibration source and matching channel electronics. Reflections/directivity bias it.', 'Scalar gain cancels in ideal PHAT. Frequency/phase mismatch is NOT fitted.', 'Heading correction is the negative of reported measured-minus-surveyed offset. Revalidate on held calibration bearings. Noise SPL stays null without Pa/full-scale.'] };
}
