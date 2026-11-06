import test from 'node:test';
import assert from 'node:assert/strict';
import { correctedDistance, estimateSoundSpeed } from './sound-speed.js';

test('sound-speed estimator fuses pair timing and temperature sensor', () => {
  const estimate = estimateSoundSpeed({
    nominal_temperature_c: 15,
    temperature_sensor_c: 22,
    pairs: [
      { distance_m: 60, time_s: 0.1746, time_sigma_s: 0.0002 },
      { distance_m: 110, time_s: 0.3198, time_sigma_s: 0.0002 }
    ]
  });
  assert.equal(estimate.usable, true);
  assert.ok(estimate.sound_speed_mps > 342 && estimate.sound_speed_mps < 347);
  assert.ok(estimate.sigma_mps < 1.5);
  assert.ok(correctedDistance(100, estimate) > 100);
});

test('sound-speed estimator rejects empty observations', () => {
  const estimate = estimateSoundSpeed({ pairs: [] });
  assert.equal(estimate.usable, false);
});
