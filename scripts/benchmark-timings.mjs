import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { micPositions } from '../packages/sim-core/src/mics.js';
import { percentile } from '../packages/sim-core/src/sweep.js';
import { timingDescriptor } from '../packages/sim-core/src/benchmark/experiment.js';

const root = new URL('../', import.meta.url);
const sources = ['baselines/baseline-0.json', 'baselines/array-full-budget.json.gz'];
const groups = new Map(), provenance = [];
for (const path of sources) {
  const bytes = await readFile(new URL(path, root));
  const report = JSON.parse(path.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  provenance.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), expected_runs: report.manifest.expected_runs, runs: report.runs.length });
  if (report.manifest.cancelled || report.runs.length !== report.manifest.expected_runs) throw new Error(`Incomplete timing population: ${path}`);
  for (const r of report.runs) {
    const total_mics = r.scenario.nodes.reduce((s, n) => s + micPositions(n).length, 0);
    const key = `${r.job.scene}|${total_mics}|${r.job.analysis_mode}`;
    const group = groups.get(key) ?? { scene: r.job.scene, total_mics, analysis_mode: r.job.analysis_mode, descriptor: timingDescriptor(r.scenario), render: [], analysis: [] };
    if (r.render_ms > 0) group.render.push(r.render_ms);
    if (r.analysis_ms > 0) group.analysis.push(r.analysis_ms);
    groups.set(key, group);
  }
}
const timings = [...groups].map(([key, r]) => ({
  key, scene: r.scene, total_mics: r.total_mics, analysis_mode: r.analysis_mode, descriptor: r.descriptor,
  render_n: r.render.length, analysis_n: r.analysis.length,
  render_p50_ms: percentile(r.render, 50), render_p90_ms: percentile(r.render, 90),
  analysis_p50_ms: percentile(r.analysis, 50), analysis_p90_ms: percentile(r.analysis, 90)
})).sort((a, b) => a.key.localeCompare(b.key));
await writeFile(new URL('packages/sim-core/src/benchmark/timings.json', root), JSON.stringify({
  schema: 1, method: 'Recorded cold render times and analysis stage times from complete stored studies; per-run p90, no cache discount. Different runtime/CPU load is a source of uncertainty.',
  provenance, timings
}, null, 2) + '\n');
console.log(`Stored ${timings.length} measured scene/channel/mode timing strata.`);
