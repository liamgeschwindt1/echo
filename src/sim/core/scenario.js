import { distance, speedOfSound } from './physics.js';
import { insideBuilding } from './geometry.js';

export const SCENARIO_VERSION = '0.2';
const LOADABLE_VERSIONS = ['0.1', '0.2'];

export const DEFAULT_SETTINGS = Object.freeze({
  temperature_c: 15,
  humidity_pct: 70,
  pressure_kpa: 101.325,
  noise_floor_db_spl: 45,
  noise_off: false,
  mic_self_noise_db_spl: 30,
  ground_reflectivity: 0.8,
  slice_height_m: 1.5,
  seed: 1,
  render_sample_rate: 48000,
  localisation_band_hz: [200, 1600],
  min_snr_db: 6,
  reflection_order: 1,
  reach_reflection_order: 2,
  reach_cell_m: 2,
  block_direct_behind_buildings: true,
  diffraction_order: 0,
  picked_path_tolerance_deg: 5,
  window_snr_db: 3,
  window_pad_ms: 10,
  min_window_ms: 30,
  heading_error_sigma_deg: 0,
  mic_gain_sigma_db: 0,
  mic_position_sigma_mm: 0,
  noise_correlation: 0,
  air_absorption: true,
  spl_ref_db: 94,
  dbfs_ref_db: -26
});

export function defaultScenario() {
  return { version: SCENARIO_VERSION, settings: { ...DEFAULT_SETTINGS }, nodes: [], sources: [], buildings: [] };
}

export const DEFAULT_BUILDING_HEIGHT_M = 15;

// Axis-aligned concrete box; rotation must stay 0 in this version.
export function newBuilding(id, x = 0, y = 0, w = 20, d = 12, h = DEFAULT_BUILDING_HEIGHT_M) {
  return { id, position: [x, y], size: [w, d, h], rotation_deg: 0 };
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

// Messages for any node or source placed inside a building below its roofline.
export function placementErrors(scenario) {
  const errors = [];
  const b = scenario.buildings || [];
  for (const n of scenario.nodes) {
    const hit = insideBuilding(n.position, b);
    if (hit) errors.push(`node ${n.id} is inside building ${hit.id}`);
  }
  for (const s of scenario.sources) {
    const hit = insideBuilding(sourcePosition(s), b);
    if (hit) errors.push(`source ${s.id} is inside building ${hit.id}`);
  }
  return errors;
}

export function validateScenario(s) {
  if (!s || typeof s !== 'object') throw new Error('not a scenario');
  if (!LOADABLE_VERSIONS.includes(s.version)) throw new Error(`unsupported scenario version ${s.version}`);
  const settings = { ...DEFAULT_SETTINGS, ...s.settings };
  if (!Number.isFinite(settings.reach_cell_m) || settings.reach_cell_m <= 0) throw new Error('reach_cell_m must be positive');
  if (!Number.isInteger(settings.reach_reflection_order) || settings.reach_reflection_order < 0 || settings.reach_reflection_order > 2) throw new Error('reach_reflection_order must be 0, 1 or 2');
  if (typeof settings.noise_off !== 'boolean') throw new Error('noise_off must be boolean');
  const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  for (const n of s.nodes || []) if (!vec3(n.position)) throw new Error(`node ${n.id}: bad position`);
  for (const src of s.sources || []) {
    if (!Array.isArray(src.keyframes) || src.keyframes.length !== 1 || !vec3(src.keyframes[0].position)) throw new Error(`source ${src.id}: needs exactly one keyframe`);
  }
  for (const b of s.buildings || []) {
    if (!Array.isArray(b.position) || b.position.length !== 2 || !b.position.every(Number.isFinite)) throw new Error(`building ${b.id}: bad position`);
    if (!vec3(b.size) || b.size.some((v) => v <= 0)) throw new Error(`building ${b.id}: size must be three positive numbers`);
    if (b.rotation_deg) throw new Error(`building ${b.id}: rotation is not supported yet`);
  }
  // Version 0.1 files have no buildings; they load as 0.2 scenarios with an empty list.
  const out = { version: SCENARIO_VERSION, settings, nodes: s.nodes || [], sources: s.sources || [], buildings: s.buildings || [] };
  const bad = placementErrors(out);
  if (bad.length) throw new Error(bad.join('; '));
  return out;
}

// Playback and the timeline end exactly when the last clip ends.
export function scenarioLengthS(scenario, clipDurations) {
  let end = 0;
  for (const src of scenario.sources) end = Math.max(end, src.start_s + (clipDurations.get(src.clip) || 0));
  return end;
}

// The render runs longer than playback so sound still travelling to the farthest mic is not cut off.
export function renderLengthS(scenario, clipDurations, minS = 0) {
  const c = speedOfSound(scenario.settings.temperature_c);
  let travel = 0;
  for (const src of scenario.sources) for (const n of scenario.nodes) travel = Math.max(travel, distance(sourcePosition(src), n.position) / c);
  return Math.max(scenarioLengthS(scenario, clipDurations) + travel + 0.5 + ((scenario.buildings || []).length ? 0.5 : 0), minS);
}
