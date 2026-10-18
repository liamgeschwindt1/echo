import { dbToPa, digitalPerPa, distance, speedOfSound } from './physics.js';
import { estimateBearing, intersectRays } from './localise.js';
import { backtraceCandidates, scoreAgainstTruth } from './backtrace.js';
import { pathReport } from './pathreport.js';
import { azimuthUncertaintyDeg } from './uncertainty.js';
import { FRAME_S } from './activity.js';
import { sourcePosition } from './scenario.js';

const toDeg = (r) => (r * 180) / Math.PI;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const PROGRESSIVE_FIRST_S = 0.02;

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
export function analyseScenario(scenario, rendered, clipDurations, { progressive = false } = {}) {
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

  return scenario.sources.map((src, si) => {
    const truth = sourcePosition(src);
    const perNode = scenario.nodes.map((node, ni) => {
      const rn = rendered.nodes[ni];
      const act = rendered.activity[ni];
      const centre = rendered.paths[ni].centre[si];
      const r = distance(truth, node.position);
      const own = act.per_source[si];
      const noiseP = act.noise_band_power;
      const firstDelay = centre.paths.length ? Math.min(...centre.paths.map((p) => p.delay_s)) : r / c;
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

      let status = 'ok';
      let loc = active;
      let localisedOn = 'active_window';
      if (!win) status = 'no_signal';
      else if (others.length) {
        const best = subtract(active, others.map((x) => x.w)).sort((x, y) => y[1] - y[0] - (x[1] - x[0]))[0];
        if (best && best[1] - best[0] >= minS) {
          loc = best;
          localisedOn = 'non_overlapped_part';
        } else status = 'unresolved_overlap';
      }
      if (loc[1] - loc[0] < minS) {
        const mid = (loc[0] + loc[1]) / 2;
        loc = [Math.max(0, mid - minS / 2), Math.min(lengthS, mid + minS / 2)];
      }
      const toSamples = (w) => [Math.max(0, Math.round(w[0] * fs)), Math.min(rendered.length, Math.max(Math.round(w[0] * fs) + 64, Math.round(w[1] * fs)))];
      const [a, b] = toSamples(loc);
      const bearingFor = (s0, s1) => estimateBearing({ mics: rn.mics, positions: rn.mic_positions, startSample: s0, endSample: s1, fs, c, band: settings.localisation_band_hz });
      const trueAz = toDeg(Math.atan2(truth[1] - node.position[1], truth[0] - node.position[0]));
      const sigmaFor = (bearing, w) =>
        azimuthUncertaintyDeg({
          snrDb: toDb(meanPower(own.all, w[0], w[1]), noiseP),
          windowS: w[1] - w[0],
          band: settings.localisation_band_hz,
          positions: rn.mic_positions,
          azimuthDeg: bearing.azimuth_deg,
          elevationDeg: bearing.elevation_deg,
          c,
          fs
        });

      const bearing = bearingFor(a, b);
      if (bearing) bearing.uncertainty_deg = sigmaFor(bearing, loc);
      const report = pathReport({ centre, node, source: src, bearing, settings });
      const snr = toDb(meanPower(own.all, active[0], active[1]), noiseP);
      const hasDirect = centre.paths.some((p) => p.type === 'direct');
      const reliable = status === 'ok';

      // Bearings from growing windows: the wedge is "generated" as the sound accumulates at the node.
      let steps = null;
      if (progressive && bearing && win) {
        steps = [];
        for (let tau = PROGRESSIVE_FIRST_S; tau < loc[1] - loc[0]; tau *= 2) {
          const w = [loc[0], loc[0] + tau];
          const [s0, s1] = toSamples(w);
          const bb = bearingFor(s0, s1);
          if (!bb) continue;
          bb.uncertainty_deg = sigmaFor(bb, w);
          steps.push({ t_end_s: w[1], azimuth_deg: bb.azimuth_deg, direction: bb.direction, uncertainty_deg: bb.uncertainty_deg, azimuth_error_deg: angDiff(bb.azimuth_deg, trueAz), snr_db: toDb(meanPower(own.all, w[0], w[1]), noiseP) });
        }
        steps.push({ t_end_s: loc[1], azimuth_deg: bearing.azimuth_deg, direction: bearing.direction, uncertainty_deg: bearing.uncertainty_deg, azimuth_error_deg: angDiff(bearing.azimuth_deg, trueAz), snr_db: toDb(meanPower(own.all, loc[0], loc[1]), noiseP) });
      }

      return {
        node_id: node.id,
        range_m: r,
        snr_db: snr,
        snr_direct_db: hasDirect ? toDb(meanPower(own.direct, active[0], active[1]), noiseP) : null,
        snr_broadband_db: snrBroadbandDb(rn.mics[0], ...toSamples(active), settings),
        heard: snr >= settings.min_snr_db,
        bearing,
        overlapped_with: others.map((x) => x.o.id),
        overlap_s: overlapS,
        level_diff_db: levelDiff,
        localisation_status: status,
        localised_on: localisedOn,
        reliable,
        uncertainty_valid: !!bearing && report.picked_path_type === 'direct' && status !== 'unresolved_overlap',
        active_window_s: active,
        window_s: loc,
        progressive: steps,
        ...report,
        azimuth_error_deg: bearing ? angDiff(bearing.azimuth_deg, trueAz) : null,
        true_azimuth_deg: trueAz,
        true_elevation_deg: toDeg(Math.asin((truth[2] - node.position[2]) / r)),
        first_arrival_s: src.start_s + firstDelay
      };
    });

    // A node leaves the fix if it cannot hear the sound or its window is dominated by another sound.
    const used = perNode.filter((n) => n.bearing && n.heard && n.reliable);
    const rays = used.map((n) => ({ origin: scenario.nodes.find((x) => x.id === n.node_id).position, direction: n.bearing.direction, weight: 10 ** (n.snr_db / 10) }));
    const fix = intersectRays(rays);
    const est = fix && !fix.poorly_conditioned ? fix.position : null;
    const bt = backtraceCandidates(
      used.map((n) => ({ node_id: n.node_id, position: scenario.nodes.find((x) => x.id === n.node_id).position, azimuth_deg: n.bearing.azimuth_deg, uncertainty_deg: n.bearing.uncertainty_deg })),
      scenario.buildings || [],
      { reflection_order: settings.backtrace_reflection_order ?? 2 }
    );
    const btTruth = scoreAgainstTruth(bt.candidates, truth);
    const suspect = used.some((n) => n.direct_blocked || n.picked_path_type !== 'direct');
    return {
      source_id: src.id,
      true_position: truth,
      nodes: perNode,
      heard_nodes: rays.length,
      excluded_unreliable: perNode.filter((n) => n.heard && !n.reliable).map((n) => n.node_id),
      backtrace: {
        traces: bt.traces,
        candidates: bt.candidates.slice(0, 10),
        top: bt.candidates.slice(0, 3),
        ...btTruth,
        intersection_error_m: est ? Math.hypot(est[0] - truth[0], est[1] - truth[1]) : null
      },
      fix: fix && { ...fix, position: est, fix_suspect: suspect, ready_s: used.length ? Math.max(...used.map((n) => n.window_s[1])) : null },
      error_horizontal_m: est ? Math.hypot(est[0] - truth[0], est[1] - truth[1]) : null,
      error_3d_m: est ? distance(est, truth) : null
    };
  });
}
