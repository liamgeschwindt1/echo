const wrap = (f) => (Number.isFinite(f) ? f : NaN);

export function dopplerFrequencyHz({ tone_hz, speed_mps, closest_range_m, closest_time_s, sample_time_s, sound_speed_mps = 343 }) {
  const dt = sample_time_s - closest_time_s;
  const radial = (speed_mps * speed_mps * dt) / Math.sqrt(closest_range_m * closest_range_m + speed_mps * speed_mps * dt * dt);
  return tone_hz * (sound_speed_mps / (sound_speed_mps - radial));
}

function rmse(points, predict) {
  let sum = 0, n = 0;
  for (const point of points) {
    const expected = predict(point.time_s);
    if (!Number.isFinite(expected)) continue;
    const e = point.frequency_hz - expected;
    sum += e * e;
    n += 1;
  }
  return n ? Math.sqrt(sum / n) : Infinity;
}

export function estimateDopplerCue(samples, options = {}) {
  const observations = samples
    .map((s) => ({ time_s: s.time_s, frequency_hz: wrap(s.frequency_hz) }))
    .filter((s) => Number.isFinite(s.time_s) && Number.isFinite(s.frequency_hz));
  if (observations.length < 8) return { usable: false, reason: 'insufficient_samples' };
  const tone = options.tone_hz;
  if (!(Number.isFinite(tone) && tone > 0)) return { usable: false, reason: 'missing_tone' };
  const c = options.sound_speed_mps ?? 343;
  const speedMin = options.speed_min_mps ?? 1;
  const speedMax = options.speed_max_mps ?? 80;
  const rangeMin = options.range_min_m ?? 1;
  const rangeMax = options.range_max_m ?? 200;
  const t0Guess = observations.reduce((best, x) =>
    Math.abs(x.frequency_hz - tone) < Math.abs(best.frequency_hz - tone) ? x : best, observations[0]).time_s;
  let best = null;
  for (let speed = speedMin; speed <= speedMax; speed += 0.5) {
    for (let range = rangeMin; range <= rangeMax; range += 0.5) {
      for (let dt0 = -2; dt0 <= 2; dt0 += 0.05) {
        const closest = t0Guess + dt0;
        const err = rmse(observations, (t) =>
          dopplerFrequencyHz({ tone_hz: tone, speed_mps: speed, closest_range_m: range, closest_time_s: closest, sample_time_s: t, sound_speed_mps: c }));
        if (!best || err < best.rmse_hz) best = { speed_mps: speed, closest_range_m: range, closest_time_s: closest, rmse_hz: err };
      }
    }
  }
  if (!best || !Number.isFinite(best.rmse_hz)) return { usable: false, reason: 'fit_failed' };
  const residual = Math.max(0.1, best.rmse_hz / tone);
  const sigmaRange = Math.max(0.5, best.closest_range_m * residual * 8);
  const sigmaSpeed = Math.max(0.2, best.speed_mps * residual * 4);
  return { usable: true, ...best, sigma_range_m: sigmaRange, sigma_speed_mps: sigmaSpeed };
}

export function dopplerRangeMeasurementAt(estimate, timeS) {
  if (!estimate?.usable) return null;
  const dt = timeS - estimate.closest_time_s;
  const range = Math.sqrt(estimate.closest_range_m * estimate.closest_range_m + estimate.speed_mps * estimate.speed_mps * dt * dt);
  const sigma = Math.hypot(
    estimate.sigma_range_m,
    Math.abs(dt) * estimate.sigma_speed_mps
  );
  return { time_s: timeS, range_m: range, sigma_m: sigma };
}
