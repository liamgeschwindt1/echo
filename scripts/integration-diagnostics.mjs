import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { buildJobs } from '../packages/sim-core/src/benchmark/experiment.js';
import { aggregate } from '../packages/sim-core/src/benchmark/metrics.js';
import { pairedDeltasForReports } from './engine-kpi.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const reports = [];
const refs = [];
for (const id of ['le0', 'le1']) {
  const inputPath = `docs/tracks/integration/prereg/round-1-${id}-smoke.json`;
  const inputBytes = await readFile(inputPath);
  const input = JSON.parse(inputBytes);
  const bytes = await readFile(`.benchmark-r3-integration/round-1-${id}.json`);
  const report = JSON.parse(bytes);
  const expected = buildJobs(input).jobs.map((job) => job.id).sort();
  const actual = report.runs.map((run) => run.job.id).sort();
  if (report.manifest.cancelled || JSON.stringify(expected) !== JSON.stringify(actual) ||
      expected.length !== report.manifest.expected_runs) throw new Error(`Incomplete diagnostic population: ${id}`);
  const archive = `baselines/integration-round1-${id}.json.gz`;
  await writeFile(archive, gzipSync(bytes), { flag: 'wx' });
  refs.push({ path: archive, sha256: hash(bytes), input: inputPath, input_sha256: hash(inputBytes) });
  reports.push(report);
}
const [baseline, candidate] = reports;
if (baseline.manifest.code_version !== candidate.manifest.code_version) throw new Error('Different diagnostic source hashes');
const partition = (report, key) => {
  const runs = report.runs.filter((run) => `${run.job.split}/${run.job.realism}` === key);
  return { ...report, runs, manifest: { ...report.manifest, expected_runs: runs.length } };
};
const keys = [...new Set(baseline.runs.map((run) => `${run.job.split}/${run.job.realism}`))];
const summary = {
  kind: 'echo-integration-diagnostics',
  scope: 'Existing CI population only; not matrix-standard, sealed or final stress-suite evidence',
  source_hash: candidate.manifest.code_version,
  preregistration: 'docs/tracks/integration/prereg/round-1.json',
  reports: refs,
  eligible_for_selection: false,
  reason: 'Official matrix-standard workflow is unavailable; diagnostic sample cannot establish full acceptance.',
  calibration_applied_runs: candidate.runs.filter((run) => run.inference.extensions?.fusion?.heading_calibration?.applied).length,
  pooled: {
    baseline: aggregate(baseline.runs),
    candidate: aggregate(candidate.runs),
    paired: pairedDeltasForReports(candidate, baseline)
  },
  partitions: keys.map((key) => {
    const before = partition(baseline, key);
    const after = partition(candidate, key);
    return {
      key, baseline: aggregate(before.runs), candidate: aggregate(after.runs),
      paired: pairedDeltasForReports(after, before)
    };
  }),
  timings: reports.map((report, index) => ({
    engine_id: index === 0 ? 'LE-0' : 'LE-1',
    runs: report.runs.map((run) => ({
      job_id: run.job.id, render_ms: run.render_ms, analysis_ms: run.analysis_ms,
      runtime_ms: run.runtime_ms, render_cache_hit: run.render_cache_hit
    }))
  }))
};
await writeFile('baselines/integration-round1-diagnostics.json', `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({
  eligible_for_selection: false,
  calibration_applied_runs: summary.calibration_applied_runs,
  runs_per_engine: candidate.runs.length,
  paired_events_delta: summary.pooled.paired.events_within_10m_misses_counted
}, null, 2));
