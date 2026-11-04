// Display adapter only. Horizontal measured fixes use an explicitly assumed display height, never scored as 3D.
export function testingEditorResults(run) {
  if (run.job.analysis_mode === 'truth_assisted') return run.inference;
  const { scenario, inference, scores } = run;
  return scores.sources.map((score) => {
    const fix = score.measured_fix_index === null ? null : inference.fixes[score.measured_fix_index];
    const nodes = scenario.nodes.map((node, ni) => {
      const key = fix?.node_tracks.find((key) => key.startsWith(`${ni}:`));
      const track = key ? inference.nodes[ni].tracks[Number(key.split(':')[1])] : null;
      const w = track?.windows.at(-1), scoring = score.nodes[ni];
      const az = (w?.az_deg ?? 0) * Math.PI / 180;
      return {
        node_id: node.id, range_m: scoring.range_m, snr_db: null, bearing: w ? {
          azimuth_deg: w.az_deg, elevation_deg: 0, elevation_sign_assumed: true, elevation_confidence: 'unavailable',
          direction: [Math.cos(az), Math.sin(az), 0], uncertainty_deg: inference.options.bearing_sigma_deg
        } : null,
        azimuth_error_deg: scoring.az_error_deg, heard: !!track, usable: !!track, reliable: !!fix?.reliable,
        localisable: !!track, localisation_status: track ? 'measured_track' : 'no_track',
        window_policy: 'measured_track', window_s: w ? [w.t_s - inference.options.window_ms / 2000, w.t_s + inference.options.window_ms / 2000] : null,
        first_arrival_s: track?.windows[0]?.t_s ?? 0, uncertainty_valid: !!track,
        progressive: null, overlapped_with: []
      };
    });
    return {
      source_id: score.source_id, true_position: scenario.sources.find((s) => s.id === score.source_id).keyframes[0].position,
      nodes, track: null, heard_nodes: nodes.filter((n) => n.heard).length, usable_nodes: nodes.filter((n) => n.usable).length,
      error_horizontal_m: score.horizontal_m, error_3d_m: null,
      fix: fix ? {
        position: [...fix.final_position, scenario.settings.source_height_prior_m], method: 'measured_track_horizontal',
        inlier_nodes: nodes.filter((n) => n.usable).map((n) => n.node_id), rejected_nodes: [],
        fix_suspect: score.suspect, suspect_reasons: [fix.low_confidence ? 'two_node_only' : null, fix.ambiguous ? 'ambiguous_association' : null, !fix.reliable ? 'unreliable_track' : null].filter(Boolean),
        z_clamped: true, ready_s: 0, max_angle_deg: null, poorly_conditioned: false
      } : null
    };
  });
}
