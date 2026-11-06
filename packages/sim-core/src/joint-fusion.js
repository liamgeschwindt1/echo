import { trackCandidates } from './measured.js';
import { exactTrackAssignment } from './track-assignment.js';
import { weightedConsensus } from './weighted-consensus.js';

const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;
const wrap = (d) => ((d + 540) % 360) - 180;
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rms = (values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / Math.max(1, values.length));

function predictedAzimuth(ray, position) {
  return deg(Math.atan2(position[1] - ray.origin[1], position[0] - ray.origin[0]));
}

function residualDeg(ray, position) {
  return Math.abs(wrap(ray.az_deg - predictedAzimuth(ray, position)));
}

function solve2(a, b) {
  const det = a[0][0] * a[1][1] - a[0][1] * a[1][0];
  if (!(det > 1e-14 * Math.max(1, Math.abs(a[0][0] * a[1][1])))) return null;
  return [
    (b[0] * a[1][1] - b[1] * a[0][1]) / det,
    (a[0][0] * b[1] - a[1][0] * b[0]) / det
  ];
}

function invert2(a) {
  const det = a[0][0] * a[1][1] - a[0][1] * a[1][0];
  if (!(det > 1e-14 * Math.max(1, Math.abs(a[0][0] * a[1][1])))) return null;
  return [[a[1][1] / det, -a[0][1] / det], [-a[1][0] / det, a[0][0] / det]];
}

function fitHuber(rays, initial) {
  let position = [...initial];
  const normalMatrix = () => {
    const hessian = [[0, 0], [0, 0]];
    for (const ray of rays) {
      const dx = position[0] - ray.origin[0], dy = position[1] - ray.origin[1];
      const range2 = dx * dx + dy * dy;
      if (range2 < 1e-8) return null;
      const jacobian = [-dy / range2, dx / range2];
      const residual = rad(wrap(ray.az_deg - deg(Math.atan2(dy, dx))));
      const sigma = rad(Math.max(ray.sigma_deg, 0.1));
      const z = Math.abs(residual / sigma);
      const weight = (z > 1.345 ? 1.345 / z : 1) / (sigma * sigma);
      for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
        hessian[row][col] += weight * jacobian[row] * jacobian[col];
      }
    }
    return hessian;
  };
  for (let iteration = 0; iteration < 20; iteration++) {
    const hessian = [[0, 0], [0, 0]], gradient = [0, 0];
    for (const ray of rays) {
      const dx = position[0] - ray.origin[0], dy = position[1] - ray.origin[1];
      const range2 = dx * dx + dy * dy;
      if (range2 < 1e-8) return null;
      const jacobian = [-dy / range2, dx / range2];
      const residual = rad(wrap(ray.az_deg - deg(Math.atan2(dy, dx))));
      const sigma = rad(Math.max(ray.sigma_deg, 0.1));
      const z = Math.abs(residual / sigma);
      const weight = (z > 1.345 ? 1.345 / z : 1) / (sigma * sigma);
      for (let row = 0; row < 2; row++) {
        gradient[row] += weight * jacobian[row] * residual;
        for (let col = 0; col < 2; col++) hessian[row][col] += weight * jacobian[row] * jacobian[col];
      }
    }
    const step = solve2(hessian, gradient);
    if (!step || !step.every(Number.isFinite)) return null;
    position = [position[0] + step[0], position[1] + step[1]];
    if (Math.hypot(...step) < 1e-4) break;
  }
  const information = normalMatrix();
  const covariance = information && invert2(information);
  if (!covariance || !position.every(Number.isFinite)) return null;
  return { position, covariance };
}

