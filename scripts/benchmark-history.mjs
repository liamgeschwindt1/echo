import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { summariseRuns } from '../packages/sim-core/src/benchmark/metrics.js';
import { canonical, renderSettingsFor } from '../packages/sim-core/src/benchmark/cache.js';

const root = new URL('../', import.meta.url);
const paths = process.argv.slice(2);
if (!paths.length) throw new Error('Provide complete stored benchmark report paths');
const entries = [];
for (const path of paths) {
  const bytes = await readFile(new URL(path, root)), report = JSON.parse(path.endsWith('.gz') ? gunzipSync(bytes) : bytes);
  if (report.kind !== 'echo-sim-benchmark' || report.manifest.cancelled || report.runs.length !== report.manifest.expected_runs) throw new Error(`Not a complete benchmark: ${path}`);
  const population = [...new Set(report.runs.map((r) => {
    if (!r.scenario || !r.manifest?.audio) throw new Error(`Missing physical-input provenance: ${path}/${r.job.id}`);
    const physical = { nodes: r.scenario.nodes, sources: r.scenario.sources, buildings: r.scenario.buildings,
      settings: renderSettingsFor(r.scenario.settings), audio: r.manifest.audio };
    return canonical({ scene: r.job.scene, seed: r.job.seed, realism: r.job.realism, mode: r.job.analysis_mode,
      values: r.job.config.values, scoring_version: report.manifest.scoring_version,
      wrong_fix_m: report.experiment.wrong_fix_m ?? 10,
      physical_inputs_sha256: createHash('sha256').update(canonical(physical)).digest('hex') });
  }))].sort();
  entries.push({
    report: path, report_sha256: createHash('sha256').update(bytes).digest('hex'),
    population_sha256: createHash('sha256').update(canonical(population)).digest('hex'),
    git_hash: report.manifest.git_hash, code_version: report.manifest.code_version, dirty: report.manifest.dirty,
    n_runs: report.runs.length, schema: report.schema, scoring_version: report.manifest.scoring_version,
    summary: summariseRuns(report.runs, { ...report.experiment, bootstrap_samples: 100 })
  });
}
await writeFile(new URL('docs/benchmark-history.json', root), JSON.stringify({
  schema: 2, notes: 'Stored complete reports only. Comparison-population hashes include physical scene/settings, recorded clips, scoring version and wrong-fix target, not just reused scene IDs. Metrics recomputed with current aggregation from stored scores; inference is unchanged. Different hashes are not a longitudinal regression comparison. Dirty producers retain their original code hash.',
  entries
}, null, 2) + '\n');
