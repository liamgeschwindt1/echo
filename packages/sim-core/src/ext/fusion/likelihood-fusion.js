import { overlap, wrapDeg } from './utils.js';

function trackSpan(track) {
  const times = track.windows.map((window) => window.t_s);
  return [Math.min(...times), Math.max(...times)];
}

function trackSummary(track, options, calibration = { offset_deg: 0, sigma_deg: 0 }) {
  const windows = track.windows;
  const az = windows.reduce((sum, window) => sum + window.az_deg, 0) / Math.max(1, windows.length);
  const spread = Math.sqrt(windows.reduce((sum, window) => sum + wrapDeg(window.az_deg - az) ** 2, 0) / Math.max(1, windows.length));
  const peak = windows.reduce((sum, window) => sum + (window.peak_mean ?? 0), 0) / Math.max(1, windows.length);
  const residual = windows.reduce((sum, window) => sum + (window.residual_s ?? 0), 0) / Math.max(1, windows.length);
  return {
    az_deg: wrapDeg(az + calibration.offset_deg),
    sigma_deg: Math.hypot(options.bearing_sigma_deg, spread, calibration.sigma_deg),
    peak,
    residual_s: residual,
    span_s: trackSpan(track),
    t_s: windows[Math.floor((windows.length - 1) / 2)].t_s,
    n_windows: windows.length
  };
}

function clusterTracks(nodeResults, options) {
  const tracks = [];
  nodeResults.forEach((node, ni) => {
    node.tracks.forEach((track, ti) => {
      if (track.windows.length < options.likelihood_min_track_windows) return;
      tracks.push({ ni, ti, node, track, span_s: trackSpan(track) });
    });
  });
  const clusters = [];
  for (const entry of tracks) {
    const group = clusters.find((cluster) =>
      !cluster.nodes.has(entry.ni) &&
      cluster.tracks.some((other) => overlap(other.span_s, entry.span_s)));
    if (group) {
      group.tracks.push(entry);
      group.nodes.add(entry.ni);
    } else {
      clusters.push({ tracks: [entry], nodes: new Set([entry.ni]) });
    }
  }
  return clusters;
}

function gridFromNodes(nodeResults, options) {
  const margin = options.likelihood_margin_m;
  const step = options.likelihood_grid_step_m;
  const xs = nodeResults.map((node) => node.node_position[0]);
  const ys = nodeResults.map((node) => node.node_position[1]);
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;
  const points = [];
  for (let x = minX; x <= maxX + 1e-9; x += step) {
    for (let y = minY; y <= maxY + 1e-9; y += step) points.push([x, y]);
  }
  return { points, step, bounds: { minX, maxX, minY, maxY } };
}

function logLikelihood(track, point, options) {
  const expected = Math.atan2(point[1] - track.node.node_position[1], point[0] - track.node.node_position[0]) * 180 / Math.PI;
  const residual = wrapDeg(track.summary.az_deg - expected);
  const sigma = Math.max(0.5, track.summary.sigma_deg);
  const gaussian = -0.5 * (residual / sigma) ** 2 - Math.log(sigma);
  const floor = Math.log(Math.max(1e-6, options.likelihood_outlier_floor));
  const reliability = Math.max(0.1, (track.summary.peak + 0.05) / (1 + track.summary.residual_s * 1e6));
  return {
    value: Math.log(Math.exp(gaussian) + Math.exp(floor)),
    reliability
  };
}

export function fuseLikelihoodTracks(nodeResults, context) {
  const { options } = context;
  const clusters = clusterTracks(nodeResults, options).filter((cluster) => cluster.nodes.size >= options.likelihood_min_nodes);
  const grid = gridFromNodes(nodeResults, options);
  const fixes = [];
  for (const cluster of clusters) {
    const tracks = cluster.tracks.map((entry) => ({
      ...entry,
      summary: trackSummary(entry.track, options, context.calibration?.[entry.ni])
    }));
    const scored = grid.points.map((point) => {
      let score = 0;
      for (const track of tracks) {
        const ll = logLikelihood(track, point, options);
        score += ll.value * ll.reliability;
      }
      return { point, score };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) continue;
    const maxScore = best.score;
    const weights = scored.map((cell) => Math.exp(cell.score - maxScore));
    const total = weights.reduce((sum, value) => sum + value, 0);
    const ranked = scored.map((cell, i) => ({ ...cell, weight: weights[i] / Math.max(total, 1e-12) }))
      .sort((a, b) => b.weight - a.weight);
    let mass = 0;
    const region = [];
    for (const cell of ranked) {
      mass += cell.weight;
      region.push(cell.point);
      if (mass >= 0.9) break;
    }
    const radius90 = Math.sqrt(Math.max(...region.map((point) => (point[0] - best.point[0]) ** 2 + (point[1] - best.point[1]) ** 2), 0));
    const spans = tracks.map((track) => track.summary.span_s);
    fixes.push({
      node_tracks: tracks.map((track) => `${track.ni}:${track.ti}`),
      static: true,
      final_position: best.point,
      positions: [{
        t_e: tracks.reduce((sum, track) => sum + track.summary.t_s, 0) / tracks.length,
        position: best.point,
        sigma_m: radius90 / 1.64
      }],
      n_windows: tracks.reduce((sum, track) => sum + track.summary.n_windows, 0),
      n_nodes: tracks.length,
      chi2_mean: null,
      nis_mean: null,
      low_confidence: true,
      ambiguous: false,
      reliable: false,
      confidence: {
        radius_90_m: radius90,
        p_wrong: Math.max(0.01, Math.min(0.99, 1 - mass)),
        suspect: radius90 > options.likelihood_margin_m / 2
      },
      extensions: {
        fusion: {
          mode: 'likelihood_product',
          emission_interval_s: [Math.min(...spans.map((span) => span[0])), Math.max(...spans.map((span) => span[1]))],
          grid_step_m: grid.step
        }
      }
    });
  }
  return {
    fixes,
    grid: {
      step_m: grid.step,
      bounds: grid.bounds,
      cells: grid.points.length
    }
  };
}