function robustJointFit(rays, minCrossDeg, gateSigma) {
  if (rays.length < 2) return null;
  const sorted = [...rays].sort((a, b) => lexical(a.node_id, b.node_id));
  const consensus = weightedConsensus(sorted.map((ray) => ({
    node_id: ray.node_id,
    origin: ray.origin,
    azimuth_deg: ray.az_deg,
    sigma_deg: ray.sigma_deg,
    reliable: true
  })), { mode: 'weighted', min_cross_deg: minCrossDeg, gate: gateSigma });
  if (!consensus || consensus.inlier_nodes.length < 3) return null;
  const inliers = sorted.filter((ray) => consensus.inlier_nodes.includes(ray.node_id));
  const best = { inliers, point: consensus.position, pair: consensus.pair };
  const fit = fitHuber(best.inliers, best.point);
  if (!fit) return null;
  const finalInliers = sorted.filter((ray) => residualDeg(ray, fit.position) <= gateSigma * ray.sigma_deg);
  if (finalInliers.length < 3) return null;
  const refined = finalInliers.length === best.inliers.length && finalInliers.every((ray, i) => ray === best.inliers[i])
    ? fit
    : fitHuber(finalInliers, fit.position);
  return refined ? { ...refined, inliers: finalInliers, seed_pair: best.pair } : null;
}

function trackBearing(track, calibration = { offset_deg: 0, sigma_deg: 0 }) {
  const windows = track.windows;
  const anchor = windows[0].az_deg;
  const angles = windows.map((window) => wrap(window.az_deg - anchor));
  const az_deg = wrap(anchor + median(angles) + calibration.offset_deg);
  return { az_deg, spread_deg: Math.hypot(rms(angles.map((angle) => wrap(angle - median(angles)))), calibration.sigma_deg) };
}

function emissionSpan(candidate, c) {
  const range = (node) => Math.hypot(candidate.position[0] - node.node_position[0], candidate.position[1] - node.node_position[1]);
  return candidate.selected.map(({ nr, tr }) => [
    tr.windows[0].t_s - range(nr) / c,
    tr.windows.at(-1).t_s - range(nr) / c
  ]);
}

function selectCompatibleTracks(candidate, nodes, c, options) {
  let selected = [...candidate.selected];
  let spans = emissionSpan(candidate, c);
  let common = [Math.max(...spans.map((span) => span[0])), Math.min(...spans.map((span) => span[1]))];
  if (common[0] > common[1]) return null;
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
    if (selected.some((entry) => entry.ni === nodeIndex)) continue;
    const node = nodes[nodeIndex];
    const choices = node.tracks.map((tr, ti) => {
      const measured = trackBearing(tr);
      const ray = { origin: node.node_position, az_deg: measured.az_deg };
      const residual = rms(tr.windows.map((w) => wrap(w.az_deg - predictedAzimuth(ray, candidate.position))));
      const span = [
        tr.windows[0].t_s - Math.hypot(candidate.position[0] - node.node_position[0], candidate.position[1] - node.node_position[1]) / c,
        tr.windows.at(-1).t_s - Math.hypot(candidate.position[0] - node.node_position[0], candidate.position[1] - node.node_position[1]) / c
      ];
      return { ni: nodeIndex, ti, tr, nr: node, residual, span, measured };
    }).filter((entry) =>
      entry.residual <= options.joint_track_gate_sigma * options.bearing_sigma_deg &&
      entry.span[0] <= common[1] && entry.span[1] >= common[0])
      .sort((a, b) => a.residual - b.residual || a.ti - b.ti);
    if (!choices.length) continue;
    const choice = choices[0];
    selected.push(choice);
    common = [Math.max(common[0], choice.span[0]), Math.min(common[1], choice.span[1])];
  }
  return { selected, common };
}

function raysFor(selected, options, calibration) {
  return selected.map(({ ni, nr, tr, measured }) => {
    const bearing = measured ?? trackBearing(tr, calibration?.[ni]);
    return {
      node_id: `${nr.node_id}:${ni}`,
      origin: nr.node_position,
      az_deg: bearing.az_deg,
      sigma_deg: Math.max(0.1, Math.hypot(options.bearing_sigma_deg, bearing.spread_deg))
    };
  });
}

