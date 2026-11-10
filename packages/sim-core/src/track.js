// Rolling track of fixes over time (P6 of the 0.4 upgrade, plus the P5 observation gate).
// Every step is one emission time tE. Each node is read at the time that sound reaches it, tE + |p - node| / c, with p
// the current position estimate, so all rays in a fix describe the same moment; p is refined and the windows re-aligned
// track_iterations times. Fixes go through the robust solver and then a constant-velocity alpha-beta filter.
import { distance } from './physics.js';
import { estimateBearing } from './localise.js';
import { windowReflectionEvidence } from './pathreport.js';
import { azimuthUncertaintyDeg, multipathSigmaDeg, overlapSigmaDeg, reflectorSigmaDeg } from './uncertainty.js';
import { robustFix } from './fix.js';
import { emittedPosition, isMoving, positionAt } from './motion.js';

const toDeg = (r) => (r * 180) / Math.PI;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const azFrom = (o, p) => toDeg(Math.atan2(p[1] - o[1], p[0] - o[0]));
const hasTrustedAerialElevation = (bearing) => !bearing.elevation_sign_assumed && bearing.elevation_confidence === 'ok' && bearing.elevation_deg > 0;

/**
 * ctx: { scenario, rendered, si, settings, c, fs, lengthS, windowS, intervalS, activeWindows (per node [t0,t1] or null),
 *        perNode (long-window node results), longFix (position or null), durationS, reflectorM (per node),
 *        meanPower(frames, t0, t1), toDb(p, noise) }.
 */
