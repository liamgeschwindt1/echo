import { renderScenario } from './core/render.js';
import { analyseScenario } from './core/analyse.js';
import { renderComponents } from './core/components.js';

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
    const clipMap = new Map(clips);
    const rendered = renderScenario(scenario, clipMap, { lengthS, onProgress: (p) => self.postMessage({ type: 'progress', value: p * 0.9 }) });
    const results = analyseScenario(scenario, rendered, new Map(durations));
    self.postMessage({ type: 'progress', value: 1 });
    const transfer = rendered.nodes.flatMap((n) => n.mics.map((m) => m.buffer));
    self.postMessage({ type: 'done', rendered, results }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
