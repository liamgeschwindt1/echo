const clamp = (value, min, max, fallback) => {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function multisourceConfig(settings = {}) {
  const mode = typeof settings.ms_candidate_mode === 'string' ? settings.ms_candidate_mode : 'off'
  const associationMode = typeof settings.ms_association_mode === 'string' ? settings.ms_association_mode : 'off'
  const labelMode = typeof settings.ms_label_assist_mode === 'string' ? settings.ms_label_assist_mode : 'off'
  return {
    enabled: mode !== 'off' || associationMode !== 'off' || labelMode !== 'off',
    candidate_mode: mode, // off | multi_peak | tf_histogram | harmonic_comb
    association_mode: associationMode, // off | spectral
    label_assist_mode: labelMode, // off | oracle | injected
    max_hypotheses: Math.round(clamp(settings.ms_max_hypotheses, 1, 6, 3)),
    time_gate_s: clamp(settings.ms_time_gate_s, 0.01, 0.5, 0.08),
    azimuth_merge_deg: clamp(settings.ms_azimuth_merge_deg, 1, 25, 6),
    spectral_bins: Math.round(clamp(settings.ms_spectral_bins, 8, 128, 32)),
    harmonic_min_hz: clamp(settings.ms_harmonic_min_hz, 30, 600, 40),
    harmonic_max_hz: clamp(settings.ms_harmonic_max_hz, 80, 900, 320),
    harmonic_lines_max: Math.round(clamp(settings.ms_harmonic_lines_max, 2, 12, 8))
  }
}
