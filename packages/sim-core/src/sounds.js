// Sound library models: calibrated level at 1 m, labels, and procedural synthesis.
import { synthesizeClip } from './clips.js';

export const SOUND_KINDS = ['library', 'upload', 'generated'];
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

// Free field: level falls 6 dB per doubling of distance, so a level read at d metres is 20 log10(d) louder at 1 m.
export function level1mFromMeasurement(measuredDb, distanceM) {
  if (!Number.isFinite(measuredDb) || !(distanceM > 0)) throw new Error('calibration needs a level and a distance above 0 m');
  return measuredDb + 20 * Math.log10(distanceM);
}

export function synthTone(rate, freqHz = 1000, durationS = 1) {
  const n = Math.max(1, Math.round(durationS * rate));
  const out = new Float32Array(n);
  const edge = Math.min(0.01 * rate, n / 2);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freqHz * i) / rate) * Math.min(1, i / edge, (n - 1 - i) / edge);
  return out;
}

export function synthesizeModel(synth, rate) {
  if (synth?.type === 'tone') return synthTone(rate, synth.freq_hz, synth.duration_s);
  if (synth?.type === 'impulse') return synthesizeClip('impulse', rate);
  if (synth?.type === 'noise') return synthesizeClip('noise', rate);
  throw new Error('unknown generator');
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function validateSoundModel(m) {
  if (!m || typeof m !== 'object') throw new Error('sound: not an object');
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) throw new Error('sound: id must be lowercase letters, digits, - or _ (max 64)');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120) throw new Error('sound: name is required (max 120 characters)');
  if (!SOUND_KINDS.includes(m.kind)) throw new Error('sound: bad kind');
  if (!Number.isFinite(m.level_1m_db) || m.level_1m_db < 0 || m.level_1m_db > 200) throw new Error('sound: level at 1 m must be 0 to 200 dB SPL');
  const out = {
    id: m.id,
    name: m.name.trim(),
    kind: m.kind,
    level_1m_db: m.level_1m_db,
    confirmed: m.confirmed === true,
    labels: Array.isArray(m.labels) ? m.labels.filter((l) => typeof l === 'string' && l.trim()).map((l) => l.trim().slice(0, 40)).slice(0, 12) : [],
    notes: typeof m.notes === 'string' ? m.notes.slice(0, 2000) : ''
  };
  if (m.calibration) {
    const c = m.calibration;
    if (!Number.isFinite(c.measured_db) || !(c.distance_m > 0)) throw new Error('sound: bad calibration record');
    out.calibration = { measured_db: c.measured_db, distance_m: c.distance_m, method: typeof c.method === 'string' ? c.method.slice(0, 200) : '', date: typeof c.date === 'string' ? c.date.slice(0, 10) : '' };
  }
  if (m.kind === 'generated') {
    const s = m.synth;
    if (!s || !['tone', 'impulse', 'noise'].includes(s.type)) throw new Error('sound: generated sounds need a generator');
    out.synth = { type: s.type };
    if (s.type === 'tone') {
      if (!(s.freq_hz >= 20 && s.freq_hz <= 20000) || !(s.duration_s > 0 && s.duration_s <= 30)) throw new Error('sound: tone needs 20-20000 Hz and 0-30 s');
      out.synth.freq_hz = s.freq_hz;
      out.synth.duration_s = s.duration_s;
    }
  }
  if (m.kind === 'upload') {
    if (typeof m.audio_b64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.audio_b64)) throw new Error('sound: uploads need audio data');
    if (m.audio_b64.length * 0.75 > MAX_AUDIO_BYTES) throw new Error('sound: audio is over 8 MB');
    out.audio_b64 = m.audio_b64;
  }
  if (m.kind === 'library') {
    if (typeof m.file !== 'string' || !/^[\w.-]{1,120}$/.test(m.file)) throw new Error('sound: bad library file');
    out.file = m.file;
  }
  return out;
}
