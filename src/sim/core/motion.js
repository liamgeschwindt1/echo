// Moving sources: a source's keyframes ({ t, position }, t in scenario seconds) form a path walked at linear
// interpolation between keyframes. One keyframe means a static source. Pure helpers shared by the render, the
// analysis, the heatmap and the UI.
import { distance } from './physics.js';

export const MIN_MOTION_S = 0.1;

export const isMoving = (src) => (src?.keyframes?.length ?? 0) > 1;

export const motionSpan = (src) => [src.keyframes[0].t, src.keyframes[src.keyframes.length - 1].t];

export function pathLength(src) {
  let len = 0;
  for (let i = 1; i < src.keyframes.length; i++) len += distance(src.keyframes[i - 1].position, src.keyframes[i].position);
  return len;
}

/** Mean speed along the path in m/s (0 for a static source). */
export function pathSpeed(src) {
  if (!isMoving(src)) return 0;
  const [t0, t1] = motionSpan(src);
  return t1 > t0 ? pathLength(src) / (t1 - t0) : 0;
}

/** Position at scenario time t: the first keyframe before the path starts, the last after it ends. */
export function positionAt(src, t) {
  const kf = src.keyframes;
  if (kf.length === 1 || t <= kf[0].t) return kf[0].position;
  const last = kf[kf.length - 1];
  if (t >= last.t) return last.position;
  let i = 1;
  while (kf[i].t < t) i++;
  const a = kf[i - 1];
  const b = kf[i];
  const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  return [0, 1, 2].map((k) => a.position[k] + u * (b.position[k] - a.position[k]));
}

/** Keyframes for a polyline walked at constant speed from t0 to t1. */
export function keyframesAlong(points, t0, t1) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + distance(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  return points.map((p, i) => ({ t: total > 0 ? t0 + ((t1 - t0) * cum[i]) / total : t0 + ((t1 - t0) * i) / Math.max(1, points.length - 1), position: [...p] }));
}

/** Rescales the keyframe times so the path runs from t0 to t1 (kept at least MIN_MOTION_S long). Mutates src. */
export function retime(src, t0, t1) {
  if (!isMoving(src)) return;
  const [a, b] = motionSpan(src);
  const s0 = Math.max(0, t0);
  const s1 = Math.max(s0 + MIN_MOTION_S, t1);
  for (const k of src.keyframes) k.t = b > a ? s0 + ((k.t - a) * (s1 - s0)) / (b - a) : s0;
  src.keyframes[src.keyframes.length - 1].t = s1;
}

/** Moves every keyframe time by dt (never before 0). Mutates src. */
export function shiftTimes(src, dt) {
  if (!isMoving(src)) return;
  const d = Math.max(dt, -src.keyframes[0].t);
  for (const k of src.keyframes) k.t += d;
}

/** Moves every keyframe position by (dx, dy). Mutates the existing position arrays in place. */
export function translatePath(src, dx, dy) {
  for (const k of src.keyframes) {
    k.position[0] += dx;
    k.position[1] += dy;
  }
}

export function setPathHeight(src, z) {
  for (const k of src.keyframes) k.position[2] = z;
}

/** Points along the path at most `step` metres apart (keyframes included), for placement checks. */
export function samplePath(src, step = 0.5) {
  const kf = src.keyframes;
  const out = [kf[0].position];
  for (let i = 1; i < kf.length; i++) {
    const a = kf[i - 1].position;
    const b = kf[i].position;
    const n = Math.max(1, Math.ceil(distance(a, b) / step));
    for (let j = 1; j <= n; j++) out.push([0, 1, 2].map((k) => a[k] + ((b[k] - a[k]) * j) / n));
  }
  return out;
}

/**
 * Position used where one representative point is needed (path diagnostics, back-trace truth fallback):
 * the keyframe for a static source, the position half way through the clip for a moving one.
 */
export const referencePosition = (src, clipDurationS = 0) => (isMoving(src) ? positionAt(src, src.start_s + clipDurationS / 2) : src.keyframes[0].position);

/** Position that emitted the sound reaching `receiver` at time tArrival (fixed-point on the travel time). */
export function emittedPosition(src, receiver, tArrival, c) {
  if (!isMoving(src)) return src.keyframes[0].position;
  let p = positionAt(src, tArrival);
  for (let i = 0; i < 50; i++) {
    const q = positionAt(src, tArrival - distance(p, receiver) / c);
    const moved = distance(p, q);
    p = q;
    if (moved < 1e-9) break;
  }
  return p;
}

/**
 * Knot times (scenario seconds) for rendering a moving source in crossfaded pieces. The clip spans [clipStart, clipEnd];
 * inside the part where the source moves the knots are at most `stepM` metres of travel apart (hop clamped to
 * [minHopS, maxHopS], at most maxKnots knots). Outside it the source is still, so the clip ends are the only knots.
 */
export function motionKnots(src, clipStart, clipEnd, { stepM = 0.25, minHopS = 0.01, maxHopS = 0.1, maxKnots = 300 } = {}) {
  const knots = [clipStart, clipEnd];
  if (isMoving(src) && clipEnd > clipStart) {
    const [t0, t1] = motionSpan(src);
    const a = Math.max(clipStart, t0);
    const b = Math.min(clipEnd, t1);
    if (b > a) {
      const v = pathSpeed(src);
      let hop = Math.min(maxHopS, Math.max(minHopS, v > 0 ? stepM / v : maxHopS));
      if ((b - a) / hop > maxKnots - 2) hop = (b - a) / (maxKnots - 2);
      const n = Math.max(1, Math.ceil((b - a) / hop - 1e-9));
      for (let i = 0; i <= n; i++) knots.push(a + ((b - a) * i) / n);
      for (const k of src.keyframes) if (k.t > a && k.t < b) knots.push(k.t);
    }
  }
  knots.sort((x, y) => x - y);
  return knots.filter((k, i) => i === 0 || k - knots[i - 1] > 1e-6);
}

/** Linear "hat" weight of knot j at time t; the weights of all knots sum to 1 on [knots[0], knots[last]]. */
export function hatWeight(knots, j, t) {
  const k = knots[j];
  if (t === k) return 1;
  if (t < k) {
    const prev = knots[j - 1];
    return prev === undefined || t <= prev ? 0 : (t - prev) / (k - prev);
  }
  const next = knots[j + 1];
  return next === undefined || t >= next ? 0 : (next - t) / (next - k);
}
