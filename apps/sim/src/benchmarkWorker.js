import { buildJobs, scenarioForJob } from '@echo/sim-core/benchmark/experiment.js';
import { buildScene } from '@echo/sim-core/benchmark/scenes.js';
import { runExperiment, jobRenderKey } from '@echo/sim-core/benchmark/runner.js';
import { decodeBenchmarkWav } from '@echo/sim-core/benchmark/audio.js';
import { audioHash } from '@echo/sim-core/benchmark/cache.js';
import { reportCsv, reportHtml } from '@echo/sim-core/benchmark/report.js';
import { testingStore } from './ui/testing-store.js';
import { compareReports } from '@echo/sim-core/benchmark/metrics.js';

let paused = false, controller, active = false;
const wakes = new Set();
function resumeDispatch() { for (const wake of wakes) wake(); wakes.clear(); }
const pool = [];
let sequence = 0;
function execute(job, { releaseRender = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const slot = pool.find((s) => !s.busy);
    if (!slot) return reject(new Error('Benchmark worker pool exhausted'));
    slot.busy = true;
    const id = sequence++;
    slot.worker.onmessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.type === 'render-ready') { releaseRender(); return; }
      slot.busy = false;
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    slot.worker.onerror = (error) => { slot.busy = false; reject(new Error(error.message)); };
    slot.worker.postMessage({ id, job });
  });
}
async function start({ record, clips: providedClips, arrays, manifest, targets }) {
  if (active) throw new Error('Testing run already active');
  active = true; paused = false; controller = new AbortController();
  try {
    const { experiment, jobs } = buildJobs(record.experiment);
    const ids = new Set(jobs.flatMap((job) => scenarioForJob(experiment.custom_scenes?.[job.scene] ?? buildScene(job.scene), job, arrays).sources.map((s) => s.clip)));
    const clips = new Map(providedClips ?? []);
    const response = await fetch('/test-audio/manifest.json', { signal: controller.signal });
    if (!response.ok) throw new Error(`Audio manifest request failed (${response.status})`);
    const audioManifest = await response.json();
    for (const id of ids) {
      if (clips.has(id)) continue;
      const entry = audioManifest.clips.find((c) => c.id === id);
      if (!entry?.file) throw new Error(`Missing recorded clip ${id}; no synthetic fallback`);
      const response = await fetch(`/test-audio/${entry.file}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Missing clip ${id} (${response.status})`);
      clips.set(id, decodeBenchmarkWav(await response.arrayBuffer()));
    }
    manifest = { ...manifest, audio: await audioHash(clips), runtime: { engine: 'browser', user_agent: self.navigator.userAgent } };
    const context = { clips, arrays, custom_scenes: experiment.custom_scenes, manifest, wrong_fix_m: experiment.wrong_fix_m };
    for (let i = 0; i < 2; i++) {
      const worker = new Worker(new URL('./benchmarkJobWorker.js', import.meta.url), { type: 'module' });
      worker.postMessage({ type: 'init', context });
      pool.push({ worker, busy: false });
    }
    const completed = await testingStore.jobs(record.id);
    record = { ...record, manifest, status: 'running', updated: new Date().toISOString() };
    await testingStore.set('runs', record.id, record);
    const report = await runExperiment(experiment, {
      execute,
      renderGroup: (job) => jobRenderKey(job, context),
      onResult: (result) => testingStore.set('jobs', `${record.id}:${result.job.id}`, result),
      completed, manifest, workers: 2, signal: controller.signal,
      isPaused: () => paused,
      waitWhilePaused: () => new Promise((resolve) => { wakes.add(resolve); }),
      onProgress: ({ result, ...progress }) => self.postMessage({ type: 'progress', ...progress, resumed: !!progress.resumed })
    });
    record = { ...record, report, status: controller.signal.aborted ? 'cancelled' : 'complete', updated: new Date().toISOString() };
    await testingStore.set('runs', record.id, record);
    self.postMessage({ type: 'done', record, csv: reportCsv(report), html: reportHtml(report, targets) });
  } catch (error) {
    let message = error.stack ?? String(error);
    try { await testingStore.set('runs', record.id, { ...record, status: 'error', error: message, updated: new Date().toISOString() }); }
    catch (storageError) { message += `\nSaving failure state also failed: ${storageError.message}`; }
    self.postMessage({ type: 'error', message });
  } finally {
    for (const { worker } of pool) worker.terminate();
    pool.length = 0; active = false;
  }
}
self.onmessage = ({ data }) => {
  if (data.type === 'pause') { paused = true; self.postMessage({ type: 'paused' }); }
  if (data.type === 'resume') { paused = false; resumeDispatch(); self.postMessage({ type: 'resumed' }); }
  if (data.type === 'cancel') { controller?.abort(); paused = false; resumeDispatch(); }
  if (data.type === 'start') start(data);
  if (data.type === 'compare') {
    try { self.postMessage({ type: 'comparison', comparison: compareReports(data.current, data.baseline, data.current.experiment.tolerances) }); }
    catch (error) { self.postMessage({ type: 'error', message: `Comparison failed: ${error.message}` }); }
  }
};
