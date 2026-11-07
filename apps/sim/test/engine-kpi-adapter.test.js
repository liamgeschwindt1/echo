import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptEngineKpi } from '../src/ui/engine-kpi-adapter.js';
import { engineAssetsPlugin } from '../scripts/engine-assets.mjs';
import { deltaMetric } from '../src/ui/dashboards.js';

test('registry KPI adapter preserves published values, intervals and profile populations', async () => {
  const kpi = JSON.parse(await readFile(new URL('../../../engines/LE-0/kpi.json', import.meta.url), 'utf8'));
  const data = adaptEngineKpi(kpi, 'LE-0');
  const key = 'horizontal_p90_m';
  assert.equal(data.headline.pooled[key].value, kpi.headline[key].value);
  assert.deepEqual(data.headline.pooled[key].ci, kpi.headline[key].interval95);
  assert.equal(data.headline.pooled[key].n_sites, kpi.headline[key].n_sites);
  const on = kpi.breakdowns.install_profile_comparison.find((row) => row.profile === 'on');
  assert.equal(data.headline.on[key].value, on.metrics[key].value);
  assert.equal(data.matrix.on.length, 24);
  assert.equal(data.headline.pooled.aerial_height_error_m.value, null);
  assert.equal(data.source_count_split.on, undefined, 'pooled source counts must not be relabeled as on');
});

test('dashboard comparisons never invent paired intervals from marginal intervals', () => {
  const base = { value: 0.5, ci: [0.4, 0.6], engine_id: 'LE-0' };
  assert.equal(deltaMetric({ value: 0.9, ci: [0.8, 1] }, base), null);
  assert.deepEqual(deltaMetric({
    value: 0.9, paired_deltas: { 'LE-0': { delta: 0.4, interval95: [0.2, 0.5] } }
  }, base), { value: 0.4, ci: [0.2, 0.5] });
});

test('registered engine JSON is included as exact production assets', async () => {
  const plugin = await engineAssetsPlugin();
  const assets = [];
  plugin.generateBundle.call({ emitFile: (asset) => assets.push(asset) });
  for (const file of ['registry.json', 'LE-0/engine.json', 'LE-0/kpi.json', 'LE-0/refs.json']) {
    const asset = assets.find((entry) => entry.fileName === `engines/${file}`);
    assert.ok(asset);
    assert.deepEqual(asset.source, await readFile(new URL(`../../../engines/${file}`, import.meta.url)));
  }
});
