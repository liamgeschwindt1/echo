import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const baselinePath = 'baselines/matrix-baseline-r3.full.json.gz';
const experimentPath = 'docs/experiments/mission4-x1-node-count.json';
const preregPath = 'docs/experiments/mission4-x1.json';
const bytes = await readFile(baselinePath);
const report = JSON.parse(gunzipSync(bytes));
const selected = new Map();
for (const run of report.runs) {
  const cellIndex = run.scenario.settings.matrix_cell_index;
  if (!run.job.scene.startsWith('core-') || ![0, 1].includes(cellIndex) ||
      run.scenario.settings.matrix_environment !== 'open' ||
      run.scenario.settings.matrix_source_height !== 'ground' ||
      run.scenario.settings.matrix_motion !== 'stationary') continue;
  if (!selected.has(cellIndex)) selected.set(cellIndex, new Map());
  selected.get(cellIndex).set(run.job.scene, run);
}
const sites = [0, 1].flatMap((cellIndex) =>
  [...selected.get(cellIndex).values()]
    .filter((run) => ['train', 'validation'].includes(run.job.split))
    .sort((a, b) => a.job.scene.localeCompare(b.job.scene))
    .map((run) => ({
      id: run.job.scene,
      scene: run.scenario,
      split: run.job.split,
      render_seed: run.job.seed,
      source_count: run.scenario.sources.length
    })));
if (sites.length !== 10 || new Set(sites.map((site) => site.source_count)).size !== 2) {
  throw new Error(`Expected ten open, ground, stationary matrix sites; got ${sites.length}`);
}
const experiment = {
  name: 'Mission 4 X1: legacy solver node-count sweep on fixed matrix sites',
  scenes: sites.map((site) => site.id),
  seeds: [1],
  scene_seeds: Object.fromEntries(sites.map((site) => [site.id, [site.render_seed]])),
  scene_splits: Object.fromEntries(sites.map((site) => [site.id, site.split])),
  custom_scenes: Object.fromEntries(sites.map((site) => [site.id, site.scene])),
  realism: ['off', 'on'],
  analysis_modes: ['measured_only'],
  mode: 'grid',
  base_settings: { measured_fusion_mode: 'legacy' },
  base_values: {},
  sweeps: [{ variable: 'node_count', values: [2, 3, 4, 5, 6, 7, 8] }],
  max_runs: 2000,
  wrong_fix_m: 10,
  bootstrap_samples: 2000,
  permutation_samples: 2000,
  confidence: 0.95,
  preregistration: {
    baseline_gzip_sha256: createHash('sha256').update(bytes).digest('hex'),
    source_cells: [0, 1],
    note: 'Training and validation source sites are selected before rendering new node-count variants; no sealed site is used.'
  }
};
const preregistration = {
  name: 'Mission 4 X1 node-count reconciliation',
  status: 'preregistered-before-new-node-count-runs',
  schema: 1,
  source_baseline: baselinePath,
  source_baseline_gzip_sha256: experiment.preregistration.baseline_gzip_sha256,
  source_cells: sites.map(({ id, split, source_count }) => ({ id, split, source_count })),
  fixed_factors: { environment: 'open', source_height: 'ground', motion: 'stationary', install_profiles: ['off', 'on'] },
  variable: { node_counts: [2, 3, 4, 5, 6, 7, 8], solver: 'legacy pairwise' },
  experiment: experimentPath,
  expected_runs: sites.length * 7 * 2,
  acceptance: 'Diagnostic only; no solver tuning or promotion. Report all node counts and intervals; small selected population is not a general population ranking.',
  limitations: [
    'Only ten matrix sites from two open/ground/stationary source-count cells are used.',
    'This does not estimate an all-environment node-count curve.',
    'Some untransformed five-node baseline outcomes are already known; transformed node-count variants are new rendered runs.',
    'No sealed inputs are used or read.'
  ]
};
await writeFile(experimentPath, JSON.stringify(experiment, null, 2) + '\n');
await writeFile(preregPath, JSON.stringify(preregistration, null, 2) + '\n');
console.log(JSON.stringify({
  experiment: experimentPath,
  preregistration: preregPath,
  expected_runs: preregistration.expected_runs,
  sites: sites.map(({ id, split, source_count }) => ({ id, split, source_count })),
  baseline_gzip_sha256: preregistration.source_baseline_gzip_sha256
}, null, 2));
