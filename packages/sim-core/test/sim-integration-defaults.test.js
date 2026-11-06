import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { measuredOptions } from '../src/benchmark/runner.js';
import { measuredOptionsFor } from '../src/measured.js';
import { thresholdsOf } from '../src/export.js';

test('default measured options preserve the exact LE-0 option shape', async () => {
  const base = JSON.parse(gunzipSync(await readFile(new URL('../../../baselines/integration-le0-smoke.json.gz', import.meta.url))));
  const expected = base.runs.find((run) => run.job.analysis_mode === 'measured_only').inference.options;
  assert.deepEqual(measuredOptions({}), expected);
  assert.deepEqual(measuredOptionsFor({ measured_heading_self_calibration: 0 }), expected);
  assert.equal(thresholdsOf({}).measured_heading_self_calibration, undefined);
  assert.equal(measuredOptions({ measured_heading_self_calibration: 1 }).heading_self_calibration, 1);
  assert.equal(measuredOptions({ measured_fusion_mode: 'likelihood' }).likelihood_grid_step_m, 2);
});
