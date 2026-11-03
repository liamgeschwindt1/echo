import { dbToPa, digitalPerPa, distance, speedOfSound } from './physics.js';
import { estimateBearing, intersectRays } from './localise.js';
import { backtraceCandidates, scoreAgainstTruth } from './backtrace.js';
import { pathReport } from './pathreport.js';
import { timed } from './profile.js';
import { azimuthUncertaintyDeg, multipathSigmaDeg, overlapSigmaDeg, reflectorSigmaDeg } from './uncertainty.js';
import { robustFix } from './fix.js';
import { commonTimeTrack } from './track.js';
import { FRAME_S } from './activity.js';
import { adaptiveWindow, arrivalSpan, nearestReflectorM, nodeMixtureFrames, reflectionGuardS, triggerType } from './windows.js';
import { sourcePosition } from './scenario.js';
import { emittedPosition, isMoving, positionAt } from './motion.js';
import { buildSourceGraph, buildSurfaces, findPaths } from './geometry.js';

const toDeg = (r) => (r * 180) / Math.PI;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const PROGRESSIVE_FIRST_S = 0.02;
export const TRACK_WINDOW_S = 0.1;
export const TRACK_INTERVAL_S = 0.1;

/** Mean in-band power over [t0, t1) seconds from 10 ms frames. */
function meanPower(frames, t0, t1) {
  const f0 = Math.max(0, Math.floor(t0 / FRAME_S));
  const f1 = Math.min(frames.length, Math.max(f0 + 1, Math.ceil(t1 / FRAME_S)));
  let s = 0;
  for (let f = f0; f < f1; f++) s += frames[f];
  return s / Math.max(1, f1 - f0);
}

const toDb = (p, noise) => 10 * Math.log10(Math.max(p / noise, 1e-6));

// Legacy broadband definition: total mic-1 power in the window (every source) above the analytic noise power.
function snrBroadbandDb(signal, a, b, settings) {
  let s = 0;
  for (let i = a; i < b; i++) s += signal[i] * signal[i];
  const win = s / Math.max(1, b - a);
  const k = digitalPerPa(settings.spl_ref_db, settings.dbfs_ref_db);
  const noise = (dbToPa(settings.noise_floor_db_spl) ** 2 + dbToPa(settings.mic_self_noise_db_spl) ** 2) * k * k;
  return 10 * Math.log10(Math.max(win - noise, noise * 1e-3) / noise);
}

// Active window: first to last frame where the source's own in-band power is window_snr_db above the noise, padded.
function activeWindow(own, noiseP, thresholdDb, padS, spreadS, lengthS) {
  const thr = noiseP * 10 ** (thresholdDb / 10);
  let a = -1;
  let b = -1;
  for (let f = 0; f < own.length; f++) {
    if (own[f] >= thr) {
      if (a < 0) a = f;
      b = f;
    }
  }
  if (a < 0) return null;
  return [Math.max(0, a * FRAME_S - padS), Math.min(lengthS, (b + 1) * FRAME_S + padS + spreadS)];
}

const intersect = (a, b) => (Math.min(a[1], b[1]) > Math.max(a[0], b[0]) ? [Math.max(a[0], b[0]), Math.min(a[1], b[1])] : null);

function union(list) {
  const s = [...list].sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const iv of s) {
    if (out.length && iv[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], iv[1]);
    else out.push([...iv]);
  }
  return out;
}

function subtract(w, others) {
  const free = [];
  let cur = w[0];
  for (const o of union(others)) {
    if (o[1] <= cur || o[0] >= w[1]) continue;
    if (o[0] > cur) free.push([cur, o[0]]);
    cur = Math.max(cur, o[1]);
  }
  if (cur < w[1]) free.push([cur, w[1]]);
  return free;
}

/**
 * Per-source bearings, SNR and position fix.
 *
 * snr_db: mean in-band (localisation band) power of the source's own contribution, all paths summed,
 * at mic 1 over its active window, divided by the mean in-band power of the ambient plus self noise at mic 1.
 * progressive: also store bearings from growing windows (for the time-resolved wedges in the UI).
 */
