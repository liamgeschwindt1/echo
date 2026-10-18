import { irfft, nextPow2 } from './core/dsp.js';
import { mulberry32 } from './core/rng.js';
import { loudestWindowRms } from './core/render.js';

export function builtinClips() {
  return [
    { id: 'builtin_impulse', name: 'Band-limited impulse (200–1600 Hz)', builtin: 'impulse', level_1m_db: 90, confirmed: true, labels: [] },
    { id: 'builtin_noise_burst', name: 'Band-limited noise burst (200–1600 Hz)', builtin: 'noise_burst', level_1m_db: 90, confirmed: true, labels: [] }
  ];
}

// Periodic FFT synthesis gives exact band limits; returned clip has unit loudest-125-ms RMS.
export function generateBuiltinClip(entryOrId, rate = 48000, band = [200, 1600]) {
  const entry = typeof entryOrId === 'string' ? builtinClips().find((c) => c.id === entryOrId) : entryOrId;
  if (!entry?.builtin) throw new Error('unknown built-in clip');
  if (!Number.isInteger(rate) || rate < 4000 || rate > 192000 || !Array.isArray(band) || band.length !== 2 || !band.every(Number.isFinite) || band[0] <= 0 || band[1] <= band[0] || band[1] >= rate / 2) throw new Error('invalid built-in sample rate or band');
  const n = nextPow2(Math.ceil(rate * 0.5));
  const re = new Float64Array(n / 2 + 1);
  const im = new Float64Array(n / 2 + 1);
  const rng = mulberry32(51966);
  for (let k = Math.ceil(band[0] * n / rate); k <= Math.floor(band[1] * n / rate); k++) {
    const phase = entry.builtin === 'impulse' ? -2 * Math.PI * k * Math.round(n / 3) / n : 2 * Math.PI * rng();
    re[k] = Math.cos(phase);
    im[k] = Math.sin(phase);
  }
  const samples = Float32Array.from(irfft(re, im, n));
  const rms = loudestWindowRms(samples, rate);
  for (let i = 0; i < samples.length; i++) samples[i] /= rms;
  return samples;
}

// Placeholder levels at 1 m (dB SPL); confirmed: false until measured.
export const PLACEHOLDER_LEVELS = {
  glass_breaking: 100, car_horn: 105, dog: 100, chainsaw: 110, fireworks: 130, thunderstorm: 120, crying_baby: 100, engine: 95, airplane: 120, footsteps: 75,
  gunshot: 140, scream: 110
};

// Synthetic references are always available; only manifest clips flagged "sim" join the library.
export async function loadManifest() {
  // The static server caches for an hour, so a stale manifest from the phone app would hide the sim flags.
  let m;
  try {
    const res = await fetch('/test-audio/manifest.json', { cache: 'no-store' });
    if (!res.ok) return builtinClips();
    m = await res.json();
  } catch {
    return builtinClips();
  }
  const flagged = m.clips.filter((c) => c.sim);
  return [...builtinClips(), ...flagged.map((c) => ({ id: c.id, name: c.name, file: c.file, level_1m_db: PLACEHOLDER_LEVELS[c.id] ?? 90, confirmed: false, labels: c.labels }))];
}

// OfflineAudioContext decodes straight to the render rate.
export async function decodeToMono(arrayBuffer, rate = 48000) {
  const ctx = new OfflineAudioContext(1, 1, rate);
  const buf = await ctx.decodeAudioData(arrayBuffer);
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

export async function fetchClip(entry, rate) {
  if (entry.builtin) return generateBuiltinClip(entry, rate);
  const res = await fetch(`/test-audio/${entry.file}`);
  if (!res.ok) throw new Error(`clip ${entry.id} missing (${res.status}); run "npm run fetch-test-audio"`);
  return decodeToMono(await res.arrayBuffer(), rate);
}

// A missing file can come back as the SPA's index.html with status 200, so check the type too.
export async function clipAvailable(entry) {
  if (entry.builtin) return true;
  try {
    const res = await fetch(`/test-audio/${entry.file}`, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') || '').includes('text/html');
  } catch {
    return false;
  }
}
