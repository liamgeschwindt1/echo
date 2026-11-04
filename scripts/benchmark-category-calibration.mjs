import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { metricValues } from '../packages/sim-core/src/benchmark/metrics.js';
import { isMoving } from '../packages/sim-core/src/motion.js';

const root = new URL('../', import.meta.url), paths = process.argv.slice(2);
if (!paths.length) throw new Error('Provide complete benchmark report paths');
const registrationBytes = await readFile(new URL('docs/experiments/round2-category-report.json', root));
const registration = JSON.parse(registrationBytes);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const reports = [];
for (const path of paths) {
  const bytes = await readFile(new URL(path, root));
  const report = JSON.parse(path.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  if (report.kind !== 'echo-sim-benchmark' || report.manifest.cancelled ||
      report.runs.length !== report.manifest.expected_runs ||
      new Set(report.runs.map((r) => r.job.id)).size !== report.runs.length) throw new Error(`Incomplete population:${path}`);
  const groups = new Map();
  for (const run of report.runs) {
    if (run.job.analysis_mode !== 'measured_only') continue;
    const category = Object.entries(registration.scene_categories).find(([, scenes]) => scenes.includes(run.job.scene))?.[0]
      ?? registration.unknown_scene_category;
    const s = run.scenario;
    const physical = [s.nodes.length === 2 ? 'two_available_nodes' : 'three_plus_available_nodes',
      s.sources.length === 1 ? 'one_source' : 'multiple_sources',
      s.buildings.length ? 'buildings_present' : 'no_buildings'];
    if (s.sources.some(isMoving)) physical.push('moving_source_present');
    if (s.sources.some((source) => source.keyframes.some((k) => k.position[2] >= 10))) physical.push('source_at_or_above10m');
    for (const group of ['overall', `scene:${category}`, ...physical.map((p) => `physical:${p}`)]) {
      const key = JSON.stringify({ config: run.job.config.id, split: run.job.split, realism: run.job.realism, group });
      const rows = groups.get(key) ?? [];
      rows.push(run); groups.set(key, rows);
    }
  }
  const summary = [...groups].map(([key, runs]) => {
    const metrics = metricValues(runs);
    const bearings = runs.flatMap((r) => r.scores.fixes.flatMap((f) => f.nodes))
      .filter((n) => Number.isFinite(n.az_error_deg) && Number.isFinite(n.sigma_deg) && n.sigma_deg > 0);
    return { ...JSON.parse(key), scenes: runs.length, available_bearing_episodes: bearings.length,
      within_1sigma: metrics.within_1sigma, within_2sigma: metrics.within_2sigma,
      scene_fix_rate: metrics.scene_fix_rate };
  });
  reports.push({ path, sha256: sha(bytes), producer: report.manifest, summary });
}
await writeFile(new URL('baselines/round2-category-calibration.json', root), JSON.stringify({
  schema: 1, registration, registration_sha256: sha(registrationBytes), reports
}, null, 2) + '\n');
console.log(`Stored category calibration from${reports.length} complete reports; no fitting or new renders.`);
