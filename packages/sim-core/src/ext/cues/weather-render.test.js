import test from 'node:test';
import assert from 'node:assert/strict';
import { cuePathDelayS, cueWeatherState } from './weather-render.js';

test('weather defaults stay disabled', () => {
  const state = cueWeatherState({ temperature_c: 15 });
  assert.equal(state.enabled, false);
});

test('downwind path decreases direct delay', () => {
  const state = cueWeatherState({
    temperature_c: 15,
    cue_weather_temp_offset_c: 10,
    cue_weather_wind_mps: 10,
    cue_weather_wind_from_deg: 270
  });
  const path = { type: 'direct', length: 100, delay_s: 100 / 343 };
  const delay = cuePathDelayS(path, [0, 0, 1.5], [100, 0, 5], state);
  assert.ok(delay < path.delay_s);
});
