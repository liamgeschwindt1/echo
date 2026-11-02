import { renderScenario } from './render.js';
import { analyseScenario } from './analyse.js';
import { renderLengthS } from './scenario.js';
import { angleBetweenDeg } from './localise.js';
import { applyArrayToNode } from './arrays.js';

const rad = (d) => (d * Math.PI) / 180;
const unit = (az, el) => [Math.cos(rad(el)) * Math.cos(rad(az)), Math.cos(rad(el)) * Math.sin(rad(az)), Math.sin(rad(el))];

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// Parameter variants. Each returns a fresh scenario so trials never share state.
const SETTING_VARIABLES = [
  { id: 'noise_floor_db_spl', label: 'Noise floor (dB SPL)', example: '30, 45, 60' },
  { id: 'min_snr_db', label: 'Minimum SNR to use a node (dB)', example: '0, 6, 12' },
  { id: 'temperature_c', label: 'Temperature (\u00b0C)', example: '0, 15, 30' },
  { id: 'ground_reflectivity', label: 'Ground reflectivity (0-1)', example: '0, 0.4, 0.8' },
  { id: 'reflection_order', label: 'Reflection order', example: '0, 1, 2' },
  { id: 'diffraction_order', label: 'Diffraction order', example: '0, 1, 2' },
  { id: 'mic_gain_sigma_db', label: 'Mic gain mismatch (dB sigma)', example: '0, 0.5, 1' },
  { id: 'mic_position_sigma_mm', label: 'Mic position error (mm sigma)', example: '0, 1, 3' },
  { id: 'heading_error_sigma_deg', label: 'Node heading error (\u00b0 sigma)', example: '0, 2, 5' },
  { id: 'noise_correlation', label: 'Noise correlation between mics (0-1)', example: '0, 0.5, 1' }
];

export const SWEEP_PARAMS = {
  distance_scale: (s, v) => {
    const n = s.nodes;
    const cx = n.reduce((a, o) => a + o.position[0], 0) / n.length;
    const cy = n.reduce((a, o) => a + o.position[1], 0) / n.length;
    const sources = s.sources.map((src) => ({
      ...src,
      keyframes: src.keyframes.map((k) => ({ ...k, position: [cx + (k.position[0] - cx) * v, cy + (k.position[1] - cy) * v, k.position[2]] }))
    }));
    return { ...s, sources };
  },
  node_count: (s, v) => ({ ...s, nodes: s.nodes.slice(0, Math.max(1, Math.round(v))) }),
  node_height_m: (s, v) => ({ ...s, nodes: s.nodes.map((n) => ({ ...n, position: [n.position[0], n.position[1], v] })) }),
  // v is an array model id; ctx.arrays lists the models available to this run.
  mic_array: (s, v, ctx) => {
    const model = ctx?.arrays?.find((a) => a.id === v);
    if (!model) throw new Error(`unknown mic array ${v}`);
    return { ...s, nodes: s.nodes.map((n) => applyArrayToNode({ ...n }, model)) };
  },
  ...Object.fromEntries(SETTING_VARIABLES.map((v) => [v.id, (s, x) => ({ ...s, settings: { ...s.settings, [v.id]: x } })]))
};

// What the sweep dialog offers. kind 'array' takes mic array ids; everything else takes numbers.
export const SWEEP_VARIABLES = [
  { id: 'mic_array', label: 'Mic array', kind: 'array' },
  { id: 'distance_scale', label: 'Distance scale (about node centroid)', kind: 'number', example: '0.5, 1, 2, 4' },
  { id: 'node_count', label: 'Node count', kind: 'number', example: '1, 2, 3' },
  { id: 'node_height_m', label: 'Node height (m)', kind: 'number', example: '2, 5, 10' },
  ...[{ id: 'noise_floor_db_spl', label: 'Noise floor (dB SPL)', example: '30, 45, 60' }, ...SETTING_VARIABLES.filter((v) => v.id !== 'noise_floor_db_spl')].map((v) => ({ ...v, kind: 'number' }))
];

