import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { compareRound2Reports } from '../packages/sim-core/src/benchmark/acceptance.js';

const sourcePath = 'baselines/mission4-c1-smoke.json.gz';
const preregPath = 'docs/experiments/mission4-c1.json';
const outputPath = 'baselines/mission4-c1-smoke-analysis.json';
const markdownPath = 'docs/experiments/mission4-c1-smoke.md';
const [sourceBytes, prereg] = await Promise.all([
  readFile(sourcePath),
  readFile(preregPath, 'utf8').then(JSON.parse)
]);
const source = JSON.parse(gunzipSync(sourceBytes));

if (source.runs.length !== source.manifest.expected_runs ||
    source.runs.length !== 72 || prereg.population.exact_jobs_are_frozen_in_experiment !== true) {
  throw new Error('C1 smoke report is incomplete or does not match the preregistered 72-job population');
}
const configs = new Map(source.runs.map((run) => [run.job.config.name, run.job.config.id]));
if (configs.size !== 2 || !configs.has('legacy') || !configs.has('joint')) {
  throw new Error('Expected exactly the preregistered legacy and joint configurations');
}

function configReport(name) {
  const id = configs.get(name);
  const report = structuredClone(source);
  report.runs = report.runs.filter((run) => run.job.config.id === id);
  for (const run of report.runs) run.job.config.id = 'paired';
  report.manifest.expected_runs = report.runs.length;
  return report;
}

const legacy = configReport('legacy');
const joint = configReport('joint');
if (legacy.runs.length !== 36 || joint.runs.length !== 36) {
  throw new Error(`Expected 36 paired runs per configuration; got ${legacy.runs.length}/${joint.runs.length}`);
}
const acceptance = compareRound2Reports(joint, legacy, {
  bootstrap_samples: source.experiment.bootstrap_samples,
  confidence: source.experiment.confidence
});
const output = {
  schema: 1,
  source_report: sourcePath,
  preregistration: preregPath,
  configs: { reference: 'legacy', candidate: 'joint' },
  rule: 'Existing round-2 rule-four implementation; paired whole-scene/seed bootstrap',
  acceptance
};
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n');

const pct = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
const num = (value) => Number.isFinite(value) ? value.toFixed(3) : 'n/a';
const ci = (value) => value ? `[${num(value[0])}, ${num(value[1])}]` : 'n/a';
const rows = acceptance.rows.map((row) => {
  const c = row.changes;
  return `| ${row.key.split('|')[1]} | ${row.key.split('|')[2]} | ${row.n_pairs} | ${pct(c.scene_fix_rate.before)} | ${pct(c.scene_fix_rate.after)} | ${pct(c.within_1sigma.before)} | ${pct(c.within_1sigma.after)} | ${num(c.horizontal_p90_m.delta)} ${ci(c.horizontal_p90_m.ci)} | ${num(c.risk_coverage_area.delta)} ${ci(c.risk_coverage_area.ci)} | ${row.pass ? 'PASS' : 'FAIL'}${row.reasons.length ? `: ${row.reasons.join('; ')}` : ''} |`;
}).join('\n');
const markdown = `# Mission 4 C1 paired smoke result

The frozen 72-job smoke completed: 36 paired legacy/joint jobs across train/validation and off/on/surveyed profiles. Analysis uses the existing round-2 rule-four comparator with 2,000 whole-scene/seed bootstrap draws and 95% intervals. This smoke is not full acceptance.

| Split | Profile | Pairs | Legacy scene fix | Joint scene fix | Legacy within 1σ | Joint within 1σ | P90 delta [95% CI] m | Risk-area delta [95% CI] | Rule-four group |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
${rows}

Overall smoke decision: **${acceptance.pass ? 'PASS' : 'FAIL'}**. ${acceptance.pass ? 'This does not promote joint mode; full matrix-standard validation is still required.' : 'Keep legacy as default and joint mode opt-in. The smoke does not support promotion.'}

Training guards fail for off-realism 1σ calibration, on-realism scene-fix rate, and surveyed 1σ calibration. Validation on-realism scene-fix rate falls from 100% to 83.3%, and no endpoint improvement has a paired interval wholly below zero in that group. Validation off and surveyed groups pass, but cannot override failures elsewhere. Unflagged wrong-fix rate is zero for both solvers in all six groups. The covariance-derived confidence remains uncalibrated.

Full group metrics and intervals are in \`${outputPath}\`; source report is \`${sourcePath}\`.
`;
await writeFile(markdownPath, markdown);
console.log(JSON.stringify({ result: markdownPath, analysis: outputPath, pass: acceptance.pass, groups: acceptance.rows.length }, null, 2));
