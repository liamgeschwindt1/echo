import { DEFAULT_SETTINGS } from '../scenario.js';
import { BUILTIN_ARRAYS, applyArrayToNode } from '../arrays.js';
import { REALISM_DEFAULTS } from '../realism.js';

const setting = (id, group, unit, values, description, analysisOnly = false) => ({
  id, group, unit, values, description, affects: analysisOnly ? 'analysis' : 'render', base: DEFAULT_SETTINGS[id]
});
export const VARIABLES = Object.freeze([
  setting('heading_error_sigma_deg', 'Hardware errors', 'deg sigma', [0, 1, 2.5, 5], 'Unmeasured per-node heading offset.'),
  setting('mic_gain_sigma_db', 'Hardware errors', 'dB sigma', [0, 0.5, 1, 2], 'Scalar gain mismatch; ideally cancels in PHAT. Does not model frequency/phase response.'),
  setting('mic_position_sigma_mm', 'Hardware errors', 'mm sigma', [0, 1, 5, 10], 'Actual mic offsets differ from geometry used for inference.'),
  setting('noise_correlation', 'Hardware errors', 'fraction', [0, 0.3, 0.6], 'Shared component of noise within a node.'),
  setting('noise_floor_db_spl', 'Environment', 'dB SPL', [30, 45, 60], 'Ambient pressure noise.'),
  setting('mic_self_noise_db_spl', 'Environment', 'dB SPL', [20, 30, 40], 'Microphone equivalent noise.'),
  setting('temperature_c', 'Environment', 'C', [0, 15, 30], 'Propagation and assumed sound speed.'),
  setting('humidity_pct', 'Environment', '%', [30, 70, 90], 'Air absorption parameter.'),
  setting('ground_reflectivity', 'Environment', 'fraction', [0, 0.4, 0.8], 'Unmeasured pressure reflection coefficient.'),
  setting('reflection_order', 'Environment', 'order', [0, 1, 2], 'Maximum wall reflections.'),
  setting('diffraction_order', 'Environment', 'order', [0, 1, 2], 'Maximum edge path order.'),
  ...[
    ['clock_offset_sigma_ms', 'ms sigma', [0, 1, 5], 'Opt-in seeded per-node clock offset. Common to all node microphones. No inter-node TDOA constraint.'],
    ['clock_drift_sigma_ppm', 'ppm sigma', [0, 20, 100], 'Opt-in node sample-clock drift. Linear interpolation and zero-padded record edges are approximations.'],
    ['wind_speed_mps', 'm/s', [0, 3, 7], 'PLACEHOLDER low-frequency wind noise; 55 dB SPL at 5 m/s, pressure proportional to speed squared. Zero is OFF.'],
    ['wind_correlation', 'fraction', [0, 0.5, 1], 'Shared wind-noise power within a node; only active with nonzero wind speed.'],
    ['urban_noise_db_spl', 'dB SPL / 0 OFF', [0, 45, 60], 'PLACEHOLDER additive 250 Hz low-pass urban rumble plus 75 Hz tone; not a measured city recording.'],
    ['rain_noise_db_spl', 'dB SPL / 0 OFF', [0, 45, 60], 'PLACEHOLDER broadband rain plus sparse impacts; no calibrated rainfall or housing response.'],
    ['noise_variation_db', 'peak dB depth', [0, 3, 6], 'PLACEHOLDER shared-node slow amplitude modulation of ambient/weather noise, not self-noise or source signals.']
  ].map(([id, unit, values, description]) => ({ id, unit, values, description, group: 'Opt-in realism (placeholders)', base: REALISM_DEFAULTS[id], affects: 'render' })),
  { id: 'level_1m_db', group: 'Sources', unit: 'dB SPL', values: [90, 100, 110], base: 100, affects: 'render', description: 'Set level of all sources at 1 m.' },
  { id: 'clip', group: 'Sources', unit: 'clip ID', values: ['glass_breaking', 'car_horn', 'engine'], base: 'glass_breaking', affects: 'render', description: 'Recorded clip for all sources; not a classifier label.' },
  { id: 'range_m', group: 'Sources', unit: 'm', values: [20, 50, 100, 200], base: 50, affects: 'render', description: 'Move source reference positions to this range from node centroid.' },
  { id: 'source_count', group: 'Sources', unit: 'sources', values: [1, 2, 3], base: 1, affects: 'render', description: 'Keep or add sources around the site; simultaneous copies when added.' },
  { id: 'level_difference_db', group: 'Sources', unit: 'dB', values: [0, 6, 10], base: 0, affects: 'render', description: 'Level added to all sources after the first.' },
  { id: 'source_speed_mps', group: 'Sources', unit: 'm/s', values: [0, 5, 15], base: 0, affects: 'render', description: 'Linear 5-second path eastward from each source position.' },
  { id: 'source_height_m', group: 'Sources', unit: 'm', values: [1.5, 20, 50], base: 1.5, affects: 'render', description: 'Set all source path heights.' },
  { id: 'mic_array', group: 'Array and nodes', unit: 'array ID', values: BUILTIN_ARRAYS.map((a) => a.id), base: 'flat4_100', affects: 'render', description: 'Any built-in or supplied library array.' },
  { id: 'node_count', group: 'Array and nodes', unit: 'nodes', values: [2, 3, 4, 6], base: 3, affects: 'render', description: 'Keep existing nodes; add missing nodes in a ring.' },
  { id: 'node_spacing_m', group: 'Array and nodes', unit: 'm', values: [20, 40, 80], base: 40, affects: 'render', description: 'Scale node geometry so mean pair spacing equals this value.' },
  { id: 'node_height_m', group: 'Array and nodes', unit: 'm', values: [1.5, 5, 10], base: 5, affects: 'render', description: 'Array centre height.' },
  { id: 'layout', group: 'Array and nodes', unit: 'layout', values: ['ring', 'line'], base: 'ring', affects: 'render', description: 'Place nodes on a 30 m ring or 60 m line.' },
  ...['min_snr_db', 'fix_min_crossing_deg', 'fix_inlier_gate_sigma', 'track_gate_sigma', 'track_gate_min_deg', 'onset_window_ms'].map((id) =>
    setting(id, 'Algorithm thresholds', id.endsWith('ms') ? 'ms' : id.endsWith('db') ? 'dB' : id.includes('sigma') ? 'sigma' : 'deg',
      [DEFAULT_SETTINGS[id] / 2, DEFAULT_SETTINGS[id], DEFAULT_SETTINGS[id] * 2], 'Unmeasured analysis threshold; truth-assisted pipeline only unless noted.', true)),
  setting('window_policy', 'Algorithm thresholds', 'policy', ['fixed', 'auto'], 'Truth-assisted window choice.', true),
  { id: 'analysis_mode', group: 'Algorithm thresholds', unit: 'mode', values: ['measured_only', 'truth_assisted'], base: 'measured_only', affects: 'analysis', description: 'Mixture-only inference or optimistic source-window upper bound.' },
  { id: 'building_density', group: 'Site', unit: 'fraction kept', values: [0, 0.5, 1], base: 1, affects: 'render', description: 'Fraction of existing buildings retained, in stable ID order.' }
]);
export const VARIABLE_MAP = new Map(VARIABLES.map((v) => [v.id, v]));

