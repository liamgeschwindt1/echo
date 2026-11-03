// Position fix from node bearings (P3, P4 of the 0.4 upgrade).
// Horizontal first: each node gives a ray in the ground plane, weighted by the metres of error implied at the fix.
// Consensus and leave-one-out reject contradictory rays. When horizontal conditioning fails, trusted elevations enable
// a 3D weighted fit. Height comes from resolved elevations, otherwise it is clamped to a prior. Suspect checks use
// bearings and site bounds only, never ground truth.
import { mapBounds } from './backtrace.js';

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Horizontal crossing angle of two azimuths as lines (0..90 deg). */
export const crossingDeg = (a, b) => {
  const d = Math.abs(((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
};

// Weighted least-squares point closest to 2D rays: sum_i w_i (I - u_i u_i^T) (x - o_i) = 0.
function solve2(rays, weights) {
  let a = 0;
  let b = 0;
  let d = 0;
  let vx = 0;
  let vy = 0;
  rays.forEach((r, i) => {
    const w = weights[i];
    const [ux, uy] = r.u;
    const m00 = w * (1 - ux * ux);
    const m01 = -w * ux * uy;
    const m11 = w * (1 - uy * uy);
    a += m00;
    b += m01;
    d += m11;
    vx += m00 * r.o[0] + m01 * r.o[1];
    vy += m01 * r.o[0] + m11 * r.o[1];
  });
  const det = a * d - b * b;
  if (Math.abs(det) < 1e-12 * Math.max(1, a * d)) return null;
  return [(d * vx - b * vy) / det, (a * vy - b * vx) / det];
}

const rangeAlong = (r, p) => (p[0] - r.o[0]) * r.u[0] + (p[1] - r.o[1]) * r.u[1];
const perpDist = (r, p) => Math.abs((p[0] - r.o[0]) * r.u[1] - (p[1] - r.o[1]) * r.u[0]);
// Normalised residual: perpendicular miss over the miss one sigma of bearing implies at that range.
const zScore = (r, p) => {
  const t = rangeAlong(r, p);
  return t > 0 ? perpDist(r, p) / (Math.max(t, 1) * Math.tan(toRad(Math.min(r.sigma_deg, 60)))) : Infinity;
};

// Weighted fit, re-weighted twice with the ranges of the previous solution.
function weightedFit(rays) {
  let w = rays.map((r) => 1 / toRad(r.sigma_deg) ** 2);
  let p = solve2(rays, w);
  for (let it = 0; p && it < 2; it++) {
    w = rays.map((r) => 1 / (Math.max(rangeAlong(r, p), 1) * toRad(r.sigma_deg)) ** 2);
    p = solve2(rays, w) || p;
  }
  return p;
}

// Residual of r against the fit of the other rays, or null when they are too close to parallel to say.
function looScore(r, set, settings) {
  const rest = set.filter((x) => x !== r);
  if (maxCrossing(rest) < settings.fix_min_crossing_deg) return null;
  const p = weightedFit(rest);
  return p ? zScore(r, p) : null;
}

function maxCrossing(rays) {
  let m = 0;
  for (let i = 0; i < rays.length; i++) for (let j = i + 1; j < rays.length; j++) m = Math.max(m, crossingDeg(rays[i].azimuth_deg, rays[j].azimuth_deg));
  return m;
}

function angle3dDeg(a, b) {
  const dot = Math.abs(a.u3[0] * b.u3[0] + a.u3[1] * b.u3[1] + a.u3[2] * b.u3[2]);
  return toDeg(Math.acos(Math.max(-1, Math.min(1, dot))));
}

function maxCrossing3d(rays) {
  let m = 0;
  for (let i = 0; i < rays.length; i++) for (let j = i + 1; j < rays.length; j++) m = Math.max(m, angle3dDeg(rays[i], rays[j]));
  return m;
}

function solveLinear3(a, b) {
  const m = a.map((row, i) => [...row, b[i]]);
  const scale = Math.max(...a.flat().map(Math.abs), 1);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    if (Math.abs(m[pivot][col]) <= 1e-12 * scale) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const d = m[col][col];
    for (let j = col; j < 4; j++) m[col][j] /= d;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const f = m[row][col];
      for (let j = col; j < 4; j++) m[row][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row[3]);
}

function solve3(rays, weights) {
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b = [0, 0, 0];
  rays.forEach((r, i) => {
    const w = weights[i];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        const q = w * ((j === k ? 1 : 0) - r.u3[j] * r.u3[k]);
        a[j][k] += q;
        b[j] += q * r.o[k];
      }
    }
  });
  return solveLinear3(a, b);
}

const rangeAlong3 = (r, p) => (p[0] - r.o[0]) * r.u3[0] + (p[1] - r.o[1]) * r.u3[1] + (p[2] - r.o[2]) * r.u3[2];
const perpDist3 = (r, p) => {
  const d = [p[0] - r.o[0], p[1] - r.o[1], p[2] - r.o[2]];
  const t = rangeAlong3(r, p);
  return Math.hypot(d[0] - t * r.u3[0], d[1] - t * r.u3[1], d[2] - t * r.u3[2]);
};
const zScore3 = (r, p) => {
  const t = rangeAlong3(r, p);
  return t > 0 ? perpDist3(r, p) / (Math.max(t, 1) * Math.tan(toRad(Math.min(r.sigma_deg, 60)))) : Infinity;
};

function weightedFit3(rays) {
  let w = rays.map((r) => 1 / toRad(r.sigma_deg) ** 2);
  let p = solve3(rays, w);
  for (let it = 0; p && it < 2; it++) {
    w = rays.map((r) => 1 / (Math.max(rangeAlong3(r, p), 1) * toRad(r.sigma_deg)) ** 2);
    p = solve3(rays, w) || p;
  }
  return p;
}

function looScore3(r, set, settings) {
  const rest = set.filter((x) => x !== r);
  if (rest.length < 2 || maxCrossing3d(rest) < settings.fix_min_crossing_deg) return null;
  const p = weightedFit3(rest);
  return p ? zScore3(r, p) : null;
}

function consensus3d(rays, settings) {
  let inliers = rays;
  const gate = settings.fix_inlier_gate_sigma;
  if (rays.length >= 3) {
    let best = null;
    for (let i = 0; i < rays.length; i++) {
      for (let j = i + 1; j < rays.length; j++) {
        if (angle3dDeg(rays[i], rays[j]) < settings.fix_min_crossing_deg) continue;
        const p = solve3([rays[i], rays[j]], [1, 1]);
        if (!p || !(rangeAlong3(rays[i], p) > 0) || !(rangeAlong3(rays[j], p) > 0)) continue;
        const z = rays.map((r) => zScore3(r, p));
        const set = rays.filter((r, k) => z[k] <= gate || k === i || k === j);
        const cost = set.reduce((s, r) => s + Math.min(zScore3(r, p), gate) ** 2, 0);
        if (!best || set.length > best.set.length || (set.length === best.set.length && cost < best.cost)) best = { set, cost };
      }
    }
    if (best) {
      inliers = best.set;
      const p = weightedFit3(inliers);
      if (p) inliers = rays.filter((r) => inliers.includes(r) || zScore3(r, p) <= gate);
    }
    while (inliers.length >= 3) {
      let worst = null;
      for (const r of inliers) {
        const z = looScore3(r, inliers, settings);
        if (z !== null && (!worst || z > worst.z)) worst = { r, z };
      }
      if (!worst || !(worst.z > gate)) break;
      inliers = inliers.filter((r) => r !== worst.r);
    }
  }
  return inliers;
}

/**
 * rays: [{ node_id, origin [x,y,z], azimuth_deg, elevation_deg, elevation_trusted, sigma_deg, direction (3D, optional) }].
 * opts: settings (fix_* thresholds, source_height_prior_m), scenario (for the scene bounds).
 * Returns null for fewer than two rays.
 */
export function robustFix(rays, { settings, scenario }) {
  if (rays.length < 2) return null;
  const gate = settings.fix_inlier_gate_sigma;
  const R = rays.map((r) => {
    const az = toRad(r.azimuth_deg);
    const el = toRad(r.elevation_deg);
    return {
      ...r,
      o: r.origin,
      u: [Math.cos(az), Math.sin(az)],
      u3: [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]
    };
  });
  const rejected = [];
  let inliers = R;
  let method = 'wls';

  if (R.length >= 3) {
    method = 'ransac_wls';
    let best = null;
    for (let i = 0; i < R.length; i++) {
      for (let j = i + 1; j < R.length; j++) {
        if (crossingDeg(R[i].azimuth_deg, R[j].azimuth_deg) < settings.fix_min_crossing_deg) continue;
        const p = solve2([R[i], R[j]], [1, 1]);
        if (!p || !(rangeAlong(R[i], p) > 0) || !(rangeAlong(R[j], p) > 0)) continue;
        const z = R.map((r) => zScore(r, p));
        const set = R.filter((_, k) => z[k] <= gate || k === i || k === j);
        const cost = set.reduce((s, r) => s + Math.min(zScore(r, p), gate) ** 2, 0);
        if (!best || set.length > best.set.length || (set.length === best.set.length && cost < best.cost)) best = { set, cost };
      }
    }
    if (best) {
      inliers = best.set;
      // Refit on the consensus set and re-admit any ray that agrees with the refined point.
      const p = weightedFit(inliers);
      if (p) inliers = R.filter((r) => inliers.includes(r) || zScore(r, p) <= gate);
    }
    // Leave-one-out: drop the ray that the fit of the others contradicts most, while three or more remain. A fit of the
    // others only counts when they still cross at fix_min_crossing_deg or more (two near-parallel rays prove nothing).
    while (inliers.length >= 3) {
      let worst = null;
      for (const r of inliers) {
        const z = looScore(r, inliers, settings);
        if (z !== null && (!worst || z > worst.z)) worst = { r, z };
      }
      if (!worst || !(worst.z > gate)) break;
      inliers = inliers.filter((x) => x !== worst.r);
    }
    for (const r of R) {
      if (inliers.includes(r)) continue;
      const p = weightedFit(inliers);
      const z = p ? zScore(r, p) : null;
      rejected.push({ node_id: r.node_id, reason: p && !(rangeAlong(r, p) > 0) ? 'behind_node' : 'outlier', residual_sigma: Number.isFinite(z) ? z : null });
    }
  } else method = 'two_ray';

  const xy = weightedFit(inliers);
  const ranges2d = xy ? inliers.map((r) => rangeAlong(r, xy)) : [];
  const negative2d = !xy || ranges2d.some((t) => !(t > 0));
  const crossH = maxCrossing(inliers);
  const poorlyConditioned2d = negative2d || crossH < settings.fix_min_crossing_deg;
  const trusted = R.filter((r) => r.elevation_trusted && Number.isFinite(r.elevation_deg));
  let inliers3d = [];
  let p3d = null;
  let cross3d = trusted.length >= 2 ? maxCrossing3d(trusted) : 0;
  const attempted3d = poorlyConditioned2d && trusted.length >= 2 && cross3d >= settings.fix_min_crossing_deg;
  let negative3d = false;
  if (attempted3d) {
    inliers3d = consensus3d(trusted, settings);
    cross3d = inliers3d.length >= 2 ? maxCrossing3d(inliers3d) : 0;
    p3d = inliers3d.length >= 2 && cross3d >= settings.fix_min_crossing_deg ? weightedFit3(inliers3d) : null;
    if (p3d && inliers3d.some((r) => !(rangeAlong3(r, p3d) > 0))) {
      negative3d = true;
      p3d = null;
    }
  }
  const use3d = !!p3d;
  if (use3d) {
    inliers = inliers3d;
    method = inliers3d.length >= 3 ? '3d_ransac_wls' : '3d_two_ray';
    rejected.length = 0;
    for (const r of R) {
      if (inliers.includes(r)) continue;
      const z = r.elevation_trusted && Number.isFinite(r.elevation_deg) && p3d ? zScore3(r, p3d) : null;
      rejected.push({
        node_id: r.node_id,
        reason: !r.elevation_trusted ? 'untrusted_elevation' : p3d && !(rangeAlong3(r, p3d) > 0) ? 'behind_node' : 'outlier',
        residual_sigma: Number.isFinite(z) ? z : null
      });
    }
  }

  // Height: from nodes that resolve elevation (not sign-assumed, confidence ok), otherwise the ground-event prior.
  let z = settings.source_height_prior_m;
  let z_clamped = true;
  let zFrom = [];
  if (use3d) {
    z = p3d[2];
    z_clamped = false;
    zFrom = inliers;
  } else if (xy && !negative2d) {
    zFrom = inliers.filter((r) => r.elevation_trusted && Number.isFinite(r.elevation_deg));
    if (zFrom.length) {
      let sw = 0;
      let sz = 0;
      for (const r of zFrom) {
        const h = Math.max(Math.hypot(xy[0] - r.o[0], xy[1] - r.o[1]), 1);
        const w = 1 / (h * toRad(r.sigma_deg)) ** 2;
        sw += w;
        sz += w * (r.o[2] + h * Math.tan(toRad(r.elevation_deg)));
      }
      z = sz / sw;
      z_clamped = false;
    }
  }
  const position = use3d ? p3d : !negative3d && xy && !negative2d ? [xy[0], xy[1], z] : null;
  const ranges = use3d ? inliers.map((r) => rangeAlong3(r, p3d)) : ranges2d;
  const negative_range = use3d ? false : negative2d || negative3d;
  const poorly_conditioned = use3d ? cross3d < settings.fix_min_crossing_deg : negative_range || crossH < settings.fix_min_crossing_deg;
  const finalCrossH = maxCrossing(inliers);

  // Leave-one-out residuals on the final inliers (only defined for three or more).
  const loo = [];
  if (position && inliers.length >= 3) {
    for (const r of inliers) loo.push({ node_id: r.node_id, residual_sigma: use3d ? looScore3(r, inliers, settings) : looScore(r, inliers, settings) });
  }
  const looMax = loo.reduce((m, x) => (Number.isFinite(x.residual_sigma) ? Math.max(m, x.residual_sigma) : m), 0);
  const raw3d = trusted.length >= 2 ? weightedFit3(trusted) : null;

  const reasons = [];
  if (position) {
    if (position[2] < -0.5) reasons.push('below_ground');
    const pos = ranges.filter((t) => t > 0);
    if (pos.length >= 2 && Math.max(...pos) / Math.max(Math.min(...pos), 1e-6) > settings.fix_range_ratio_max) reasons.push('range_ratio');
    if (looMax > settings.fix_loo_suspect_sigma) reasons.push('loo_residual');
    // As many rays were rejected as kept: the consensus itself is in doubt.
    if (rejected.length && rejected.length >= inliers.length) reasons.push('weak_consensus');
    if (scenario) {
      const b = mapBounds(scenario, settings.fix_bounds_margin_m);
      if (position[0] < b.min[0] || position[0] > b.max[0] || position[1] < b.min[1] || position[1] > b.max[1]) reasons.push('outside_scene');
    }
  } else if (negative_range) reasons.push('negative_range');

  return {
    method,
    position,
    poorly_conditioned,
    negative_range,
    ranges_m: ranges,
    max_angle_deg: finalCrossH,
    max_crossing_angle_horizontal_deg: finalCrossH,
    max_angle_3d_deg: use3d ? cross3d : trusted.length >= 2 ? maxCrossing3d(trusted) : null,
    z_3d_raw_m: use3d ? p3d[2] : raw3d?.[2] ?? null,
    inlier_nodes: inliers.map((r) => r.node_id),
    rejected_nodes: rejected,
    loo_residuals: loo,
    z_clamped: !!position && z_clamped,
    z_from_nodes: zFrom.map((r) => r.node_id),
    fix_suspect: reasons.length > 0,
    suspect_reasons: reasons
  };
}

/** Mean elevation-consistent check helper for tests and callers: azimuth (deg) of the vector from a to b. */
export const azimuthDeg = (a, b) => toDeg(Math.atan2(b[1] - a[1], b[0] - a[0]));
