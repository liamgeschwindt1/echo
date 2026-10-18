import { buildSurfaces, insideBuilding } from './geometry.js';

// Back-tracing of bearings through building faces. Horizontal plane only: every ray stays at the node's height,
// so a face is hit only when that height is inside the face's height range.
export const BACKTRACE_DEFAULTS = Object.freeze({
  reflection_order: 2,
  min_crossing_angle_deg: 20,
  cluster_m: 1,
  path_scale_m: 100,
  fallback_uncertainty_deg: 5,
  edge_margin_m: 100
});

const EPS = 1e-6;
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];

export function mapBounds(scenario, margin = BACKTRACE_DEFAULTS.edge_margin_m) {
  const xs = [];
  const ys = [];
  for (const n of scenario.nodes) (xs.push(n.position[0]), ys.push(n.position[1]));
  for (const b of scenario.buildings || []) {
    xs.push(b.position[0] - b.size[0] / 2, b.position[0] + b.size[0] / 2);
    ys.push(b.position[1] - b.size[1] / 2, b.position[1] + b.size[1] / 2);
  }
  return { min: [Math.min(...xs) - margin, Math.min(...ys) - margin], max: [Math.max(...xs) + margin, Math.max(...ys) + margin] };
}

// Distance along a 2D unit direction to the first wall face that is hit from outside, inside its rectangle and height range.
function firstHit(pos, dir, z, walls) {
  let best = null;
  for (const s of walls) {
    if (dir[s.axis] * s.sign >= -1e-12) continue;
    const t = (s.offset - pos[s.axis]) / dir[s.axis];
    if (t <= EPS) continue;
    const other = 1 - s.axis;
    const o = pos[other] + t * dir[other];
    const [lo, hi] = s.bounds[other];
    if (o < lo - 1e-9 || o > hi + 1e-9 || z < s.bounds[2][0] || z > s.bounds[2][1]) continue;
    if (!best || t < best.t) best = { t, surface: s };
  }
  return best;
}

function edgeDistance(pos, dir, bounds) {
  let t = Infinity;
  for (let i = 0; i < 2; i++) {
    if (Math.abs(dir[i]) < 1e-12) continue;
    const tt = ((dir[i] > 0 ? bounds.max[i] : bounds.min[i]) - pos[i]) / dir[i];
    if (tt >= 0) t = Math.min(t, tt);
  }
  return t;
}

/**
 * All branches for one node. Each branch is a stretch where the source may lie:
 * the first leg (solid) or a leg after a specular reflection (dashed).
 * Returns { legs: [{ from, to, len, path_before, reflections, kind, faces, ends_at }] }.
 */
export function traceBearing(origin, azimuthDeg, { buildings = [], reflection_order = BACKTRACE_DEFAULTS.reflection_order, bounds }) {
  const walls = buildSurfaces(buildings).filter((s) => s.kind === 'wall');
  const z = origin[2];
  const legs = [];
  const az = (azimuthDeg * Math.PI) / 180;
  const walk = (pos, dir, reflections, pathBefore, faces) => {
    const h = firstHit(pos, dir, z, walls);
    const tEdge = edgeDistance(pos, dir, bounds);
    const hitsFace = h && h.t < tEdge;
    const len = hitsFace ? h.t : tEdge;
    if (!(len > EPS)) return;
    const to = [pos[0] + dir[0] * len, pos[1] + dir[1] * len];
    legs.push({
      from: [pos[0], pos[1]],
      to,
      dir: [...dir],
      len,
      path_before: pathBefore,
      reflections,
      kind: reflections === 0 ? 'solid' : 'dashed',
      faces,
      ends_at: hitsFace ? h.surface.id : 'edge'
    });
    if (hitsFace && reflections < reflection_order) {
      const next = [...dir];
      next[h.surface.axis] = -next[h.surface.axis];
      walk(to, next, reflections + 1, pathBefore + len, [...faces, h.surface.id]);
    }
  };
  walk([origin[0], origin[1]], [Math.cos(az), Math.sin(az)], 0, 0, []);
  return { legs };
}

