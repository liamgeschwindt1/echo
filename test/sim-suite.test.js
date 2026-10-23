// Regression guard for the A-E suite: scenarios build, validate and are reproducible by seed.
// Full 50-seed statistics live in scripts/sim-suite.mjs (docs/suite/*.json). SIMULATED only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, buildScenario, runOne } from './suite-lib.js';

test('every suite scenario builds and carries the error settings', () => {
  for (const l of SCENARIOS) {
    const s = buildScenario(l, 1);
    assert.equal(s.settings.heading_error_sigma_deg, 2.5);
    assert.equal(s.settings.mic_gain_sigma_db, 1);
    assert.equal(s.settings.mic_position_sigma_mm, 5);
  }
  let withBuildings = 0;
  for (let seed = 1; seed <= 10; seed++) if (buildScenario('D', seed).buildings.length > 0) withBuildings++;
  assert.ok(withBuildings >= 7, 'most seeds keep stand-in buildings');
  assert.equal(buildScenario('E', 1).settings.noise_floor_db_spl, 60);
  assert.equal(buildScenario('D', 1, { thirdNode: true }).nodes.length, 3);
});

test('same seed gives the same scenario and the same result; other seeds differ', async () => {
  assert.deepEqual(buildScenario('D', 5), buildScenario('D', 5));
  assert.notDeepEqual(buildScenario('D', 5).sources, buildScenario('D', 6).sources);
  const a = await runOne('A', 3);
  const b = await runOne('A', 3);
  assert.deepEqual(a, b);
});
