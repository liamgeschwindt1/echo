// The results export ("Export results" in the sim). Schema 0.13: see EXPORT_CHANGELOG.
// Node output is limited to bearings, levels, times, uncertainties, labels, scores and confidences: no audio, spectra or
// embeddings, and every unmeasured constant or threshold is marked placeholder.
import { simConstants } from './geometry.js';
import { ANALYSIS_THRESHOLDS } from './scenario.js';
import { LABELLING_NOTE } from './labelling.js';
import { nextPow2 } from './dsp.js';
import { MEASURED_DEFAULTS } from './measured.js';

export const EXPORT_SCHEMA = '0.13';

export const EXPORT_CHANGELOG = [
  {
    schema: '0.13',
    changed: ['Cap reduction preserves actual train/held-out seed IDs and the requested held-out fraction when both partitions exist. It reduces random/LHS samples, then seed repetitions, before dropping variable alternatives, so the default array-ranking preset retains all nine arrays.', 'Explicit held_out_seeds must be unique unsigned integers. An impossible cap fails explicitly instead of silently turning a split experiment into a one-seed pilot. Existing JSON experiment/run fields record the effective retained seeds; inference and rendering are unchanged.']
  },
  {
    schema: '0.12',
    added: ['Benchmark manifest snapshots display targets (including placeholder marker) and cache_policy. CLI --discard-renders is opt-in; default retain behavior is unchanged.'],
    changed: ['Shared scheduler notifies completion only after all consumers of an exact render key finish. Opt-in Node cleanup deletes only that audio/provenance pair, preserving whole results and interrupted groups. No cross-process cleanup safety is claimed; use a separate cache for concurrent discard-mode experiments.']
  },
  {
    schema: '0.11',
    added: ['Opt-in library ID ball12_d180_sub4_maxvol: exact maximum-volume noncoplanar four-mic subset, with its own new signal golden. No default array changes.'],
    changed: ['Legacy coplanar ball12_d180_sub4 coordinates and name remain unchanged, but status/notes warn of rank deficiency. Seeded benchmark sites pin the original eight array IDs/order so library additions cannot change held-out inputs.']
  },
  {
    schema: '0.10',
    added: ['Benchmark scores.fixes contains every assigned measured episode; manifests identify scoring_version and explicit re-scoring provenance. Failure atlas includes every wrong episode and counts unmatched hypotheses separately without inventing their spatial errors.'],
    changed: ['Measured one-to-one assignment applies to overlapping emission-time intervals, not a whole recording. Disjoint bursts may match the same source. Error, track and calibration metrics include every assigned episode; source coverage stays capped at one per source.', 'Comparisons reject different scoring conventions. benchmark-rescore.mjs preserves original reports and inference, invalidates the old whole-run cache reference, and recomputes scores only. Simultaneous unassigned hypotheses still count wrong.']
  },
  {
    schema: '0.9',
    added: ['Benchmark manifest.render_code_version and render_source_files: SHA-256 of the complete parsed local renderer dependency graph', 'Run render_provenance preserves actual audio producer code/git/runtime; cache_keys.origin identifies its sidecar'],
    changed: ['Analysis-only source revisions invalidate complete results but reuse audio only when renderer dependency fingerprint, runtime, inputs and clip hashes match. Unknown/external dependency graphs fail explicitly.', 'Shared worker scheduler single-flights cold audio keys and releases waiting jobs as soon as audio is persisted, before analysis finishes. Equivalent-result cache hits retain requested variable values.'],
    removed: []
  },
  {
    schema: '0.8',
    added: ['windowTdoas[].peak_normalized: raw PHAT peak divided by the theoretical fully coherent in-band peak; raw peak and TDOA remain unchanged', 'Benchmark runtime provenance, completed-job resume_identity, summary config settings and held_out_fraction=0.3 (placeholder)'],
    changed: ['Measured-only min_peak=0.25 now applies to dimensionless coherence, not an inverse-FFT peak whose maximum is below 0.015 in the default band. No threshold tuning, signal or truth-assisted bearing changes.', 'Resume verifies audio, runtime, exact experiment/job settings and scoring target. OAT preserves explicitly requested values; analysis-mode sweeps no longer duplicate runs. Integer seed counts reserve at least 30% held-out seeds when count is at least two.', 'Variable transforms use fixed geometry-before-range order. Regression comparisons match variable values and reject different scene/seed populations or error targets. Unavailable tornado sensitivity is not shown as zero.'],
    removed: []
  },
  {
    schema: '0.7',
    added: [
      'benchmark result kind: experiments, reproducibility manifest with source/audio hashes, scene/seed split, realism and analysis mode, bootstrap CI, paired comparisons, failure atlas and ranking flips',
      'analysis_mode setting; measured-only inference has no source/path/activity input; scoring truth is isolated after inference',
      'measured_* placeholder thresholds in exports, including effective defaults'
    ],
    changed: ['Benchmark defaults to measured_only; existing editor defaults remain truth_assisted. No rendered signal changes.'],
    removed: []
  },
  {
    schema: '0.6',
    added: [
      'rendering (when rendered data is available): sample_rate_hz, samples_per_mic, duration_s, fft_size, frequency_bins, nodes[].noise powers and microphones[].sources[].applied_paths (the actual render audit)',
      'HTML results report: expandable pipeline stages and Copy JSON of the same export'
    ],
    changed: ['Export results opens a report in a new tab instead of downloading JSON; exports use the scenario snapshot belonging to the results'],
    removed: []
  },
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
  'rendering contains actual static-source per-microphone path audits, not waveform samples. Moving-source piece audits, FFT spectra, pairwise TDOAs and solver iteration matrices are not retained.',
  LABELLING_NOTE
];

