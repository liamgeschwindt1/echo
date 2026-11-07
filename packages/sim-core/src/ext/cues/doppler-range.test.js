import test from 'node:test';
import assert from 'node:assert/strict';
import { dopplerFrequencyHz, dopplerRangeMeasurementAt, estimateDopplerCue } from './doppler-range.js';

test('doppler cue recovers speed and closest approach from synthetic line', () => {
  const tone = 480;
  const truth = { speed_mps: 14, closest_range_m: 32, closest_time_s: 4.2 };
  const samples = Array.from({ length: 240 }, (_, i) => {
    const t = 2 + i * 0.02;
    const pure = dopplerFrequencyHz({
      tone_hz: tone,
      speed_mps: truth.speed_mps,
      closest_range_m: truth.closest_range_m,
      closest_time_s: truth.closest_time_s,
      sample_time_s: t
    });
    const jitter = Math.sin(i * 0.77) * 0.25;
    return { time_s: t, frequency_hz: pure + jitter };
  });
  const fit = estimateDopplerCue(samples, { tone_hz: tone, speed_max_mps: 30, range_max_m: 80 });
  assert.equal(fit.usable, true);
  assert.ok(Math.abs(fit.speed_mps - truth.speed_mps) < 1.5);
  assert.ok(Math.abs(fit.closest_range_m - truth.closest_range_m) < 3.5);
});

test('doppler range measurement provides range plus uncertainty', () => {
  const measurement = dopplerRangeMeasurementAt({
    usable: true,
    closest_range_m: 20,
    closest_time_s: 3,
    speed_mps: 8,
    sigma_range_m: 1.2,
    sigma_speed_mps: 0.7
  }, 5);
  assert.ok(measurement.range_m > 20);
  assert.ok(measurement.sigma_m > 1.2);
});
