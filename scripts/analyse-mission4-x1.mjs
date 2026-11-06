import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { aggregate } from '../packages/sim-core/src/benchmark/metrics.js';
import { mulberry32 } from '../packages/sim-core/src/rng.js';
import { percentile } from '../packages/sim-core/src/sweep.js';

const sourcePath = 'baselines/mission4-x1-node-count.json.gz';
const preregPath = 'docs/experiments/mission4-x1.json';
const outputPath = 'baselines/mission4-x1-node-count-analysis.json';
const markdownPath = 'docs/experiments/mission4-x1-node-count-results.md';
const [sourceBytes, prereg] = await Promise.all([
  readFile(sourcePath),
  readFile(preregPath, 'utf8').then(JSON.parse)
]);
const source = JSON.parse(gunzipSync(sourceBytes));

if (source.runs.length !== 140 || source.runs.length !== source.manifest.expected_runs ||
    source.manifest.cancelled || prereg.expected_runs !== 140) {
  throw new Error('X1 report is incomplete or does not match the preregistered 140-run population');
}

const bootstrapSamples = source.experiment.bootstrap_samples;
const confidence = source.experiment.confidence;
const wrongFixM = source.experiment.wrong_fix_m;
const rows = [];
for (const realism of ['off', 'on']) {
  for (const sourceCount of [1, 3]) {
    for (const nodeCount of [2, 3, 4, 5, 6, 7, 8]) {
      const runs = source.runs.filter((run) =>
        run.job.realism === realism &&
        run.job.analysis_mode === 'measured_only' &&
        run.job.config.settings.measured_fusion_mode === 'legacy' &&
        run.job.config.values.node_count === nodeCount &&
        run.scenario.settings.matrix_simultaneous_sources === sourceCount);
      const sites = new Map();
      for (const run of runs) {
        const site = run.job.scene;
        const cluster = sites.get(site) ?? [];
        cluster.push(run);
        sites.set(site, cluster);
      }
      if (runs.length !== 5 || sites.size !== 5 || [...sites.values()].some((cluster) => cluster.length !== 1)) {
        throw new Error(`Expected five independent site runs for ${realism}/${sourceCount} sources/N${nodeCount}`);
      }

      const metrics = aggregate(runs, {
        wrong_fix_m: wrongFixM,
        bootstrap_samples: bootstrapSamples,
        confidence
      });
      const custom = (sample) => ({
        duplicate_fix_scene_rate: sample.filter((run) =>
          (run.inference.fixes?.length ?? 0) > run.scenario.sources.length).length / sample.length,
        mean_fixes_per_scene: sample.reduce((sum, run) => sum + (run.inference.fixes?.length ?? 0), 0) / sample.length
      });
      const rng = mulberry32(7103);
      const customDraws = { duplicate_fix_scene_rate: [], mean_fixes_per_scene: [] };
      const clusters = [...sites.values()];
      for (let i = 0; i < bootstrapSamples; i++) {
        const sample = Array.from({ length: clusters.length }, () =>
          clusters[Math.floor(rng() * clusters.length)][0]);
        const values = custom(sample);
        for (const [key, value] of Object.entries(values)) customDraws[key].push(value);
      }
      const tail = (1 - confidence) * 50;
      const customMetrics = Object.fromEntries(Object.entries(custom(runs)).map(([key, value]) => [
        key,
        { value, ci: [percentile(customDraws[key], tail), percentile(customDraws[key], 100 - tail)] }
      ]));
      rows.push({
        realism,
        source_count: sourceCount,
        node_count: nodeCount,
        runs: runs.length,
        sites: [...sites.keys()].sort(),
        metrics: Object.fromEntries([
          'scene_fix_rate',
          'events_within_10m_misses_counted',
          'detectable_3_node_fraction',
          'wrong_fix_rate',
          'unflagged_wrong_fix_rate'
        ].map((key) => [key, metrics[key]])),
        ...customMetrics
      });
    }
  }
}

const payload = {
  schema: 1,
  source_report: sourcePath,
  source_report_sha256: createHash('sha256').update(sourceBytes).digest('hex'),
  preregistration: preregPath,
  method: '2000 bootstrap draws resampling the five fixed site clusters with replacement; 95% percentile intervals',
  wrong_fix_m: wrongFixM,
  results: rows
};
await writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n');

const fmt = (stat, fraction = false) => {
  if (!Number.isFinite(stat.value)) return 'n/a';
  const value = fraction ? `${(stat.value * 100).toFixed(1)}%` : stat.value.toFixed(3);
  const interval = stat.ci
    ? `${fraction ? (stat.ci[0] * 100).toFixed(1) : stat.ci[0].toFixed(3)}, ${fraction ? (stat.ci[1] * 100).toFixed(1) : stat.ci[1].toFixed(3)}`
    : 'n/a';
  return `${value} [${interval}]`;
};
const tableRows = rows.map((row) => {
  const m = row.metrics;
  return `| ${row.realism} | ${row.source_count} | ${row.node_count} | ${row.runs} | ${fmt(m.scene_fix_rate, true)} | ${fmt(m.events_within_10m_misses_counted, true)} | ${fmt(m.detectable_3_node_fraction, true)} | ${fmt(m.wrong_fix_rate, true)} | ${fmt(m.unflagged_wrong_fix_rate, true)} | ${fmt(row.duplicate_fix_scene_rate, true)} | ${fmt(row.mean_fixes_per_scene)} |`;
}).join('\n');
const markdown = `# Mission 4 X1 node-count sweep results

The preregistered 140-run legacy-solver sweep completed across ten fixed sites, node counts 2-8, and off/on profiles. Each row aggregates five site clusters across the registered train and validation sites. Intervals are 95% percentile intervals from 2,000 site-cluster bootstrap draws; these small-sample intervals are descriptive, not a population-wide ranking.

| Profile | Sources | Nodes | Sites | Scene fix rate [95% CI] | Events within 10 m, misses fail [95% CI] | Detectable at 3+ nodes [95% CI] | Wrong-fix rate [95% CI] | Unflagged wrong-fix rate [95% CI] | Duplicate-fix scene rate [95% CI] | Mean fixes/scene [95% CI] |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${tableRows}

In the selected three-source cohort, scene fix rate rises from 20% at N2 to 100% at N8 in both profiles. Events within 10 m rise from 6.7% to 66.7% off and 6.7% to 53.3% on, while source-aligned detection at 3+ nodes reaches only 20.0% off and 13.3% on at N8. N8 duplicate-fix scene rates are 60% off and 40% on. These point patterns show that coverage gain does not remove wrong/duplicate-fix risk; they do not prove a general node-count effect.

The fixed population contains only open, ground-source, stationary scenes from one- and three-source matrix cells. Results do not establish an all-environment node-count optimum. Each cell has five sites only, and the same sites repeat across node counts.

Machine-readable results and all intervals: \`${outputPath}\`. Compressed full run report: \`${sourcePath}\`.
`;
await writeFile(markdownPath, markdown);
console.log(JSON.stringify({ result: markdownPath, analysis: outputPath, rows: rows.length, report_sha256: payload.source_report_sha256 }, null, 2));
