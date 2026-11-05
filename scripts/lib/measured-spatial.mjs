import { windowTdoas } from '../../packages/sim-core/src/localise.js';
import { micPairs, micPositions } from '../../packages/sim-core/src/mics.js';
import { MEASURED_DEFAULTS, nodeTracks, mixtureFrames, detectOnsets, fuseTracks } from '../../packages/sim-core/src/measured.js';

const rad = Math.PI / 180;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const mul = (a, x) => a.map((r) => dot(r, x));
const zero = () => Array.from({ length: 3 }, () => [0, 0, 0]);

export function inverse3(a) {
  const [x, y, z] = a;
  const co = [[y[1] * z[2] - y[2] * z[1], x[2] * z[1] - x[1] * z[2], x[1] * y[2] - x[2] * y[1]],
    [y[2] * z[0] - y[0] * z[2], x[0] * z[2] - x[2] * z[0], x[2] * y[0] - x[0] * y[2]],
    [y[0] * z[1] - y[1] * z[0], x[1] * z[0] - x[0] * z[1], x[0] * y[1] - x[1] * y[0]]];
  const det = x[0] * co[0][0] + x[1] * co[1][0] + x[2] * co[2][0];
  const trace = x[0] + y[1] + z[2];
  if (!(trace > 0) || !(det > 1e-10 * trace ** 3)) return null;
  return co.map((r) => r.map((v) => v / det));
}

function geometry(positions) {
  const rows = micPairs(positions.length).map(([i, j]) => positions[j].map((x, k) => x - positions[i][k]));
  const gram = zero();
  for (const r of rows) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) gram[i][j] += r[i] * r[j];
  return { rows, inverse: inverse3(gram) };
}

export const spatialEligible = (node) => !!geometry(micPositions(node)).inverse;

export function fitSpatialTdoas(positions, delays, { fs, c, headingSigmaDeg = 0, positionSigmaMm = 0 }) {
  const { rows, inverse } = geometry(positions);
  if (!inverse) return null;
  const rhs = [0, 0, 0];
  for (let k = 0; k < rows.length; k++) for (let i = 0; i < 3; i++) rhs[i] += rows[k][i] * c * delays[k];
  const u = mul(inverse, rhs), norm = Math.hypot(...u), horizontal = Math.hypot(u[0], u[1]);
  if (!(norm >= 0.8 && norm <= 1.2 && horizontal > 1e-8)) return null;
  const residual = Math.sqrt(rows.reduce((s, r, k) => s + (dot(r, u) / c - delays[k]) ** 2, 0) / rows.length);
  const delayVariance = Math.max(residual ** 2 / 2, (1 / (4 * fs * Math.sqrt(12))) ** 2) + (positionSigmaMm / 1000 / c) ** 2;
  const scale = positions.length * c * c * delayVariance;
  const jaz = [-u[1] / horizontal ** 2, u[0] / horizontal ** 2, 0];
  const jel = [-u[0] * u[2] / (norm ** 2 * horizontal), -u[1] * u[2] / (norm ** 2 * horizontal), horizontal / norm ** 2];
  return {
    az_deg: Math.atan2(u[1], u[0]) / rad, elevation_deg: Math.atan2(u[2], horizontal) / rad,
    h_mag: horizontal, direction_norm: norm, residual_s: residual,
    sigma_az_deg: Math.sqrt(Math.max(0, scale * dot(jaz, mul(inverse, jaz))) + (headingSigmaDeg * rad) ** 2) / rad,
    sigma_elevation_deg: Math.sqrt(Math.max(0, scale * dot(jel, mul(inverse, jel)))) / rad
  };
}

