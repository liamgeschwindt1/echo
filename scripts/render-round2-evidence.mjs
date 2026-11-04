import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { reportHtml } from '../packages/sim-core/src/benchmark/report.js';

const root = new URL('../', import.meta.url), trials = [];
for (const study of ['confidence', 'global', 'global-uncertainty', 'weighted', 'predictive']) {
  for (const kind of ['baseline', 'trial']) {
    const path = `baselines/round2-${study}-${kind}.json.gz`, bytes = await readFile(new URL(path, root));
    const report = JSON.parse(gunzipSync(bytes));
    if (report.manifest.cancelled || report.runs.length !== 150) throw new Error(`Incomplete archived trial: ${path}`);
    await writeFile(new URL(`baselines/round2-${study}-${kind}.html`, root), reportHtml(report, report.manifest.targets));
    if (kind === 'trial') trials.push({ study, report: path, sha256: createHash('sha256').update(bytes).digest('hex'),
      accepted: report.comparison.pass, full_acceptance: report.comparison,
      confidence_evaluation: report.confidence_evaluation });
  }
}
const baseline = JSON.parse(await readFile(new URL('baselines/round2-final-baseline.json', root)));
const validationOn = baseline.runs.filter((r) => r.job.split === 'validation' && r.job.realism === 'on');
const bad = validationOn.filter((r) => r.scores.unmatched_fixes || r.scores.fixes.some((f) => f.horizontal_m > 10)).length;
const output = { trials, diagnostic_not_a_new_acceptance_rule: {
  population: 'Fixed validation/on population', n: validationOn.length, wrong_scene_count: bad,
  bootstrap_probability_no_wrong_scene: (1 - bad / validationOn.length) ** validationOn.length,
  implication: 'For confidence-only reordering with unchanged fixes/coverage, every bootstrap sample without a wrong scene has exactly zero risk-area delta. More than 2.5% such samples prevent a central 95% upper endpoint strictly below zero even with perfect ordering. No population, rule or threshold was changed in response.'
} };
await writeFile(new URL('baselines/round2-decisions.json', root), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ decisions: trials.map((t) => ({ study: t.study, accepted: t.accepted })),
  power_diagnostic: output.diagnostic_not_a_new_acceptance_rule }, null, 2));
