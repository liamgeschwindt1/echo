import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildScene } from '../packages/sim-core/src/benchmark/scenes.js';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { metricValues } from '../packages/sim-core/src/benchmark/metrics.js';
import { placementScale, suggestPlacement } from '../apps/sim/src/ui/placement.js';

const root = new URL('../', import.meta.url), sha = (data) => createHash('sha256').update(data).digest('hex');
const path = new URL('docs/experiments/round2-placement.json', root);
const helperHash = sha(await readFile(new URL('apps/sim/src/ui/placement.js', root)));
if (process.argv[2] === 'register') {
  const bounds = { min_x: -60, max_x: 60, min_y: -60, max_y: 60 }, custom_scenes = {}, predictions = {};
  for (let n = 2; n <= 6; n++) {
    const suggested = suggestPlacement(bounds, n), scene = buildScene('sparse_50');
    scene.id = `placement_${n}`; scene.name = `Greedy geometry placement ${n} nodes`;
    scene.nodes = suggested.nodes.map((position, i) => ({ ...structuredClone(scene.nodes[0]), id: `pnode${i + 1}`, position }));
    scene.sources[0].keyframes = [{ t: 0, position: [0, 20, 1.5] }];
    custom_scenes[scene.id] = scene;
    predictions[n] = { ...suggested, at_source: placementScale([0, 20], suggested.nodes) };
  }
  await writeFile(path, JSON.stringify({
    name: 'Geometry-only placement diagnostic, not a localiser change',
    mode: 'grid', scenes: Object.keys(custom_scenes), seeds: [1, 101], held_out_seeds: [101],
    analysis_modes: ['measured_only'], realism: ['off', 'on'], custom_scenes,
    base_settings: { reflection_order: 0, diffraction_order: 0, ground_reflectivity: 0 },
    max_runs: 30, expected_runs: 20,
    placement_method: { helper_sha256: helperHash, bounds, predictions,
      algorithm: 'Independent Gaussian azimuth Jacobian covariance;2.5deg assumed sigma,100m assumed bearing range,10deg crossing gate; known footprint LOS. Exclude indoor targets and bearings below1m horizontal range. Exhaust all pairs of eight quarter-lattice candidate mounts at5m, then greedy additions. Objective: mean min(major_scale/10m,1) over9x9 cell centres; blind=1; ties quantised1e-12 then candidate order.',
      analysis: 'Complete20 cases. Compare frozen source-point RMS geometry scale with observed matched-fix RMSE and actual fusion-node count, per seed/profile/N. Preserve no-fix errors/ratios as null. Two seed ranges, not population95%CI. No tuning from outcomes; one source cell does not validate the whole map, model probability or suggested real-world mounts.'
    }
  }, null, 2) + '\n', { flag: 'wx' });
  console.log('Registered exact20-case placement population and predictions; no audio/inference run.');
} else if (process.argv[2] === 'analyse') {
  const registrationBytes = await readFile(path), registration = JSON.parse(registrationBytes);
  if (registration.placement_method.helper_sha256 !== helperHash) throw new Error('Placement helper differs from preregistration');
  const bytes = await readFile(new URL('baselines/round2-placement.json', root)), report = JSON.parse(bytes);
  const jobs = buildJobs(registration).jobs, ids = new Set(jobs.map((j) => j.id));
  if (report.manifest.cancelled || report.runs.length !== jobs.length || new Set(report.runs.map((r) => r.job.id)).size !== jobs.length ||
      report.runs.some((r) => !ids.has(r.job.id))) throw new Error('Incomplete or unequal placement population');
  const rows = report.runs.map((r) => {
    const count = r.scenario.nodes.length, prediction = registration.placement_method.predictions[count].at_source;
    const errors = r.scores.fixes.map((f) => f.horizontal_m).filter(Number.isFinite);
    const rmse = errors.length ? Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length) : null;
    return { run_id: r.job.id, count, seed: r.job.seed, split: r.job.split, realism: r.job.realism,
      predicted_geometry_rms_m: prediction.rms_m, matched_fix_rmse_m: rmse,
      observed_to_assumed_rms_ratio: rmse === null || prediction.rms_m === null ? null : rmse / prediction.rms_m,
      actual_fusion_node_counts: [...new Set(r.inference.fixes.map((f) => f.n_nodes))], metrics: metricValues([r]) };
  });
  const output = { complete: true, runs: rows.length, registration_sha256: sha(registrationBytes), input_sha256: sha(bytes),
    method: registration.placement_method, producer: report.manifest, rows,
    caveat: 'Only one fixed source cell and two noise seeds. Geometry all-node covariance is deliberately contrasted with retained pair-only fusion. No calibrated map, detection probability, field mounting recommendation or demonstrated third-node fusion gain.'
  };
  await writeFile(new URL('baselines/round2-placement-summary.json', root), JSON.stringify(output, null, 2) + '\n');
  console.log('Complete20-case placement diagnostic, with explicit no-fix nulls.');
} else throw new Error('Usage: node scripts/placement-study.mjs register|analyse');
