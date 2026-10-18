import { computeGrid, computeSection, prepareField } from './core/field.js';

let cached = null;
let cachedKey = null;

// Omit cacheKey to force fresh preparation. Explicit keys must change with scenario AND clip samples.
self.onmessage = ({ data }) => {
  const { id, type, scenario, clips, options = {}, cacheKey } = data;
  try {
    if (!['grid', 'section'].includes(type)) throw new Error(`unknown field request ${type}`);
    const key = cacheKey == null ? null : `${cacheKey}:${JSON.stringify(scenario)}:${JSON.stringify(options.sourceId ?? null)}`;
    if (key == null || key !== cachedKey) {
      cached = prepareField(scenario, clips instanceof Map ? clips : new Map(clips), { sourceId: options.sourceId });
      cachedKey = key;
    }
    const calculate = type === 'grid' ? computeGrid : computeSection;
    let lastProgress = -1;
    const result = calculate(cached, {
      ...options,
      onProgress: (progress) => {
        if (progress === 1 || progress - lastProgress >= 0.02) {
          self.postMessage({ id, type: 'progress', progress });
          lastProgress = progress;
        }
      }
    });
    const transfers = [result.total_db_spl.buffer, result.snr_db.buffer, result.localisation_snr_db.buffer, result.mask.buffer, ...result.band_db_spl.map((x) => x.buffer)];
    self.postMessage({ id, type: 'result', result }, transfers);
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error.message });
  }
};
