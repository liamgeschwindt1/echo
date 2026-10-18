// Image-source geometry: ground plus vertical building faces. Roofs block sound but never reflect (see ROOF_STUB).
import { distance } from './physics.js';

// Placeholder, not measured: one broadband energy absorption coefficient for every concrete face.
export const CONCRETE_ABSORPTION = 0.03;
export const WALL_PRESSURE_FACTOR = Math.sqrt(1 - CONCRETE_ABSORPTION);
export const MAX_PATHS_PER_MIC = 64;

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
  diffraction: { formula: '10 log10(3 + 20 N), N = 2 delta / lambda, capped at 20 dB', c2_equivalent: 40, cap_db: DIFFRACTION_CAP_DB, placeholder: true, note: 'engineering approximation, first order only' },
  concrete_absorption: { value: CONCRETE_ABSORPTION, placeholder: true, note: 'one broadband energy coefficient for every concrete face, not measured' },
  wall_pressure_factor: { value: WALL_PRESSURE_FACTOR, placeholder: true },
  max_paths_per_mic: MAX_PATHS_PER_MIC
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

/**
 * Reflection points for one ordered surface sequence from src to mic, or null if the specular path is
 * missing a face, comes from the wrong side, or is blocked. images = imagesFor(src, seq).
 */
export function traceReflection(src, mic, seq, images, boxes, onDrop = () => {}) {
  const drop = (reason) => { onDrop(reason); return null; };
  const hits = new Array(seq.length);
  let next = mic;
  for (let k = seq.length - 1; k >= 0; k--) {
    const h = hit(next, images[k + 1], seq[k]);
    if (!h) return drop('missed_face');
    hits[k] = h;
    next = h;
  }
  const pts = [src, ...hits, mic];
  for (let k = 0; k < seq.length; k++) if (!(outward(pts[k], seq[k]) && outward(pts[k + 2], seq[k]))) return drop('wrong_side');
  for (let k = 0; k + 1 < pts.length; k++) if (segmentBlocked(pts[k], pts[k + 1], boxes)) return drop('blocked_leg');
  return hits;
}

/** Candidate images for drawing; settings enables the same ground/mixed sequences as findPaths. */
export function reflectionImages(src, buildings, order, settings = null) {
  if (!settings && (order < 1 || !buildings.length)) return [];
  const surfaces = buildSurfaces(buildings).filter((s) => settings
    ? s.kind === 'ground' ? settings.ground_reflectivity > 0 : order !== 0
    : s.kind === 'wall');
  const maxOrder = settings ? Math.max(1, order) : order;
  const out = [];
  for (const idx of sequences(surfaces.map((_, i) => i), maxOrder)) {
    const seq = idx.map((i) => surfaces[i]);
    const images = imagesFor(src, seq);
    let gain = 1;
    for (const s of seq) gain *= s.kind === 'ground' ? settings.ground_reflectivity : WALL_PRESSURE_FACTOR;
    out.push({ seq, images, image: images[images.length - 1], gain });
  }
  return out;
}

/**
 * All valid paths from a source to one point (a mic, or the array centre).
 * Returns { paths, directBlocked, capped }. Each path: type, surfaces, length (m), gain (spreading excluded),
 * image (final image source), hits (reflection points).
 * candidateSurfaces selects one reflection sequence ([] selects direct only). Use only when the full
 * candidate count cannot reach MAX_PATHS_PER_MIC: this mode does not apply the global path ranking/cap.
 */
