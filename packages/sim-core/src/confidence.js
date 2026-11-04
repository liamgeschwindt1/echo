import { buildingBox, segmentBlocked } from './geometry.js';

const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const wrap = (d) => ((d + 540) % 360) - 180;
const rad = (d) => d * Math.PI / 180;
export const CONFIDENCE_FEATURES = Object.freeze([
  'log_range_m', 'log_range_ratio', 'crossing_sine', 'bearing_spread_deg',
  'residual_us', 'incoherence', 'horizontal_magnitude_deviation', 'log_chi2',
  'log_nis', 'onset_skew_s', 'onset_missing', 'blocked_fraction',
  'competing_tracks', 'reliable_nodes', 'declared_heading_sigma_deg', 'node_count'
]);

/** Inference-only features: never receives sources, scores, true headings or rendered paths. */
export function confidenceFeatures(fix, nodes, { buildings = [], settings = {} } = {}) {
  if (!fix.final_position?.every(Number.isFinite) || !fix.node_tracks?.length) throw new Error('Confidence requires a finite fix with node tracks');
  const tracks = fix.node_tracks.map((key) => {
    const [ni, ti] = key.split(':').map(Number);
    const nr = nodes[ni], tr = nr?.tracks[ti];
    if (!tr?.windows?.length || !nr.node_position?.every(Number.isFinite)) throw new Error(`Invalid confidence track: ${key}`);
    return { nr, tr };
  });
  const windows = tracks.flatMap(({ tr }) => tr.windows);
  if (windows.some((w) => ![w.az_deg, w.residual_s, w.peak_mean, w.h_mag].every(Number.isFinite))) throw new Error('Nonfinite confidence window');
  const ranges = tracks.map(({ nr }) => Math.hypot(fix.final_position[0] - nr.node_position[0], fix.final_position[1] - nr.node_position[1]));
  const azimuths = tracks.map(({ tr }) => {
    const anchor = tr.windows[0].az_deg;
    return anchor + median(tr.windows.map((w) => wrap(w.az_deg - anchor)));
  });
  const spreads = tracks.map(({ tr }, i) => Math.sqrt(mean(tr.windows.map((w) => wrap(w.az_deg - azimuths[i]) ** 2))));
  const crossing = azimuths.flatMap((az, i) => azimuths.slice(i + 1).map((other) => Math.abs(Math.sin(rad(az - other)))));
  const boxes = buildings.map(buildingBox);
  const blocked = tracks.filter(({ nr }) => segmentBlocked(nr.node_position, [fix.final_position[0], fix.final_position[1], nr.node_position[2] ?? 1.5], boxes)).length;
  const competing = tracks.map(({ nr, tr }) => nr.tracks.filter((other) => other !== tr &&
    other.windows[0].t_s <= tr.windows.at(-1).t_s && other.windows.at(-1).t_s >= tr.windows[0].t_s).length);
  const reliable = tracks.filter(({ tr }, i) => spreads[i] <= (settings.measured_bearing_sigma_deg ?? 2.5) &&
    mean(tr.windows.map((w) => w.peak_mean)) >= (settings.measured_min_peak ?? 0.25)).length;
  const values = [
    Math.log1p(Math.max(...ranges)), Math.log(Math.max(...ranges) / Math.max(0.01, Math.min(...ranges))),
    crossing.length ? Math.max(...crossing) : 0, Math.max(...spreads),
    1e6 * Math.sqrt(mean(windows.map((w) => w.residual_s ** 2))),
    1 - mean(windows.map((w) => w.peak_mean)), mean(windows.map((w) => Math.abs(1 - w.h_mag))),
    Math.log1p(Math.max(0, fix.chi2_mean)), Math.log1p(Math.max(0, fix.nis_mean)),
    fix.onset_skew_s ?? 0, Number(fix.onset_skew_s === null || fix.onset_skew_s === undefined),
    blocked / tracks.length, mean(competing), reliable, settings.heading_error_sigma_deg ?? 0, tracks.length
  ];
  if (!values.every(Number.isFinite)) throw new Error('Nonfinite confidence feature');
  const scale_m = Math.max(0.1, Math.max(...ranges) * rad(Math.hypot(settings.measured_bearing_sigma_deg ?? 2.5, settings.heading_error_sigma_deg ?? 0)) / Math.max(0.05, Math.max(...crossing, 0)));
  return { values, scale_m };
}

