import { speedOfSound } from '../../physics.js';

const robustMean = (values, sigmas) => {
  let weighted = 0, sum = 0;
  for (let i = 0; i < values.length; i++) {
    const sigma = Math.max(1e-6, sigmas[i]);
    const w = 1 / (sigma * sigma);
    weighted += values[i] * w;
    sum += w;
  }
  return { mean: weighted / sum, sigma: Math.sqrt(1 / sum) };
};

export function estimateSoundSpeed(observation, options = {}) {
  const pairs = (observation.pairs ?? []).filter((pair) =>
    Number.isFinite(pair.distance_m) && pair.distance_m > 0 &&
    Number.isFinite(pair.time_s) && pair.time_s > 0
  );
  const speeds = [];
  const sigmas = [];
  for (const pair of pairs) {
    const c = pair.distance_m / pair.time_s;
    if (!Number.isFinite(c) || c < 250 || c > 430) continue;
    speeds.push(c);
    const sigmaT = Math.max(1e-5, pair.time_sigma_s ?? 5e-4);
    sigmas.push((pair.distance_m / (pair.time_s * pair.time_s)) * sigmaT);
  }
  const temp = observation.temperature_sensor_c;
  const haveTemp = Number.isFinite(temp);
  if (haveTemp) {
    speeds.push(speedOfSound(temp));
    sigmas.push(Math.max(0.3, options.temp_sensor_sigma_mps ?? 1.2));
  }
  if (!speeds.length) return { usable: false, reason: 'no_valid_observations' };
  const nominal = speedOfSound(observation.nominal_temperature_c ?? 15);
  const fit = robustMean(speeds, sigmas);
  const correction = fit.mean / nominal;
  return {
    usable: true,
    sound_speed_mps: fit.mean,
    sigma_mps: fit.sigma,
    nominal_speed_mps: nominal,
    correction_scale: correction,
    pair_count: pairs.length,
    used_temperature_sensor: haveTemp
  };
}

export function correctedDistance(distanceM, estimate) {
  if (!estimate?.usable) return distanceM;
  return distanceM * estimate.correction_scale;
}

export function correctedTravelTime(distanceM, estimate) {
  if (!estimate?.usable) return null;
  return distanceM / estimate.sound_speed_mps;
}
