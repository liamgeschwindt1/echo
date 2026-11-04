import { runJob } from '@echo/sim-core/benchmark/runner.js';
import { browserCache } from './ui/testing-store.js';

let context;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') { context = { ...data.context, cache: browserCache }; return; }
  try { self.postMessage({ id: data.id, result: await runJob(data.job, context) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.stack ?? String(error) }); }
};
