import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildStandaloneEnginesHtml, mapBaselineToKpi } from '../src/ui/dashboards.js';

test('baseline adapter maps LE-0 matrix baseline into dashboard KPI structure', async () => {
  const baseline = JSON.parse(await readFile(new URL('../../../baselines/matrix-baseline-r3.json', import.meta.url), 'utf8'));
  const mapped = mapBaselineToKpi(baseline);
  assert.ok(mapped.matrix.off.length > 0);
  assert.ok(mapped.install_profile_comparison.length > 0);
  assert.ok(mapped.source_count_split.off.length > 0);
  assert.equal(mapped.integrity.sealed_set_run, false);
});

test('standalone engine dashboard html is self-contained', () => {
  const payload = {
    pageId: 'engines',
    profile: 'on',
    compareMode: 'none',
    selectedEngineId: 'LE-0',
    le0Id: 'LE-0',
    engines: [{
      id: 'LE-0',
      parent: null,
      date: '2026-11-01',
      status: 'baseline',
      source_hash: 'abc123',
      options: {},
      refs: { baseline: 'baselines/matrix-baseline-r3.json' },
      kpi: {
        headline: { on: { events_within_10m_misses_counted: { value: 0.9, ci: [0.8, 1] } } },
        matrix: { on: [] },
        source_count_split: { on: [] },
        node_count_curve: [],
        install_profile_comparison: [],
        detectable_subsets: [],
        building_vs_open: [],
        failure_attribution: [],
        tracking: [],
        integrity: { sealed_set_run: false, input_sha256: 'i', sealed_input_sha256: 's', population: { runs: 1 } }
      }
    }]
  };
  const html = buildStandaloneEnginesHtml(payload);
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Synthetic simulator outputs only/);
  assert.equal(html.includes('<script src='), false);
  assert.equal(html.includes('<link rel='), false);
  assert.match(html, /LE-0/);
});
