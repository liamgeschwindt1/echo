// Component signals for one node, rendered with the same deterministic code and seed as the main render.
import { irfft } from './dsp.js';
import { addSourceSpectrum, commonNoise, micGainFor, noiseForMic, prepareRender } from './render.js';

export const COMPONENT_MODES = ['by_source', 'by_path', 'noise'];
const PATH_TYPES = ['direct', 'ground', 'wall', 'diffracted'];

function pathSeries(ctx, ni, mi, filterFor, sourceIndices) {
  const { bins, n, total } = ctx;
  const accRe = new Float64Array(bins);
  const accIm = new Float64Array(bins);
  for (const si of sourceIndices) addSourceSpectrum(ctx, si, ctx.table[ni].perMic[mi][si].paths, accRe, accIm, filterFor, ctx.bins - 2, null, { ni, mi });
  const full = irfft(accRe, accIm, n);
  const g = micGainFor(ctx, ni, mi);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) out[i] = full[i] * g;
  return out;
}

/**
 * mode: 'by_source' (one series per source), 'by_path' (direct / ground / wall), 'noise'.
 * Returns { sample_rate, length, series: [{ id, label, mics: Float32Array[4] }] }; values are digital floats.
 */
export function renderComponents(scenario, clips, lengthS, nodeIndex, mode) {
  const ctx = prepareRender(scenario, clips, lengthS);
  const allSources = scenario.sources.map((_, i) => i);
  const common = commonNoise(ctx, nodeIndex);
  const mics = ctx.truePositions[nodeIndex].map((_, i) => i);
  const series = [];
  if (mode === 'by_source') {
    scenario.sources.forEach((s, si) => series.push({ id: s.id, label: `${s.id} ${s.clip}`, mics: mics.map((mi) => pathSeries(ctx, nodeIndex, mi, null, [si])) }));
  } else if (mode === 'by_path') {
    for (const type of PATH_TYPES) series.push({ id: type, label: type, mics: mics.map((mi) => pathSeries(ctx, nodeIndex, mi, (p) => p.type === type, allSources)) });
  } else if (mode !== 'noise') {
    throw new Error(`unknown component mode ${mode}`);
  }
  if (mode === 'by_source' || mode === 'noise') {
    series.push({
      id: 'noise',
      label: 'noise',
      mics: mics.map((mi) => {
        const { amb, self } = noiseForMic(ctx, nodeIndex, mi, common);
        const g = micGainFor(ctx, nodeIndex, mi);
        const out = new Float32Array(ctx.total);
        for (let i = 0; i < ctx.total; i++) out[i] = (amb[i] + self[i]) * g;
        return out;
      })
    });
  }
  return { sample_rate: ctx.fs, length: ctx.total, series };
}
