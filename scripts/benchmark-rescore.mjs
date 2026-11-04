import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { rescoreReport } from '../packages/sim-core/src/benchmark/runner.js';
import { compareReports } from '../packages/sim-core/src/benchmark/metrics.js';
import { reportCsv, reportHtml } from '../packages/sim-core/src/benchmark/report.js';

const args = process.argv.slice(2);
const option = (name, required = true) => {
  const at = args.indexOf(name);
  if (at < 0 && !required) return null;
  if (at < 0 || !args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`Required: ${name} VALUE`);
  return args[at + 1];
};
const input = resolve(option('--from')), output = resolve(option('--out'));
if (input === output) throw new Error('Preserve original report; --out must differ from --from');
const report = rescoreReport(JSON.parse(await readFile(input, 'utf8')), await codeManifest());
const baseline = option('--compare', false);
if (baseline) {
  report.comparison = compareReports(report, JSON.parse(await readFile(resolve(baseline), 'utf8')), report.experiment.tolerances);
  if (args.includes('--fail-on-regress') && !report.comparison.pass) process.exitCode = 1;
} else if (args.includes('--fail-on-regress')) throw new Error('--fail-on-regress requires --compare');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
const stem = output.replace(/\.json$/, '');
await writeFile(`${stem}.csv`, reportCsv(report));
await writeFile(`${stem}.html`, reportHtml(report, report.manifest.targets));
console.log(`Re-scored ${report.runs.length} stored inferences without rendering or inference changes. Saved ${output}${report.comparison ? `; ${report.comparison.pass ? 'no regressions' : `${report.comparison.regressions.length} REGRESSIONS`}` : ''}.`);
