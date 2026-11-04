import { parentPort, workerData } from 'node:worker_threads';
import { runJob } from './runner.js';
import { DiskCache } from './node.js';

const context = { ...workerData, cache: new DiskCache(workerData.cacheDirectory) };
parentPort.on('message', async ({ id, job }) => {
  try { parentPort.postMessage({ id, result: await runJob(job, context) }); }
  catch (error) { parentPort.postMessage({ id, error: error.stack ?? String(error) }); }
});
