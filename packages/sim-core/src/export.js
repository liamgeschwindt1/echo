// The results export ("Export results" in the sim). Schema 0.5: see EXPORT_CHANGELOG.
// Node output is limited to bearings, levels, times, uncertainties, labels, scores and confidences: no audio, spectra or
// embeddings, and every unmeasured constant or threshold is marked placeholder.
import { simConstants } from './geometry.js';
import { ANALYSIS_THRESHOLDS } from './scenario.js';
import { LABELLING_NOTE } from './labelling.js';

export const EXPORT_SCHEMA = '0.5';

export const EXPORT_CHANGELOG = [
  {
    schema: '0.5',
    added: [
      'fix.method: 3d_two_ray | 3d_ransac_wls when trusted elevations rescue a poorly conditioned horizontal fix',
      'fix.max_angle_3d_deg and fix.z_3d_raw_m from the trusted-elevation 3D solver; 3D fixes use 3D ranges and leave-one-out residuals',
      'track_pre_fix_elevation_gate_deg (90° placeholder) and its value in thresholds'
    ],
    changed: [
      'fix.rejected_nodes[].reason adds untrusted_elevation for usable nodes omitted from a 3D fix',
      "track uses each node's recent accepted bearing and the wide pre-fix gate for trusted positive elevations; ground and flat-array bearings keep the prior gate",
      'labelling is included only after labelEvents completes for the exported results; labelling_enabled alone does not create a labelling block'
    ],
    removed: []
  },
  {
    schema: '0.4',
    added: [
      'nodes[].window_snr_db: SNR of the source in the window the bearing was taken on (snr_db is unchanged: over the active window)',
      'nodes[].window_policy: onset_gated | adaptive_long | fixed; nodes[].trigger {type, rise_db, onset_s}; reflection_guard; adaptive_stop; arrival_span_s',
      'nodes[].overlapped, usable, weight, weight_terms {uncertainty_deg, overlap_deg, reflector_deg, total_deg}, nearest_reflector_m',
      'nodes[].bearing.uncertainty_noise_deg, uncertainty_motion_deg, uncertainty_multipath_deg (uncertainty_deg combines them in quadrature)',
      'nodes[].reflection_gap_s (strongest reflection after the first arrival)',
      'nodes[].snr_detection_db, detected_broadband, localisable, aliasing_limit_hz, band_above_aliasing',
      'usable_nodes',
      'fix.method (two_ray | ransac_wls), fix.inlier_nodes, fix.rejected_nodes [{node_id, reason, residual_sigma}], fix.loo_residuals',
      'fix.z_clamped, fix.z_from_nodes, fix.z_3d_raw_m, fix.max_crossing_angle_horizontal_deg, fix.max_angle_3d_deg, fix.suspect_reasons, fix.multipath_suspect',
      'track.alignment, track.filter, track.rejected_count, track.dominated_count; track.fixes[].t_emit_s, raw_position, velocity_mps, error_m, raw_error_m, true_position, inlier_nodes, overlapped; track.observations[].t_emit_s, window_s',
      'backtrace.edge_hypotheses; backtrace candidates[].hypotheses and support[].hypothesis (direct | reflection | edge)',
      'labelling (when labelling completes): events, sources, summary, models, association_rule, notes',
      'thresholds: every analysis threshold with its value and placeholder: true; notes'
    ],
    changed: [
      'heard_nodes counts nodes with heard: true (it counted only the nodes used in the fix); heard is detected_broadband or localisable',
      'nodes[].heard: true when the source is detected in the detection band OR localisable in the localisation band (was: localisation band only)',
      'fix.max_angle_deg is now the horizontal crossing angle (was 3D); the 3D value is fix.max_angle_3d_deg',
      'fix.fix_suspect now comes from checks a real system can make (below_ground, negative_range, range_ratio, loo_residual, outside_scene, weak_consensus); the 0.3 rule (a node picked a non-direct path or has its direct path blocked) is fix.multipath_suspect',
      'fix.position z is clamped to source_height_prior_m when no node resolves elevation (flat arrays)',
      'nodes with localisation_status unresolved_overlap still enter the fix, weighted (reliable stays false); nodes whose window SNR is below min_snr_db get localisation_status no_signal and bearing null',
      'picked_path_index: strongest path within the azimuth tolerance, picked_path_level_window_db and picked_path_elevation_tol_deg (was the first azimuth match)',
      'track.fixes[].t_s is when the fix is available (last inlier window end); track fixes are at common emission times'
    ],
    removed: []
  },
  { schema: '0.3', added: ['nodes: layout and the mic positions used (world metres)'], changed: [], removed: [] }
];

export const EXPORT_NOTES = [
  'SIMULATED results. Physics constants that are not measured are marked placeholder; nothing here is validated against real recordings.',
  'No housing scattering, wind, rain, coloured noise or facade scattering; the diffraction model is unvalidated beyond its listed checks.',
  'weight_terms.uncertainty_deg (multipath term), picked_path_* and multipath_suspect use the true source position (simulator-only); track_overlap_max_db uses per-source levels (simulator-only). fix_suspect does not use ground truth.',
  LABELLING_NOTE
];

/** Every analysis threshold with its value in this scenario, marked placeholder. */
export function thresholdsOf(settings) {
  return Object.fromEntries(Object.entries(ANALYSIS_THRESHOLDS).map(([k, note]) => [k, { value: settings[k], placeholder: true, note }]));
}

// Fields that must never leave: audio or audio-derived arrays. Labelling results never contain them; this is a guard.
const FORBIDDEN = new Set(['mics', 'audio', 'samples', 'embedding', 'embeddings', 'spectrogram', 'audio_embeds']);
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object' && !(ArrayBuffer.isView(v))) return Object.fromEntries(Object.entries(v).filter(([k]) => !FORBIDDEN.has(k)).map(([k, x]) => [k, scrub(x)]));
  return ArrayBuffer.isView(v) ? undefined : v;
}

/** The export object. nodes: per node layout (0.3); labelling: completed labelEvents output or null. */
export function buildExport({ scenario, nodes, results, labelling = null }) {
  return {
    app: 'echo-sim',
    schema: EXPORT_SCHEMA,
    changelog: EXPORT_CHANGELOG,
    notes: EXPORT_NOTES,
    constants: simConstants(),
    thresholds: thresholdsOf(scenario.settings),
    scenario,
    nodes,
    results: scrub(results),
    ...(labelling ? { labelling: scrub(labelling) } : {})
  };
}