function spatialWindow(rn, start, end, context) {
  const { fs, c, band } = context;
  const pairs = micPairs(rn.mic_positions.length);
  const spacing = Math.max(...pairs.map(([i, j]) => Math.hypot(...rn.mic_positions[j].map((x, k) => x - rn.mic_positions[i][k]))));
  const t = windowTdoas(rn.mics, start, end, { fs, c, band, maxLagS: spacing / c });
  const fit = fitSpatialTdoas(rn.mic_positions, t.map((x) => x.tdoa_s), context);
  return fit && { ...fit, peak_min: Math.min(...t.map((x) => x.peak_normalized)),
    peak_mean: t.reduce((s, x) => s + x.peak_normalized, 0) / t.length };
}

function direction(w) {
  const a = w.az_deg * rad, e = (w.elevation_deg ?? 0) * rad;
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
}
const separation = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(direction(a), direction(b))))) / rad;

function spatialNodeTracks(rn, node, context) {
  const { fs, band, options: o } = context;
  const frames = mixtureFrames(rn.mics[0], band, fs);
  const sorted = [...frames].sort((a, b) => a - b);
  const quiet = sorted[Math.floor(sorted.length * 0.2)] || 1e-30;
  const winS = o.window_ms / 1000, hopS = o.hop_ms / 1000, cand = [];
  const bearing = (t, duration) => spatialWindow(rn, Math.round(t * fs), Math.round((t + duration) * fs), context);
  const good = (w) => w && w.peak_min >= o.min_peak && w.residual_s * 1e6 <= o.max_residual_us;
  for (let t = 0; t + winS <= rn.mics[0].length / fs; t += hopS) {
    const f0 = Math.floor(t / 0.01), f1 = Math.min(frames.length, Math.ceil((t + winS) / 0.01));
    let e = 0;
    for (let f = f0; f < f1; f++) e += frames[f];
    if (e / Math.max(1, f1 - f0) < 1.5 * quiet) continue;
    const w = bearing(t, winS);
    if (good(w)) cand.push({ t_s: t + winS / 2, ...w });
  }
  const windows = cand.filter((w, i) => cand.filter((x, j) => j !== i &&
    Math.abs(x.t_s - w.t_s) <= o.neighbour_s && separation(x, w) <= o.neighbour_deg).length >= o.min_neighbours);
  const tracks = [];
  for (const w of windows) {
    let best = null, bestD = Infinity;
    for (const tr of tracks) {
      const last = tr.windows.at(-1), dt = w.t_s - last.t_s, d = separation(w, last);
      if (dt <= o.gap_s && d <= o.link_deg + o.link_rate_deg_s * Math.max(dt, 0) && d < bestD) {
        best = tr; bestD = d;
      }
    }
    if (best) best.windows.push(w);
    else tracks.push({ windows: [w] });
  }
  const kept = tracks.filter((tr) => tr.windows.length >= o.min_track_windows), onsets = [];
  for (const on of detectOnsets(frames, { riseDb: o.onset_rise_db })) {
    const w = bearing(on.t_s, o.onset_window_ms / 1000);
    if (!good(w)) continue;
    const tr = kept.find((k) => k.windows.some((x) => x.t_s >= on.t_s && x.t_s <= on.t_s + 0.4 && separation(x, w) <= o.link_deg));
    if (!tr) continue;
    const entry = { ...on, ...w, t_s: on.t_s + o.onset_window_ms / 2000, onset: true };
    (tr.onsets ||= []).push(entry); onsets.push(entry);
  }
  return { windows, candidates: cand, onsets, tracks: kept, quiet_power: quiet,
    node_id: node.id, node_position: node.position,
    ...(windows.length ? { bearing_intervals: { sigma_deg: median(windows.map((w) => w.sigma_az_deg)),
      two_sigma_deg: 2 * median(windows.map((w) => w.sigma_az_deg)),
      method: 'analytic shared-pair covariance and declared realism; unvalidated' } } : {}) };
}