export const logistic = (z) => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));

export function fitLogistic(rows, { lambda = 0.1, iterations = 3000, learning_rate = 0.05 } = {}) {
  if (!rows.length || rows.some((r) => ![0, 1].includes(r.y) || r.x.length !== CONFIDENCE_FEATURES.length || !r.x.every(Number.isFinite))) throw new Error('Invalid logistic training population');
  const means = CONFIDENCE_FEATURES.map((_, j) => mean(rows.map((r) => r.x[j])));
  const scales = means.map((m, j) => Math.sqrt(mean(rows.map((r) => (r.x[j] - m) ** 2))) || 1);
  const xs = rows.map((r) => r.x.map((x, j) => (x - means[j]) / scales[j]));
  const coefficients = means.map(() => 0);
  let intercept = Math.log((rows.reduce((s, r) => s + r.y, 0) + 0.5) / (rows.reduce((s, r) => s + 1 - r.y, 0) + 0.5));
  for (let it = 0; it < iterations; it++) {
    const residuals = rows.map((r, i) => logistic(intercept + coefficients.reduce((s, b, j) => s + b * xs[i][j], 0)) - r.y);
    intercept -= learning_rate * mean(residuals);
    for (let j = 0; j < coefficients.length; j++) coefficients[j] -= learning_rate * (mean(residuals.map((r, i) => r * xs[i][j])) + lambda * coefficients[j]);
  }
  return { features: CONFIDENCE_FEATURES, means, scales, coefficients, intercept, lambda, iterations, learning_rate };
}

export function predictWrong(model, values) {
  if (values.length !== model.coefficients.length || !values.every(Number.isFinite)) throw new Error('Invalid confidence model input');
  const raw = model.intercept + model.coefficients.reduce((s, b, j) => s + b * (values[j] - model.means[j]) / model.scales[j], 0);
  return logistic((model.calibration?.intercept ?? 0) + (model.calibration?.slope ?? 1) * raw);
}

export function applyConfidence(inference, sensorScenario, model) {
  if (!model?.regression || !Number.isFinite(model.flag_threshold)) throw new Error('Missing frozen confidence model');
  for (const fix of inference.fixes) {
    const features = confidenceFeatures(fix, inference.nodes, sensorScenario);
    const p = predictWrong(model.regression, features.values);
    const condition = sensorScenario.settings.heading_error_sigma_deg > 0 || sensorScenario.settings.mic_position_sigma_mm > 0 ? 'on' : 'off';
    const radius = model.radius[condition];
    fix.confidence = {
      p_wrong: p, suspect: p >= model.flag_threshold, features: Object.fromEntries(CONFIDENCE_FEATURES.map((k, i) => [k, features.values[i]])),
      radius_90_m: radius?.quantile === null || !radius ? null : radius.quantile * features.scale_m,
      radius_condition: condition, model_id: model.id, status: 'simulator-trained; not real-data calibrated'
    };
  }
  return inference;
}

export function reliabilityDiagram(predictions, bins = 10) {
  return Array.from({ length: bins }, (_, i) => {
    const rows = predictions.filter((p) => Math.min(bins - 1, Math.floor(p.p * bins)) === i);
    return { min_probability: i / bins, max_probability: (i + 1) / bins, count: rows.length, predicted: rows.length ? mean(rows.map((r) => r.p)) : null, observed: rows.length ? mean(rows.map((r) => r.y)) : null };
  });
}