export function analyseScenario(scenario, rendered, clipDurations, { progressive = false, profile = null } = {}) {
  const { settings } = scenario;
  const fs = rendered.sample_rate;
  const c = speedOfSound(settings.temperature_c);
  const lengthS = rendered.length / fs;
  const padS = settings.window_pad_ms / 1000;
  const minS = settings.min_window_ms / 1000;

  // Active windows for every source at every node, so overlaps can be judged.
  const windows = scenario.nodes.map((_, ni) =>
    scenario.sources.map((__, si) => {
      const act = rendered.activity[ni];
      const delays = rendered.paths[ni].centre[si].paths.map((p) => p.delay_s);
      const spread = delays.length ? Math.max(...delays) - Math.min(...delays) : 0;
      const w = activeWindow(act.per_source[si].all, act.noise_band_power, settings.window_snr_db, padS, spread, lengthS);
      return w ? [w[0], w[1]] : null;
    })
  );

  // Spatial aliasing limit of each array, c / (2 x nearest mic spacing).
  const aliasingHz = rendered.nodes.map((rn) => {
    let dmin = Infinity;
    const P = rn.mic_positions;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) dmin = Math.min(dmin, distance(P[i], P[j]));
    return c / (2 * dmin);
  });
  const reflectorM = scenario.nodes.map((n) => nearestReflectorM(n.position, scenario.buildings || []));

  return scenario.sources.map((src, si) => {
    const moving = isMoving(src);
    // A moving source has no single true position: each node is judged against where the sound it localised was
    // emitted (mid-window), and the source as a whole against the mean of those points.
    let truth = moving ? rendered.source_positions?.[si] ?? sourcePosition(src) : sourcePosition(src);
    const perNode = scenario.nodes.map((node, ni) => {
      const rn = rendered.nodes[ni];
      const act = rendered.activity[ni];
      const centre = rendered.paths[ni].centre[si];
      const r = distance(truth, node.position);
      const own = act.per_source[si];
      const noiseP = act.noise_band_power;
      // A moving source's reference-position paths say nothing about when it is first heard: use its position at the start.
      const firstDelay = moving ? distance(positionAt(src, src.start_s), node.position) / c : centre.paths.length ? Math.min(...centre.paths.map((p) => p.delay_s)) : r / c;
      const win = windows[ni][si];
      const active = win || [src.start_s + firstDelay, Math.min(lengthS, src.start_s + firstDelay + 0.2)];

      const others = scenario.sources.map((o, oi) => ({ o, oi, w: windows[ni][oi] })).filter((x) => x.oi !== si && x.w && intersect(x.w, active));
      const overlapShared = others.length ? union(others.map((x) => intersect(x.w, active))) : [];
      const overlapS = overlapShared.reduce((a, iv) => a + (iv[1] - iv[0]), 0);
      let levelDiff = null;
      if (overlapS > 0) {
        let mine = 0;
        let theirs = 0;
        for (const iv of overlapShared) {
          mine += meanPower(own.all, iv[0], iv[1]) * (iv[1] - iv[0]);
          for (const x of others) theirs += meanPower(act.per_source[x.oi].all, iv[0], iv[1]) * (iv[1] - iv[0]);
        }
        levelDiff = 10 * Math.log10(Math.max(theirs, 1e-30) / Math.max(mine, 1e-30));
      }

      // P1: the window must lie inside the source's arrival span at this node (emission interval + propagation delay).
      const span = arrivalSpan(src, node.position, clipDurations?.get?.(src.clip) ?? null, c, centre.paths.map((p) => p.delay_s));
      const contained = win ? intersect(win, [span[0] - padS, span[1] + padS]) : null;
      const windowSnr = (w) => toDb(meanPower(own.all, w[0], w[1]), noiseP);
      const widen = (w) => {
        if (w[1] - w[0] >= minS) return w;
        const mid = (w[0] + w[1]) / 2;
        return [Math.max(0, mid - minS / 2), Math.min(lengthS, mid + minS / 2)];
      };

      let status = 'ok';
      let loc = contained || active;
      let localisedOn = 'active_window';
      let overlapped = false;
      if (!contained) status = 'no_signal';
      else if (others.length) {
        // Longest non-overlapped piece that is long enough and actually carries the source.
        const free = subtract(loc, others.map((x) => x.w)).filter((w) => w[1] - w[0] >= minS && windowSnr(w) >= settings.min_snr_db);
        const best = free.sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        if (best) {
          loc = best;
          localisedOn = 'non_overlapped_part';
        } else {
          status = 'unresolved_overlap';
          overlapped = true;
        }
      }
      loc = widen(loc);
      const toSamples = (w) => [Math.max(0, Math.round(w[0] * fs)), Math.min(rendered.length, Math.max(Math.round(w[0] * fs) + 64, Math.round(w[1] * fs)))];
      const bearingFor = (w, stage = 'localise_final') => timed(profile, stage, () => estimateBearing({ mics: rn.mics, positions: rn.mic_positions, startSample: toSamples(w)[0], endSample: toSamples(w)[1], fs, c, band: settings.localisation_band_hz }));
      const midTruth = (w) => (moving ? emittedPosition(src, node.position, (w[0] + w[1]) / 2, c) : truth);
      const azAt = (tArr) => {
        const q = emittedPosition(src, node.position, tArr, c);
        return toDeg(Math.atan2(q[1] - node.position[1], q[0] - node.position[0]));
      };
      const noiseSigma = (bearing, w) =>
        azimuthUncertaintyDeg({
          snrDb: windowSnr(w),
          windowS: w[1] - w[0],
          band: settings.localisation_band_hz,
          positions: rn.mic_positions,
          azimuthDeg: bearing.azimuth_deg,
          elevationDeg: bearing.elevation_deg,
          c,
          fs
        });
      // A moving source sweeps across the window: half the swept angle is added (in quadrature) to the noise-limited spread.
      const sigmaFor = (bearing, w) => (moving ? Math.hypot(noiseSigma(bearing, w), angDiff(azAt(w[0]), azAt(w[1])) / 2) : noiseSigma(bearing, w));
      const bearingWithSigma = (w, stage) => {
        const b = bearingFor(w, stage);
        if (b) b.uncertainty_deg = sigmaFor(b, w);
        return b;
      };

      // P2: window policy from the trigger type (mixture level rise at the onset), never from a classifier.
      let policy = 'fixed';
      let trigger = null;
      let guard = null;
      let adaptive = null;
      let bearing = null;
      let w = loc;
      if (status !== 'no_signal' && settings.window_policy !== 'fixed') {
        const frames = nodeMixtureFrames(rn, settings.localisation_band_hz, fs, FRAME_S);
        trigger = triggerType(frames, loc[0], FRAME_S, { riseDb: settings.trigger_rise_db, riseS: settings.trigger_rise_ms / 1000 });
        const atOnset = Math.abs(loc[0] - (contained?.[0] ?? loc[0])) < 1e-9;
        if (trigger.type === 'impulsive' && atOnset) {
          // Short window from the onset; end it before the first strong wall reflection where possible.
          const pre = bearingWithSigma([loc[0], Math.min(loc[1], loc[0] + padS + settings.onset_window_ms / 1000)], 'localise_onset');
          guard = pre ? reflectionGuardS(node.position, pre.direction, scenario.buildings || [], c, settings.reflector_search_m) : null;
          const lenS = Math.max(settings.onset_min_ms / 1000, Math.min(settings.onset_window_ms / 1000, guard ? guard.delay_s : Infinity));
          const onsetW = [loc[0], Math.min(loc[1], loc[0] + padS + lenS)];
          if (onsetW[1] - onsetW[0] >= settings.onset_min_ms / 1000 && windowSnr(onsetW) >= settings.min_snr_db) {
            policy = 'onset_gated';
            w = onsetW;
            bearing = lenS === settings.onset_window_ms / 1000 && pre ? pre : bearingWithSigma(w);
          }
        }
        if (policy === 'fixed') {
          adaptive = adaptiveWindow(loc, {
            bearingAt: (x) => bearingWithSigma(x, 'localise_progressive'),
            snrAt: windowSnr,
            minS,
            minSnrDb: settings.min_snr_db,
            firstS: PROGRESSIVE_FIRST_S,
            driftDeg: settings.adaptive_drift_deg,
            sigmaRise: settings.adaptive_sigma_rise
          });
          if (adaptive.chosen) {
            policy = 'adaptive_long';
            w = adaptive.chosen.window;
            bearing = adaptive.chosen.bearing;
          }
        }
      }
      if (policy === 'fixed' && status !== 'no_signal') bearing = bearingWithSigma(w);
      // P1: SNR on the window actually used. Below min_snr_db the bearing is not usable.
      const window_snr_db = status === 'no_signal' && !contained ? null : windowSnr(w);
      if (window_snr_db === null || window_snr_db < settings.min_snr_db) {
        status = 'no_signal';
        bearing = null;
      }
      loc = w;
      const nodeTruth = midTruth(loc);
      const nodeRange = moving ? distance(nodeTruth, node.position) : r;
      const trueAz = toDeg(Math.atan2(nodeTruth[1] - node.position[1], nodeTruth[0] - node.position[0]));

      let centreUsed = centre;
      if (moving) {
        // Diagnose against the paths from where the localised sound left the source. They replace the reference-position
        // entry in rendered.paths so the map and mic view draw the same paths the picked index refers to.
        const buildings = scenario.buildings || [];
        const surfaces = buildSurfaces(buildings);
        const wedgeOn = settings.diffraction_model === 'wedge' && (settings.diffraction_order ?? 0) >= 1;
        const graph = wedgeOn ? buildSourceGraph(nodeTruth, { settings, buildings, surfaces }) : undefined;
        centreUsed = findPaths(nodeTruth, node.position, { settings, buildings, surfaces, c, graph });
        rendered.paths[ni].centre[si] = centreUsed;
      }
      const report = timed(profile, 'path_report', () => pathReport({ centre: centreUsed, node, source: src, bearing, settings, sourcePos: nodeTruth }));
      const snr = toDb(meanPower(own.all, active[0], active[1]), noiseP);
      const snrDetection = own.detection ? toDb(meanPower(own.detection, active[0], active[1]), act.noise_detection_power) : null;
      const hasDirect = centreUsed.paths.some((p) => p.type === 'direct');
      const reliable = status === 'ok';

      // P5: reported uncertainty = noise-limited term (CRB, plus half the swept angle for a moving source) combined in
      // quadrature with a multipath floor. P3: the fix weight adds the overlap and near-wall terms on top.
      let weightTerms = null;
      if (bearing) {
        const noise = noiseSigma(bearing, loc);
        const motion = moving ? angDiff(azAt(loc[0]), azAt(loc[1])) / 2 : 0;
        const multipath = multipathSigmaDeg({ directToReflectedDb: report.direct_to_reflected_db, delaySpreadS: report.delay_spread_s, reflectionGapS: report.reflection_gap_s, windowS: loc[1] - loc[0], settings });
        bearing.uncertainty_noise_deg = Math.min(90, Math.hypot(noise, motion));
        bearing.uncertainty_motion_deg = motion;
        bearing.uncertainty_multipath_deg = multipath;
        bearing.uncertainty_deg = Math.min(90, Math.hypot(noise, motion, multipath));
        const overlapTerm = overlapped ? overlapSigmaDeg(levelDiff, settings) : 0;
        const reflectorTerm = reflectorSigmaDeg(reflectorM[ni], settings);
        const total = Math.min(90, Math.hypot(bearing.uncertainty_deg, overlapTerm, reflectorTerm));
        weightTerms = { uncertainty_deg: bearing.uncertainty_deg, overlap_deg: overlapTerm, reflector_deg: reflectorTerm, total_deg: total };
      }

      // Bearings from growing windows: the wedge is "generated" as the sound accumulates at the node.
      let steps = null;
      if (progressive && bearing) {
        const stepOf = (win, bb, snrDb) => ({ t_end_s: win[1], azimuth_deg: bb.azimuth_deg, direction: bb.direction, uncertainty_deg: bb.uncertainty_deg, azimuth_error_deg: angDiff(bb.azimuth_deg, trueAz), snr_db: snrDb });
        if (adaptive?.steps.length) steps = adaptive.steps.filter((x) => !x.rejected && x.window[1] <= loc[1] + 1e-9).map((x) => stepOf(x.window, x.bearing, x.snr_db));
        else {
          steps = [];
          for (let tau = PROGRESSIVE_FIRST_S; tau < loc[1] - loc[0]; tau *= 2) {
            const x = [loc[0], loc[0] + tau];
            const bb = bearingWithSigma(x, 'localise_progressive');
            if (bb) steps.push(stepOf(x, bb, windowSnr(x)));
          }
        }
        if (!steps.length || steps[steps.length - 1].t_end_s < loc[1] - 1e-9) steps.push(stepOf(loc, bearing, window_snr_db));
      }

      return {
        node_id: node.id,
        range_m: nodeRange,
        snr_db: snr,
        snr_direct_db: hasDirect ? toDb(meanPower(own.direct, active[0], active[1]), noiseP) : null,
        snr_broadband_db: snrBroadbandDb(rn.mics[0], ...toSamples(active), settings),
        // P8: detected (own broadband SNR) and localisable (own in-band SNR, over the active or the chosen window) are
        // separate; heard means either. snr_broadband_db above is the legacy whole-mixture value.
        snr_detection_db: snrDetection,
        detected_broadband: snrDetection !== null && snrDetection >= settings.min_snr_db,
        localisable: snr >= settings.min_snr_db || (window_snr_db !== null && window_snr_db >= settings.min_snr_db),
        heard: (snrDetection !== null && snrDetection >= settings.min_snr_db) || snr >= settings.min_snr_db || (window_snr_db !== null && window_snr_db >= settings.min_snr_db),
        aliasing_limit_hz: aliasingHz[ni],
        band_above_aliasing: settings.localisation_band_hz[1] > aliasingHz[ni],
        bearing,
        overlapped_with: others.map((x) => x.o.id),
        overlap_s: overlapS,
        level_diff_db: levelDiff,
        localisation_status: status,
        localised_on: localisedOn,
        overlapped,
        window_snr_db,
        window_policy: policy,
        trigger: trigger && { ...trigger, onset_s: loc[0] },
        reflection_guard: guard,
        adaptive_stop: adaptive?.stopped ?? null,
        arrival_span_s: span,
        reliable,
        usable: !!bearing,
        weight: weightTerms ? 1 / weightTerms.total_deg ** 2 : 0,
        weight_terms: weightTerms,
        nearest_reflector_m: reflectorM[ni],
        uncertainty_valid: !!bearing && report.picked_path_type === 'direct' && status !== 'unresolved_overlap',
        active_window_s: active,
        window_s: loc,
        progressive: steps,
        ...report,
        azimuth_error_deg: bearing ? angDiff(bearing.azimuth_deg, trueAz) : null,
        true_azimuth_deg: trueAz,
        true_elevation_deg: toDeg(Math.asin((nodeTruth[2] - node.position[2]) / nodeRange)),
        ...(moving ? { true_position: nodeTruth } : {}),
        first_arrival_s: src.start_s + firstDelay
      };
    });

    // P3: every node with a usable bearing enters the fix, weighted by its realistic error; outliers are rejected by
    // consensus and leave-one-out, with a reason. Overlap no longer excludes a node by itself.
    const used = perNode.filter((n) => n.usable);
    if (moving && used.length) truth = [0, 1, 2].map((k) => used.reduce((a, n) => a + n.true_position[k], 0) / used.length);
    const posOf = (id) => scenario.nodes.find((x) => x.id === id).position;
    const rays = used.map((n) => ({
      node_id: n.node_id,
      origin: posOf(n.node_id),
      azimuth_deg: n.bearing.azimuth_deg,
      elevation_deg: n.bearing.elevation_deg,
      elevation_trusted: !n.bearing.elevation_sign_assumed && n.bearing.elevation_confidence === 'ok',
      sigma_deg: n.weight_terms.total_deg
    }));
    const robust = robustFix(rays, { settings, scenario });
    // The 0.3 solver in 3D, kept for reference: with a flat array its z follows the assumed elevation sign.
    const fix3d = intersectRays(used.map((n) => ({ origin: posOf(n.node_id), direction: n.bearing.direction, weight: n.weight })));
    const fix = robust && {
      ...robust,
      max_angle_3d_deg: fix3d?.max_angle_deg ?? null,
      z_3d_raw_m: fix3d?.position?.[2] ?? null,
      multipath_suspect: used.some((n) => robust.inlier_nodes.includes(n.node_id) && (n.direct_blocked || n.picked_path_type !== 'direct'))
    };
    const est = fix && !fix.poorly_conditioned ? fix.position : null;
    const notUsed = perNode.filter((n) => !n.usable).map((n) => ({ node_id: n.node_id, reason: n.localisation_status === 'no_signal' ? (n.window_snr_db === null ? 'no_signal' : 'below_min_snr') : 'no_bearing' }));
    // P6: common emission time across nodes, motion-compensated windows, alpha-beta filtered.
    const track = timed(profile, 'track', () => commonTimeTrack({
      scenario, rendered, si, settings, c, fs, lengthS,
      windowS: TRACK_WINDOW_S,
      intervalS: TRACK_INTERVAL_S,
      activeWindows: perNode.map((n) => (n.active_window_s && n.localisation_status !== 'no_signal' ? [Math.max(n.active_window_s[0], n.arrival_span_s[0] - padS), Math.min(n.active_window_s[1], n.arrival_span_s[1] + padS)] : null)),
      perNode,
      longFix: est,
      durationS: clipDurations?.get?.(src.clip) ?? null,
      reflectorM,
      meanPower,
      toDb
    }));
    const bt = timed(profile, 'backtrace', () => backtraceCandidates(
      used.map((n) => ({ node_id: n.node_id, position: scenario.nodes.find((x) => x.id === n.node_id).position, azimuth_deg: n.bearing.azimuth_deg, uncertainty_deg: n.bearing.uncertainty_deg })),
      scenario.buildings || [],
      { reflection_order: settings.backtrace_reflection_order ?? 2 }
    ));
    const btTruth = scoreAgainstTruth(bt.candidates, truth);
    return {
      source_id: src.id,
      true_position: truth,
      nodes: perNode,
      track,
      heard_nodes: perNode.filter((n) => n.heard).length,
      usable_nodes: used.length,
      excluded_unreliable: perNode.filter((n) => n.heard && !n.reliable).map((n) => n.node_id),
      backtrace: {
        traces: bt.traces,
        candidates: bt.candidates.slice(0, 10),
        top: bt.candidates.slice(0, 3),
        ...btTruth,
        intersection_error_m: est ? Math.hypot(est[0] - truth[0], est[1] - truth[1]) : null
      },
      fix: fix && { ...fix, position: est, rejected_nodes: [...fix.rejected_nodes, ...notUsed], ready_s: Math.max(...used.filter((n) => fix.inlier_nodes.includes(n.node_id)).map((n) => n.window_s[1])) },
      error_horizontal_m: est ? Math.hypot(est[0] - truth[0], est[1] - truth[1]) : null,
      error_3d_m: est ? distance(est, truth) : null
    };
  });
}

