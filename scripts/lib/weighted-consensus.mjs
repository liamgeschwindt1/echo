import { weightedRayFit2d, crossingDeg } from '../../packages/sim-core/src/fix.js';

const rad = (x) => x * Math.PI / 180;
const along = (r, p) => (p[0] - r.o[0]) * r.u[0] + (p[1] - r.o[1]) * r.u[1];
const perp = (r, p) => Math.abs((p[0] - r.o[0]) * r.u[1] - (p[1] - r.o[1]) * r.u[0]);
const weight = (r) => (r.reliable ? 1 : 0.1) / r.sigma_deg ** 2;
const sigmaMetres = (r, p) => Math.max(along(r, p), 1) * Math.tan(rad(Math.min(r.sigma_deg, 60)));
const zscore = (r, p) => along(r, p) > 0 ? perp(r, p) / sigmaMetres(r, p) : Infinity;
const quantise = (x) => Math.round(x * 1e10);

function covariance(rays, p) {
  let a = 0, b = 0, d = 0;
  for (const r of rays) {
    const w = (r.reliable ? 1 : 0.1) / sigmaMetres(r, p) ** 2;
    a += w * r.u[1] ** 2; b -= w * r.u[0] * r.u[1]; d += w * r.u[0] ** 2;
  }
  const det = a * d - b * b;
  return det > 1e-12 * a * d ? [[d / det, -b / det], [-b / det, a / det]] : null;
}

export function predictiveResidual(ray, others, p) {
  const cov = covariance(others, p);
  if (!cov) return null;
  const n = [-ray.u[1], ray.u[0]];
  const variance = sigmaMetres(ray, p) ** 2 + n[0] ** 2 * cov[0][0] + 2 * n[0] * n[1] * cov[0][1] + n[1] ** 2 * cov[1][1];
  return along(ray, p) > 0 ? perp(ray, p) / Math.sqrt(variance) : null;
}

export function weightedConsensus(input, { mode, min_cross_deg, gate = 3 }) {
  if (!['weighted', 'predictive'].includes(mode)) throw new Error('Unknown experimental consensus');
  const rays = input.map((r) => ({ ...r, o: r.origin, u: [Math.cos(rad(r.azimuth_deg)), Math.sin(rad(r.azimuth_deg))] }))
    .sort((a, b) => a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0);
  const fit = (set) => weightedRayFit2d(set.map((r) => ({ ...r, sigma_deg: r.sigma_deg / Math.sqrt(r.reliable ? 1 : 0.1) })));
  let best = null;
  for (let i = 0; i < rays.length; i++) for (let j = i + 1; j < rays.length; j++) {
    if (crossingDeg(rays[i].azimuth_deg, rays[j].azimuth_deg) < min_cross_deg) continue;
    const p = fit([rays[i], rays[j]]);
    if (!p || along(rays[i], p) <= 0 || along(rays[j], p) <= 0) continue;
    const set = rays.filter((r) => zscore(r, p) <= gate);
    const support = set.reduce((s, r) => s + weight(r), 0);
    const cost = set.reduce((s, r) => s + weight(r) * Math.min(zscore(r, p), gate) ** 2, 0);
    const pair = `${rays[i].node_id}\0${rays[j].node_id}`;
    if (!best || quantise(support) > quantise(best.support) ||
        quantise(support) === quantise(best.support) && (quantise(cost) < quantise(best.cost) ||
          quantise(cost) === quantise(best.cost) && pair < best.pair)) best = { set, support, cost, pair };
  }
  if (!best) return null;
  let set = best.set;
  while (set.length >= 3) {
    let worst = null;
    for (const ray of set) {
      const others = set.filter((r) => r !== ray);
      if (!others.some((r, i) => others.slice(i + 1).some((q) => crossingDeg(r.azimuth_deg, q.azimuth_deg) >= min_cross_deg))) continue;
      if (mode === 'weighted' && others.reduce((s, r) => s + weight(r), 0) < 2 * weight(ray) - 1e-12) continue;
      const p = fit(others);
      if (!p || others.some((r) => along(r, p) <= 0)) continue;
      const z = mode === 'predictive' ? predictiveResidual(ray, others, p) : zscore(ray, p);
      if (z !== null && (!worst || z > worst.z)) worst = { ray, z };
    }
    if (!worst || !(worst.z > gate)) break;
    set = set.filter((r) => r !== worst.ray);
  }
  const position = fit(set);
  if (!position || set.some((r) => along(r, position) <= 0)) return null;
  return { position, inlier_nodes: set.map((r) => r.node_id), covariance: covariance(set, position), pair: best.pair.split('\0') };
}
