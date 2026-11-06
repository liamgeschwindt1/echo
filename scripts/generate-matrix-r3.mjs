import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../packages/sim-core/src/rng.js';
import { defaultScenario, newBuilding, newNode, newSource, validateScenario } from '../packages/sim-core/src/scenario.js';
import { canonical } from '../packages/sim-core/src/benchmark/cache.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? 'docs/experiments/matrix-r3-sites.json');
const environments = ['open', 'mixed', 'dense_urban'];
const heights = ['ground', 'aerial'];
const motions = ['stationary', 'moving'];
const sourceCounts = [1, 3];
const realism = ['off', 'on', 'surveyed'];
const trainSitesPerCell = 4;
const validationSitesPerCell = 8;
const sealedSitesPerCell = 8;
const generalisationCount = 48;
const densityCount = 60;
const sourceRangeM = 40;
const siteAreaM2 = 40000;
const preregistration = JSON.parse(await readFile(resolve(root, 'docs/experiments/matrix-r3.json'), 'utf8'));

function averageUnitPairDistance(count) {
  const points = Array.from({ length: count }, (_, i) => [Math.cos(2 * Math.PI * i / count), Math.sin(2 * Math.PI * i / count)]);
  const distances = points.flatMap((p, i) => points.slice(i + 1).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
  return distances.reduce((sum, d) => sum + d, 0) / distances.length;
}

function sourcePathPoint(source, t) {
  if (source.keyframes.length === 1) return source.keyframes[0].position;
  const [a, b] = source.keyframes;
  const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  return a.position.map((v, i) => v + (b.position[i] - v) * u);
}

function insideRect(x, y, b, margin = 0) {
  return Math.abs(x - b.position[0]) <= b.size[0] / 2 + margin &&
    Math.abs(y - b.position[1]) <= b.size[1] / 2 + margin;
}

function makeBuildings(environment, rng, nodes, sources) {
  if (environment === 'open') return { buildings: [], cover: 0 };
  const target = environment === 'mixed' ? 0.15 : 0.4;
  const targetArea = siteAreaM2 * target;
  const heightRange = environment === 'mixed' ? [8, 20] : [15, 40];
  const sizeRange = environment === 'mixed' ? [24, 42] : [28, 45];
  const streetRange = [10, 25];
  const protectedPoints = [
    ...nodes.map((n) => n.position),
    ...sources.flatMap((s) => Array.from({ length: 81 }, (_, i) => sourcePathPoint(s, i / 80 * 8 + 3)))
  ];
  const buildings = [];
  let builtArea = 0;
  for (let attempt = 0; builtArea < targetArea && attempt < 3000; attempt++) {
    const width = sizeRange[0] + rng() * (sizeRange[1] - sizeRange[0]);
    const depth = sizeRange[0] + rng() * (sizeRange[1] - sizeRange[0]);
    const building = newBuilding(
      `b${buildings.length + 1}`,
      -100 + rng() * 200,
      -100 + rng() * 200,
      width,
      depth,
      heightRange[0] + rng() * (heightRange[1] - heightRange[0])
    );
    if (protectedPoints.some(([x, y]) => insideRect(x, y, building, 1))) continue;
    const street = streetRange[0] + rng() * (streetRange[1] - streetRange[0]);
    if (buildings.some((other) => {
      const gapX = Math.abs(other.position[0] - building.position[0]) -
        (other.size[0] + building.size[0]) / 2;
      const gapY = Math.abs(other.position[1] - building.position[1]) -
        (other.size[1] + building.size[1]) / 2;
      return gapX < street && gapY < street;
    })) continue;
    buildings.push(building);
    builtArea += width * depth;
  }
  return { buildings, cover: builtArea / siteAreaM2 };
}

function makeScene({
  id, siteSeed, renderSeed, environment, source_height: sourceHeight, motion,
  simultaneous_sources, sourceCount: explicitSourceCount, soundType, nodeCount = 5, spacingM = 40,
  cell_index, includeCellIndex = true
}) {
  const sourceCount = explicitSourceCount ?? simultaneous_sources;
  if (!Number.isInteger(sourceCount) || sourceCount < 1) throw new Error(`Invalid registered source count for ${id}`);
  const rng = mulberry32(siteSeed);
  const scenario = defaultScenario();
  scenario.settings = {
    ...scenario.settings,
    seed: renderSeed,
    matrix_site_seed: siteSeed,
    noise_floor_db_spl: 45,
    mic_self_noise_db_spl: 30,
    reflection_order: environment === 'open' ? 0 : 1,
    diffraction_order: environment === 'open' ? 0 : 2,
    block_direct_behind_buildings: environment !== 'open',
    matrix_environment: environment,
    matrix_source_height: sourceHeight,
    matrix_motion: motion,
    matrix_simultaneous_sources: sourceCount,
    ...(includeCellIndex && Number.isInteger(cell_index) ? { matrix_cell_index: cell_index } : {}),
    matrix_sound_type: soundType,
    matrix_node_count: nodeCount,
    matrix_mean_spacing_m: spacingM
  };
  const radius = spacingM / averageUnitPairDistance(nodeCount);
  scenario.nodes = Array.from({ length: nodeCount }, (_, i) => {
    const angle = 2 * Math.PI * i / nodeCount;
    return newNode(`n${i + 1}`, radius * Math.cos(angle), radius * Math.sin(angle));
  });
  const baseAngle = rng() * 2 * Math.PI;
  const speed = motion === 'stationary' ? 0 : sourceHeight === 'ground' ? 1.5 + rng() * 8.5 : 10 + rng() * 10;
  const z = sourceHeight === 'ground' ? 1.5 : 40 + rng() * 80;
  scenario.sources = Array.from({ length: sourceCount }, (_, i) => {
    const angle = baseAngle + 2 * Math.PI * i / sourceCount;
    const x = sourceRangeM * Math.cos(angle), y = sourceRangeM * Math.sin(angle);
    const source = newSource(`s${i + 1}`, soundType === 'impulsive' ? 'glass_breaking' : 'engine', x, y, 100);
    source.start_s = 3;
    source.keyframes = motion === 'stationary'
      ? [{ t: 0, position: [x, y, z] }]
      : [{ t: 3, position: [x, y, z] }, { t: 8, position: [x + speed * 5 * Math.cos(angle + Math.PI / 2), y + speed * 5 * Math.sin(angle + Math.PI / 2), z] }];
    return source;
  });
  const { buildings, cover } = makeBuildings(environment, rng, scenario.nodes, scenario.sources);
  scenario.buildings = buildings;
  return {
    scenario: validateScenario(scenario),
    metadata: {
      id, site_seed: siteSeed, render_seed: renderSeed, environment, source_height: sourceHeight,
      motion, source_count: sourceCount, sound_type: soundType, node_count: nodeCount,
      mean_spacing_m: spacingM, target_building_cover_fraction: environment === 'open' ? 0 : environment === 'mixed' ? 0.15 : 0.4,
      generated_building_cover_fraction: cover,
      synthetic_street_layout: environment === 'dense_urban',
      placeholder_parameters: true
    }
  };
}

let cellIndex = 0;
const cells = [];
const sites = [];
for (const environment of environments) for (const sourceHeight of heights) for (const motion of motions) for (const sourceCount of sourceCounts) {
  const cell = { environment, source_height: sourceHeight, motion, simultaneous_sources: sourceCount, cell_index: cellIndex++ };
  cells.push(cell);
  for (const [split, splitIndex, count] of [
    ['train', 0, trainSitesPerCell],
    ['validation', 1, validationSitesPerCell],
    ['sealed', 2, sealedSitesPerCell]
  ]) for (let replicate = 0; replicate < count; replicate++) {
    const siteSeed = 300000 + cell.cell_index * 1000 + splitIndex * 100 + replicate;
    const renderSeed = 3100000 + cell.cell_index * 10000 + splitIndex * 1000 + replicate;
    const soundType = replicate % 2 === 0 ? 'impulsive' : 'sustained';
    const id = `core-${cell.cell_index}-${split}-${String(replicate + 1).padStart(2, '0')}`;
    const generated = makeScene({ id, siteSeed, renderSeed, ...cell, soundType, includeCellIndex: split !== 'sealed' });
    sites.push({ ...generated, split, cell_index: cell.cell_index });
  }
}

for (let i = 0; i < generalisationCount; i++) {
  const siteSeed = 330000 + i;
  const renderSeed = 3300000 + i;
  const rng = mulberry32(siteSeed);
  const cell = {
    environment: environments[Math.floor(rng() * environments.length)],
    source_height: heights[Math.floor(rng() * heights.length)],
    motion: motions[Math.floor(rng() * motions.length)],
    simultaneous_sources: sourceCounts[Math.floor(rng() * sourceCounts.length)]
  };
  const soundType = i % 2 === 0 ? 'impulsive' : 'sustained';
  const id = `generalisation-${String(i + 1).padStart(3, '0')}`;
  sites.push({ ...makeScene({ id, siteSeed, renderSeed, ...cell, soundType }), split: 'validation', cell_index: null, generalisation: true });
}

const nodeCounts = [2, 3, 4, 5, 6, 8], spacings = [20, 40, 80];
for (let i = 0; i < densityCount; i++) {
  const design = (i * 73 + 17) % (cells.length * nodeCounts.length * spacings.length);
  const cell = cells[Math.floor(design / (nodeCounts.length * spacings.length))];
  const nodeCount = nodeCounts[Math.floor(design / spacings.length) % nodeCounts.length];
  const spacingM = spacings[design % spacings.length];
  const siteSeed = 360000 + i, renderSeed = 3600000 + i;
  const soundType = i % 2 === 0 ? 'impulsive' : 'sustained';
  const id = `density-${String(i + 1).padStart(3, '0')}`;
  sites.push({
    ...makeScene({ id, siteSeed, renderSeed, ...cell, soundType, nodeCount, spacingM }),
    split: 'validation', cell_index: cell.cell_index, density_sweep: true
  });
}

const scriptHash = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
const input = {
  schema: 1,
  preregistration_sha256: createHash('sha256').update(canonical(preregistration)).digest('hex'),
  generator_sha256: scriptHash,
  cells,
  sites,
  placeholder_notice: 'All scene dimensions, levels, source motion distributions and realism settings are simulated design placeholders.'
};
input.input_sha256 = createHash('sha256').update(canonical(input)).digest('hex');
await writeFile(output, JSON.stringify(input) + '\n');

function experimentFor(name, selectedSites, profiles = realism) {
  const rows = selectedSites.map((site) => ({
    id: site.metadata.id,
    scene: site.scenario,
    split: site.split,
    render_seed: site.metadata.render_seed
  }));
  return {
    name,
    scenes: rows.map((r) => r.id),
    seeds: [1],
    scene_seeds: Object.fromEntries(rows.map((r) => [r.id, [r.render_seed]])),
    scene_splits: Object.fromEntries(rows.map((r) => [r.id, r.split])),
    custom_scenes: Object.fromEntries(rows.map((r) => [r.id, r.scene])),
    realism: profiles,
    analysis_modes: ['measured_only'],
    mode: 'grid',
    sweeps: [],
    max_runs: 2000,
    wrong_fix_m: 10,
    bootstrap_samples: 2000,
    preregistration: {
      input_sha256: input.input_sha256,
      generator_sha256: scriptHash,
      sealed_input_sha256: preregistration.sealed_input_sha256
    }
  };
}

const smokeCells = cells.filter((cell) =>
  cell.motion === 'stationary' && cell.simultaneous_sources === 1);
const smokeSites = smokeCells.flatMap((cell) => {
  const members = sites.filter((site) => site.cell_index === cell.cell_index &&
    ['train', 'validation'].includes(site.split));
  return [
    members.find((site) => site.split === 'train' && site.metadata.sound_type === 'impulsive'),
    members.find((site) => site.split === 'validation' && site.metadata.sound_type === 'sustained')
  ];
});
const timingSites = smokeCells.map((cell) => sites.find((site) =>
  site.cell_index === cell.cell_index && site.split === 'train' &&
  site.metadata.sound_type === 'impulsive'));
const expandedTimingSites = cells.map((cell) => sites.find((site) =>
  site.cell_index === cell.cell_index && site.split === 'train' &&
  site.metadata.sound_type === 'impulsive'));
const standardSites = cells.flatMap((cell) => {
  const members = sites.filter((site) => site.cell_index === cell.cell_index &&
    ['train', 'validation'].includes(site.split));
  return [
    members.find((site) => site.split === 'train'),
    ...members.filter((site) => site.split === 'validation').slice(0, 2)
  ];
});
const baselineSites = cells.flatMap((cell) => {
  const members = sites.filter((site) => site.cell_index === cell.cell_index &&
    ['train', 'validation'].includes(site.split));
  return [
    ...members.filter((site) => site.split === 'train').slice(0, 2),
    ...members.filter((site) => site.split === 'validation').slice(0, 3)
  ];
}).concat(sites.filter((site) => site.generalisation)).concat(sites.filter((site) =>
  site.density_sweep && site.metadata.node_count !== 8 && site.metadata.mean_spacing_m !== 80));
const fullSites = sites.filter((site) =>
  ['train', 'validation'].includes(site.split) || site.generalisation || site.density_sweep);
await writeFile(resolve(root, 'docs/experiments/matrix-r3-smoke.json'),
  JSON.stringify(experimentFor('Matrix smoke: six cells, train and validation', smokeSites), null, 2) + '\n');
await writeFile(resolve(root, 'docs/experiments/matrix-r3-timing.json'),
  JSON.stringify(experimentFor('Matrix timing: one registered site per scene type', timingSites), null, 2) + '\n');
await writeFile(resolve(root, 'docs/experiments/matrix-r3-timing-expanded.json'),
  JSON.stringify(experimentFor('Matrix timing: one registered site per core cell', expandedTimingSites), null, 2) + '\n');
await writeFile(resolve(root, 'docs/experiments/matrix-r3-standard.json'),
  JSON.stringify(experimentFor('Matrix standard: 24 cells, three sites each', standardSites), null, 2) + '\n');
await writeFile(resolve(root, 'docs/experiments/matrix-r3-baseline.json'),
  JSON.stringify(experimentFor('Matrix baseline: five sites per cell plus capped sweeps', baselineSites), null, 2) + '\n');
await writeFile(resolve(root, 'docs/experiments/matrix-r3-full.json'),
  JSON.stringify(experimentFor('Matrix full: 24 cells, train/validation plus sweeps', fullSites), null, 2) + '\n');

const sealedSites = sites.filter((s) => s.split === 'sealed' || s.generalisation);
const sealedScenes = Object.fromEntries(sealedSites.map((s) => [s.metadata.id, s.scenario]));
const sealedRegistration = {
  site_seeds: sealedSites.map((s) => ({ id: s.metadata.id, site_seed: s.metadata.render_seed })),
  input_sha256: createHash('sha256').update(canonical({
    sites: sealedSites.map((s) => ({ id: s.metadata.id, site_seed: s.metadata.render_seed, scene: s.scenario })),
    renderSeed: null
  })).digest('hex')
};
if (preregistration.sealed_input_sha256 &&
    sealedRegistration.input_sha256 !== preregistration.sealed_input_sha256) {
  throw new Error('Generated sealed input does not match the preregistered frozen hash');
}
const sealed = {
  name: 'Frozen round 3 matrix sealed test; reserved for Mission 3D',
  sealed: true,
  scenes: sealedSites.map((s) => s.metadata.id),
  seeds: [1],
  scene_seeds: Object.fromEntries(sealedSites.map((s) => [s.metadata.id, [s.metadata.render_seed]])),
  scene_splits: Object.fromEntries(sealedSites.map((s) => [s.metadata.id, 'test'])),
  custom_scenes: sealedScenes,
  realism: ['on', 'surveyed'],
  analysis_modes: ['measured_only'],
  mode: 'grid',
  sweeps: [],
  max_runs: 1000,
  preregistration: sealedRegistration
};
await writeFile(resolve(root, 'docs/experiments/matrix-r3-sealed.json'), JSON.stringify(sealed, null, 2) + '\n');
console.log(JSON.stringify({
  input: output,
  sites: sites.length,
  core_cells: cells.length,
  train: sites.filter((s) => s.split === 'train').length,
  validation: sites.filter((s) => s.split === 'validation').length,
  sealed: sealedSites.length,
  sealed_input_sha256: sealedRegistration.input_sha256,
  generated_input_sha256: input.input_sha256,
  smoke_runs: smokeSites.length * realism.length,
  standard_runs: standardSites.length * realism.length,
  baseline_sites: baselineSites.length,
  baseline_runs: baselineSites.length * realism.length,
  full_runs: fullSites.length * realism.length,
  generator_sha256: scriptHash
}, null, 2));