function crossLegs(a, b) {
  const den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
  if (Math.abs(den) < 1e-9) return null;
  const dx = b.from[0] - a.from[0];
  const dy = b.from[1] - a.from[1];
  const ta = (dx * b.dir[1] - dy * b.dir[0]) / den;
  const tb = (dx * a.dir[1] - dy * a.dir[0]) / den;
  const tol = 1e-6;
  if (ta < -tol || tb < -tol || ta > a.len + tol || tb > b.len + tol) return null;
  return { ta: Math.max(0, ta), tb: Math.max(0, tb), angle_deg: (Math.asin(Math.min(1, Math.abs(den))) * 180) / Math.PI };
}

/**
 * Candidate positions from crossings of legs of different nodes.
 * nodes: [{ node_id, position, azimuth_deg, uncertainty_deg }]. Never uses a negative range along a ray.
 */
export function backtraceCandidates(nodes, buildings, opts = {}) {
  const o = { ...BACKTRACE_DEFAULTS, ...opts };
  const bounds = o.bounds || mapBounds({ nodes, buildings });
  const traces = new Map();
  for (const n of nodes) {
    traces.set(n.node_id, traceBearing(n.position, n.azimuth_deg, { buildings, reflection_order: o.reflection_order, bounds }));
  }
  const sigma = (n) => Math.max(n.uncertainty_deg ?? o.fallback_uncertainty_deg, 0.1);

  // Best (shortest-path) leg of each node that passes the point within its bearing uncertainty, or null.
  const support = (p, z) => {
    const out = [];
    for (const n of nodes) {
      let best = null;
      for (const leg of traces.get(n.node_id).legs) {
        const rel = [p[0] - leg.from[0], p[1] - leg.from[1]];
        const s = dot2(rel, leg.dir);
        if (s < -1e-6 || s > leg.len + 1e-6) continue;
        const perp = Math.abs(rel[0] * leg.dir[1] - rel[1] * leg.dir[0]);
        const range = leg.path_before + Math.max(s, 0);
        if (perp > Math.tan((sigma(n) * Math.PI) / 180) * range + 1e-6) continue;
        if (!best || range < best.range) best = { node_id: n.node_id, range, reflections: leg.reflections, faces: leg.faces };
      }
      if (best) out.push(best);
    }
    return out;
  };

  const raw = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      for (const a of traces.get(nodes[i].node_id).legs) {
        for (const b of traces.get(nodes[j].node_id).legs) {
          const x = crossLegs(a, b);
          if (!x) continue;
          const p = [a.from[0] + a.dir[0] * x.ta, a.from[1] + a.dir[1] * x.ta];
          const z = nodes[i].position[2];
          if (insideBuilding([p[0], p[1], z], buildings)) continue;
          const sup = support(p, z);
          if (sup.length < 2) continue;
          const meanPath = sup.reduce((s, q) => s + q.range, 0) / sup.length;
          const angleFactor = x.angle_deg >= o.min_crossing_angle_deg ? 1 : (x.angle_deg / o.min_crossing_angle_deg) ** 2;
          const score = (sup.length * angleFactor) / (1 + meanPath / o.path_scale_m);
          raw.push({
            position: [p[0], p[1], z],
            score,
            n_nodes: sup.length,
            crossing_angle_deg: x.angle_deg,
            mean_path_m: meanPath,
            total_path_m: sup.reduce((s, q) => s + q.range, 0),
            support: sup
          });
        }
      }
    }
  }
  raw.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of raw) if (!kept.some((k) => Math.hypot(k.position[0] - c.position[0], k.position[1] - c.position[1]) < o.cluster_m)) kept.push(c);
  kept.forEach((c, i) => (c.rank = i + 1));
  return { traces: Object.fromEntries([...traces].map(([id, t]) => [id, t.legs])), candidates: kept };
}

/** Rank and distance error of the candidate nearest the true source (horizontal distance). */
export function scoreAgainstTruth(candidates, truth) {
  let best = null;
  for (const c of candidates) {
    const d = Math.hypot(c.position[0] - truth[0], c.position[1] - truth[1]);
    if (!best || d < best.d) best = { d, rank: c.rank };
  }
  return { true_rank: best ? best.rank : null, true_error_m: best ? best.d : null, n_candidates: candidates.length };
}
