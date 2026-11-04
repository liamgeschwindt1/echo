import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { summariseRuns, rankingFlips } from '../packages/sim-core/src/benchmark/metrics.js';
import { metricTable, reportCsv, escapeHtml as esc } from '../packages/sim-core/src/benchmark/report.js';
import { codeManifest } from '../packages/sim-core/src/benchmark/node.js';

const root = new URL('../', import.meta.url), sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const path = new URL('docs/experiments/round2-array-regrade.json', root);
async function render(output) {
  if (!output.complete || output.sources.length !== 9) throw new Error('Only complete archived analysis may be rendered');
  await writeFile(new URL('baselines/round2-arrays-regraded.html', root), `<!doctype html><meta charset="utf-8"><title>Archived array regrading, not a rerender</title><style>body{font:14px system-ui;margin:2rem}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.4rem}section{overflow:auto}pre{white-space:pre-wrap}.pass{background:#d9eedf}.fail{background:#f2d5d5}</style><h1>Archived array regrading, not a rerender</h1><p>${esc(output.method)}</p><p>Mixed-range target colours are indicative only; provisional error targets apply within50m. No hardware winner.</p>${output.sources.map((s) => `<details open><summary>${esc(s.name)}: ${s.expected_runs} complete archived cases</summary><p>Original producer ${esc(s.producer.git_hash)}; source SHA256 ${esc(s.sha256)}</p><section>${metricTable({ summary: s.summary }, output.targets)}</section><pre>${esc(JSON.stringify({ primary: s.primary, risk: s.risk }, null, 2))}</pre></details>`).join('')}`);
}
if (process.argv[2] === 'register') {
  const names = ['array-full-budget', 'array-heading', 'array-gain', 'array-position', 'array-correlation',
    'array-noise-floor', 'array-self-noise', 'array-ground', 'array-source-level'];
  const sources = [];
  for (const name of names) {
    const experiment = JSON.parse(await readFile(new URL(`docs/experiments/${name}.json`, root)));
    const file = `baselines/${name}.json.gz`;
    sources.push({ name, file, sha256: sha(await readFile(new URL(file, root))), expected_runs: buildJobs(experiment).jobs.length, experiment });
  }
  await writeFile(path, JSON.stringify({ sources, bootstrap_samples: 500, confidence: .95,
    method: 'Re-aggregate ALL original900 full-array and8x144 endpoint stored inferences with current metrics. No rerender, solver change, new test or claim of improved-engine hardware validation. Existing outcomes are already known; only the new complete coverage-aware analysis is preregistered. Preserve exact archives/producer hashes. Map legacy held-out metadata to seen validation in derived summaries only. Primary useful-fix rate; secondary risk-coverage area (both over all scenes). Include every array, suppress comparisons on missing/unequal populations, preserve nulls and ties. Shared bootstrap500 whole scene/seed runs; within-site seeds remain correlated, not independent field sites. Point-leader flips are descriptive, not significant superiority or hardware winners.'
  }, null, 2) + '\n', { flag: 'wx' });
  console.log('Registered exact complete2052 archived cases and new grading method; no metrics calculated.');
} else if (process.argv[2] === 'analyse') {
  const bytes = await readFile(path), registration = JSON.parse(bytes), sources = [];
  const targets = JSON.parse(await readFile(new URL('docs/targets.json', root)));
  const compact = (result) => ({ ...result, rankings: result.rankings.map(({ rows, ...row }) => row) });
  for (const source of registration.sources) {
    const raw = await readFile(new URL(source.file, root));
    if (sha(raw) !== source.sha256) throw new Error(`Archive changed: ${source.file}`);
    const report = JSON.parse(gunzipSync(raw)), jobs = buildJobs(source.experiment).jobs, ids = new Set(jobs.map((j) => j.id));
    if (report.manifest.cancelled || report.runs.length !== source.expected_runs || new Set(report.runs.map((r) => r.job.id)).size !== jobs.length ||
        report.runs.some((r) => !ids.has(r.job.id))) throw new Error(`Incomplete/unequal archive: ${source.file}`);
    const runs = report.runs.map((r) => ({ ...r, job: { ...r.job, split: r.job.split === 'held-out' ? 'validation' : r.job.split } }));
    const summary = summariseRuns(runs, { ...source.experiment, bootstrap_samples: registration.bootstrap_samples, confidence: registration.confidence });
    const primary = compact(rankingFlips(summary)), risk = compact(rankingFlips(summary, 'risk_coverage_area'));
    if ([...primary.rankings, ...risk.rankings].some((r) => r.reason?.startsWith('Unequal'))) throw new Error('Registered complete array population mismatch');
    sources.push({ ...source, producer: report.manifest, summary, primary, risk });
    await writeFile(new URL(`baselines/round2-regraded-${source.name}.csv`, root), reportCsv({ ...report, summary }));
    console.log(`Complete ${source.name}: ${runs.length} archived cases; no inference recomputed.`);
  }
  const output = { kind: 'echo-archived-array-regrading', schema: 1, complete: true, registration_sha256: sha(bytes),
    method: registration.method, reaggregation_producer: await codeManifest(), targets, sources };
  await writeFile(new URL('baselines/round2-arrays-regraded.json', root), JSON.stringify(output, null, 2) + '\n');
  await render(output);
} else if (process.argv[2] === 'render') {
  await render(JSON.parse(await readFile(new URL('baselines/round2-arrays-regraded.json', root))));
} else throw new Error('Usage: node scripts/round2-array-regrade.mjs register|analyse|render');
