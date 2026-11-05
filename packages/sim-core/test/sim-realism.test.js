import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clockSignal, nodeClock, realismNoise, noiseEnvelope, validateRealism, REALISM_DEFAULTS } from '../src/realism.js';
import { dbToPa } from '../src/physics.js';
import { renderScenario } from '../src/render.js';
import { realismScene, realismGolden, realismSpec } from './realism-fixture.js';
import { valueHash } from '../../../scripts/lib/value-hash.mjs';
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

test('clock resampling matches analytic local/global mapping, common to every mic', () => {
  const x = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
  assert.equal(clockSignal(x, 48000, { offset_ms: 0, drift_ppm: 0 }), x);
  const clock = { offset_ms: 2, drift_ppm: 100 };
  const y = clockSignal(x, 48000, clock);
  assert.equal(y[0], 0);
  for (const i of [100, 500, 999]) assert.ok(Math.abs(y[i] - (i - 96) / 1.0001 / 1000) < 1e-7);
  assert.deepEqual(y, clockSignal(x, 48000, clock));
  assert.deepEqual(nodeClock({ seed: 1, clock_offset_sigma_ms: 5 }, 0), nodeClock({ seed: 1, clock_offset_sigma_ms: 5 }, 0));
  assert.notDeepEqual(nodeClock({ seed: 1, clock_offset_sigma_ms: 5 }, 0), nodeClock({ seed: 1, clock_offset_sigma_ms: 5 }, 1));
});
test('placeholder noise is seeded, pressure-scaled, low-frequency wind is node-correlated', () => {
  const settings = { seed: realismSpec.seed, wind_speed_mps: 5, wind_correlation: 1 };
  const wind = realismNoise(settings, 0, 0, 48000, 48000);
  assert.deepEqual(wind, realismNoise(settings, 0, 1, 48000, 48000));
  assert.ok(Math.abs(rms(wind) / dbToPa(55) - 1) < 1e-6);
  let difference = 0;
  for (let i = 1; i < wind.length; i++) difference += (wind[i] - wind[i - 1]) ** 2;
  assert.ok(difference / wind.length / rms(wind) ** 2 < 0.08);
  for (const key of ['urban_noise_db_spl', 'rain_noise_db_spl']) {
    const noise = realismNoise({ seed: 1, [key]: 55 }, 0, 0, 48000, 48000);
    assert.ok(Math.abs(rms(noise) / dbToPa(55) - 1) < 1e-6);
    assert.ok(noise.every(Number.isFinite));
  }
  const envelope = noiseEnvelope({ seed: 1, noise_variation_db: 6 }, 0, 48000, 48000);
  assert.ok(envelope.every((v) => v >= 10 ** (-6 / 20) && v <= 10 ** (6 / 20)));
  assert.equal(realismNoise({}, 0, 0, 10, 48000), null);
});
test('new settings OFF preserve the complete legacy render value and every sample', () => {
  const { scenario, clips } = realismScene(), before = renderScenario(scenario, clips, { lengthS: 1 });
  Object.assign(scenario.settings, REALISM_DEFAULTS);
  const after = renderScenario(scenario, clips, { lengthS: 1 });
  assert.equal(valueHash(before), valueHash(after));
  assert.throws(() => validateRealism({ wind_correlation: 2 }), /Invalid/);
  assert.throws(() => validateRealism({ noise_variation_db: Infinity }), /Invalid/);
});
test('new physics has its own exact microphone goldens; older signal goldens are not regenerated', () => {
  const expected = JSON.parse(readFileSync(new URL('./golden/golden-realism.json', import.meta.url)));
  assert.deepEqual(realismGolden(), expected);
});
