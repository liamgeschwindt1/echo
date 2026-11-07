import { speedOfSound } from '../../physics.js';

export const CUE_WEATHER_DEFAULTS = Object.freeze({
  cue_weather_temp_offset_c: 0,
  cue_weather_wind_mps: 0,
  cue_weather_wind_from_deg: 0,
  cue_weather_wind_coupling: 1
});

export function validateCueWeather(settings) {
  const max = {
    cue_weather_temp_offset_c: 80,
    cue_weather_wind_mps: 80,
    cue_weather_wind_from_deg: 360,
    cue_weather_wind_coupling: 2
  };
  for (const [key, fallback] of Object.entries(CUE_WEATHER_DEFAULTS)) {
    const value = settings[key] ?? fallback;
    if (!Number.isFinite(value) || Math.abs(value) > max[key]) throw new Error(`Invalid cue weather setting ${key}`);
  }
}

const toRad = (deg) => (deg * Math.PI) / 180;
const norm = (v) => {
  const m = Math.hypot(v[0], v[1], v[2] ?? 0) || 1;
  return [v[0] / m, v[1] / m, (v[2] ?? 0) / m];
};

export function cueWeatherState(settings) {
  validateCueWeather(settings);
  const enabled = (settings.cue_weather_temp_offset_c ?? 0) !== 0 || (settings.cue_weather_wind_mps ?? 0) !== 0;
  const trueTemperatureC = (settings.temperature_c ?? 15) + (settings.cue_weather_temp_offset_c ?? 0);
  const baseSpeed = speedOfSound(trueTemperatureC);
  const windSpeed = settings.cue_weather_wind_mps ?? 0;
  const windFromDeg = settings.cue_weather_wind_from_deg ?? 0;
  const windDirToRad = toRad((windFromDeg + 180) % 360);
  const wind = [windSpeed * Math.cos(windDirToRad), windSpeed * Math.sin(windDirToRad), 0];
  return {
    enabled,
    true_temperature_c: trueTemperatureC,
    base_speed_mps: baseSpeed,
    wind_vector_mps: wind,
    wind_coupling: settings.cue_weather_wind_coupling ?? 1
  };
}

export function cuePathDelayS(path, sourcePosition, receiverPosition, weather) {
  if (!weather?.enabled) return path.delay_s;
  const c = weather.base_speed_mps;
  if (path.type !== 'direct' || !sourcePosition || !receiverPosition) return path.length / c;
  const ray = norm([
    receiverPosition[0] - sourcePosition[0],
    receiverPosition[1] - sourcePosition[1],
    receiverPosition[2] - sourcePosition[2]
  ]);
  const along = weather.wind_vector_mps[0] * ray[0] + weather.wind_vector_mps[1] * ray[1] + weather.wind_vector_mps[2] * ray[2];
  const effective = Math.max(250, c + weather.wind_coupling * along);
  return path.length / effective;
}
