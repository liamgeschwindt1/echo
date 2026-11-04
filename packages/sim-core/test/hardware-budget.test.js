import test from 'node:test';
import assert from 'node:assert/strict';
import { idealHardwareBudget } from '../../../scripts/lib/hardware-budget.mjs';

const variables = { range_m: 50, median_m: 5, p90_m: 10, temperature_c: 20, azimuths_deg: [0, 90, 180, 270] };
test('ideal error budget inverts Rayleigh radial targets and independent mic timing with exact units', () => {
  const result = idealHardwareBudget([[50, 50, 0], [-50, 50, 0], [-50, -50, 0], [50, -50, 0]], variables);
  const sigmaRad = .1 / Math.sqrt(2 * Math.log(2));
  assert.ok(Math.abs(result.bearing_sigma_deg_full_budget - sigmaRad * 180 / Math.PI) < 1e-10);
  assert.ok(Math.abs(result.independent_mic_position_sigma_mm_full_budget - 100 * sigmaRad) < 1e-10);
  assert.equal(result.operational_self_noise_requirement_db_spl, null);
});
test('unidentifiable ideal geometry produces null ceilings, never zero or nonfinite exports', () => {
  const result = idealHardwareBudget([[-50, 0, -50], [50, 0, 50]], variables);
  assert.equal(result.identifiable_by_existing_ideal_fit, false);
  assert.equal(result.independent_per_mic_delay_sigma_us_full_budget, null);
  assert.ok(!JSON.stringify(result).includes('Infinity'));
  assert.throws(() => idealHardwareBudget([], variables), /Invalid/);
});
