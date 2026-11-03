import { buildingBox, buildingPolygon, buildSurfaces, insideBuilding, segmentBlocked } from './geometry.js';

// Back-tracing of bearings through building faces. Horizontal plane only: every ray stays at the node's height,
// so a face is hit only when that height is inside the face's height range.
export const BACKTRACE_DEFAULTS = Object.freeze({
  reflection_order: 2,
  min_crossing_angle_deg: 20,
  cluster_m: 1,
  path_scale_m: 100,
  fallback_uncertainty_deg: 5,
  min_tolerance_deg: 3,
  edge_margin_m: 100,
  // Diffraction-aware hypotheses (P7): a node whose bearing points at a building corner may hear the source round it.
  edges: true,
  edge_fan_step_deg: 5,
  edge_support_weight: 0.7 // placeholder: an edge support counts this much of a direct or reflected one in the score
});

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** Convex vertical corners of the buildings taller than z: [{ id, p: [x, y], h }]. Boxes have four; outlines their convex vertices. */
export function buildingCorners(buildings, z) {
  const out = [];
  for (const b of buildings) {
    const { min, max } = buildingBox(b);
    if (max[2] <= z) continue;
    const poly = buildingPolygon(b);
    if (poly) {
      // Simplified rings are counter-clockwise: a left turn at a vertex is a convex corner.
      poly.forEach((v, i) => {
        const a = poly[(i + poly.length - 1) % poly.length];
        const c = poly[(i + 1) % poly.length];
        if ((v[0] - a[0]) * (c[1] - v[1]) - (v[1] - a[1]) * (c[0] - v[0]) > 1e-9) out.push({ id: `${b.id}:corner-${i}`, p: [v[0], v[1]], h: max[2] });
      });
      continue;
    }
    [[min[0], min[1], 'sw'], [max[0], min[1], 'se'], [max[0], max[1], 'ne'], [min[0], max[1], 'nw']].forEach(([x, y, k]) => out.push({ id: `${b.id}:${k}`, p: [x, y], h: max[2] }));
  }
  return out;
}

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

// Distance along a 2D unit direction to the first wall face that is hit from outside, inside its extent and height range.
function firstHit(pos, dir, z, walls) {
  let best = null;
  for (const s of walls) {
    if (s.axis !== undefined) {
      if (dir[s.axis] * s.sign >= -1e-12) continue;
      const t = (s.offset - pos[s.axis]) / dir[s.axis];
      if (t <= EPS) continue;
      const other = 1 - s.axis;
      const o = pos[other] + t * dir[other];
      const [lo, hi] = s.bounds[other];
      if (o < lo - 1e-9 || o > hi + 1e-9 || z < s.bounds[2][0] || z > s.bounds[2][1]) continue;
      if (!best || t < best.t) best = { t, surface: s };
      continue;
    }
    const dn = dot2(dir, s.normal);
    if (dn >= -1e-12) continue;
    const t = (s.offset - dot2(pos, s.normal)) / dn;
    if (t <= EPS) continue;
    const u = (pos[0] + t * dir[0] - s.a[0]) * s.dir[0] + (pos[1] + t * dir[1] - s.a[1]) * s.dir[1];
    if (u < -1e-9 || u > s.len + 1e-9 || z < 0 || z > s.h) continue;
    if (!best || t < best.t) best = { t, surface: s };
  }
  return best;
}

// Specular reflection of a 2D direction off a vertical wall.
function reflect2(dir, s) {
  if (s.axis !== undefined) {
    const next = [...dir];
    next[s.axis] = -next[s.axis];
    return next;
  }
  const k = 2 * dot2(dir, s.normal);
  return [dir[0] - k * s.normal[0], dir[1] - k * s.normal[1]];
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
      const next = reflect2(dir, h.surface);
      walk(to, next, reflections + 1, pathBefore + len, [...faces, h.surface.id]);
    }
  };
  walk([origin[0], origin[1]], [Math.cos(az), Math.sin(az)], 0, 0, []);
  return { legs };
}

/**
 * Edge (diffraction) hypotheses for one node: corners within its bearing tolerance that it can see, each fanning legs
 * into the directions the corner itself can see. A leg: { from, to, dir, len, path_before, reflections: 0, kind: 'edge',
 * faces: [corner id], ends_at, corner }.
 */