const MAX_SWEEP_CASES = 60;

/** Every combination of the chosen variables' values, as { param: value } objects. */
export function sweepCases(vars) {
  let cases = [{}];
  for (const { param, values } of vars) cases = cases.flatMap((c) => values.map((v) => ({ ...c, [param]: v })));
  return cases;
}

/** vars: [{ param, values }]. Runs seeds trials per combination; arrays supplies the models for 'mic_array'. */
export function sweepMulti(scenario, clips, durations, { vars, seeds, arrays = [], onProgress }) {
  for (const v of vars) {
    if (!SWEEP_PARAMS[v.param]) throw new Error(`unknown sweep parameter ${v.param}`);
    if (!v.values.length) throw new Error(`${v.param}: no values`);
  }
  const cases = sweepCases(vars);
  if (cases.length > MAX_SWEEP_CASES) throw new Error(`${cases.length} combinations is too many (limit ${MAX_SWEEP_CASES}). Pick fewer values.`);
  const rows = [];
  cases.forEach((c, i) => {
    const scn = Object.entries(c).reduce((s, [param, value]) => SWEEP_PARAMS[param](s, value, { arrays }), scenario);
    const trials = runTrials(scn, clips, durations, { seeds, onTrial: (k) => onProgress?.((i * seeds + k) / (cases.length * seeds)) });
    rows.push({ values: c, ...summarise(trials) });
  });
  return rows;
}

/** Renders the scenario once per seed and collects localisation outcomes per source. */
export function runTrials(scenario, clips, durations, { seeds, onTrial } = {}) {
  const lengthS = renderLengthS(scenario, durations);
  const trials = [];
  for (let i = 0; i < seeds; i++) {
    const scn = { ...scenario, settings: { ...scenario.settings, seed: scenario.settings.seed + i } };
    const rendered = renderScenario(scn, clips, { lengthS });
    const results = analyseScenario(scn, rendered, durations);
    for (const r of results) {
      const bearingErr = r.nodes.filter((n) => n.bearing).map((n) => angleBetweenDeg(n.bearing.direction, unit(n.true_azimuth_deg, n.true_elevation_deg)));
      const heard = r.nodes.filter((n) => n.heard && n.bearing);
      trials.push({
        seed: scn.settings.seed,
        source_id: r.source_id,
        localised: !!r.fix?.position,
        error_3d_m: r.error_3d_m,
        error_horizontal_m: r.error_horizontal_m,
        bearing_error_deg: bearingErr,
        // True when any contributing node picked a path other than the direct one.
        picked_not_direct: heard.some((n) => n.picked_path_type !== 'direct')
      });
    }
    onTrial?.(i + 1, seeds);
  }
  return trials;
}

export function summarise(trials) {
  const err = trials.filter((t) => t.localised).map((t) => t.error_3d_m);
  const bearing = trials.flatMap((t) => t.bearing_error_deg);
  return {
    trials: trials.length,
    fix_rate: trials.length ? err.length / trials.length : 0,
    picked_not_direct_rate: trials.length ? trials.filter((t) => t.picked_not_direct).length / trials.length : 0,
    error_3d_median_m: percentile(err, 50),
    error_3d_p90_m: percentile(err, 90),
    bearing_median_deg: percentile(bearing, 50),
    bearing_p90_deg: percentile(bearing, 90)
  };
}

export function sweep(scenario, clips, durations, { param, values, seeds, onProgress }) {
  const make = SWEEP_PARAMS[param];
  if (!make) throw new Error(`unknown sweep parameter ${param}`);
  const rows = [];
  values.forEach((value, i) => {
    const trials = runTrials(make(scenario, value), clips, durations, { seeds, onTrial: (k) => onProgress?.((i * seeds + k) / (values.length * seeds)) });
    rows.push({ value, ...summarise(trials) });
  });
  return rows;
}
