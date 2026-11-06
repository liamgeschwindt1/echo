import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildArtifacts } from '../../../scripts/engine-kpi.mjs';

async function writeFixtureReport() {
  const root = await mkdtemp(join(tmpdir(), 'engine-kpi-'));
  const reportPath = join(root, 'report.json');
  const metric = (value, ci = null) => ({ value, ci, n_runs: 4, n_sites: 2, confidence: 0.95 });
  const report = {
    kind: 'echo-sim-benchmark',
    experiment: { wrong_fix_m: 10 },
    manifest: { expected_runs: 4 },
    summary: [{
      analysis_mode: 'measured_only',
      realism: 'on',
      split: 'validation',
      metrics: {
        events_within_10m_misses_counted: metric(0.75, [0.5, 1]),
        horizontal_p90_m: metric(9.5, [8, 11]),
        horizontal_median_m: metric(3.5, [2.9, 4.2]),
        scene_fix_rate: metric(0.9, [0.7, 1]),
        source_fix_rate: metric(0.95, [0.8, 1]),
        unflagged_wrong_fix_rate: metric(0.05, [0.01, 0.09]),
        within_1sigma: metric(0.63, [0.5, 0.7]),
        within_2sigma: metric(0.91, [0.8, 1]),
        error_3d_p90_m: metric(null, null),
        track_median_error_m: metric(2.2, [1.8, 2.6]),
        detectable_3_node_fraction: metric(0.8, [0.6, 0.9]),
        detectable_3_node_events_within_10m: metric(0.7, [0.5, 0.85]),
        detectable_3_node_event_count: metric(30, [25, 35])
      }
    }]
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

test('engine KPI artifacts are deterministic and preserve null metrics', async () => {
  const reportPath = await writeFixtureReport();
  const args = {
    engineId: 'LE-0',
    parentId: null,
    status: 'baseline',
    branch: 'overnight/loc5-infra',
    sourceHash: 'fixture-hash',
    optionSet: {},
    notes: 'fixture',
    reportInputs: [reportPath],
    date: '2026-01-01T00:00:00.000Z'
  };
  const first = await buildArtifacts(args);
  const second = await buildArtifacts(args);
  assert.deepEqual(first, second);
  assert.equal(first.kpi.headline.error_3d_p90_m.value, null);
  assert.equal(first.kpi.headline.error_3d_p90_m.interval95, null);
  assert.equal(first.kpi.comparisons.vs_le0.metrics.horizontal_median_m.delta, 0);
  assert.deepEqual(first.kpi.comparisons.vs_le0.metrics.horizontal_median_m.interval95, [0, 0]);
});