export function edgeLegs(origin, azimuthDeg, toleranceDeg, { buildings, bounds, walls, boxes, stepDeg = BACKTRACE_DEFAULTS.edge_fan_step_deg }) {
  const z = origin[2];
  const legs = [];
  const corners = buildingCorners(buildings, z);
  const fan = (c, pathBefore, faces) => {
    for (let a = 0; a < 360; a += stepDeg) {
      const dir = [Math.cos(toRad(a)), Math.sin(toRad(a))];
      // The leg must start into open air (not into the corner's own building).
      const probe = [c.p[0] + dir[0] * 0.05, c.p[1] + dir[1] * 0.05, z];
      if (insideBuilding(probe, buildings)) continue;
      const h = firstHit(c.p, dir, z, walls);
      const tEdge = edgeDistance(c.p, dir, bounds);
      const len = h && h.t > 1e-3 && h.t < tEdge ? h.t : tEdge;
      if (!(len > EPS)) continue;
      legs.push({ from: [...c.p], to: [c.p[0] + dir[0] * len, c.p[1] + dir[1] * len], dir, len, path_before: pathBefore, reflections: 0, kind: 'edge', faces, ends_at: h && h.t < tEdge ? h.surface.id : 'edge', corner: c.p });
    }
  };
  for (const c of corners) {
    const toC = [c.p[0] - origin[0], c.p[1] - origin[1]];
    const dC = Math.hypot(...toC);
    if (dC < 1e-6 || angDiff(toDeg(Math.atan2(toC[1], toC[0])), azimuthDeg) > toleranceDeg + toDeg(Math.atan2(1, dC))) continue;
    if (segmentBlocked([origin[0], origin[1], z], [c.p[0], c.p[1], z], boxes)) continue;
    fan(c, dC, [c.id]);
    // Order 2: on to another corner of the same building that this corner sees along a face (thick walls, as the
    // render's edge-to-edge chains).
    const bid = c.id.slice(0, c.id.lastIndexOf(':'));
    for (const c2 of corners) {
      if (c2 === c || c2.id.slice(0, c2.id.lastIndexOf(':')) !== bid) continue;
      if (segmentBlocked([c.p[0], c.p[1], z], [c2.p[0], c2.p[1], z], boxes)) continue;
      fan(c2, dC + Math.hypot(c2.p[0] - c.p[0], c2.p[1] - c.p[1]), [c.id, c2.id]);
    }
  }
  return legs;
}

/**
 * Roof (diffraction) hypothesis: where the node's own ray (reflections 0) meets a building taller than the node, the
 * sound may have come over the roof along the same azimuth. The leg continues from where the ray leaves the footprint.
 */
