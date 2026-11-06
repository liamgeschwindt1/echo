const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

const logistic = (x) => 1 / (1 + Math.exp(-x));

export function notchSpacingHz(notchFrequenciesHz) {
  if (!Array.isArray(notchFrequenciesHz) || notchFrequenciesHz.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < notchFrequenciesHz.length; i++) {
    const d = notchFrequenciesHz[i] - notchFrequenciesHz[i - 1];
    if (Number.isFinite(d) && d > 0) deltas.push(d);
  }
  return median(deltas);
}

export function estimateHeightFromNodeCue(nodeCue, { speedOfSoundMps = 343 } = {}) {
  const spacing = Number.isFinite(nodeCue.spacing_hz) && nodeCue.spacing_hz > 0 ? nodeCue.spacing_hz : notchSpacingHz(nodeCue.notch_frequencies_hz);
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return { node_id: nodeCue.node_id, usable: false, reason: 'missing_spacing' };
  }
  const d = nodeCue.horizontal_range_m;
  const hr = nodeCue.node_height_m;
  if (!(Number.isFinite(d) && d > 0 && Number.isFinite(hr) && hr > 0)) {
    return { node_id: nodeCue.node_id, usable: false, reason: 'missing_geometry' };
  }
  const hs = speedOfSoundMps * d / (2 * hr * spacing);
  const reflectivity = nodeCue.ground_reflectivity ?? 0.8;
  const snr = nodeCue.notch_snr_db ?? 15;
  const spacingSigma = Math.max(1, spacing * Math.max(0.03, 0.35 / Math.max(1, snr)));
  const sigma = Math.abs(hs) * (spacingSigma / spacing) / Math.max(0.1, Math.sqrt(Math.max(0.05, reflectivity)));
  const warnings = [];
  if (reflectivity < 0.15) warnings.push('low_reflectivity');
  if (d / hr > 120) warnings.push('grazing_geometry');
  if (snr < 6) warnings.push('low_snr');
  return {
    node_id: nodeCue.node_id,
    usable: Number.isFinite(hs) && hs > 0,
    height_m: hs,
    sigma_m: sigma,
    spacing_hz: spacing,
    warnings
  };
}

export function estimateNotchHeightCue(nodeCues, options = {}) {
  const perNode = nodeCues.map((node) => estimateHeightFromNodeCue(node, options));
  const usable = perNode.filter((n) => n.usable && Number.isFinite(n.sigma_m) && n.sigma_m > 0);
  if (!usable.length) {
    return {
      height_m: null,
      sigma_m: null,
      aerial_probability: null,
      ground_probability: null,
      class: 'unknown',
      usable_nodes: 0,
      per_node: perNode
    };
  }
  const weighted = usable.reduce((acc, node) => {
    const w = 1 / (node.sigma_m * node.sigma_m);
    return { num: acc.num + node.height_m * w, den: acc.den + w };
  }, { num: 0, den: 0 });
  const h = weighted.num / weighted.den;
  const sigma = Math.sqrt(1 / weighted.den);
  const groundMax = options.ground_max_height_m ?? 4;
  const score = (h - groundMax) / Math.max(0.25, sigma);
  const aerial = logistic(score);
  return {
    height_m: h,
    sigma_m: sigma,
    aerial_probability: aerial,
    ground_probability: 1 - aerial,
    class: aerial >= 0.5 ? 'aerial' : 'ground',
    usable_nodes: usable.length,
    per_node: perNode
  };
}
