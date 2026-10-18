// Image-source geometry: ground plus vertical building faces. Roofs block sound but never reflect (see ROOF_STUB).
import { airAbsorptionDbPerM, distance } from './physics.js';
import { boxEdges, diffractionAngles, edgePoint, stationaryU, WEDGE_N } from './edges.js';
import { diffractionConstants, diffractionResponse } from './diffraction.js';

// Placeholder, not measured: one broadband energy absorption coefficient for every concrete face.
export const CONCRETE_ABSORPTION = 0.03;
export const WALL_PRESSURE_FACTOR = Math.sqrt(1 - CONCRETE_ABSORPTION);
// Safety cap only: energy pruning (settings.path_prune_db) is the main limiter for the wedge model. The legacy model keeps its cap of 64.
export const MAX_PATHS_PER_MIC = 128;
const LEGACY_MAX_PATHS = 64;
const PRUNE_FREQS_HZ = [250, 1000, 4000];

// ISO 9613-2 style single-diffraction attenuation: 3 + (C2 / lambda) * z, here C2 = 40 because the ground bounce is not added to
// diffracted paths, capped at 20 dB for one edge. Written as 3 + 20 N with N = 2 z / lambda.
export const DIFFRACTION_CAP_DB = 20;
export function diffractionLossDb(delta, f, c) {
  const n = (2 * Math.max(delta, 0) * f) / c;
  return Math.min(10 * Math.log10(3 + 20 * n), DIFFRACTION_CAP_DB);
}

function buildingEdges(b) {
  const { min, max } = buildingBox(b);
  const h = max[2];
  const edges = [['sw', min[0], min[1]], ['se', max[0], min[1]], ['ne', max[0], max[1]], ['nw', min[0], max[1]]].map(([n, x, y]) => ({ id: `${b.id}:corner-${n}`, a: [x, y, 0], b: [x, y, h] }));
  edges.push(
    { id: `${b.id}:roof-south`, a: [min[0], min[1], h], b: [max[0], min[1], h] },
    { id: `${b.id}:roof-north`, a: [min[0], max[1], h], b: [max[0], max[1], h] },
    { id: `${b.id}:roof-west`, a: [min[0], min[1], h], b: [min[0], max[1], h] },
    { id: `${b.id}:roof-east`, a: [max[0], min[1], h], b: [max[0], max[1], h] }
  );
  return edges;
}

// Point on the edge segment with the shortest source -> point -> mic length (the sum of distances is convex along the edge).
function shortestEdgePoint(src, mic, a, b) {
  const at = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
  const len = (t) => distance(src, at(t)) + distance(at(t), mic);
  let lo = 0;
  let hi = 1;
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 50; i++) {
    const m1 = hi - phi * (hi - lo);
    const m2 = lo + phi * (hi - lo);
    if (len(m1) < len(m2)) hi = m2;
    else lo = m1;
  }
  return at((lo + hi) / 2);
}

// Written into every export so nobody mistakes the placeholders for measurements.
export const simConstants = () => ({
  diffraction: diffractionConstants(),
  diffraction_legacy: { model: 'maekawa', formula: '10 log10(3 + 20 N), N = 2 delta / lambda, capped at 20 dB', c2_equivalent: 40, cap_db: DIFFRACTION_CAP_DB, placeholder: true, note: 'engineering approximation, first order only, kept for comparison and regression' },
  concrete_absorption: { value: CONCRETE_ABSORPTION, placeholder: true, note: 'one broadband energy coefficient for every concrete face, not measured' },
  wall_pressure_factor: { value: WALL_PRESSURE_FACTOR, placeholder: true },
  max_paths_per_mic: MAX_PATHS_PER_MIC,
  path_prune_db: { default: 50, note: 'a path is dropped when it is this far below the strongest path at 250 Hz, 1 kHz and 4 kHz' }
});

const EPS = 1e-9;
const SHRINK = 1e-6;

export function buildingBox(b) {
  const [cx, cy] = b.position;
  const [w, d, h] = b.size;
  return { min: [cx - w / 2, cy - d / 2, 0], max: [cx + w / 2, cy + d / 2, h] };
}

