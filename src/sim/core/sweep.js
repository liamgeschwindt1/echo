import { renderScenario } from './render.js';
import { analyseScenario } from './analyse.js';
import { renderLengthS } from './scenario.js';
import { angleBetweenDeg } from './localise.js';

const rad = (d) => (d * Math.PI) / 180;
const unit = (az, el) => [Math.cos(rad(el)) * Math.cos(rad(az)), Math.cos(rad(el)) * Math.sin(rad(az)), Math.sin(rad(el))];

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// Parameter variants. Each returns a fresh scenario so trials never share state.
export const SWEEP_PARAMS = {
  noise_floor_db_spl: (s, v) => ({ ...s, settings: { ...s.settings, noise_floor_db_spl: v } }),
  distance_scale: (s, v) => {
    const n = s.nodes;
    const cx = n.reduce((a, o) => a + o.position[0], 0) / n.length;
    const cy = n.reduce((a, o) => a + o.position[1], 0) / n.length;
    const sources = s.sources.map((src) => {
      const [x, y, z] = src.keyframes[0].position;
      return { ...src, keyframes: [{ ...src.keyframes[0], position: [cx + (x - cx) * v, cy + (y - cy) * v, z] }] };
    });
    return { ...s, sources };
  },
  node_count: (s, v) => ({ ...s, nodes: s.nodes.slice(0, Math.max(1, Math.round(v))) })
};

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