export function stationarySpatialFix(observations, start) {
  let point = [...start], converged = false;
  for (let iteration = 0; iteration < 20; iteration++) {
    const matrix = zero(), rhs = [0, 0, 0];
    for (const o of observations) {
      const az = o.az_deg * rad, delta = point.map((x, k) => x - o.node_position[k]);
      const planes = [{ n: [-Math.sin(az), Math.cos(az), 0],
        sigma: Math.max(1e-8, Math.hypot(delta[0], delta[1]) * o.sigma_az_deg * rad) }];
      if (Number.isFinite(o.elevation_deg)) {
        const el = o.elevation_deg * rad;
        planes.push({ n: [-Math.sin(el) * Math.cos(az), -Math.sin(el) * Math.sin(az), Math.cos(el)],
          sigma: Math.max(1e-8, Math.hypot(...delta) * o.sigma_elevation_deg * rad) });
      }
      for (const { n, sigma } of planes) {
        const weight = 1 / sigma ** 2, value = dot(n, o.node_position);
        for (let i = 0; i < 3; i++) {
          rhs[i] += weight * n[i] * value;
          for (let j = 0; j < 3; j++) matrix[i][j] += weight * n[i] * n[j];
        }
      }
    }
    const inverse = inverse3(matrix);
    if (!inverse) return { reason: 'rank-deficient spatial intersection' };
    const next = mul(inverse, rhs), change = Math.hypot(...next.map((x, k) => x - point[k]));
    point = next;
    if (change < 0.001) { converged = true; break; }
  }
  if (!converged) return { reason: 'spatial range weights did not converge in20 iterations' };
  if (observations.some((o) => dot(direction(o), point.map((x, k) => x - o.node_position[k])) <= 0)) {
    return { reason: 'spatial intersection behind a bearing ray' };
  }
  return { position: point };
}

export function analyseSpatial(scenario, data, { c, options = {} }) {
  const o = { ...MEASURED_DEFAULTS, ...options };
  const context = { fs: data.sample_rate, c, band: scenario.settings.localisation_band_hz, options: o,
    headingSigmaDeg: scenario.settings.heading_error_sigma_deg ?? 0, positionSigmaMm: scenario.settings.mic_position_sigma_mm ?? 0 };
  const nodes = scenario.nodes.map((node, i) => geometry(data.nodes[i].mic_positions).inverse
    ? spatialNodeTracks(data.nodes[i], node, context) : nodeTracks(data.nodes[i], node, context));
  const fixes = fuseTracks(nodes, { c, options: o });
  for (const fix of fixes) {
    if (!fix.static) continue;
    const obs = fix.node_tracks.map((key) => {
      const [ni, ti] = key.split(':').map(Number), windows = nodes[ni].tracks[ti].windows;
      const az0 = windows[0].az_deg;
      const az = az0 + median(windows.map((w) => ((w.az_deg - az0 + 540) % 360) - 180));
      const spatial = windows.filter((w) => Number.isFinite(w.elevation_deg));
      return { node_position: nodes[ni].node_position, az_deg: az,
        sigma_az_deg: spatial.length ? median(spatial.map((w) => w.sigma_az_deg)) : o.bearing_sigma_deg,
        ...(spatial.length ? { elevation_deg: median(spatial.map((w) => w.elevation_deg)),
          sigma_elevation_deg: median(spatial.map((w) => w.sigma_elevation_deg)) } : {}) };
    });
    if (!obs.some((x) => Number.isFinite(x.elevation_deg))) continue;
    const result = stationarySpatialFix(obs, [...fix.final_position, 1.5]);
    if (!result.position) { fix.spatial_failure = result.reason; continue; }
    fix.legacy_horizontal_chi2_mean = fix.chi2_mean;
    fix.chi2_mean = null;
    fix.final_position = result.position;
    fix.positions = fix.positions.map((p) => ({ ...p, position: result.position, sigma_m: null }));
    fix.spatial_uncertainty_note = 'Static3D point; calibrated positional sigma/radius unavailable. Legacy pair reliability/flags retained.';
  }
  return { nodes, fixes, options: o };
}
