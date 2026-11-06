import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourcePath = 'docs/experiments/matrix-r3-smoke.json';
const experimentPath = 'docs/experiments/mission4-c1-smoke.json';
const preregPath = 'docs/experiments/mission4-c1.json';
const sourceBytes = await readFile(resolve(sourcePath));
const source = JSON.parse(sourceBytes);
const experiment = {
  ...source,
  name: 'Mission 4 C1: legacy versus joint fusion on preregistered matrix smoke',
  mode: 'paired',
  configs: [
    { name: 'legacy', settings: { measured_fusion_mode: 'legacy' } },
    { name: 'joint', settings: { measured_fusion_mode: 'joint' } }
  ],
  base_settings: {},
  bootstrap_samples: 2000,
  permutation_samples: 2000,
  confidence: 0.95
};
const preregistration = {
  name: 'Mission 4 C1 joint N-node fusion smoke comparison',
  status: 'preregistered-before-run',
  schema: 1,
  source_experiment: sourcePath,
  source_experiment_sha256: createHash('sha256').update(sourceBytes).digest('hex'),
  experiment: experimentPath,
  population: {
    inherited_from: sourcePath,
    analysis_modes: ['measured_only'],
    profiles: ['off', 'on', 'surveyed'],
    split: ['train', 'validation'],
    paired_configs: ['legacy', 'joint'],
    exact_jobs_are_frozen_in_experiment: true
  },
  candidate: {
    mode: 'measured_fusion_mode=joint',
    default: 'legacy',
    deterministic: true,
    position_changing: true
  },
  acceptance: {
    reference: 'legacy config on same exact site/seed/profile jobs',
    required_metrics: [
      'scene_fix_rate',
      'unflagged_wrong_fix_rate',
      'within_1sigma',
      'within_2sigma',
      'events_within_10m_misses_counted',
      'horizontal_median_m',
      'horizontal_p90_m',
      'risk_coverage_area'
    ],
    rule: 'docs/round2-method.md rule four and Mission 4 acceptance rule; validation is accept/reject only',
    smoke_is_not_full_acceptance: true
  },
  known_scope: [
    'This smoke covers the preregistered stationary one-source smoke cells only.',
    'C1 does not change rendering, legacy mode, or default solver.',
    'Joint mode handles static tracks only; moving tracks retain legacy pairwise behavior until separately implemented and accepted.',
    'All thresholds and covariance-derived radii are placeholders pending independent calibration.'
  ]
};
await writeFile(experimentPath, JSON.stringify(experiment, null, 2) + '\n');
await writeFile(preregPath, JSON.stringify(preregistration, null, 2) + '\n');
console.log(JSON.stringify({
  experiment: experimentPath,
  preregistration: preregPath,
  source_experiment_sha256: preregistration.source_experiment_sha256,
  configs: experiment.configs.map((config) => config.name),
  runs: experiment.scenes.length * experiment.seeds.length * experiment.realism.length * experiment.configs.length
}, null, 2));
