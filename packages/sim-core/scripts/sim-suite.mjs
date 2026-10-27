// Runs the A-E scenario suite over N seeds (2 worker threads) and writes per-source records plus a summary.
// Usage: node scripts/sim-suite.mjs --label baseline [--seeds 50] [--scn A,B,C,D,E] [--third-node]
// SIMULATED results only; the diffraction model is unvalidated.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { SCENARIOS, runOne, summarise } from '../test/suite-lib.js';

if (isMainThread) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i < 0 ? d : process.argv[i + 1];
  };
  const label = arg('label', 'run');
  const seeds = Number(arg('seeds', 50));
  const scn = arg('scn', SCENARIOS.join(',')).split(',');
  const opts = { thirdNode: process.argv.includes('--third-node') };
  const jobs = [];
  for (let s = 1; s <= seeds; s++) for (const l of scn) jobs.push([l, s]);
  const records = [];
  let next = 0;
  let done = 0;
  const finish = () => {
    writeFileSync(new URL(`../docs/suite/${label}.json`, import.meta.url), JSON.stringify({ label, seeds, simulated_only: true, diffraction_model: 'unvalidated', summary: summarise(records), records }, null, 1));
    console.log(`wrote docs/suite/${label}.json (${records.length} source records)`);
  };
  const n = Math.min(2, jobs.length);
  let live = n;
  for (let w = 0; w < n; w++) {
    const worker = new Worker(new URL(import.meta.url), { workerData: opts });
    const feed = () => (next < jobs.length ? worker.postMessage(jobs[next++]) : worker.postMessage(null));
    worker.on('message', (rows) => {
      records.push(...rows);
      if (++done % 10 === 0) console.log(`${done}/${jobs.length}`);
      feed();
    });
    worker.on('exit', () => {
      if (--live === 0) finish();
    });
    feed();
  }
} else {
  parentPort.on('message', async (job) => {
    if (!job) return process.exit(0);
    parentPort.postMessage(await runOne(job[0], job[1], workerData));
  });
}