export function commonTimeTrack(ctx) {
  const { scenario, rendered, si, settings, c, fs, windowS: W, intervalS, activeWindows, perNode, longFix, reflectorM } = ctx;
  const src = scenario.sources[si];
  const moving = isMoving(src);
  const nodes = scenario.nodes;
  const observations = [];
  const fixes = [];
  let rejected = 0;
  let dominatedCount = 0;
  if (!activeWindows.some(Boolean)) return { window_s: W, interval_s: intervalS, alignment: 'common_emission_time', observations, fixes, rejected_count: 0 };

  const cache = new Map();
  const bearingAt = (ni, a) => {
    const key = `${ni}:${a}`;
    if (!cache.has(key)) {
      const rn = rendered.nodes[ni];
      const b = estimateBearing({ mics: rn.mics, positions: rn.mic_positions, startSample: a, endSample: Math.min(rendered.length, a + Math.round(W * fs)), fs, c, band: settings.localisation_band_hz });
      cache.set(key, b);
    }
    return cache.get(key);
  };

  // Emission times: the clip's span, or (duration unknown) the span the nodes heard it, minus the shortest delay.
  const nearest = Math.min(...nodes.map((n) => distance(positionAt(src, src.start_s), n.position) / c));
  const tEnd = ctx.durationS != null ? src.start_s + ctx.durationS : Math.max(...activeWindows.map((w) => w?.[1] ?? -Infinity)) - nearest;
  const centroid = [0, 1].map((k) => nodes.reduce((a, n) => a + n.position[k], 0) / nodes.length);
  let state = null; // { x: [x, y], v: [vx, vy], t, n (fixes so far) }
  const recentBearing = new Map();

  for (let tE = src.start_s; tE + W <= tEnd + 1e-9; tE += intervalS) {
    const pred = state ? [state.x[0] + state.v[0] * (tE - state.t), state.x[1] + state.v[1] * (tE - state.t)] : null;
    let p = pred ? [...pred, settings.source_height_prior_m] : longFix ? [...longFix] : [...centroid, settings.source_height_prior_m];
    let fix = null;
    let atTime = [];
    let gated = 0;
    let dominated = 0;
    for (let it = 0; it < Math.max(1, settings.track_iterations); it++) {
      atTime = [];
      gated = 0;
      dominated = 0;
      for (let ni = 0; ni < nodes.length; ni++) {
        const act = activeWindows[ni];
        if (!act) continue;
        const node = nodes[ni];
        const tA = tE + distance(p, node.position) / c;
        const win = [tA, tA + W];
        if (win[0] < act[0] - 1e-9 || win[1] > act[1] + 1e-9) continue;
        const actN = rendered.activity[ni];
        const own = actN.per_source[si];
        const snrDb = ctx.toDb(ctx.meanPower(own.all, win[0], win[1]), actN.noise_band_power);
        if (snrDb < settings.min_snr_db) continue;
        const a = Math.max(0, Math.round(win[0] * fs));
        const bearing = bearingAt(ni, a);
        if (!bearing) continue;
        const rn = rendered.nodes[ni];
        const noise = azimuthUncertaintyDeg({ snrDb, windowS: W, band: settings.localisation_band_hz, positions: rn.mic_positions, azimuthDeg: bearing.azimuth_deg, elevationDeg: bearing.elevation_deg, c, fs });
        const nr = perNode[ni];
        const reflection = windowReflectionEvidence(nr.paths, W);
        const multipath = multipathSigmaDeg({ directToReflectedDb: reflection.direct_to_reflected_db, reflectionGapS: reflection.reflection_gap_s, windowS: W, settings });
        // Other sources active in this window: overlap term from their level relative to this one.
        let theirs = 0;
        for (let oi = 0; oi < scenario.sources.length; oi++) if (oi !== si) theirs += ctx.meanPower(actN.per_source[oi].all, win[0], win[1]);
        const mine = ctx.meanPower(own.all, win[0], win[1]);
        const levelDiff = theirs > 0 ? 10 * Math.log10(Math.max(theirs, 1e-30) / Math.max(mine, 1e-30)) : null;
        // Simulator-only gate kept from 0.3 (which dropped every overlapped window): skip a window another source dominates.
        // It reads the per-source levels the simulator knows; a real node cannot.
        if (levelDiff !== null && levelDiff > settings.track_overlap_max_db) {
          dominated++;
          continue;
        }
        const ovTerm = levelDiff !== null && levelDiff > -30 ? overlapSigmaDeg(levelDiff, settings) : 0;
        const sigma = Math.min(90, Math.hypot(noise, multipath));
        const total = Math.min(90, Math.hypot(sigma, ovTerm, reflectorSigmaDeg(reflectorM[ni], settings)));
        // P5 gate, bearing sigmas only (the overlap term would widen the gate exactly when another source takes over).
        // A trusted positive elevation makes the last accepted rolling bearing a truth-free reference before a fix
        // exists. This lets that reference follow an aerial source instead of pinning it to the whole-event bearing.
        let ref = null;
        let refSigma = 0;
        let allow = 0;
        if (pred && state.n >= 2) {
          ref = azFrom(node.position, pred);
          refSigma = nr.bearing?.uncertainty_deg ?? sigma;
          allow = toDeg(Math.atan2(Math.hypot(...state.v) * intervalS, Math.max(Math.hypot(pred[0] - node.position[0], pred[1] - node.position[1]), 1)));
        } else if (hasTrustedAerialElevation(bearing) && recentBearing.has(node.id)) {
          const previous = recentBearing.get(node.id);
          ref = previous.azimuth_deg;
          refSigma = previous.uncertainty_deg;
          allow = Math.max(0, settings.track_pre_fix_elevation_gate_deg - Math.max(settings.track_gate_min_deg, settings.track_gate_sigma * Math.hypot(sigma, refSigma)));
        } else if (!state && nr.bearing && !hasTrustedAerialElevation(bearing)) {
          ref = nr.bearing.azimuth_deg;
          refSigma = nr.bearing.uncertainty_deg;
        }
        if (ref !== null && angDiff(bearing.azimuth_deg, ref) > Math.max(settings.track_gate_min_deg, settings.track_gate_sigma * Math.hypot(sigma, refSigma)) + allow) {
          gated++;
          continue;
        }
        atTime.push({ ni, node, win, bearing, snrDb, sigma, total, levelDiff });
      }
      fix = robustFix(atTime.map((o) => ({
        node_id: o.node.id,
        origin: o.node.position,
        azimuth_deg: o.bearing.azimuth_deg,
        elevation_deg: o.bearing.elevation_deg,
        elevation_trusted: !o.bearing.elevation_sign_assumed && o.bearing.elevation_confidence === 'ok',
        sigma_deg: o.total
      })), { settings, scenario });
      if (!fix?.position || fix.poorly_conditioned) break;
      p = fix.position;
    }
    for (const o of atTime) {
      if (hasTrustedAerialElevation(o.bearing)) {
        recentBearing.set(o.node.id, { azimuth_deg: o.bearing.azimuth_deg, uncertainty_deg: o.sigma });
      }
    }
    rejected += gated;
    dominatedCount += dominated;

    for (const o of atTime) {
      const nodeTruth = moving ? emittedPosition(src, o.node.position, (o.win[0] + o.win[1]) / 2, c) : src.keyframes[0].position;
      observations.push({
        t_s: o.win[1],
        t_emit_s: tE,
        node_id: o.node.id,
        window_s: o.win,
        direction: o.bearing.direction,
        azimuth_deg: o.bearing.azimuth_deg,
        uncertainty_deg: o.sigma,
        azimuth_error_deg: angDiff(o.bearing.azimuth_deg, azFrom(o.node.position, nodeTruth)),
        snr_db: o.snrDb
      });
    }
    if (!fix?.position || fix.poorly_conditioned) continue;

    // Constant-velocity alpha-beta filter on the horizontal position.
    const z = [fix.position[0], fix.position[1]];
    if (!state) state = { x: z, v: [0, 0], t: tE, n: 1 };
    else if (state.n === 1) {
      // Two-point start: velocity from the first two fixes.
      const dt = tE - state.t;
      state = { x: z, v: [(z[0] - state.x[0]) / dt, (z[1] - state.x[1]) / dt], t: tE, n: 2 };
    } else {
      const dt = tE - state.t;
      const xp = [state.x[0] + state.v[0] * dt, state.x[1] + state.v[1] * dt];
      const r = [z[0] - xp[0], z[1] - xp[1]];
      state = { x: [xp[0] + settings.track_alpha * r[0], xp[1] + settings.track_alpha * r[1]], v: [state.v[0] + (settings.track_beta / dt) * r[0], state.v[1] + (settings.track_beta / dt) * r[1]], t: tE, n: state.n + 1 };
    }
    const truth = positionAt(src, tE + W / 2);
    const inl = atTime.filter((o) => fix.inlier_nodes.includes(o.node.id));
    fixes.push({
      t_s: Math.max(...inl.map((o) => o.win[1])),
      t_emit_s: tE,
      position: [state.x[0], state.x[1], fix.position[2]],
      raw_position: fix.position,
      velocity_mps: [...state.v],
      method: fix.method,
      inlier_nodes: fix.inlier_nodes,
      rejected_nodes: fix.rejected_nodes,
      fix_suspect: fix.fix_suspect,
      overlapped: inl.some((o) => o.levelDiff !== null && o.levelDiff > -30),
      true_position: truth,
      error_m: Math.hypot(state.x[0] - truth[0], state.x[1] - truth[1]),
      raw_error_m: Math.hypot(fix.position[0] - truth[0], fix.position[1] - truth[1])
    });
  }
  return { window_s: W, interval_s: intervalS, alignment: 'common_emission_time', filter: 'alpha_beta', observations, fixes, rejected_count: rejected, dominated_count: dominatedCount };
}