function solveCandidates(nodes, candidates, { c, options, calibration }) {
  const proposals = [];
  for (const candidate of candidates) {
    if (!candidate.static || candidate.score > 25 ||
      candidate.skew != null && candidate.skew > options.max_onset_skew_s) continue;
    const initial = {
      position: candidate.st.position,
      selected: [
        { ni: candidate.A.ni, ti: candidate.A.ti, tr: candidate.A.tr, nr: candidate.A.nr },
        { ni: candidate.B.ni, ti: candidate.B.ti, tr: candidate.B.tr, nr: candidate.B.nr }
      ]
    };
    const selected = selectCompatibleTracks(initial, nodes, c, options);
    if (!selected || selected.selected.length < 3) continue;
    const rays = raysFor(selected.selected, options, calibration);
    const fit = robustJointFit(rays, options.min_cross_deg, options.joint_gate_sigma);
    if (!fit || fit.inliers.length < 3) continue;
    const keptIds = new Set(fit.inliers.map((ray) => ray.node_id));
    const kept = selected.selected.filter((entry) => keptIds.has(`${entry.nr.node_id}:${entry.ni}`));
    const residuals = fit.inliers.map((ray) => residualDeg(ray, fit.position));
    const sigma = fit.inliers.map((ray) => ray.sigma_deg);
    const chi2 = residuals.reduce((sum, value, i) => sum + (value / sigma[i]) ** 2, 0) / fit.inliers.length;
    if (chi2 > options.static_chi2) continue;
    const positions = kept.flatMap(({ ni, nr, tr }) => tr.windows.map((window) => ({
      t_e: window.t_s - Math.hypot(fit.position[0] - nr.node_position[0], fit.position[1] - nr.node_position[1]) / c,
      position: fit.position
    }))).sort((a, b) => a.t_e - b.t_e);
    const start = Math.min(...positions.map((entry) => entry.t_e));
    const end = Math.max(...positions.map((entry) => entry.t_e));
    const eigenMax = (() => {
      const [[a, b], [c, d]] = fit.covariance;
      return Math.max(0, (a + d + Math.sqrt((a - d) ** 2 + 4 * b * c)) / 2);
    })();
    const fix = {
      node_tracks: kept.map(({ ni, ti }) => `${ni}:${ti}`).sort(lexical),
      static: true,
      final_position: fit.position,
      positions,
      chi2_mean: chi2,
      nis_mean: chi2,
      onset_skew_s: candidate.skew,
      n_windows: positions.length,
      n_nodes: kept.length,
      low_confidence: true,
      ambiguous: false,
      reliable: false,
      algorithm: 'joint-ransac-huber',
      covariance: fit.covariance,
      covariance_radius_90_m: Math.sqrt(4.605 * eigenMax * Math.max(1, chi2)),
      consensus: { seed_pair: fit.seed_pair, inlier_nodes: fit.inliers.map((ray) => ray.node_id), residual_deg: residuals },
      emission_interval_s: [start, end]
    };
    const score = chi2 + 1 / kept.length;
    const duplicate = proposals.find((proposal) =>
      Math.hypot(proposal.fix.final_position[0] - fix.final_position[0], proposal.fix.final_position[1] - fix.final_position[1]) <= options.joint_dedupe_m &&
      Math.max(proposal.fix.emission_interval_s[0], start) <= Math.min(proposal.fix.emission_interval_s[1], end));
    if (!duplicate) proposals.push({ fix, score });
    else if (kept.length > duplicate.fix.n_nodes || kept.length === duplicate.fix.n_nodes && score < duplicate.score) {
      duplicate.fix = fix;
      duplicate.score = score;
    }
  }
  return proposals;
}

function assignDisjoint(proposals) {
  const candidates = proposals.map(({ fix, score }) => ({
    fix,
    utility: fix.n_nodes - score * 1e-3
  }));
  return exactTrackAssignment(candidates).fixes;
}

export function fuseJointTracks(nodes, context) {
  const { pairs, options: base } = trackCandidates(nodes, context);
  const options = {
    ...base,
    joint_track_gate_sigma: 3,
    joint_gate_sigma: 3,
    joint_dedupe_m: 2
  };
  const proposals = solveCandidates(nodes, pairs, { ...context, options, calibration: context.calibration });
  return assignDisjoint(proposals);
}