export function roofLegs(origin, legs, { buildings, bounds, walls }) {
  const z = origin[2];
  const out = [];
  for (const leg of legs) {
    if (leg.reflections !== 0 || leg.ends_at === 'edge') continue;
    const bid = leg.ends_at.split(':')[0];
    let t = 0.05;
    const at = (u) => [leg.to[0] + leg.dir[0] * u, leg.to[1] + leg.dir[1] * u, z];
    while (t < 500 && insideBuilding(at(t), buildings)) t += 0.25;
    if (t >= 500) continue;
    const from = at(t);
    const h = firstHit(from, leg.dir, z, walls);
    const tEdge = edgeDistance(from, leg.dir, bounds);
    const len = h && h.t < tEdge ? h.t : tEdge;
    if (!(len > EPS)) continue;
    out.push({ from: [from[0], from[1]], to: [from[0] + leg.dir[0] * len, from[1] + leg.dir[1] * len], dir: [...leg.dir], len, path_before: leg.len + t, reflections: 0, kind: 'edge', roof: true, faces: [`${bid}:roof`], ends_at: h && h.t < tEdge ? h.surface.id : 'edge' });
  }
  return out;
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
  const sigma = (n) => Math.max(n.uncertainty_deg ?? o.fallback_uncertainty_deg, o.min_tolerance_deg);
  const walls = buildSurfaces(buildings).filter((x) => x.kind === 'wall');
  const boxes = buildings.map(buildingBox);
  const edges = new Map(nodes.map((n) => [n.node_id, o.edges ? [...edgeLegs(n.position, n.azimuth_deg, sigma(n), { buildings, bounds, walls, boxes, stepDeg: o.edge_fan_step_deg }), ...roofLegs(n.position, traces.get(n.node_id).legs, { buildings, bounds, walls })] : []]));
  const legsOf = (id) => [...traces.get(id).legs, ...edges.get(id)];

  // Best (shortest-path) leg of each node that passes the point within its bearing uncertainty, or null.
  const support = (p, z) => {
    const out = [];
    for (const n of nodes) {
      let best = null;
      for (const leg of [...traces.get(n.node_id).legs, ...edges.get(n.node_id).filter((l) => l.roof)]) {
        const rel = [p[0] - leg.from[0], p[1] - leg.from[1]];
        const s = dot2(rel, leg.dir);
        if (s < -1e-6 || s > leg.len + 1e-6) continue;
        const perp = Math.abs(rel[0] * leg.dir[1] - rel[1] * leg.dir[0]);
        const range = leg.path_before + Math.max(s, 0);
        if (perp > Math.tan((sigma(n) * Math.PI) / 180) * range + 1e-6) continue;
        const hyp = leg.roof ? 'edge' : leg.reflections ? 'reflection' : 'direct';
        // Prefer direct and reflection hypotheses over a roof one; among equals the shortest path.
        if (!best || (best.hypothesis === 'edge' && hyp !== 'edge') || ((best.hypothesis === 'edge') === (hyp === 'edge') && range < best.range)) best = { node_id: n.node_id, range, reflections: leg.reflections, faces: leg.faces, hypothesis: hyp };
      }
      // Edge hypothesis: the node heard the point round a corner it points at. The point must be visible from the corner
      // and hidden from the node (otherwise the node would have heard it directly). Range = node-corner + corner-point.
      if (!best) {
        const seen = new Set();
        for (const leg of edges.get(n.node_id)) {
          if (leg.roof) continue;
          const key = leg.faces.join('>');
          if (seen.has(key)) continue;
          seen.add(key);
          const P = [p[0], p[1], z];
          const C = [leg.corner[0], leg.corner[1], z];
          if (segmentBlocked(C, P, boxes) || !segmentBlocked([n.position[0], n.position[1], z], P, boxes)) continue;
          const range = leg.path_before + Math.hypot(p[0] - C[0], p[1] - C[1]);
          if (!best || range < best.range) best = { node_id: n.node_id, range, reflections: 0, faces: leg.faces, hypothesis: 'edge' };
        }
      }
      if (best) out.push(best);
    }
    return out;
  };

  const raw = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      for (const a of legsOf(nodes[i].node_id)) {
        for (const b of legsOf(nodes[j].node_id)) {
          const x = crossLegs(a, b);
          if (!x) continue;
          const p = [a.from[0] + a.dir[0] * x.ta, a.from[1] + a.dir[1] * x.ta];
          const z = nodes[i].position[2];
          if (insideBuilding([p[0], p[1], z], buildings)) continue;
          const sup = support(p, z);
          if (sup.length < 2) continue;
          // A crossing made by a fan leg only stands for an edge hypothesis; otherwise it is a coarse copy of a real one.
          if ((a.kind === 'edge' || b.kind === 'edge') && !sup.some((q) => q.hypothesis === 'edge')) continue;
          const meanPath = sup.reduce((s, q) => s + q.range, 0) / sup.length;
          const angleFactor = x.angle_deg >= o.min_crossing_angle_deg ? 1 : (x.angle_deg / o.min_crossing_angle_deg) ** 2;
          const weight = sup.reduce((acc, q) => acc + (q.hypothesis === 'edge' ? o.edge_support_weight : 1), 0);
          const score = (weight * angleFactor) / (1 + meanPath / o.path_scale_m);
          raw.push({
            position: [p[0], p[1], z],
            score,
            n_nodes: sup.length,
            crossing_angle_deg: x.angle_deg,
            mean_path_m: meanPath,
            total_path_m: sup.reduce((s, q) => s + q.range, 0),
            hypotheses: [...new Set(sup.map((q) => q.hypothesis))],
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
  return {
    traces: Object.fromEntries([...traces].map(([id, t]) => [id, t.legs])),
    edge_hypotheses: Object.fromEntries([...edges].map(([id, legs]) => [id, [...new Set(legs.map((l) => l.faces.join('>')))]])),
    candidates: kept
  };
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