// Reflecting surfaces. Normal sign says which side the sound must be on. ROOF_STUB: add a top face here to enable roof reflections.
export function buildSurfaces(buildings = []) {
  const surfaces = [{ id: 'ground', kind: 'ground', axis: 2, offset: 0, sign: 1, bounds: null }];
  for (const b of buildings) {
    const { min, max } = buildingBox(b);
    surfaces.push(
      { id: `${b.id}:west`, kind: 'wall', axis: 0, offset: min[0], sign: -1, bounds: { 1: [min[1], max[1]], 2: [0, max[2]] } },
      { id: `${b.id}:east`, kind: 'wall', axis: 0, offset: max[0], sign: 1, bounds: { 1: [min[1], max[1]], 2: [0, max[2]] } },
      { id: `${b.id}:south`, kind: 'wall', axis: 1, offset: min[1], sign: -1, bounds: { 0: [min[0], max[0]], 2: [0, max[2]] } },
      { id: `${b.id}:north`, kind: 'wall', axis: 1, offset: max[1], sign: 1, bounds: { 0: [min[0], max[0]], 2: [0, max[2]] } }
    );
  }
  return surfaces;
}

const mirror = (p, s) => {
  const q = [...p];
  q[s.axis] = 2 * s.offset - q[s.axis];
  return q;
};

// Where the segment from a to b meets the surface plane, or null if it misses the face.
function hit(a, b, s) {
  const den = b[s.axis] - a[s.axis];
  if (Math.abs(den) < 1e-12) return null;
  const t = (s.offset - a[s.axis]) / den;
  if (t <= EPS || t >= 1 - EPS) return null;
  const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
  p[s.axis] = s.offset;
  if (s.bounds) for (const [axis, [lo, hi]] of Object.entries(s.bounds)) if (p[axis] < lo - EPS || p[axis] > hi + EPS) return null;
  return p;
}

