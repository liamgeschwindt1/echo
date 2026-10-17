import { dbToPa, digitalPerPa, distance, speedOfSound } from './physics.js';
import { estimateBearing, intersectRays } from './localise.js';
import { sourcePosition } from './scenario.js';

const toDeg = (r) => (r * 180) / Math.PI;

function snrDb(signal, a, b, settings) {
  let s = 0;
  for (let i = a; i < b; i++) s += signal[i] * signal[i];
  const win = s / Math.max(1, b - a);
  const k = digitalPerPa(settings.spl_ref_db, settings.dbfs_ref_db);
  const noise = (dbToPa(settings.noise_floor_db_spl) ** 2 + dbToPa(settings.mic_self_noise_db_spl) ** 2) * k * k;
  return 10 * Math.log10(Math.max(win - noise, noise * 1e-3) / noise);
}

/**
 * Per-source bearings, SNR and position fix using each source's true event window.
 * Model-driven detection windows replace this in the classification phase.
 */
export function analyseScenario(scenario, rendered, clipDurations) {
  const { settings } = scenario;
  const fs = rendered.sample_rate;
  const c = speedOfSound(settings.temperature_c);
  // Analysis window of a source at a node, in samples.
  const windowAt = (s, node) => {
    const r = distance(sourcePosition(s), node.position);
    const d = clipDurations.get(s.clip) || 0;
    return [Math.max(0, Math.round((s.start_s + r / c - 0.02) * fs)), Math.min(rendered.length, Math.round((s.start_s + d + r / c + 0.05) * fs))];
  };
  return scenario.sources.map((src) => {
    const truth = sourcePosition(src);
    const perNode = scenario.nodes.map((node, ni) => {
      const rn = rendered.nodes[ni];
      const r = distance(truth, node.position);
      const [a, b] = windowAt(src, node);
      // Another sound inside this window contaminates the bearing.
      const overlaps = scenario.sources
        .filter((o) => {
          if (o === src) return false;
          const [oa, ob] = windowAt(o, node);
          return oa < b && ob > a;
        })
        .map((o) => o.id);
      const bearing = estimateBearing({ mics: rn.mics, positions: rn.mic_positions, startSample: a, endSample: b, fs, c, band: settings.localisation_band_hz });
      const trueAz = toDeg(Math.atan2(truth[1] - node.position[1], truth[0] - node.position[0]));
      return {
        node_id: node.id,
        range_m: r,
        snr_db: snrDb(rn.mics[0], a, b, settings),
        heard: false,
        bearing,
        overlaps,
        azimuth_error_deg: bearing ? Math.abs(((bearing.azimuth_deg - trueAz + 540) % 360) - 180) : null,
        true_azimuth_deg: trueAz,
        true_elevation_deg: toDeg(Math.asin((truth[2] - node.position[2]) / r)),
        first_arrival_s: src.start_s + r / c
      };
    });
    // Localisation-only gate: a node too far below the noise to hear the sound is left out of the fix.
    for (const n of perNode) n.heard = n.snr_db >= settings.min_snr_db;
    const rays = perNode
      .map((n, i) => ({ origin: scenario.nodes[i].position, bearing: n.bearing, weight: 10 ** (n.snr_db / 10), heard: n.heard }))
      .filter((n) => n.bearing && n.heard)
      .map((n) => ({ origin: n.origin, direction: n.bearing.direction, weight: n.weight }));
    const fix = intersectRays(rays);
    const est = fix && !fix.poorly_conditioned ? fix.position : null;
    return {
      source_id: src.id,
      true_position: truth,
      nodes: perNode,
      heard_nodes: rays.length,
      fix: fix && { ...fix, position: est },
      error_horizontal_m: est ? Math.hypot(est[0] - truth[0], est[1] - truth[1]) : null,
      error_3d_m: est ? distance(est, truth) : null
    };
  });
}
