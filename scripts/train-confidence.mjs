import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { confidenceFeatures, fitLogistic, predictWrong, logistic, applyConfidence, reliabilityDiagram } from '../packages/sim-core/src/confidence.js';
import { scoreMeasured } from '../packages/sim-core/src/benchmark/score.js';
import { rescoreReport, finishExperiment } from '../packages/sim-core/src/benchmark/runner.js';
import { codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { compareRound2Reports } from '../packages/sim-core/src/benchmark/acceptance.js';
import { speedOfSound } from '../packages/sim-core/src/physics.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';

const root = new URL('../', import.meta.url);
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
const examples = baseline.runs.flatMap((r) => r.inference.fixes.map((fix, fi) => {
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
  id: 'round2-logistic-v1', regression, radius,
  flag_threshold: wrongTrain.length ? Math.min(...wrongTrain) / 2 : 0,
  training: {
    reference_sha256: createHash('sha256').update(originalBytes).digest('hex'),
    population: baseline.runs.filter((r) => r.job.split === 'train').map((r) => r.job.id),
    n_episodes: training.length, n_wrong: training.filter((e) => e.y).length, scene_folds: Object.fromEntries(scenes.map((s, i) => [s, i % 5])),
    hyperparameters, producer: provenance
  }
};
const runs = baseline.runs.map((r) => {
  const inference = applyConfidence(structuredClone(r.inference), { buildings: r.scenario.buildings, settings: r.scenario.settings }, model);
  return { ...r, inference, scores: scoreMeasured(r.scenario, inference, { c: speedOfSound(r.scenario.settings.temperature_c) }) };
});
const trial = finishExperiment(registration, baseline.configs, runs, {
  ...baseline.manifest, confidence_trial: model.id, code_version: provenance.code_version, expected_runs: 150
});
trial.comparison = compareRound2Reports(trial, baseline, registration);
trial.confidence_model = model;
trial.confidence_evaluation = ['train', 'validation'].flatMap((split) => ['off', 'on'].map((realism) => {
  const predictions = examples.filter((e) => e.split === split && e.realism === realism).map((e) => ({
    p: predictWrong(regression, e.x), y: e.y, radius_covered: Number.isFinite(e.error) ? e.error <= radius[realism].quantile * e.scale : null
  }));
  const known = predictions.filter((p) => p.radius_covered !== null);
  return {
    split, realism, n_episodes: predictions.length, reliability: reliabilityDiagram(predictions),
    brier_score: predictions.length ? predictions.reduce((s, p) => s + (p.p - p.y) ** 2, 0) / predictions.length : null,
    radius_90_coverage: known.length ? known.filter((p) => p.radius_covered).length / known.length : null,
    radius_n: known.length
  };
}));
for (const [stem, report] of [['round2-confidence-baseline', baseline], ['round2-confidence-trial', trial]]) {
  await writeFile(new URL(`baselines/${stem}.json`, root), JSON.stringify(report, null, 2) + '\n');
  await writeFile(new URL(`baselines/${stem}.csv`, root), reportCsv(report));
  await writeFile(new URL(`baselines/${stem}.html`, root), reportHtml(report, provenance.targets));
}
await writeFile(new URL('baselines/round2-confidence-model.json', root), JSON.stringify(model, null, 2) + '\n');
console.log(JSON.stringify({ accepted: trial.comparison.pass, training_episodes: training.length, threshold: model.flag_threshold, evaluation: trial.confidence_evaluation, comparison: trial.comparison.rows }, null, 2));