/** Every analysis threshold with its value in this scenario, marked placeholder. */
export function thresholdsOf(settings) {
  return {
    ...Object.fromEntries(Object.entries(ANALYSIS_THRESHOLDS).map(([k, note]) => [k, { value: settings[k], placeholder: true, note }])),
    ...Object.fromEntries(Object.entries(MEASURED_DEFAULTS).map(([k, value]) => [`measured_${k}`, { value: settings[`measured_${k}`] ?? value, placeholder: true, note: 'Existing measured.js heuristic; not calibrated on real recordings.' }]))
  };
}

// Fields that must never leave: audio or audio-derived arrays. Labelling results never contain them; this is a guard.
const FORBIDDEN = new Set(['mics', 'audio', 'samples', 'embedding', 'embeddings', 'spectrogram', 'audio_embeds']);
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object' && !(ArrayBuffer.isView(v))) return Object.fromEntries(Object.entries(v).filter(([k]) => !FORBIDDEN.has(k)).map(([k, x]) => [k, scrub(x)]));
  return ArrayBuffer.isView(v) ? undefined : v;
}

/** The export object. Only scalar render diagnostics are retained, never microphone audio or spectra. */
export function buildExport({ scenario, nodes, results, labelling = null, rendered = null }) {
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
    ...(rendered ? {
      rendering: {
        sample_rate_hz: rendered.sample_rate,
        samples_per_mic: rendered.length,
        duration_s: rendered.length / rendered.sample_rate,
        fft_size: nextPow2(rendered.length),
        frequency_bins: nextPow2(rendered.length) / 2 + 1,
        nodes: rendered.nodes.map((node, ni) => ({
          node_id: node.id,
          noise_band_power: rendered.activity?.[ni]?.noise_band_power ?? null,
          noise_detection_power: rendered.activity?.[ni]?.noise_detection_power ?? null,
          microphones: (rendered.audit?.[ni] ?? []).map((mic, mi) => ({
            mic_index: mi,
            sources: mic.map((paths, si) => ({
              source_id: scenario.sources[si].id,
              applied_paths: scrub(paths)
            }))
          }))
        }))
      }
    } : {}),
    ...(labelling ? { labelling: scrub(labelling) } : {})
  };
}
