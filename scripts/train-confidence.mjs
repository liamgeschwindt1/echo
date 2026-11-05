import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { confidenceFeatures, fitLogistic, predictWrong, logistic, applyConfidence, reliabilityDiagram } from './lib/confidence.mjs';
import { scoreMeasured } from '../packages/sim-core/src/benchmark/score.js';
import { rescoreReport, finishExperiment } from '../packages/sim-core/src/benchmark/runner.js';
import { codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { compareRound2Reports } from '../packages/sim-core/src/benchmark/acceptance.js';
import { speedOfSound } from '../packages/sim-core/src/physics.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';
import { fuseGlobalTracks, hardwareSigma } from './lib/global-fusion.mjs';

const root = new URL('../', import.meta.url);
const { values } = parseArgs({ options: { study: { type: 'string', default: 'confidence' } } });
const study = values.study;
if (!['confidence', 'global', 'global-uncertainty', 'weighted', 'predictive'].includes(study)) throw new Error('Unknown preregistered confidence study');
for (const suffix of ['json', 'json.gz']) {
  try { await stat(new URL(`baselines/round2-${study}-trial.${suffix}`, root)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  throw new Error(`Trial ${study} already exists; preserve evidence and preregister a new study instead of overwriting`);
}
const methodPath = `docs/experiments/round2-${['weighted', 'predictive'].includes(study) ? 'consensus' : study === 'confidence' ? 'confidence' : 'global'}.json`;
const methodBytes = await readFile(new URL(methodPath, root));
const originalBytes = await readFile(new URL('baselines/final-1.json', root));
const original = JSON.parse(originalBytes);
const registration = JSON.parse(await readFile(new URL('docs/experiments/round2-evaluation.json', root)));
const hyperparameters = JSON.parse(await readFile(new URL('docs/experiments/round2-confidence.json', root)));
const provenance = await codeManifest();
const baseline = rescoreReport({
  ...original, runs: original.runs.filter((r) => r.job.analysis_mode === 'measured_only').map((r) => ({
    ...r, job: { ...r.job, split: r.job.split === 'held-out' ? 'validation' : 'train' }
  })),
  experiment: registration, manifest: { ...original.manifest, expected_runs: 150 }
}, provenance);
const candidateRuns = baseline.runs.map((r) => {
  if (study === 'confidence') return r;
  const global = fuseGlobalTracks(r.inference.nodes, { c: speedOfSound(r.scenario.settings.temperature_c), options: r.inference.options,
    ...(['weighted', 'predictive'].includes(study) ? { consensus: study, scenario: r.scenario } : {}) });
  const inference = { ...r.inference, fixes: global.fixes, global_assignment: { states: global.states, utility: global.utility } };
  return { ...r, inference, scores: scoreMeasured(r.scenario, inference, { c: speedOfSound(r.scenario.settings.temperature_c) }) };
});
const examples = candidateRuns.flatMap((r) => r.inference.fixes.map((fix, fi) => {
  const score = r.scores.fixes.find((s) => s.measured_fix_index === fi);
  const features = confidenceFeatures(fix, r.inference.nodes, { settings: r.scenario.settings, buildings: r.scenario.buildings });
  return {
    x: features.values, y: Number(!score || score.horizontal_m > 10),
    error: score?.horizontal_m ?? null, scale: features.scale_m, scene: r.job.scene,
    split: r.job.split, realism: r.job.realism, run_id: r.job.id, fi
  };
}));
const training = examples.filter((e) => e.split === 'train');
if (!training.length) throw new Error('Empty training population');
const scenes = [...new Set(baseline.runs.filter((r) => r.job.split === 'train').map((r) => r.job.scene))].sort();
const fold = (e) => scenes.indexOf(e.scene) % 5;
const oof = new Map();
for (let k = 0; k < 5; k++) {
  const fitted = fitLogistic(training.filter((e) => fold(e) !== k), hyperparameters.logistic);
  for (const e of training.filter((e) => fold(e) === k)) oof.set(e, predictWrong(fitted, e.x));
}
const logit = (p) => Math.log(Math.max(1e-12, p) / Math.max(1e-12, 1 - p));
let intercept = 0, slope = 1;
for (let it = 0; it < 2000; it++) {
  let a = 0, b = 0;
  for (const e of training) {
    const x = logit(oof.get(e)), residual = logistic(intercept + slope * x) - e.y;
    a += residual; b += residual * x;
  }
  intercept -= 0.05 * a / training.length;
  slope -= 0.05 * (b / training.length + 0.1 * (slope - 1));
}
const regression = { ...fitLogistic(training, hyperparameters.logistic), calibration: { intercept, slope } };
const wrongTrain = training.filter((e) => e.y).flatMap((e) => [
  predictWrong(regression, e.x), logistic(intercept + slope * logit(oof.get(e)))
]);
const radius = Object.fromEntries(['off', 'on'].map((condition) => {
  const values = training.filter((e) => e.realism === condition && Number.isFinite(e.error)).map((e) => e.error / e.scale).sort((a, b) => a - b);
  const rank = Math.ceil(0.9 * (values.length + 1));
  return [condition, { quantile: rank > values.length ? null : values[rank - 1], n: values.length, rank, target: 0.9 }];
}));
const model = {
  id: `round2-${study}-logistic-v1`, regression, radius,
  flag_threshold: wrongTrain.length ? Math.min(...wrongTrain) / 2 : 0,
  training: {
    reference_sha256: createHash('sha256').update(originalBytes).digest('hex'),
    population: baseline.runs.filter((r) => r.job.split === 'train').map((r) => r.job.id),
    n_episodes: training.length, n_wrong: training.filter((e) => e.y).length, scene_folds: Object.fromEntries(scenes.map((s, i) => [s, i % 5])),
    hyperparameters, study_registration: { path: methodPath, sha256: createHash('sha256').update(methodBytes).digest('hex'), method: JSON.parse(methodBytes) }, producer: provenance
  }
};
if (study === 'global-uncertainty') model.bearing_intervals = Object.fromEntries(['off', 'on'].map((realism) => {
  const errors = candidateRuns.filter((r) => r.job.split === 'train' && r.job.realism === realism)
    .flatMap((r) => r.scores.fixes.flatMap((s) => s.nodes.map((n) => n.az_error_deg))).filter(Number.isFinite).sort((a, b) => a - b);
  const quantile = (coverage) => { const rank = Math.ceil(coverage * (errors.length + 1)); return rank > errors.length ? null : errors[rank - 1]; };
  return [realism, { sigma_deg: quantile(0.6827), two_sigma_deg: quantile(0.9545), n: errors.length, semantics: 'train empirical central absolute-bearing-error intervals; not Gaussian standard deviation' }];
}));
const runs = candidateRuns.map((r) => {
  const inference = applyConfidence(structuredClone(r.inference), { buildings: r.scenario.buildings, settings: r.scenario.settings }, model);
  if (['weighted', 'predictive'].includes(study)) for (let ni = 0; ni < inference.nodes.length; ni++) {
    const sigma = hardwareSigma(r.scenario.nodes[ni], r.scenario.settings);
    inference.nodes[ni].bearing_intervals = { sigma_deg: sigma, two_sigma_deg: 2 * sigma, semantics: 'Independent declared hardware and legacy bearing terms in quadrature; gain term zero in ideal PHAT' };
  }
  if (model.bearing_intervals) for (const n of inference.nodes) n.bearing_intervals = model.bearing_intervals[r.job.realism];
  return { ...r, inference, scores: scoreMeasured(r.scenario, inference, { c: speedOfSound(r.scenario.settings.temperature_c) }) };
});
const trial = finishExperiment(registration, baseline.configs, runs, {
  ...baseline.manifest, confidence_trial: model.id, code_version: provenance.code_version, expected_runs: 150
});
trial.comparison = compareRound2Reports(trial, baseline, registration);
trial.confidence_model = model;
trial.confidence_evaluation = ['train', 'validation'].flatMap((split) => ['off', 'on'].map((realism) => {
  const predictions = examples.filter((e) => e.split === split && e.realism === realism).map((e) => ({
    p: predictWrong(regression, e.x), y: e.y, radius_covered: Number.isFinite(e.error) && Number.isFinite(radius[realism].quantile) ? e.error <= radius[realism].quantile * e.scale : null
  }));
  const known = predictions.filter((p) => p.radius_covered !== null);
  return {
    split, realism, n_episodes: predictions.length, reliability: reliabilityDiagram(predictions),
    brier_score: predictions.length ? predictions.reduce((s, p) => s + (p.p - p.y) ** 2, 0) / predictions.length : null,
    radius_90_coverage: known.length ? known.filter((p) => p.radius_covered).length / known.length : null,
    radius_n: known.length
  };
}));
for (const [stem, report] of [[`round2-${study}-baseline`, baseline], [`round2-${study}-trial`, trial]]) {
  await writeFile(new URL(`baselines/${stem}.json`, root), JSON.stringify(report, null, 2) + '\n');
  await writeFile(new URL(`baselines/${stem}.csv`, root), reportCsv(report));
  await writeFile(new URL(`baselines/${stem}.html`, root), reportHtml(report, provenance.targets));
}
await writeFile(new URL(`baselines/round2-${study}-model.json`, root), JSON.stringify(model, null, 2) + '\n');
console.log(JSON.stringify({ accepted: trial.comparison.pass, training_episodes: training.length, threshold: model.flag_threshold, evaluation: trial.confidence_evaluation, comparison: trial.comparison.rows }, null, 2));
