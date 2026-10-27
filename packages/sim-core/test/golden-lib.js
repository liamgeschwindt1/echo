// Fingerprints of the rendered signals plus the analysis output. Regenerate only on purpose.
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { GOLDEN_SCENES } from './golden-scenes.js';

const SAMPLES_PER_MIC = 200;

export function fingerprint(sig) {
  let sum = 0;
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < sig.length; i++) {
    sum += sig[i];
    sumSq += sig[i] * sig[i];
    peak = Math.max(peak, Math.abs(sig[i]));
  }
  const step = Math.floor(sig.length / SAMPLES_PER_MIC);
  const picks = [];
  for (let i = 0; i < SAMPLES_PER_MIC; i++) picks.push(sig[i * step]);
  return { n: sig.length, sum, sum_sq: sumSq, peak, picks };
}

export function runScene(name, overrides = {}, scenes = GOLDEN_SCENES) {
  const { scenario, clips, lengthS } = scenes[name]();
  Object.assign(scenario.settings, overrides);
  const rendered = renderScenario(scenario, new Map(Object.entries(clips)), { lengthS });
  const durations = new Map(Object.entries(clips).map(([k, v]) => [k, v.length / 48000]));
  const results = analyseScenario(scenario, rendered, durations);
  return { rendered, results };
}

export function goldenFor(name, scenes = GOLDEN_SCENES) {
  const { rendered, results } = runScene(name, {}, scenes);
  return {
    mics: rendered.nodes.map((n) => n.mics.map(fingerprint)),
    analysis: results.map((r) => ({
      source_id: r.source_id,
      nodes: r.nodes.map((n) => ({ node_id: n.node_id, azimuth_deg: n.bearing?.azimuth_deg ?? null, elevation_deg: n.bearing?.elevation_deg ?? null, snr_db: n.snr_db })),
      fix: r.fix?.position ?? null
    }))
  };
}
