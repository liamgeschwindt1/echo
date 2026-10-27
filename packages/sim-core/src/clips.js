// Placeholder levels at 1 m (dB SPL); confirmed: false until measured.
import { fft, nextPow2 } from './dsp.js';
import { mulberry32 } from './rng.js';

export const PLACEHOLDER_LEVELS = {
  glass_breaking: 100, car_horn: 105, dog: 100, chainsaw: 110, fireworks: 130, thunderstorm: 120, crying_baby: 100, engine: 95, airplane: 120, footsteps: 75,
  gunshot: 140, scream: 110
};

// Built-in test clips, synthesised deterministically (no file needed). The impulse is flat across the
// localisation band; the noise burst is stationary broadband noise for level checks.
export const GENERATED_CLIPS = [
  { id: 'test_impulse', name: 'Impulse (test, 200-1600 Hz flat)', generated: 'impulse', level_1m_db: 94, confirmed: true },
  { id: 'test_noise_burst', name: 'Noise burst (test, 50-12000 Hz flat)', generated: 'noise', level_1m_db: 90, confirmed: true }
];

function synthImpulse(rate) {
  const n = Math.round(0.06 * rate);
  const [f1, f2] = [200, 1600];
  const mid = n / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i - mid) / rate;
    const w = 0.5 + 0.5 * Math.cos((2 * Math.PI * (i - mid)) / n);
    const s = t === 0 ? 2 * (f2 - f1) : (Math.sin(2 * Math.PI * f2 * t) - Math.sin(2 * Math.PI * f1 * t)) / (Math.PI * t);
    out[i] = s * w;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

function synthNoiseBurst(rate) {
  const n = Math.round(1 * rate);
  const rng = mulberry32(1234);
  const N = nextPow2(n);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const [f1, f2] = [50, 12000];
  for (let k = 1; k < N / 2; k++) {
    const f = (k * rate) / N;
    if (f < f1 || f > f2) continue;
    const phase = 2 * Math.PI * rng();
    re[k] = Math.cos(phase);
    im[k] = Math.sin(phase);
    re[N - k] = re[k];
    im[N - k] = -im[k];
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const edge = Math.min(1, i / (0.01 * rate), (n - 1 - i) / (0.01 * rate));
    out[i] = re[i] * edge;
    sum += out[i] * out[i];
  }
  const k = 1 / Math.sqrt(sum / n);
  for (let i = 0; i < n; i++) out[i] *= k; // exactly RMS 1: loudest window and clip mean agree
  return out;
}

export const synthesizeClip = (kind, rate) => (kind === 'impulse' ? synthImpulse(rate) : synthNoiseBurst(rate));

// Only clips flagged "sim" in the manifest form the built-in library; the generated test clips always exist.
export async function loadManifest() {
  // The static server caches for an hour, so a stale manifest from the phone app would hide the sim flags.
  const res = await fetch('/test-audio/manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`manifest request failed (${res.status})`);
  const m = await res.json();
  const flagged = m.clips.filter((c) => c.sim);
  if (!flagged.length) throw new Error(`manifest lists ${m.clips.length} clips but none are flagged for the simulator`);
  const real = flagged.map((c) => ({ id: c.id, name: c.name, file: c.file, level_1m_db: PLACEHOLDER_LEVELS[c.id] ?? 90, confirmed: false, labels: c.labels }));
  return [...GENERATED_CLIPS, ...real];
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
  if (entry.generated) return synthesizeClip(entry.generated, rate);
  const res = await fetch(`/test-audio/${entry.file}`);
  if (!res.ok) throw new Error(`clip ${entry.id} missing (${res.status}); run "npm run fetch-test-audio"`);
  return decodeToMono(await res.arrayBuffer(), rate);
}

// A missing file can come back as the SPA's index.html with status 200, so check the type too.
export async function clipAvailable(entry) {
  if (entry.generated) return true;
  try {
    const res = await fetch(`/test-audio/${entry.file}`, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') || '').includes('text/html');
  } catch {
    return false;
  }
}
