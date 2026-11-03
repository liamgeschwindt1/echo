// Choice of the time window a node localises on (P1, P2 of the 0.4 upgrade).
// Containment: the window must lie where the source can be heard at all, i.e. its emission interval shifted by the
// propagation delays to the node. Policy: impulsive onsets get a short onset-gated window that ends before the first
// strong wall reflection where possible; sustained sounds grow the window while the bearing stays consistent.
// The trigger type comes from the level of the mixture at the reference mic, never from a classifier.
import { buildSurfaces } from './geometry.js';
import { distance } from './physics.js';
import { isMoving, positionAt } from './motion.js';
import { mixtureFrames } from './measured.js';

const toDb = (x) => 10 * Math.log10(Math.max(x, 1e-30));
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Arrival interval [t0, t1] (scenario seconds) of a source at a node: emission [start_s, start_s + duration] plus the
 * propagation delay, widened by the delay spread of the paths (pathDelays, seconds, from the reference position).
 * A moving source is sampled along its route every 50 ms. duration null: open-ended.
 */
export function arrivalSpan(src, nodePos, durationS, c, pathDelays = []) {
  const spread = pathDelays.length ? Math.max(...pathDelays) - Math.min(...pathDelays) : 0;
  const end = durationS == null ? Infinity : src.start_s + durationS;
  if (!isMoving(src)) {
    const first = pathDelays.length ? Math.min(...pathDelays) : distance(src.keyframes[0].position, nodePos) / c;
    return [src.start_s + first, end + first + spread];
  }
  const last = Number.isFinite(end) ? end : src.keyframes[src.keyframes.length - 1].t;
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = src.start_s; t <= last + 1e-9; t += 0.05) {
    const a = t + distance(positionAt(src, t), nodePos) / c;
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  return [lo, Number.isFinite(end) ? hi + spread : Infinity];
}

/** Mixture in-band frame power at mic 1 of one rendered node, cached on the node object (not exported). */
export function nodeMixtureFrames(rn, band, fs, frameS) {
  const key = `${band[0]}-${band[1]}-${frameS}`;
  rn._mixFrames ??= {};
  if (!rn._mixFrames[key]) Object.defineProperty(rn._mixFrames, key, { value: mixtureFrames(rn.mics[0], band, fs, frameS), enumerable: false });
  return rn._mixFrames[key];
}

/**
 * Trigger type at an onset time from the mixture alone: 'impulsive' when the level within riseS after t rises at least
 * riseDb above the rolling floor (median of the frames in the floorS before t, ending guardS before it), else 'sustained'.
 */
export function triggerType(frames, t, frameS, { riseDb, riseS, floorS = 1, guardS = 0.03 }) {
  const f0 = Math.max(0, Math.floor((t - floorS) / frameS));
  const f1 = Math.max(f0 + 1, Math.floor((t - guardS) / frameS));
  const floor = frames.slice(f0, Math.min(frames.length, f1)).sort((a, b) => a - b);
  const floorP = floor.length ? floor[Math.floor(floor.length / 2)] : 0;
  let peak = 0;
  for (let f = Math.max(0, Math.floor(t / frameS)); f < Math.min(frames.length, Math.ceil((t + riseS) / frameS)); f++) peak = Math.max(peak, frames[f]);
  const rise = floorP > 0 ? toDb(peak / floorP) : Infinity;
  return { type: rise >= riseDb ? 'impulsive' : 'sustained', rise_db: Number.isFinite(rise) ? rise : null };
}

/**
 * Earliest extra delay (s) of a specular wall reflection for a far source in direction u (unit, from the node), from the
 * site model only: a wall with outward normal n at distance d in front of which the node stands adds 2 d (n . u) of path
 * when the reflection point lies on the face. Searched within maxM metres. null when no wall reflects.
 */
