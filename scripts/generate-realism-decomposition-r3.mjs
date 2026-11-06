import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonical } from '../packages/sim-core/src/benchmark/cache.js';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { mulberry32 } from '../packages/sim-core/src/rng.js';

const preregistrationPath = resolve('docs/experiments/matrix-r3.json');
const sitesPath = resolve('docs/experiments/matrix-r3-sites.json');
const outputSites = resolve('docs/experiments/matrix-r3-realism-sites.json');
const outputExperiment = resolve('docs/experiments/matrix-r3-realism-decomposition.json');
const [preregistration, registered] = await Promise.all([
  readFile(preregistrationPath, 'utf8').then(JSON.parse),
  readFile(sitesPath, 'utf8').then(JSON.parse)
]);

const candidates = registered.sites.filter((site) =>
  ['open', 'mixed'].includes(site.metadata.environment) &&
  site.metadata.source_height === 'ground' &&
  site.metadata.motion === 'stationary' &&
  site.metadata.source_count === 1 &&
  ['train', 'validation'].includes(site.split));
const levels = [
  ['heading_error_sigma_deg', [0.5, 1, 2.5, 5]],
  ['mic_position_sigma_mm', [2, 5, 10]],
  ['noise_correlation', [0.3, 0.6]],
  ['mic_gain_sigma_db', [0.5, 1, 2]]
];
const contrasts = [];
for (const [component, values] of levels) for (const value of values) {
  contrasts.push({ kind: 'single', components: [component], values: { [component]: value } });
}
for (let i = 0; i < levels.length; i++) for (let j = i + 1; j < levels.length; j++) {
  const [first, firstLevels] = levels[i], [second, secondLevels] = levels[j];
  for (const firstValue of firstLevels) for (const secondValue of secondLevels) {
    contrasts.push({
      kind: 'pairwise',
      components: [first, second],
      values: { [first]: firstValue, [second]: secondValue }
    });
  }
}
if (contrasts.length < preregistration.realism_decomposition.minimum_total_sites) {
  throw new Error('Realism decomposition does not meet its preregistered minimum site count');
}

function averageUnitPairDistance(count) {
  const points = Array.from({ length: count }, (_, i) => [Math.cos(2 * Math.PI * i / count), Math.sin(2 * Math.PI * i / count)]);
  const distances = points.flatMap((p, i) => points.slice(i + 1).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  return distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
}

function makeVariant(base, contrast, index, variant) {
  const siteSeed = 3400000 + index;
  const renderSeed = 34000000 + index;
  const rng = mulberry32(siteSeed);
  const environment = index % 2 === 0 ? 'open' : 'mixed';
  const nodeCount = 2 + Math.floor(index / 2) % 5;
  const spacingM = 40;
  const id = `realism-${String(index + 1).padStart(3, '0')}-${variant}`;
  const scenario = structuredClone(base.scenario);
  const radius = spacingM / averageUnitPairDistance(nodeCount);
  const prototype = scenario.nodes[0];
  const dx = (rng() - 0.5) * 20, dy = (rng() - 0.5) * 20;
  scenario.nodes = Array.from({ length: nodeCount }, (_, i) => ({
    ...structuredClone(prototype),
    id: `n${i + 1}`,
    position: [dx + radius * Math.cos(2 * Math.PI * i / nodeCount), dy + radius * Math.sin(2 * Math.PI * i / nodeCount)]
  }));
  for (const source of scenario.sources) for (const keyframe of source.keyframes) {
    keyframe.position[0] += dx;
    keyframe.position[1] += dy;
  }
  for (const building of scenario.buildings) {
    building.position[0] += dx;
    building.position[1] += dy;
  }
  const componentValues = variant === 'baseline' ? {} : contrast.values;
  const components = Object.fromEntries(levels.map(([name]) => [name, componentValues[name] ?? 0]));
  Object.assign(scenario.settings, components, {
    seed: renderSeed,
    matrix_site_seed: siteSeed,
    matrix_environment: environment,
    matrix_node_count: nodeCount,
    matrix_mean_spacing_m: spacingM,
    matrix_realism_contrast_id: `realism-${String(index + 1).padStart(3, '0')}`,
    matrix_realism_contrast_kind: contrast.kind,
    matrix_realism_components: contrast.components,
    matrix_realism_values: contrast.values,
    matrix_realism_variant: variant
  });
  return {
    id,
    scenario,
    metadata: {
      contrast_id: `realism-${String(index + 1).padStart(3, '0')}`,
      kind: contrast.kind,
      components: contrast.components,
      values: contrast.values,
      variant,
      site_seed: siteSeed,
      render_seed: renderSeed,
      environment,
      node_count: nodeCount,
      source_height: 'ground',
      motion: 'stationary',
      source_count: 1
    }
  };
}

const rows = contrasts.map((contrast, index) => {
  const environment = index % 2 === 0 ? 'open' : 'mixed';
  const base = candidates.filter((site) => site.metadata.environment === environment)[index % candidates.filter((site) => site.metadata.environment === environment).length];
  return [
    makeVariant(base, contrast, index, 'baseline'),
    makeVariant(base, contrast, index, 'treatment')
  ];
}).flat();
const population = {
  schema: 1,
  name: preregistration.realism_decomposition.design,
  source_input_sha256: registered.input_sha256,
  sealed_input_sha256: preregistration.sealed_input_sha256,
  contrasts: contrasts.length,
  sites: contrasts.length,
  variants_per_site: 2,
  rows
};
population.input_sha256 = createHash('sha256').update(canonical(population)).digest('hex');
const generatorSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const experiment = {
  name: 'Round 3 realism component decomposition: matched source-site contrasts',
  scenes: rows.map((row) => row.id),
  seeds: [1],
  scene_seeds: Object.fromEntries(rows.map((row) => [row.id, [row.metadata.render_seed]])),
  scene_splits: Object.fromEntries(rows.map((row) => [row.id, 'train'])),
  custom_scenes: Object.fromEntries(rows.map((row) => [row.id, row.scenario])),
  realism: ['custom'],
  analysis_modes: ['measured_only'],
  mode: 'grid',
  sweeps: [],
  max_runs: 2000,
  wrong_fix_m: 10,
  bootstrap_samples: 2000,
  preregistration: {
    input_sha256: population.input_sha256,
    source_input_sha256: registered.input_sha256,
    sealed_input_sha256: preregistration.sealed_input_sha256,
    generator_sha256: generatorSha256
  }
};
const runCount = buildJobs(experiment).jobs.length;
if (runCount !== contrasts.length * 2) throw new Error(`Unexpected realism decomposition run count: ${runCount}`);
await writeFile(outputSites, JSON.stringify(population, null, 2) + '\n');
await writeFile(outputExperiment, JSON.stringify(experiment, null, 2) + '\n');
console.log(JSON.stringify({
  sites: contrasts.length,
  variants: rows.length,
  runs: runCount,
  single_component_contrasts: contrasts.filter((contrast) => contrast.kind === 'single').length,
  pairwise_contrasts: contrasts.filter((contrast) => contrast.kind === 'pairwise').length,
  input_sha256: population.input_sha256,
  generator_sha256: generatorSha256,
  output: outputExperiment
}, null, 2));
