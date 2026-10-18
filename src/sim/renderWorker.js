import { renderScenario } from './core/render.js';
import { analyseScenario } from './core/analyse.js';
import { renderComponents } from './core/components.js';
import { computeReachField, noiseBandPowerPa2, gridSize } from './core/reach.js';
import { clipBandEnvelopes, computeFieldArrivals, fieldSources, fitGridToBudget, DEFAULT_MEMORY_BUDGET_BYTES, DEFAULT_TOP_N } from './core/field.js';

self.onmessage = (e) => {
  const { type, scenario, clips, lengthS, durations } = e.data;
  try {
    if (type === 'components') {
      const { nodeIndex, mode } = e.data;
      const out = renderComponents(scenario, new Map(clips), lengthS, nodeIndex, mode);
      const transfer = out.series.flatMap((s) => s.mics.map((m) => m.buffer));
      self.postMessage({ type: 'components', nodeIndex, mode, key: e.data.key, ...out }, transfer);
      return;
    }
    if (type === 'field') {
      const { grid, job, z, cell, fine, base, key, sourceFilter } = e.data;
      try {
        const clipMap = new Map(clips);
        const all = fieldSources(scenario, clipMap);
        const only = sourceFilter ? scenario.sources.findIndex((s) => s.id === sourceFilter) : -1;
        const sources = only >= 0 ? [all[only]] : all;
        const fit = fitGridToBudget(grid, sources.length, DEFAULT_TOP_N, DEFAULT_MEMORY_BUDGET_BYTES);
        const field = computeFieldArrivals({ sources, settings: scenario.settings, buildings: scenario.buildings || [], grid: fit.grid, topN: DEFAULT_TOP_N });
        const envelopes = sources.map((s) => clipBandEnvelopes(clipMap.get(s.clip), scenario.settings.render_sample_rate, scenario.settings.localisation_band_hz));
        const noisePa2 = scenario.settings.noise_enabled === false ? 0 : noiseBandPowerPa2(scenario.settings);
        const rec = { ...field, envelopes, grid: fit.grid, noisePa2, coarsened: fit.coarsened, budget: DEFAULT_MEMORY_BUDGET_BYTES };
        const transfer = [field.mask.buffer, ...field.perSource.flatMap((s) => [s.count.buffer, s.delay.buffer, s.amp2.buffer])];
        self.postMessage({ type: 'field_done', job, z, cell: fit.grid.cell, fine, base, key, rec }, transfer);
      } catch (err) {
        self.postMessage({ type: 'field_error', message: String(err?.message || err) });
      }
      return;
    }
    if (type === 'reach') {
      const { grid, sourceLevels } = e.data;
      const noisePa2 = scenario.settings.noise_enabled === false ? 0 : noiseBandPowerPa2(scenario.settings);
      const out = computeReachField({
        sources: sourceLevels,
        settings: scenario.settings,
        buildings: scenario.buildings || [],
        grid,
        noisePa2,
        onProgress: (p) => self.postMessage({ type: 'reach_progress', value: p })
      });
      self.postMessage({ type: 'reach_done', key: e.data.key, grid, ...gridSize(grid), levelDb: out.levelDb, snrDb: out.snrDb, mask: out.mask }, [out.levelDb.buffer, out.snrDb.buffer, out.mask.buffer]);
      return;
    }
    const clipMap = new Map(clips);
    const rendered = renderScenario(scenario, clipMap, { lengthS, onProgress: (p) => self.postMessage({ type: 'progress', value: p * 0.9 }) });
    const results = analyseScenario(scenario, rendered, new Map(durations), { progressive: true });
    self.postMessage({ type: 'progress', value: 1 });
    const transfer = rendered.nodes.flatMap((n) => n.mics.map((m) => m.buffer));
    self.postMessage({ type: 'done', rendered, results }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
