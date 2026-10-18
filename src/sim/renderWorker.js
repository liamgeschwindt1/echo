import { renderScenario } from './core/render.js';
import { analyseScenario } from './core/analyse.js';
import { renderComponents } from './core/components.js';
import { computeReachField, noiseBandPowerPa2, gridSize } from './core/reach.js';

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