export function applyValues(original, values, arrays = BUILTIN_ARRAYS) {
  const s = structuredClone(original);
  const centroid = () => [0, 1].map((k) => s.nodes.reduce((a, n) => a + n.position[k], 0) / s.nodes.length);
  const geometryOrder = ['node_count', 'mic_array', 'node_height_m', 'layout', 'node_spacing_m', 'source_count', 'clip', 'level_1m_db', 'level_difference_db', 'source_height_m', 'source_speed_mps', 'range_m'];
  for (const id of [...geometryOrder, ...Object.keys(values).filter((id) => !geometryOrder.includes(id)).sort()]) {
    if (!Object.hasOwn(values, id)) continue;
    const value = values[id];
    if (!VARIABLE_MAP.has(id)) throw new Error(`Unknown benchmark variable: ${id}`);
    if (id in DEFAULT_SETTINGS || id in REALISM_DEFAULTS || id === 'analysis_mode') s.settings[id] = value;
    else if (id === 'mic_array') {
      const a = arrays.find((a) => a.id === value);
      if (!a) throw new Error(`Unknown array: ${value}`);
      s.nodes = s.nodes.map((n) => applyArrayToNode(n, a));
    } else if (id === 'node_count') {
      while (s.nodes.length < value) {
        const n = structuredClone(s.nodes[0]);
        const az = 2 * Math.PI * s.nodes.length / value;
        n.id = `benchmark_n${s.nodes.length + 1}`;
        n.position = [30 * Math.cos(az), 30 * Math.sin(az), n.position[2]];
        s.nodes.push(n);
      }
      s.nodes = s.nodes.slice(0, value);
    } else if (id === 'node_height_m') s.nodes.forEach((n) => n.position[2] = value);
    else if (id === 'layout') s.nodes.forEach((n, i) => {
      const az = 2 * Math.PI * i / s.nodes.length;
      n.position = value === 'ring' ? [30 * Math.cos(az), 30 * Math.sin(az), n.position[2]] : [-30 + i * 60 / Math.max(1, s.nodes.length - 1), 0, n.position[2]];
    });
    else if (id === 'node_spacing_m') {
      const ctr = centroid();
      const pairs = s.nodes.flatMap((n, i) => s.nodes.slice(i + 1).map((o) => Math.hypot(n.position[0] - o.position[0], n.position[1] - o.position[1])));
      const scale = value / (pairs.reduce((a, b) => a + b, 0) / Math.max(1, pairs.length) || 1);
      s.nodes.forEach((n) => n.position = [ctr[0] + (n.position[0] - ctr[0]) * scale, ctr[1] + (n.position[1] - ctr[1]) * scale, n.position[2]]);
    } else if (id === 'source_count') {
      while (s.sources.length < value) {
        const src = structuredClone(s.sources[0]);
        src.id = `benchmark_s${s.sources.length + 1}`;
        src.keyframes.forEach((k) => k.position[0] += 15 * s.sources.length);
        s.sources.push(src);
      }
      s.sources = s.sources.slice(0, value);
    } else if (id === 'building_density') s.buildings = s.buildings.slice(0, Math.round(s.buildings.length * value));
    else s.sources.forEach((src, i) => {
      if (id === 'level_1m_db') src.level_1m_db = value;
      if (id === 'level_difference_db' && i > 0) src.level_1m_db += value;
      if (id === 'clip') src.clip = value;
      if (id === 'source_height_m') src.keyframes.forEach((k) => k.position[2] = value);
      if (id === 'source_speed_mps') {
        const p = src.keyframes[0].position;
        src.keyframes = value === 0 ? [{ t: 0, position: [...p] }] : [{ t: src.start_s, position: [...p] }, { t: src.start_s + 5, position: [p[0] + value * 5, p[1], p[2]] }];
      }
      if (id === 'range_m') {
        const ctr = centroid();
        const p = src.keyframes[0].position;
        const old = Math.hypot(p[0] - ctr[0], p[1] - ctr[1]) || 1;
        const dx = (p[0] - ctr[0]) * (value / old - 1);
        const dy = (p[1] - ctr[1]) * (value / old - 1);
        src.keyframes.forEach((k) => k.position = [k.position[0] + dx, k.position[1] + dy, k.position[2]]);
      }
    });
  }
  return s;
}
