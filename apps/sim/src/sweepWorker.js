import { sweep, sweepMulti, runTrials, summarise } from '@echo/sim-core/sweep.js';

self.onmessage = (e) => {
  const { scenario, clips, durations, param, values, vars, arrays, seeds } = e.data;
  try {
    const clipMap = new Map(clips);
    const dur = new Map(durations);
    const onProgress = (v) => self.postMessage({ type: 'progress', value: v });
    if (vars?.length) {
      self.postMessage({ type: 'done', rows: sweepMulti(scenario, clipMap, dur, { vars, seeds, arrays, onProgress }) });
    } else if (param) {
      self.postMessage({ type: 'done', rows: sweep(scenario, clipMap, dur, { param, values, seeds, onProgress }) });
    } else {
      const trials = runTrials(scenario, clipMap, dur, { seeds, onTrial: (k, n) => onProgress(k / n) });
      self.postMessage({ type: 'done', rows: [{ value: null, ...summarise(trials) }] });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