export function reflectionGuardS(nodePos, u, buildings, c, maxM = 30) {
  let best = null;
  for (const s of buildSurfaces(buildings)) {
    if (s.kind !== 'wall') continue;
    const n = s.normal;
    const d = s.axis !== undefined ? (nodePos[s.axis] - s.offset) * s.sign : n[0] * nodePos[0] + n[1] * nodePos[1] - s.offset;
    if (!(d > 0) || d > maxM) continue;
    const nu = n[0] * u[0] + n[1] * u[1] + n[2] * u[2];
    if (!(nu > 1e-6)) continue;
    // The reflected ray leaves the node along u' = u - 2 (n . u) n and meets the wall plane after d / (n . u).
    const t = d / nu;
    const r = [0, 1, 2].map((k) => u[k] - 2 * nu * n[k]);
    const p = [0, 1, 2].map((k) => nodePos[k] + t * r[k]);
    let onFace;
    if (s.axis !== undefined) onFace = Object.entries(s.bounds).every(([axis, [lo, hi]]) => p[axis] >= lo - 1e-6 && p[axis] <= hi + 1e-6);
    else {
      const along = (p[0] - s.a[0]) * s.dir[0] + (p[1] - s.a[1]) * s.dir[1];
      onFace = along >= -1e-6 && along <= s.len + 1e-6 && p[2] >= 0 && p[2] <= s.h;
    }
    if (!onFace) continue;
    const extra = (2 * d * nu) / c;
    if (best === null || extra < best.delay_s) best = { delay_s: extra, surface: s.id, distance_m: d };
  }
  return best;
}

/** Horizontal distance (m) from a node to the nearest wall face at the node's height, or null. */
export function nearestReflectorM(nodePos, buildings) {
  let best = null;
  for (const s of buildSurfaces(buildings)) {
    if (s.kind !== 'wall') continue;
    let d;
    if (s.axis !== undefined) {
      const other = 1 - s.axis;
      const [lo, hi] = s.bounds[other];
      if (nodePos[2] > s.bounds[2][1]) continue;
      const along = Math.max(lo - nodePos[other], 0, nodePos[other] - hi);
      d = Math.hypot(nodePos[s.axis] - s.offset, along);
    } else {
      if (nodePos[2] > s.h) continue;
      const u = Math.max(0, Math.min(s.len, (nodePos[0] - s.a[0]) * s.dir[0] + (nodePos[1] - s.a[1]) * s.dir[1]));
      d = Math.hypot(nodePos[0] - s.a[0] - u * s.dir[0], nodePos[1] - s.a[1] - u * s.dir[1]);
    }
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * Adaptive long window: bearings over windows growing from w[0] by doubling (first `firstS`). Growth stops at the first
 * step whose bearing drifts from the previous one by more than max(driftDeg, 3 * hypot(sigmas)) or whose uncertainty
 * rises by more than sigmaRise (fraction). Of the steps before that, the one with the lowest cross-mic residual wins.
 * bearingAt(w) -> bearing with uncertainty_deg and residual_s (or null); snrAt(w) -> in-window SNR dB.
 */
export function adaptiveWindow(w, { bearingAt, snrAt, minS, minSnrDb, firstS = 0.02, driftDeg, sigmaRise }) {
  const steps = [];
  const len = w[1] - w[0];
  const taus = [];
  for (let tau = Math.max(firstS, minS); tau < len - 1e-9; tau *= 2) taus.push(tau);
  taus.push(len);
  let prev = null;
  let stopped = null;
  for (const tau of taus) {
    const win = [w[0], w[0] + tau];
    const snr = snrAt(win);
    if (snr < minSnrDb) continue;
    const b = bearingAt(win);
    if (!b) continue;
    const step = { window: win, bearing: b, snr_db: snr };
    if (prev) {
      const drift = angDiff(b.azimuth_deg, prev.bearing.azimuth_deg);
      const gate = Math.max(driftDeg, 3 * Math.hypot(b.uncertainty_deg, prev.bearing.uncertainty_deg));
      if (drift > gate) stopped = 'bearing_drift';
      else if (b.uncertainty_deg > prev.bearing.uncertainty_deg * (1 + sigmaRise)) stopped = 'uncertainty_rise';
      if (stopped) {
        steps.push({ ...step, rejected: stopped });
        break;
      }
    }
    steps.push(step);
    prev = step;
  }
  const ok = steps.filter((s) => !s.rejected);
  if (!ok.length) return { chosen: null, steps, stopped };
  const chosen = ok.reduce((a, s) => (s.bearing.residual_s < a.bearing.residual_s ? s : a));
  return { chosen, steps, stopped };
}
