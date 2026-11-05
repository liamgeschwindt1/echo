import { readFile, writeFile, mkdir, rename, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { codeManifest, loadBenchmarkClips } from '../packages/sim-core/src/benchmark/node.js';
import { estimateExperiment } from '../packages/sim-core/src/benchmark/experiment.js';
import { finishExperiment, measuredOptions } from '../packages/sim-core/src/benchmark/runner.js';
import { scoreMeasured } from '../packages/sim-core/src/benchmark/score.js';
import { compareRound2Reports } from '../packages/sim-core/src/benchmark/acceptance.js';
import { reportHtml, reportCsv } from '../packages/sim-core/src/benchmark/report.js';
import { renderScenario } from '../packages/sim-core/src/render.js';
import { renderLengthS, sourcePosition } from '../packages/sim-core/src/scenario.js';
import { isMoving, positionAt } from '../packages/sim-core/src/motion.js';
import { speedOfSound } from '../packages/sim-core/src/physics.js';
import { analyseSpatial, spatialEligible } from './lib/measured-spatial.mjs';

if (process.argv.slice(2).join(' ') !== '--discard-renders') throw new Error('Use exactly --discard-renders; raw audio is never retained');
const root = new URL('../', import.meta.url), cache = new URL('.benchmark-round2-spatial/', root);
const read = (p) => readFile(new URL(p, root));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const registration = JSON.parse(await read('docs/experiments/round2-spatial.json'));
const referenceBytes = await read(registration.population.reference);
const baseline = JSON.parse(gunzipSync(referenceBytes));
const evaluation = JSON.parse(await read('docs/experiments/round2-evaluation.json'));
if (baseline.runs.length !== 150 || baseline.manifest.cancelled) throw new Error('Complete150-run reference required');
const population = baseline.runs.map((r) => `${r.job.scene}|${r.job.seed}|${r.job.realism}`).sort();
const expected = registration.population.scenes.flatMap((s) => registration.population.seeds.flatMap((seed) =>
  registration.population.realism.map((realism) => `${s}|${seed}|${realism}`))).sort();
if (JSON.stringify(population) !== JSON.stringify(expected)) throw new Error('Reference differs from registered exact population');
const eligibleScenes = [...new Set(baseline.runs.filter((r) => r.scenario.nodes.some(spatialEligible)).map((r) => r.job.scene))];
const trialEstimate = estimateExperiment({ ...evaluation, scenes: eligibleScenes });
const sealedEstimate = estimateExperiment(JSON.parse(await read('docs/experiments/round2-sealed.json')));
const disk = await statfs(root), diskUsed = 1 - disk.bavail / disk.blocks;
const reservedEnd = Date.now() + trialEstimate.milliseconds + sealedEstimate.milliseconds + 3600000;
const preflight = { now: new Date().toISOString(), disk_used: diskUsed, eligible_scenes: eligibleScenes,
  trial_measured_estimate: trialEstimate, trial_reservation_multiplier: 1, sealed_measured_estimate: sealedEstimate,
  reporting_ci_reserve_ms: 3600000, reserved_end: new Date(reservedEnd).toISOString() };
console.log(JSON.stringify(preflight));
if (diskUsed > 0.85 || reservedEnd > Date.parse('2026-11-04T19:25:00Z')) throw new Error('Spatial trial and mandatory sealed/reporting reserve do not fit; no outcome run');
await mkdir(cache, { recursive: true });
await writeFile(new URL('preflight.json', cache), JSON.stringify(preflight, null, 2) + '\n');
const manifest = await codeManifest();
const methodHash = hash(Buffer.concat(await Promise.all(['scripts/benchmark-spatial.mjs', 'scripts/lib/measured-spatial.mjs',
  'docs/experiments/round2-spatial.json'].map(read))));
const identity = { reference_sha256: hash(referenceBytes), method_sha256: methodHash, core: manifest.code_version,
  runtime: { node: process.versions.node, v8: process.versions.v8 } };
let completed = [];
try {
  const checkpoint = JSON.parse(await readFile(new URL('checkpoint.json', cache)));
  if (JSON.stringify(checkpoint.identity) !== JSON.stringify(identity)) throw new Error('Spatial checkpoint method/reference/runtime mismatch');
  completed = checkpoint.runs;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const clips = await loadBenchmarkClips([...new Set(baseline.runs.flatMap((r) => r.scenario.sources.map((s) => s.clip)))]);
function finite(value, path = 'result') {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Nonfinite spatial export at${path}`);
  if (value && typeof value === 'object') for (const [k, x] of Object.entries(value)) finite(x, `${path}.${k}`);
}
let rerendered = completed.filter((r) => r.spatial_provenance.rerendered).length;
for (const original of baseline.runs) {
  if (completed.some((r) => r.job.id === original.job.id)) continue;
  const scenario = original.scenario, eligible = scenario.nodes.some(spatialEligible);
  let result;
  if (!eligible) {
    result = { ...original, spatial_provenance: { rerendered: false,
      method: 'Identical reference inference; no full-rank nominal array', reference: registration.population.reference,
      reference_job: original.job.id } };
  } else {
    const diskNow = await statfs(root);
    if (1 - diskNow.bavail / diskNow.blocks > 0.85) throw new Error('Disk exceeds85%; checkpoint retained, no further render');
    const start = performance.now(), c = speedOfSound(scenario.settings.temperature_c);
    const used = new Map(scenario.sources.map((s) => [s.clip, clips.get(s.clip)]));
    const durations = new Map([...used].map(([id, pcm]) => [id, pcm.length / scenario.settings.render_sample_rate]));
    let rendered = renderScenario(scenario, used, { lengthS: renderLengthS(scenario, durations) });
    const renderMs = performance.now() - start, analysisStart = performance.now();
    const sensorScenario = { nodes: scenario.nodes, settings: scenario.settings, buildings: scenario.buildings };
    const sensorData = { sample_rate: rendered.sample_rate,
      nodes: rendered.nodes.map((n) => ({ id: n.id, mics: n.mics, mic_positions: n.mic_positions })) };
    const inference = analyseSpatial(sensorScenario, sensorData, { c, options: measuredOptions(scenario.settings) });
    const scores = scoreMeasured(scenario, inference, { c });
    for (const score of [...scores.sources, ...scores.fixes]) {
      if (score.measured_fix_index == null) continue;
      const fix = inference.fixes[score.measured_fix_index];
      if (fix.final_position.length !== 3) continue;
      const source = scenario.sources.find((s) => s.id === score.source_id), t = fix.positions.at(-1).t_e;
      const truth = isMoving(source) ? positionAt(source, t) : sourcePosition(source);
      score.error_3d_m = Math.hypot(...fix.final_position.map((x, i) => x - truth[i]));
    }
    rendered = null;
    result = { job: original.job, scenario, inference, scores, manifest: { ...manifest,
      scoring_version: original.manifest.scoring_version, audio: original.manifest.audio,
      spatial_method_sha256: methodHash }, cache_hit: false, render_cache_hit: false,
    render_ms: renderMs, analysis_ms: performance.now() - analysisStart, runtime_ms: performance.now() - start,
    spatial_provenance: { rerendered: true, source_truth_only_in_renderer_and_scorer: true,
      reference: registration.population.reference, reference_job: original.job.id, method_sha256: methodHash } };
    rerendered++;
  }
  finite(result);
  completed.push(result);
  const temp = new URL('checkpoint.tmp', cache);
  await writeFile(temp, JSON.stringify({ identity, runs: completed }));
  await rename(temp, new URL('checkpoint.json', cache));
  console.log(`Completed${completed.length}/150; fresh spatial renders${rerendered}`);
}
if (new Set(completed.map((r) => r.job.id)).size !== 150) throw new Error('Spatial population incomplete or duplicated');
completed.sort((a, b) => baseline.runs.findIndex((r) => r.job.id === a.job.id) - baseline.runs.findIndex((r) => r.job.id === b.job.id));
const report = finishExperiment(baseline.experiment, baseline.configs, completed, {
  ...manifest, expected_runs: 150, cancelled: false, spatial_trial: { ...identity, rerendered, reused: 150 - rerendered,
    registration: 'docs/experiments/round2-spatial.json', preflight,
    note: 'Offline experimental method, not deployed. Original inference/timings retained for rank-deficient-only cases.' } });
report.schema = '0.17-spatial-experimental';
report.manifest.schema = report.schema;
report.notes = report.notes.filter((n) => !n.startsWith('Measured-only reuses'));
report.notes.push('EXPERIMENTAL: full-rank arrays have3D DOA; only converged static fixes haveXYZ. Moving/rank-deficient fixes remain horizontal. Positional uncertainty unavailable. No real data.',
  'Partially reuses identical reference inference for ineligible geometries; full150-case population is complete, not150 new renders. Do not compare mixed producer runtimes as a speedup.');
report.comparison = compareRound2Reports(report, baseline, { bootstrap_samples: 1000 });
finite(report);
await writeFile(new URL('baselines/round2-spatial-trial.json.gz', root), gzipSync(Buffer.from(JSON.stringify(report, null, 2) + '\n')));
await writeFile(new URL('baselines/round2-spatial-trial.html', root), reportHtml(report, manifest.targets));
await writeFile(new URL('baselines/round2-spatial-trial.csv', root), reportCsv(report));
console.log(JSON.stringify({ complete: completed.length, rerendered, acceptance: report.comparison }, null, 2));