export function findPaths(src, mic, { settings, buildings = [], surfaces, c, audit = true, candidateSurfaces }) {
  const surf = surfaces || buildSurfaces(buildings);
  const boxes = buildings.map(buildingBox);
  const paths = [];
  const dropped = [];
  const drop = (type, surfaces, reason) => { if (audit) dropped.push({ type, surfaces, reason }); };
  const directBlocked = segmentBlocked(src, mic, boxes);
  const allCandidates = candidateSurfaces === undefined;
  if (allCandidates || candidateSurfaces.length === 0) {
    if (!directBlocked || !settings.block_direct_behind_buildings) {
      paths.push({ type: 'direct', surfaces: [], length: distance(src, mic), gain: 1, image: src, hits: [] });
    } else drop('direct', [], 'blocked_direct');
  }
  const order = settings.reflection_order ?? 1;
  // Order 0 keeps the original single ground bounce (controlled only by ground_reflectivity); walls are off.
  const usable = order === 0 ? (settings.ground_reflectivity > 0 ? [0] : []) : surf.map((_, i) => i).filter((i) => i !== 0 || settings.ground_reflectivity > 0);
  const maxOrder = Math.max(1, order);
  if (audit && !(settings.ground_reflectivity > 0)) drop('ground', ['ground'], 'ground_disabled');
  if (audit && order === 0) for (const s of surf.filter((s) => s.kind === 'wall')) drop('wall', [s.id], 'reflection_order_zero');
  let selected = [];
  if (!allCandidates && candidateSurfaces.length) {
    const indices = candidateSurfaces.map((id) => usable.findIndex((i) => surf[i].id === id));
    if (indices.length <= maxOrder && indices.every((i, k) => i >= 0 && (k === 0 || i !== indices[k - 1]))) selected = [indices];
    else drop('wall', candidateSurfaces, 'candidate_not_enabled');
  }
  if (usable.length) {
    for (const seqIdx of allCandidates ? sequences(usable, maxOrder) : selected) {
      const seq = seqIdx.map((i) => surf[usable[i]]);
      const images = imagesFor(src, seq);
      const hits = traceReflection(src, mic, seq, images, boxes, audit ? (reason) =>
        drop(seq.some((s) => s.kind === 'wall') ? 'wall' : 'ground', seq.map((s) => s.id), reason) : undefined);
      if (!hits) continue;
      const names = seq.map((s) => s.id);
      let gain = 1;
      for (const s of seq) gain *= s.kind === 'ground' ? settings.ground_reflectivity : WALL_PRESSURE_FACTOR;
      paths.push({
        type: seq.some((s) => s.kind === 'wall') ? 'wall' : 'ground',
        surfaces: names,
        length: distance(images[images.length - 1], mic),
        gain,
        image: images[images.length - 1],
        hits
      });
    }
  }
  const direct = paths.filter((p) => p.type === 'direct');
  // First-order diffraction over building edges, only when the direct path is blocked.
  if (allCandidates && directBlocked && (settings.diffraction_order ?? 0) >= 1) {
    const straight = distance(src, mic);
    for (const [bi, b] of buildings.entries()) {
      // Legs are checked against the other buildings only: the diffracting building is treated as a screen at that edge.
      const others = boxes.filter((_, i) => i !== bi);
      for (const edge of buildingEdges(b)) {
        const e = shortestEdgePoint(src, mic, edge.a, edge.b);
        if (segmentBlocked(src, e, others) || segmentBlocked(e, mic, others)) {
          drop('diffracted', [edge.id], 'blocked_leg');
          continue;
        }
        const length = distance(src, e) + distance(e, mic);
        paths.push({ type: 'diffracted', surfaces: [edge.id], length, gain: 1, image: e, hits: [e], direct_distance: straight });
      }
    }
  } else if (allCandidates && audit) for (const b of buildings) for (const edge of buildingEdges(b))
    drop('diffracted', [edge.id], directBlocked ? 'diffraction_disabled' : 'direct_unblocked');
  const rest = paths.filter((p) => p.type !== 'direct').sort((a, b) => a.length - b.length);
  const capped = rest.length + direct.length > MAX_PATHS_PER_MIC;
  const kept = [...direct, ...rest.slice(0, MAX_PATHS_PER_MIC - direct.length)];
  if (audit) for (const p of rest.slice(MAX_PATHS_PER_MIC - direct.length)) drop(p.type, p.surfaces, 'path_cap');
  return { paths: kept.map((p) => ({ ...p, delay_s: p.length / c })), directBlocked, capped, dropped };
}

/** Path tables for every node: per mic and for the array centre, per source. */
export function computePathTable(scenario, micPositionsOf, c) {
  const { settings } = scenario;
  const buildings = scenario.buildings || [];
  const surfaces = buildSurfaces(buildings);
  const opts = { settings, buildings, surfaces, c };
  let capped = false;
  const table = scenario.nodes.map((node) => {
    const mics = micPositionsOf(node);
    const perMic = mics.map((mp) =>
      scenario.sources.map((s) => {
        const r = findPaths(s.keyframes[0].position, mp, opts);
        capped ||= r.capped;
        return r;
      })
    );
    const centre = scenario.sources.map((s) => {
      const r = findPaths(s.keyframes[0].position, node.position, opts);
      capped ||= r.capped;
      return r;
    });
    return { perMic, centre };
  });
  if (capped) console.warn(`image-source path cap (${MAX_PATHS_PER_MIC}) reached; some weak reflections were dropped`);
  return table;
}
