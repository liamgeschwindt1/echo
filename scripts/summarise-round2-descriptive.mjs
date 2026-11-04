import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { canonical } from '../packages/sim-core/src/benchmark/cache.js';
import { metricValues } from '../packages/sim-core/src/benchmark/metrics.js';

const root = new URL('../', import.meta.url), sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const selected = ['scene_fix_rate', 'source_fix_rate', 'horizontal_median_m', 'horizontal_p90_m',
  'useful_fix_rate', 'unflagged_wrong_fix_rate', 'wrong_fix_rate', 'within_1sigma', 'within_2sigma', 'risk_coverage_area'];
const metrics = (runs) => {
  const all = metricValues(runs);
  return Object.fromEntries(selected.map((key) => [key, all[key]]));
};
for (const study of ['node-count', 'range-noise']) {
  const registrationBytes = await readFile(new URL(`docs/experiments/round2-${study}.json`, root));
  const registration = JSON.parse(registrationBytes);
  const bytes = await readFile(new URL(`baselines/round2-${study}.json`, root)), report = JSON.parse(bytes);
  const jobs = buildJobs(registration).jobs, ids = new Set(jobs.map((j) => j.id));
  if (report.manifest.cancelled || report.runs.length !== jobs.length || new Set(report.runs.map((r) => r.job.id)).size !== jobs.length ||
      report.runs.some((r) => !ids.has(r.job.id))) throw new Error(`Incomplete or unequal ${study} population`);
  const groups = new Map();
  for (const run of report.runs) {
    const key = canonical({ values: run.job.config.values, realism: run.job.realism });
    const rows = groups.get(key) ?? [];
    rows.push(run); groups.set(key, rows);
  }
  const summary = [...groups].map(([key, runs]) => {
    if (runs.length !== 2 || new Set(runs.map((r) => r.job.seed)).size !== 2) throw new Error('Missing registered paired seed');
    const seedValues = runs.map((r) => ({ seed: r.job.seed, split: r.job.split, metrics: metrics([r]),
      nodes_with_stable_tracks: r.inference.nodes.filter((n) => n.tracks.length > 0).length,
      available_nodes: r.inference.nodes.length,
      nodes_used_per_fix: r.inference.fixes.map((f) => f.n_nodes) }));
    return { ...JSON.parse(key), runs: runs.length, metrics: metrics(runs), seed_values: seedValues,
      stable_track_node_rate: seedValues.reduce((sum, r) => sum + r.nodes_with_stable_tracks / r.available_nodes, 0) / seedValues.length,
      stable_track_seed_range: [Math.min(...seedValues.map((r) => r.nodes_with_stable_tracks / r.available_nodes)),
        Math.max(...seedValues.map((r) => r.nodes_with_stable_tracks / r.available_nodes))],
      actual_fusion_node_counts: [...new Set(seedValues.flatMap((r) => r.nodes_used_per_fix))].sort((a, b) => a - b) };
  });
  const output = { kind: 'echo-round2-descriptive', schema: 1, complete: true, study, registration,
    registration_sha256: sha(registrationBytes), input_sha256: sha(bytes), producer: report.manifest,
    notes: 'Two observed seed-cluster values/range, not a reliable population95%CI. Stable track presence is a detection proxy, not verified event/classification accuracy. No hardware winner; all no-fix errors remain null.',
    summary };
  if (study === 'range-noise') output.hardware_requirements = registration.sweeps.find((s) => s.variable === 'mic_array').values.map((array) => ({
    array, required_mic_self_noise_db_spl: null, required_heading_sigma_deg: null, required_inter_node_offset_ms: null,
    required_per_mic_timing_us: null,
    reason: 'Ambient floor, not mic self-noise, was swept; heading is bundled with other realism errors; no synchronized inter-node TDOA model. Retained all-suspect fixes cannot establish useful-fix target compliance. Do not invent tolerances from conditional errors.',
    observed_useful_rate: Math.max(...summary.filter((r) => r.values.mic_array === array).map((r) => r.metrics.useful_fix_rate))
  }));
  await writeFile(new URL(`baselines/round2-${study}-summary.json`, root), JSON.stringify(output, null, 2) + '\n');
  console.log(`${study}: complete ${report.runs.length} runs, ${summary.length} paired-seed conditions`);
}
