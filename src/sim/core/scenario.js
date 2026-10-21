import { distance, speedOfSound } from './physics.js';
import { insideBuilding } from './geometry.js';
import { isMoving, motionSpan, samplePath } from './motion.js';

export const SCENARIO_VERSION = '0.2';
const LOADABLE_VERSIONS = ['0.1', '0.2'];

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
  min_snr_db: 6,
  reflection_order: 1,
  block_direct_behind_buildings: true,
  diffraction_model: 'wedge', // 'wedge' (UTD rigid wedge) or 'maekawa' (legacy formula, kept for comparison and regression)
  diffraction_order: 2, // 0 off, 1 one edge, 2 adds edge to edge and reflection + edge
  heatmap_backdrop: 0.25, // opacity of the level map shown under the Pulse heatmap
  path_prune_db: 50, // wedge model: drop paths this far below the strongest at 250 Hz, 1 kHz and 4 kHz
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
  dbfs_ref_db: -26,
  noise_enabled: true, // test switch: false renders silence apart from the sources
  reach_cell_m: 2,
  reach_reflection_order: 2
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

// The first keyframe: the position of a static source, or where a moving source's path starts (see motion.js).
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
    else if (isMoving(s)) {
      const crossed = samplePath(s).map((p) => insideBuilding(p, b)).find(Boolean);
      if (crossed) errors.push(`the path of source ${s.id} goes through building ${crossed.id}`);
    }
  }
  return errors;
}

export function validateScenario(s) {
  if (!s || typeof s !== 'object') throw new Error('not a scenario');
  if (!LOADABLE_VERSIONS.includes(s.version)) throw new Error(`unsupported scenario version ${s.version}`);
  const settings = { ...DEFAULT_SETTINGS, ...s.settings };
  const vec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  for (const n of s.nodes || []) if (!vec3(n.position)) throw new Error(`node ${n.id}: bad position`);
  for (const src of s.sources || []) {
    if (!Array.isArray(src.keyframes) || !src.keyframes.length || !src.keyframes.every((k) => vec3(k.position))) throw new Error(`source ${src.id}: needs at least one keyframe with a position`);
    if (src.keyframes.length > 1 && !src.keyframes.every((k, i) => Number.isFinite(k.t) && (i === 0 || k.t > src.keyframes[i - 1].t))) {
      throw new Error(`source ${src.id}: keyframe times must be numbers in increasing order`);
    }
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

/** One-line notices for an older file about to load (before defaults are merged in). */
export function scenarioNotices(raw) {
  const notices = [];
  if (raw?.settings?.diffraction_order === undefined) notices.push('This file has no diffraction setting: it now uses the new defaults (wedge diffraction, order 2), so levels behind buildings differ from before. Set diffraction order 0 to switch it off.');
  return notices;
}

// Playback and the timeline end exactly when the last clip ends (or the last moving source reaches the end of its path).
export function scenarioLengthS(scenario, clipDurations) {
  let end = 0;
  for (const src of scenario.sources) {
    end = Math.max(end, src.start_s + (clipDurations.get(src.clip) || 0));
    if (isMoving(src)) end = Math.max(end, motionSpan(src)[1]);
  }
  return end;
}

// The render runs longer than playback so sound still travelling to the farthest mic is not cut off.
export function renderLengthS(scenario, clipDurations, minS = 0) {
  const c = speedOfSound(scenario.settings.temperature_c);
  let travel = 0;
  for (const src of scenario.sources) for (const k of src.keyframes) for (const n of scenario.nodes) travel = Math.max(travel, distance(k.position, n.position) / c);
  return Math.max(scenarioLengthS(scenario, clipDurations) + travel + 0.5 + ((scenario.buildings || []).length ? 0.5 : 0), minS);
}
