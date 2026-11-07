import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { aggregate } from '../packages/sim-core/src/benchmark/metrics.js';
import { buildingBox, segmentBlocked } from '../packages/sim-core/src/geometry.js';
import { positionAt } from '../packages/sim-core/src/motion.js';

const preregPath = 'docs/tracks/integration/prereg/building-audit.json';
const preregBytes = await readFile(preregPath);
const prereg = JSON.parse(preregBytes);
const bytes = gunzipSync(await readFile(prereg.input));
const hash = (data) => createHash('sha256').update(data).digest('hex');
if (hash(bytes) !== prereg.uncompressed_sha256) throw new Error('Archived baseline hash mismatch');
const report = JSON.parse(bytes);
const runs = report.runs.filter((run) => {
  const settings = run.scenario.settings;
  return run.job.scene.startsWith('core-') && run.job.analysis_mode === 'measured_only' &&
    run.job.realism === 'on' && settings.matrix_source_height === 'ground' &&
    settings.matrix_motion === 'stationary' && settings.matrix_simultaneous_sources === 1;
});
const groups = prereg.groups.map((environment) => {
  const rows = runs.filter((run) => run.scenario.settings.matrix_environment === environment);
  return {
    environment,
    metrics: aggregate(rows),
    geometry: rows.map((run) => {
      const { scenario } = run;
      const source = scenario.sources[0];
      const origin = positionAt(source, source.start_s);
      const boxes = scenario.buildings.map(buildingBox);
      return {
        scene: run.job.scene,
        seed: run.job.seed,
        split: run.job.split,
        building_count: boxes.length,
        reflection_order: scenario.settings.reflection_order,
        diffraction_order: scenario.settings.diffraction_order,
        block_direct_behind_buildings: scenario.settings.block_direct_behind_buildings,
        nominal_node_rays: scenario.nodes.map((node) => ({
          node_id: node.id,
          blocked: segmentBlocked(origin, node.position, boxes),
          range_m: Math.hypot(...origin.map((value, i) => value - node.position[i]))
        }))
      };
    })
  };
});
const result = {
  kind: 'echo-archived-building-audit',
  preregistration: { path: preregPath, sha256: hash(preregBytes) },
  input: { path: prereg.input, uncompressed_sha256: hash(bytes) },
  source_hash: report.manifest.code_version,
  groups,
  comparison: {
    round2: 'Sealed errors-on physical subgroups: 31 buildings-present sites and 9 no-buildings sites. Overlapping descriptive categories, not a paired causal contrast.',
    matrix: 'Fixed node-count/spacing core cells with generated geometry; filtered one-source ground stationary on-profile subset only.',
    conclusion: 'Populations differ in sites, geometry, ranges and sampling design. Neither contrast estimates a causal effect of adding buildings; their rates must not be subtracted or used to select a lever.',
    generator_changed: false,
    new_inference_runs: 0,
    sealed_input_opened: false
  }
};
await writeFile('baselines/integration-building-audit.json', `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(groups.map((group) => ({
  environment: group.environment,
  coverage: group.metrics.scene_fix_rate,
  within_10m: group.metrics.events_within_10m_misses_counted,
  blocked_rays: group.geometry.reduce((sum, row) => sum + row.nominal_node_rays.filter((ray) => ray.blocked).length, 0),
  rays: group.geometry.reduce((sum, row) => sum + row.nominal_node_rays.length, 0)
})), null, 2));