// Slab test against the box shrunk by SHRINK so a segment that only touches a face is not blocked.
function segmentHitsBox(a, b, box) {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const lo = box.min[i] + SHRINK;
    const hi = box.max[i] - SHRINK;
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-12) {
      if (a[i] < lo || a[i] > hi) return false;
      continue;
    }
    let ta = (lo - a[i]) / d;
    let tb = (hi - a[i]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export const segmentBlocked = (a, b, boxes) => boxes.some((box) => segmentHitsBox(a, b, box));

export function insideBuilding(p, buildings = []) {
  return buildings.find((b) => {
    const { min, max } = buildingBox(b);
    return p[0] > min[0] && p[0] < max[0] && p[1] > min[1] && p[1] < max[1] && p[2] < max[2];
  });
}

export function buildingsOverlapPoint(buildingCandidate, points) {
  const { min, max } = buildingBox(buildingCandidate);
  return points.find((p) => p[0] > min[0] && p[0] < max[0] && p[1] > min[1] && p[1] < max[1] && p[2] < max[2]);
}

function* sequences(surfaces, maxOrder) {
  const walk = function* (prefix) {
    if (prefix.length) yield prefix;
    if (prefix.length === maxOrder) return;
    for (let i = 0; i < surfaces.length; i++) if (i !== prefix[prefix.length - 1]) yield* walk([...prefix, i]);
  };
  yield* walk([]);
}

const outward = (p, s) => (p[s.axis] - s.offset) * s.sign > EPS;

export const imagesFor = (src, seq) => seq.reduce((acc, s) => [...acc, mirror(acc[acc.length - 1], s)], [src]);

// Per-surface pressure gain, shared by the render, the rings and the reach map.
export const surfaceGain = (s, settings) => (s.kind === 'ground' ? settings.ground_reflectivity : WALL_PRESSURE_FACTOR);

/**
 * The single enumeration of reflection sequences used everywhere (render, rings, reach map, diagnostics).
 * Order 0 keeps the original single ground bounce; higher orders use every enabled surface.
 * Returns surface objects in reflection order.
 */
export function reflectionSequences(settings, surfaces) {
  const order = settings.reflection_order ?? 1;
  const usable = order === 0 ? (settings.ground_reflectivity > 0 ? [0] : []) : surfaces.map((_, i) => i).filter((i) => i !== 0 || settings.ground_reflectivity > 0);
  if (!usable.length) return [];
  const out = [];
  for (const seqIdx of sequences(usable, Math.max(1, order))) out.push(seqIdx.map((i) => surfaces[usable[i]]));
  return out;
}

/**
 * Reflection points for one ordered surface sequence from src to mic, or null if the specular path is
 * missing a face, comes from the wrong side, or is blocked. images = imagesFor(src, seq).
 */
export function traceReflection(src, mic, seq, images, boxes) {
  const hits = new Array(seq.length);
  let next = mic;
  for (let k = seq.length - 1; k >= 0; k--) {
    const h = hit(next, images[k + 1], seq[k]);
    if (!h) return null;
    hits[k] = h;
    next = h;
  }
  const pts = [src, ...hits, mic];
  for (let k = 0; k < seq.length; k++) if (!(outward(pts[k], seq[k]) && outward(pts[k + 2], seq[k]))) return null;
  for (let k = 0; k + 1 < pts.length; k++) if (segmentBlocked(pts[k], pts[k + 1], boxes)) return null;
  return hits;
}

/**
 * Reflection image sources for drawing wavefronts, from the same enumeration the render uses
 * (ground included when ground_reflectivity > 0, per-surface gains identical to findPaths).
 */
export function reflectionImages(src, settings, buildings) {
  const surfaces = buildSurfaces(buildings);
  const out = [];
  for (const seq of reflectionSequences(settings, surfaces)) {
    const images = imagesFor(src, seq);
    out.push({ seq, images, image: images[images.length - 1], gain: seq.reduce((g, s) => g * surfaceGain(s, settings), 1) });
  }
  return out;
}

// ---- Wedge (UTD) path search -------------------------------------------------------------------------------------------------
// Chains of at most two interactions, each an edge diffraction (E) or a single reflection (S): E, S+E, E+S, E+E.
// Per source a visibility graph is built once (source to edge, reflection image to edge, edge to edge); per receiver only the
// receiver-side legs are tested. The graph is conservative to within its sampling along each edge; every accepted path is
// then re-checked exactly, so nothing wrong is accepted, only a very narrow visible slit of an edge could be missed.

const EDGE_SAMPLES = 9;
const PAIR_SAMPLES = 5;
const edgeCache = new Map();

/** Edges of every building, cached by geometry so repeated calls (reach grid, audit) do not rebuild them. */
export function edgesFor(buildings) {
  const key = buildings.map((b) => `${b.id}|${b.position}|${b.size}`).join(';');
  let entry = edgeCache.get(key);
  if (!entry) {
    if (edgeCache.size > 16) edgeCache.clear();
    entry = { edges: buildings.flatMap((b, bi) => boxEdges(b, bi, WALL_PRESSURE_FACTOR)), adjacency: null };
    edgeCache.set(key, entry);
  }
  return entry;
}

const sampleU = (e, i, count) => ((i + 0.5) / count) * e.len;

function edgeSeenFrom(Q, e, boxes) {
  for (let i = 0; i < EDGE_SAMPLES; i++) {
    const P = edgePoint(e, sampleU(e, i, EDGE_SAMPLES));
    if (diffractionAngles(e, P, Q, Q) && !segmentBlocked(Q, P, boxes)) return true;
  }
  return false;
}

function edgeAdjacency(entry, boxes) {
  if (entry.adjacency) return entry.adjacency;
  const { edges } = entry;
  entry.adjacency = edges.map((e1) => {
    const out = [];
    edges.forEach((e2, j) => {
      if (e2 === e1) return;
      const graze = e2.building === e1.building;
      for (let a = 0; a < PAIR_SAMPLES; a++) {
        const P1 = edgePoint(e1, sampleU(e1, a, PAIR_SAMPLES));
        for (let b = 0; b < PAIR_SAMPLES; b++) {
          const P2 = edgePoint(e2, sampleU(e2, b, PAIR_SAMPLES));
          if (diffractionAngles(e1, P1, P2, P2, graze) && diffractionAngles(e2, P2, P1, P1, graze) && !segmentBlocked(P1, P2, boxes)) {
            out.push(j);
            return;
          }
        }
      }
    });
    return out;
  });
  return entry.adjacency;
}

// Single-reflection sequences usable in a two-interaction chain (the ground only when reflection_order is 0).
const singleSequences = (settings, surfaces) => reflectionSequences(settings, surfaces).filter((q) => q.length === 1).map((q) => q[0]);

/**
 * Everything about one source that does not depend on the receiver: which edges it sees, which edges its single-reflection
 * images see through the reflecting face, and the (cached) edge to edge adjacency.
 */
export function buildSourceGraph(src, { settings, buildings = [], surfaces }) {
  const surf = surfaces || buildSurfaces(buildings);
  const boxes = buildings.map(buildingBox);
  const entry = edgesFor(buildings);
  const { edges } = entry;
  const singles = singleSequences(settings, surf);
  const seen = [];
  edges.forEach((e, i) => {
    if (edgeSeenFrom(src, e, boxes)) seen.push(i);
  });
  // Reflect then diffract: the reflection point must lie on the finite face and both legs before the edge must be clear.
  const reflectEdge = [];
  singles.forEach((S, si) => {
    if (!outward(src, S)) return;
    const image = mirror(src, S);
    edges.forEach((e, i) => {
      for (let k = 0; k < EDGE_SAMPLES; k++) {
        const P = edgePoint(e, sampleU(e, k, EDGE_SAMPLES));
        if (!outward(P, S) || !diffractionAngles(e, P, image, image)) continue;
        const H = hit(P, image, S);
        if (H && !segmentBlocked(src, H, boxes) && !segmentBlocked(H, P, boxes)) {
          reflectEdge.push({ si, ei: i });
          return;
        }
      }
    });
  });
  return { src, entry, edges, boxes, singles, seen, reflectEdge, adjacency: edgeAdjacency(entry, boxes), images: singles.map((S) => mirror(src, S)) };
}

const finite = (e, u) => u > -1e-9 && u < e.len + 1e-9;

// One edge between effective source Q and effective receiver R. Returns { P, ang } or { reason }.
function edgeHop(e, Q, R) {
  const u = stationaryU(e, Q, R);
  if (u === null) return { reason: 'blocked' };
  if (!finite(e, u)) return { reason: 'off_face' };
  const P = edgePoint(e, Math.min(Math.max(u, 0), e.len));
  const ang = diffractionAngles(e, P, Q, R);
  return ang ? { P, ang } : { reason: 'blocked' };
}

const termOf = (e, ang, L) => ({ edge: e.id, n: WEDGE_N, beta: ang.beta, phi: ang.phi, phiP: ang.phiP, L, R0: e.r0, Rn: e.rn, scale: ang.scale });
const sin2 = (b) => Math.sin(b) ** 2;

function wedgePath(chain, surfaces, hits, length, gain, terms, spread, mic) {
  return {
    type: 'diffracted',
    surfaces,
    length,
    gain: gain * spread * length,
    image: hits[hits.length - 1],
    hits,
    diffraction: { model: 'wedge', chain, terms, spread },
    direct_distance: distance(hits[0], mic)
  };
}

// Shortest src -> E1 -> E2 -> mic path, by alternating the closed-form single-edge minimiser (the length is convex in (u1, u2)).
function twoEdgeHops(e1, e2, src, mic) {
  let u1 = e1.len / 2;
  let u2 = e2.len / 2;
  for (let it = 0; it < 80; it++) {
    const P2 = edgePoint(e2, u2);
    const n1 = stationaryU(e1, src, P2);
    if (n1 === null) return { reason: 'blocked' };
    const nu1 = Math.min(Math.max(n1, 0), e1.len);
    const P1 = edgePoint(e1, nu1);
    const n2 = stationaryU(e2, P1, mic);
    if (n2 === null) return { reason: 'blocked' };
    const nu2 = Math.min(Math.max(n2, 0), e2.len);
    const moved = Math.abs(nu1 - u1) + Math.abs(nu2 - u2);
    u1 = nu1;
    u2 = nu2;
    if (moved < 1e-10) break;
  }
  const P1 = edgePoint(e1, u1);
  const P2 = edgePoint(e2, u2);
  // A clamped optimum is a corner path, not a Keller ray.
  const w1 = stationaryU(e1, src, P2);
  const w2 = stationaryU(e2, P1, mic);
  if (!finite(e1, w1) || !finite(e2, w2) || Math.abs(w1 - u1) > 1e-6 || Math.abs(w2 - u2) > 1e-6) return { reason: 'off_face' };
  const graze = e1.building === e2.building;
  const a1 = diffractionAngles(e1, P1, src, P2, graze);
  const a2 = diffractionAngles(e2, P2, P1, mic, graze);
  return a1 && a2 ? { P1, P2, a1, a2 } : { reason: 'blocked' };
}

function wedgeCandidates(src, mic, { graph, surfaces, settings }, out, dropped) {
  const { edges, boxes, singles, seen, reflectEdge, adjacency, images } = graph;
  const drop = (surf, reason) => dropped.push({ type: 'diffracted', surfaces: surf, reason });
  const order = settings.diffraction_order ?? 0;
  let evaluated = 0;
  // E
  for (const ei of seen) {
    const e = edges[ei];
    evaluated++;
    const hop = edgeHop(e, src, mic);
    if (hop.reason) {
      drop([e.id], hop.reason);
      continue;
    }
    const { P, ang } = hop;
    if (segmentBlocked(src, P, boxes) || segmentBlocked(P, mic, boxes)) {
      drop([e.id], 'blocked');
      continue;
    }
    const { sIn, sOut } = ang;
    out.push(wedgePath('E', [e.id], [P], sIn + sOut, 1, [termOf(e, ang, ((sIn * sOut) / (sIn + sOut)) * sin2(ang.beta))], 1 / Math.sqrt(sIn * sOut * (sIn + sOut)), mic));
  }
  if (order < 2) return evaluated;
  // S + E: reflect off the face, then diffract.
  for (const { si, ei } of reflectEdge) {
    const S = singles[si];
    const e = edges[ei];
    evaluated++;
    const image = images[si];
    const hop = edgeHop(e, image, mic);
    if (hop.reason) {
      drop([S.id, e.id], hop.reason);
      continue;
    }
    const { P, ang } = hop;
    const H = outward(P, S) ? hit(P, image, S) : null;
    if (!H) {
      drop([S.id, e.id], 'off_face');
      continue;
    }
    if (segmentBlocked(src, H, boxes) || segmentBlocked(H, P, boxes) || segmentBlocked(P, mic, boxes)) {
      drop([S.id, e.id], 'blocked');
      continue;
    }
    const { sIn, sOut } = ang;
    out.push(wedgePath('SE', [S.id, e.id], [H, P], sIn + sOut, surfaceGain(S, settings), [termOf(e, ang, ((sIn * sOut) / (sIn + sOut)) * sin2(ang.beta))], 1 / Math.sqrt(sIn * sOut * (sIn + sOut)), mic));
  }
  // E + S: diffract, then reflect off the face towards the receiver (receiver image).
  for (const ei of seen) {
    const e = edges[ei];
    for (const S of singles) {
      if (!outward(mic, S)) continue;
      evaluated++;
      const mImage = mirror(mic, S);
      const hop = edgeHop(e, src, mImage);
      if (hop.reason) {
        drop([e.id, S.id], hop.reason);
        continue;
      }
      const { P, ang } = hop;
      const H = outward(P, S) ? hit(P, mImage, S) : null;
      if (!H) {
        drop([e.id, S.id], 'off_face');
        continue;
      }
      if (segmentBlocked(src, P, boxes) || segmentBlocked(P, H, boxes) || segmentBlocked(H, mic, boxes)) {
        drop([e.id, S.id], 'blocked');
        continue;
      }
      const { sIn, sOut } = ang;
      out.push(wedgePath('ES', [e.id, S.id], [P, H], sIn + sOut, surfaceGain(S, settings), [termOf(e, ang, ((sIn * sOut) / (sIn + sOut)) * sin2(ang.beta))], 1 / Math.sqrt(sIn * sOut * (sIn + sOut)), mic));
    }
  }
  // E + E, on different buildings or round the same one (the connecting leg then runs along a shared face).
  for (const i1 of seen) {
    const e1 = edges[i1];
    for (const i2 of adjacency[i1]) {
      const e2 = edges[i2];
      evaluated++;
      const hop = twoEdgeHops(e1, e2, src, mic);
      if (hop.reason) {
        drop([e1.id, e2.id], hop.reason);
        continue;
      }
      const { P1, P2, a1, a2 } = hop;
      if (segmentBlocked(src, P1, boxes) || segmentBlocked(P1, P2, boxes) || segmentBlocked(P2, mic, boxes)) {
        drop([e1.id, e2.id], 'blocked');
        continue;
      }
      const s0 = a1.sIn;
      const s1 = a1.sOut;
      const s2 = a2.sOut;
      const len = s0 + s1 + s2;
      const terms = [termOf(e1, a1, ((s0 * s1) / (s0 + s1)) * sin2(a1.beta)), termOf(e2, a2, (((s0 + s1) * s2) / len) * sin2(a2.beta))];
      out.push(wedgePath('EE', [e1.id, e2.id], [P1, P2], len, 1, terms, 1 / Math.sqrt(s0 * s1 * s2 * len), mic));
    }
  }
  return evaluated;
}

// Number of chains the order allows, so chains the visibility graph never evaluated can be reported as one aggregated drop.
const chainSpace = (graph, order) => {
  const nE = graph.edges.length;
  const nS = graph.singles.length;
  return nE + (order >= 2 ? 2 * nS * nE + nE * Math.max(0, nE - 1) : 0);
};

/** Pressure amplitude of a path at frequency f without air absorption: spreading, bounce gains and the diffraction coefficient. */
export function pathPressure(path, f, c) {
  const g0 = path.gain / Math.max(path.length, 1);
  if (path.diffraction) {
    const [re, im] = diffractionResponse(path.diffraction, f, c);
    return g0 * Math.hypot(re, im);
  }
  if (path.type === 'diffracted') return g0 * 10 ** (-diffractionLossDb(path.length - path.direct_distance, f, c) / 20);
  return g0;
}

// Drop every path that is more than settings.path_prune_db below the strongest path at each of 250 Hz, 1 kHz and 4 kHz.
function prunePaths(paths, dropped, settings, c) {
  if (paths.length < 2) return paths;
  const air = PRUNE_FREQS_HZ.map((f) => (settings.air_absorption ? airAbsorptionDbPerM(f, settings.temperature_c, settings.humidity_pct, settings.pressure_kpa) : 0));
  const level = paths.map((p) => PRUNE_FREQS_HZ.map((f, k) => pathPressure(p, f, c) * 10 ** (-(air[k] * p.length) / 20)));
  const best = PRUNE_FREQS_HZ.map((_, k) => Math.max(...level.map((l) => l[k])));
  const ratio = 10 ** (-(settings.path_prune_db ?? 50) / 20);
  return paths.filter((p, i) => {
    const weak = level[i].every((v, k) => v < best[k] * ratio);
    if (weak) dropped.push({ type: p.type, surfaces: p.surfaces, reason: 'pruned' });
    return !weak;
  });
}

/**
 * All valid paths from a source to one point (a mic, or the array centre).
 * Returns { paths, directBlocked, capped, dropped }. Each path: type, surfaces, length (m), gain (spreading excluded),
 * image (final image source), hits (reflection points).
 * dropped lists every candidate path that was rejected, with the reason:
 * 'off_face' (specular point misses the finite face or comes from the wrong side), 'blocked' (a leg hits a building),
 * 'path_cap' (valid but over MAX_PATHS_PER_MIC). Nothing is dropped silently.
 */
export function findPaths(src, mic, { settings, buildings = [], surfaces, c, imagesCache, graph }) {
  const surf = surfaces || buildSurfaces(buildings);
  const boxes = buildings.map(buildingBox);
  const paths = [];
  const dropped = [];
  const directBlocked = segmentBlocked(src, mic, boxes);
  const order = settings.diffraction_order ?? 0;
  const wedge = settings.diffraction_model === 'wedge';
  const wedgeOn = wedge && order >= 1;
  // With wedge diffraction on, a blocked direct path is replaced by the diffracted field (smooth through the shadow boundary).
  if (!directBlocked || (!wedgeOn && !settings.block_direct_behind_buildings)) {
    paths.push({ type: 'direct', surfaces: [], length: distance(src, mic), gain: 1, image: src, hits: [] });
  } else {
    dropped.push({ type: 'direct', surfaces: [], reason: 'blocked' });
  }
  for (const seq of reflectionSequences(settings, surf)) {
    const names = seq.map((s) => s.id);
    // Image chains depend only on the source and the sequence; callers with many receivers (reach map) cache them.
    const key = names.join('+');
    let images = imagesCache?.get(key);
    if (!images) {
      images = imagesFor(src, seq);
      imagesCache?.set(key, images);
    }
    const type = seq.some((s) => s.kind === 'wall') ? 'wall' : 'ground';
    const hits = traceReflection(src, mic, seq, images, boxes);
    if (!hits) {
      // Distinguish "no specular point on the finite face / wrong side" from "a leg is blocked" for the audit.
      let next = mic;
      let onFace = true;
      const hs = new Array(seq.length);
      for (let k = seq.length - 1; k >= 0 && onFace; k--) {
        const h = hit(next, images[k + 1], seq[k]);
        if (!h) onFace = false;
        else {
          hs[k] = h;
          next = h;
        }
      }
      if (onFace) {
        const pts = [src, ...hs, mic];
        for (let k = 0; k < seq.length && onFace; k++) onFace = outward(pts[k], seq[k]) && outward(pts[k + 2], seq[k]);
      }
      dropped.push({ type, surfaces: names, reason: onFace ? 'blocked' : 'off_face' });
      continue;
    }
    paths.push({
      type,
      surfaces: names,
      length: distance(images[images.length - 1], mic),
      gain: seq.reduce((g, s) => g * surfaceGain(s, settings), 1),
      image: images[images.length - 1],
      hits
    });
  }
  const direct = paths.filter((p) => p.type === 'direct');
  if (wedgeOn) {
    const g = graph || buildSourceGraph(src, { settings, buildings, surfaces: surf });
    const evaluated = wedgeCandidates(src, mic, { graph: g, surfaces: surf, settings }, paths, dropped);
    const unseen = chainSpace(g, order) - evaluated;
    if (unseen > 0) dropped.push({ type: 'diffracted', surfaces: [], reason: 'blocked', count: unseen, note: 'not visible from the source (visibility graph)' });
  } else if (directBlocked && order >= 1) {
    // Legacy model: first-order diffraction over building edges, only when the direct path is blocked.
    const straight = distance(src, mic);
    for (const [bi, b] of buildings.entries()) {
      // Legs are checked against the other buildings only: the diffracting building is treated as a screen at that edge.
      const others = boxes.filter((_, i) => i !== bi);
      for (const edge of buildingEdges(b)) {
        const e = shortestEdgePoint(src, mic, edge.a, edge.b);
        if (segmentBlocked(src, e, others) || segmentBlocked(e, mic, others)) {
          dropped.push({ type: 'diffracted', surfaces: [edge.id], reason: 'blocked' });
          continue;
        }
        const length = distance(src, e) + distance(e, mic);
        paths.push({ type: 'diffracted', surfaces: [edge.id], length, gain: 1, image: e, hits: [e], direct_distance: straight });
      }
    }
  }
  const cap = wedge ? MAX_PATHS_PER_MIC : LEGACY_MAX_PATHS;
  const pruned = wedge ? prunePaths(paths, dropped, settings, c) : paths;
  const rest = pruned.filter((p) => p.type !== 'direct').sort((a, b) => a.length - b.length);
  const capped = rest.length + direct.length > cap;
  let keptRest = rest;
  if (capped) {
    // Over the safety cap: keep the strongest at 1 kHz (the legacy model keeps the shortest).
    const strength = (p) => (wedge ? pathPressure(p, 1000, c) : -p.length);
    keptRest = [...rest].sort((a, b) => strength(b) - strength(a)).slice(0, cap - direct.length);
    const keep = new Set(keptRest);
    for (const p of rest) if (!keep.has(p)) dropped.push({ type: p.type, surfaces: p.surfaces, reason: 'path_cap' });
    keptRest = rest.filter((p) => keep.has(p));
  }
  const kept = [...pruned.filter((p) => p.type === 'direct'), ...keptRest];
  return { paths: kept.map((p) => ({ ...p, delay_s: p.length / c })), directBlocked, capped, dropped };
}

/** Path tables for every node: per mic and for the array centre, per source. Includes each entry's dropped list. */
export function computePathTable(scenario, micPositionsOf, c) {
  const { settings } = scenario;
  const buildings = scenario.buildings || [];
  const surfaces = buildSurfaces(buildings);
  const wedgeOn = settings.diffraction_model === 'wedge' && (settings.diffraction_order ?? 0) >= 1;
  // One visibility graph per source, shared by every node and microphone.
  const graphs = wedgeOn ? scenario.sources.map((s) => buildSourceGraph(s.keyframes[0].position, { settings, buildings, surfaces })) : [];
  const optsFor = (si) => ({ settings, buildings, surfaces, c, graph: graphs[si] });
  let capped = false;
  const table = scenario.nodes.map((node) => {
    const mics = micPositionsOf(node);
    const perMic = mics.map((mp) =>
      scenario.sources.map((s, si) => {
        const r = findPaths(s.keyframes[0].position, mp, optsFor(si));
        capped ||= r.capped;
        return r;
      })
    );
    const centre = scenario.sources.map((s, si) => {
      const r = findPaths(s.keyframes[0].position, node.position, optsFor(si));
      capped ||= r.capped;
      return r;
    });
    return { perMic, centre };
  });
  if (capped) console.warn(`path cap reached; some weak reflections were dropped (see the dropped lists / audit)`);
  return table;
}
