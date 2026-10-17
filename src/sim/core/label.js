import { PeriodDetector, labelPeriods } from '../../core/periods.js';
import { DEFAULTS } from '../../settings.js';
import { resampleSinc } from './dsp.js';

// Arbitrary daytime epoch so the detector's wall-clock timestamps map to scenario seconds.
export const BASE_MS = Date.parse('2026-06-01T12:00:00Z');
export const YAMNET_RATE = 16000;
const YAMNET_WINDOW_S = 0.975;
const YAMNET_HOP_S = 0.5;
const BLOCK_S = 0.1;

export const CLAP_MODES = { clap5: { window_s: 5, hop_s: 1.25 }, clap10: { window_s: 10, hop_s: 2.5 } };

const db = (v) => 20 * Math.log10(Math.max(v, 1e-6));

// 10 Hz RMS and peak in dBFS, the same series the live rig feeds the detector.
export function levelSeries(signal, fs) {
  const block = Math.round(BLOCK_S * fs);
  const out = [];
  for (let a = 0; a + block <= signal.length; a += block) {
    let s = 0;
    let peak = 0;
    for (let i = a; i < a + block; i++) {
      s += signal[i] * signal[i];
      peak = Math.max(peak, Math.abs(signal[i]));
    }
    out.push({ t_s: (a + block) / fs, rms: db(Math.sqrt(s / block)), peak: db(peak) });
  }
  return out;
}

export function detectPeriods(signal, fs, settings) {
  const det = new PeriodDetector(() => settings, null, []);
  for (const l of levelSeries(signal, fs)) det.push(BASE_MS + l.t_s * 1000, l.rms, l.peak);
  det.flush(BASE_MS + (signal.length / fs) * 1000);
  return det.periods;
}

// Window end times, first window ends once a full window of audio exists.
export function windowEnds(totalS, windowS, hopS) {
  const ends = [];
  for (let e = windowS; e <= totalS + 1e-9; e += hopS) ends.push(Math.round(e * 1e4) / 1e4);
  return ends;
}

const toRow = (model, window_s, t_s, scores) => ({ model, window_s, timestamp: new Date(BASE_MS + t_s * 1000).toISOString(), scores_json: scores });
const rel = (iso) => (Date.parse(iso) - BASE_MS) / 1000;

/**
 * Adapter: classify(audio, sampleRate, mode) -> { yamnet, clap, periods, labels }.
 * runners.yamnet(samples16k) -> {label: score}; runners.clap(samples, windowS) -> {classId: {softmax, cosine}}.
 */
export async function classify(audio, sampleRate, mode, { cat, runners, settings = {}, onProgress } = {}) {
  const m = CLAP_MODES[mode];
  if (!m) throw new Error(`unknown mode ${mode}`);
  const s = { ...DEFAULTS, ...settings, clap_window_s: m.window_s, clap_hop_s: m.hop_s };
  const totalS = audio.length / sampleRate;
  const y16 = resampleSinc(audio, sampleRate, YAMNET_RATE);

  const yEnds = windowEnds(totalS, YAMNET_WINDOW_S, YAMNET_HOP_S);
  const cEnds = windowEnds(totalS, m.window_s, m.hop_s);
  const total = yEnds.length + cEnds.length;
  let done = 0;
  const yamnet = [];
  const clap = [];
  const win = Math.round(YAMNET_WINDOW_S * YAMNET_RATE);
  for (const e of yEnds) {
    const end = Math.round(e * YAMNET_RATE);
    yamnet.push({ t: e, scores: await runners.yamnet(y16.slice(end - win, end)) });
    onProgress?.(++done / total);
  }
  for (const e of cEnds) {
    const end = Math.round(e * sampleRate);
    clap.push({ t: e, scores: await runners.clap(audio.slice(end - Math.round(m.window_s * sampleRate), end), m.window_s) });
    onProgress?.(++done / total);
  }

  const rows = [
    ...yamnet.map((r) => toRow('yamnet', YAMNET_WINDOW_S, r.t, r.scores)),
    ...clap.map((r) => toRow('clap', m.window_s, r.t, r.scores))
  ];
  const raw = detectPeriods(audio, sampleRate, s);
  const periods = labelPeriods(raw, rows, [], s, cat).map((p) => ({ ...p, start_s: rel(p.start), end_s: rel(p.end) }));
  return { yamnet, clap, periods, labels: cat.classes.map((c) => c.id) };
}
