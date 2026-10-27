// Building edges as rigid wedges: local frames, the stationary (Fermat) point on a finite edge, and the wedge angles the UTD needs.
// Pure vector maths, no dependency on the path finder.

export const WEDGE_N = 1.5; // exterior angle 3 pi / 2 for the 90 degree corner of a box
export const WEDGE_ANGLE = WEDGE_N * Math.PI;
const TWO_PI = 2 * Math.PI;
const ANGLE_MARGIN = 1e-9;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/**
 * The eight edges of an axis-aligned box: 4 vertical corners and 4 roof edges.
 * Each edge carries the frame used for the wedge angles: tangent t, outward normal n0 of face 0, direction e0 along face 0 away
 * from the edge. phi = atan2(v.n0, v.e0), taken in the plane perpendicular to t, runs through the exterior from 0 to 3 pi / 2.
 * r0 / rn are the pressure reflection coefficients of the two faces (roofs do not reflect in this simulator).
 */
export function boxEdges(b, bi, wallR) {
  const [cx, cy] = b.position;
  const [w, d, h] = b.size;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - d / 2;
  const y1 = cy + d / 2;
  const W = [-1, 0, 0];
  const E = [1, 0, 0];
  const S = [0, -1, 0];
  const N = [0, 1, 0];
  const U = [0, 0, 1];
  const mk = (id, a, bb, na, nb, r0, rn, kind) => {
    const t = sub(bb, a);
    const len = norm(t);
    return { id, kind, a, b: bb, len, t: scale(t, 1 / len), n0: na, e0: scale(nb, -1), r0, rn, building: bi };
  };
  return [
    mk(`${b.id}:edge:SW`, [x0, y0, 0], [x0, y0, h], W, S, wallR, wallR, 'vertical'),
    mk(`${b.id}:edge:SE`, [x1, y0, 0], [x1, y0, h], S, E, wallR, wallR, 'vertical'),
    mk(`${b.id}:edge:NE`, [x1, y1, 0], [x1, y1, h], E, N, wallR, wallR, 'vertical'),
    mk(`${b.id}:edge:NW`, [x0, y1, 0], [x0, y1, h], N, W, wallR, wallR, 'vertical'),
    mk(`${b.id}:roof:south`, [x0, y0, h], [x1, y0, h], U, S, 0, wallR, 'roof'),
    mk(`${b.id}:roof:north`, [x0, y1, h], [x1, y1, h], U, N, 0, wallR, 'roof'),
    mk(`${b.id}:roof:west`, [x0, y0, h], [x0, y1, h], U, W, 0, wallR, 'roof'),
    mk(`${b.id}:roof:east`, [x1, y0, h], [x1, y1, h], U, E, 0, wallR, 'roof')
  ];
}

export const edgePoint = (e, u) => [e.a[0] + e.t[0] * u, e.a[1] + e.t[1] * u, e.a[2] + e.t[2] * u];

// Corners that turn less than this are treated as straight wall and do not diffract.
export const MIN_CORNER_TURN_DEG = 10;

/**
 * Edges of a prism with a counter-clockwise footprint: one vertical edge per convex corner, with that corner's exterior angle
 * (n = 1 + turn / pi), and one roof edge per wall (n = 3/2). Concave corners do not diffract and are skipped.
 */
export function polygonEdges(b, bi, wallR, poly) {
  const h = b.size[2];
  const U = [0, 0, 1];
  const count = poly.length;
  const unit2 = (p, q) => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
  };
  const out = [];
  poly.forEach((V, i) => {
    const d1 = unit2(poly[(i - 1 + count) % count], V);
    const d2 = unit2(V, poly[(i + 1) % count]);
    const turn = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]);
    if (turn < (MIN_CORNER_TURN_DEG * Math.PI) / 180) return;
    const n = 1 + turn / Math.PI;
    out.push({ id: `${b.id}:edge:${i}`, kind: 'vertical', a: [V[0], V[1], 0], b: [V[0], V[1], h], len: h, t: U, n0: [d1[1], -d1[0], 0], e0: [-d1[0], -d1[1], 0], r0: wallR, rn: wallR, building: bi, n, wedge: n * Math.PI });
  });
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % count];
    const d = unit2(p, q);
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    out.push({ id: `${b.id}:roof:${i}`, kind: 'roof', a: [p[0], p[1], h], b: [q[0], q[1], h], len, t: [d[0], d[1], 0], n0: U, e0: [-d[1], d[0], 0], r0: 0, rn: wallR, building: bi, n: WEDGE_N, wedge: WEDGE_ANGLE });
  });
  return out;
}

const wedgeOf = (e) => e.wedge ?? WEDGE_ANGLE;

/** Wedge angle of a direction v (leaving the edge point), in [0, 2 pi). Interior directions land above 3 pi / 2. */
export function wedgeAngle(e, v) {
  const vt = dot(v, e.t);
  const p = [v[0] - vt * e.t[0], v[1] - vt * e.t[1], v[2] - vt * e.t[2]];
  const a = Math.atan2(dot(p, e.n0), dot(p, e.e0));
  const w = a < 0 ? a + TWO_PI : a;
  return w > TWO_PI - GRAZE_TOL ? w - TWO_PI : w;
}

export const insideExterior = (phi, wedge = WEDGE_ANGLE) => phi > ANGLE_MARGIN && phi < wedge - ANGLE_MARGIN;
const GRAZE_TOL = 1e-7;
const onFace = (phi, wedge) => phi < GRAZE_TOL || phi > wedge - GRAZE_TOL;

/**
 * Parameter u along the edge of the shortest Q -> edge -> R path (equal angles with the edge), unclamped.
 * Null when Q or R lies on the edge line.
 */
export function stationaryU(e, Q, R) {
  const qa = sub(Q, e.a);
  const ra = sub(R, e.a);
  const uq = dot(qa, e.t);
  const ur = dot(ra, e.t);
  const aq = Math.sqrt(Math.max(dot(qa, qa) - uq * uq, 0));
  const ar = Math.sqrt(Math.max(dot(ra, ra) - ur * ur, 0));
  if (aq < 1e-9 || ar < 1e-9) return null;
  return (ar * uq + aq * ur) / (aq + ar);
}

/**
 * Diffraction geometry at the point P of edge e for a ray from Q to R (either may be an image):
 * { phiP, phi, beta, sIn, sOut, scale } or null when either end is not in the exterior of the wedge.
 * With graze = true a leg may run along a face of the wedge (the connecting leg of a double diffraction round the same
 * building); each such grazing end halves the coefficient (scale), the standard UTD rule for incidence on a face.
 */
export function diffractionAngles(e, P, Q, R, graze = false) {
  const vq = sub(Q, P);
  const vr = sub(R, P);
  const sIn = norm(vq);
  const sOut = norm(vr);
  if (sIn < 1e-9 || sOut < 1e-9) return null;
  const phiP = wedgeAngle(e, vq);
  const phi = wedgeAngle(e, vr);
  let scaleFactor = 1;
  const wedge = wedgeOf(e);
  for (const a of [phiP, phi]) {
    if (insideExterior(a, wedge)) continue;
    if (!graze || a < -GRAZE_TOL || a > wedge + GRAZE_TOL || !onFace(a, wedge)) return null;
    scaleFactor *= 0.5;
  }
  const c = dot(vq, e.t) / sIn;
  const beta = Math.acos(Math.max(-1, Math.min(1, c)));
  if (Math.sin(beta) < 1e-6) return null;
  return { phiP, phi, beta, sIn, sOut, scale: scaleFactor };
}

