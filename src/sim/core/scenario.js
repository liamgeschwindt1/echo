export const SCENARIO_VERSION = '0.1';

export const DEFAULT_SETTINGS = Object.freeze({
  temperature_c: 15,
  humidity_pct: 70,
  pressure_kpa: 101.325,
  noise_floor_db_spl: 45,
  mic_self_noise_db_spl: 30,
  ground_reflectivity: 0.8,
  slice_height_m: 1.5,
  seed: 1,
  render_sample_rate: 48000,
  localisation_band_hz: [200, 1600],
  air_absorption: true,
  spl_ref_db: 94,
  dbfs_ref_db: -26
});

export function defaultScenario() {
  return { version: SCENARIO_VERSION, settings: { ...DEFAULT_SETTINGS }, nodes: [], sources: [] };
}

export function newNode(id, x = 0, y = 0) {
  return { id, position: [x, y, 5], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 };
}

// Detector needs ~2 s of history to learn the noise floor, so sources start later than 0.
export function newSource(id, clip, x = 0, y = 0, level_1m_db = 90) {
  return { id, clip, keyframes: [{ t: 0, position: [x, y, 1.5] }], level_1m_db, start_s: 3 };
}

// Exactly one keyframe in the MVP; later versions interpolate.
export const sourcePosition = (source) => source.keyframes[0].position;

export function validateScenario(s) {
  if (!s || typeof s !== 'object') throw new Error('not a scenario');
  if (s.version !== SCENARIO_VERSION) throw new Error(`unsupported scenario version ${s.version}`);
  const settings = { ...DEFAULT_SETTINGS, ...s.settings };
  const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  for (const n of s.nodes || []) if (!vec3(n.position)) throw new Error(`node ${n.id}: bad position`);
  for (const src of s.sources || []) {
    if (!Array.isArray(src.keyframes) || src.keyframes.length !== 1 || !vec3(src.keyframes[0].position)) throw new Error(`source ${src.id}: needs exactly one keyframe`);
  }
  return { version: s.version, settings, nodes: s.nodes || [], sources: s.sources || [] };
}

// End of the last clip plus 10 s so CLAP lag is visible.
export function scenarioLengthS(scenario, clipDurations) {
  let end = 0;
  for (const src of scenario.sources) end = Math.max(end, src.start_s + (clipDurations.get(src.clip) || 0));
  return end + 10;
}
