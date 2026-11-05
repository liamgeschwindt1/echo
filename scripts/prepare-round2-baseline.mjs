import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { rescoreReport } from '../packages/sim-core/src/benchmark/runner.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';

const root = new URL('../', import.meta.url);
const originalBytes = await readFile(new URL('baselines/final-1.json', root)), original = JSON.parse(originalBytes);
if (original.manifest.cancelled || original.runs.length !== original.manifest.expected_runs) throw new Error('Incomplete round-one source');
const registration = JSON.parse(await readFile(new URL('docs/experiments/round2-evaluation.json', root)));
const { jobs, configs } = buildJobs(registration), index = new Map(jobs.map((j) => [j.id, j]));
const selected = original.runs.filter((r) => r.job.analysis_mode === 'measured_only');
if (selected.length !== jobs.length || new Set(selected.map((r) => r.job.id)).size !== jobs.length ||
    selected.some((r) => !index.has(r.job.id))) throw new Error('Round-one inputs differ from preregistered population');
const provenance = await codeManifest();
const report = rescoreReport({
  ...original, experiment: registration, configs, runs: selected.map((r) => ({ ...r, job: index.get(r.job.id) })),
  manifest: { ...original.manifest, expected_runs: jobs.length, round2_baseline_derivation: {
    reference: 'baselines/final-1.json', sha256: createHash('sha256').update(originalBytes).digest('hex'),
    inference: 'Unmodified stored round-one measured inference; old held-out renamed validation. Current scoring aggregation applied equally to baseline and final.'
  } }
}, provenance);
for (const [extension, content] of [['json', JSON.stringify(report, null, 2) + '\n'], ['csv', reportCsv(report)], ['html', reportHtml(report, provenance.targets)]]) {
  await writeFile(new URL(`baselines/round2-final-baseline.${extension}`, root), content);
}
console.log(`Prepared ${jobs.length} unchanged baseline inferences; no render or inference recomputed.`);
