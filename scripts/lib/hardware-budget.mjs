import { bearingError } from '../../packages/sim-core/src/arrays.js';
import { speedOfSound } from '../../packages/sim-core/src/physics.js';

export function idealHardwareBudget(mics, { range_m, median_m, p90_m, temperature_c, azimuths_deg }) {
  if (![range_m, median_m, p90_m].every((v) => Number.isFinite(v) && v > 0) || !Number.isFinite(temperature_c) ||
      !azimuths_deg.length || !azimuths_deg.every(Number.isFinite) || mics.length < 2 ||
      mics.some((p) => p.length !== 3 || !p.every(Number.isFinite))) throw new Error('Invalid ideal hardware budget inputs');
  const c = speedOfSound(temperature_c);
  const sigma = Math.min(median_m / (range_m * Math.sqrt(2 * Math.log(2))),
    p90_m / (range_m * Math.sqrt(2 * Math.log(10))));
  const angular = azimuths_deg.map((az) => {
    const a = az * Math.PI / 180;
    const rotated = mics.map(([x, y, z]) => [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a), z]);
    return bearingError(rotated, 0, { sigmaS: 1e-6, c }).az_deg;
  });
  const observable = angular.every((v) => Number.isFinite(v) && v > 0);
  const worst = observable ? Math.max(...angular) : null, sigmaDeg = sigma * 180 / Math.PI;
  const delayUs = observable ? sigmaDeg / worst : null;
  return { sampled_directions: angular.length, identifiable_by_existing_ideal_fit: observable,
    bearing_sigma_deg_full_budget: sigmaDeg, worst_sampled_az_sigma_deg_at_1us: worst,
    heading_sigma_deg_full_budget: observable ? sigmaDeg : null,
    independent_per_mic_delay_sigma_us_full_budget: delayUs,
    independent_mic_position_sigma_mm_full_budget: delayUs === null ? null : delayUs * c / 1000,
    operational_self_noise_requirement_db_spl: null, operational_inter_node_sync_requirement_ms: null,
    note: observable ? 'Separate ideal ceilings, each consuming the entire error budget; not simultaneous allowances, sufficient requirements or measured performance.'
      : 'The existing ideal direction fit is unidentifiable for at least one sampled azimuth; null is not a zero-noise requirement.' };
}
