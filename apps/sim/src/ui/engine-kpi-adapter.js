export function adaptEngineKpi(kpi, engineId) {
  if (!kpi?.schema_version) return kpi;
  const metric = (value, paired = {}) => ({
    ...value,
    value: Number.isFinite(value?.value) ? value.value : null,
    ci: value?.interval95 ?? value?.ci ?? null,
    engine_id: engineId,
    paired_deltas: paired
  });
  const metrics = (values = {}) => Object.fromEntries(Object.entries(values).map(([key, value]) => [key, metric(value)]));
  const profileName = (profile) => profile.replaceAll('_', '-');
  const headline = { pooled: metrics(kpi.headline) };
  for (const comparison of Object.values(kpi.comparisons ?? {})) {
    if (!comparison?.engine_id) continue;
    for (const [key, delta] of Object.entries(comparison.metrics ?? {})) {
      if (headline.pooled[key]) headline.pooled[key].paired_deltas[comparison.engine_id] = delta;
    }
  }
  for (const row of kpi.breakdowns?.install_profile_comparison ?? []) {
    headline[profileName(row.profile)] = metrics(row.metrics);
  }
  const matrix = {};
  for (const cell of kpi.breakdowns?.matrix_24_cells ?? []) {
    for (const [profile, values] of Object.entries(cell.install_profiles ?? {})) {
      const key = profileName(profile);
      (matrix[key] ??= []).push({ factors: cell.factors, metrics: metrics(values) });
    }
  }
  const original = kpi.breakdowns?.detectable_subsets?.original_detectable_3_nodes;
  const second = kpi.breakdowns?.detectable_subsets?.second_detectability_label;
  const building = kpi.breakdowns?.building_vs_open;
  return {
    headline,
    matrix,
    source_count_split: {
      pooled: (kpi.breakdowns?.by_source_count ?? []).map((row) => ({
        source_count: row.simultaneous_sources, metrics: metrics(row.metrics)
      }))
    },
    node_count_curve: (kpi.breakdowns?.node_count_curve_2_to_8 ?? []).map((row) => ({ ...row, metrics: metrics(row.metrics) })),
    install_profile_comparison: (kpi.breakdowns?.install_profile_comparison ?? []).map((row) => ({ ...row, metrics: metrics(row.metrics) })),
    detectable_subsets: [original, second].map((row, i) => ({
      profile: `pooled/${i === 0 ? 'original' : 'second label'}`,
      detectable_3_node_fraction: metric(row?.detectable_fraction),
      detectable_3_node_events_within_10m: metric(row?.events_within_10m)
    })),
    building_vs_open: building ? [{
      profile: 'pooled', open: metric(building.open_cells), building: metric(building.building_cells)
    }] : [],
    failure_attribution: kpi.breakdowns?.failure_attribution ?? [],
    tracking: [{
      profile: 'pooled',
      track_median_error_m: metric(kpi.tracking?.track_error_median_m),
      track_continuity: metric(kpi.tracking?.continuity),
      time_to_fix_s: metric(kpi.tracking?.time_to_fix_s)
    }],
    integrity: {
      sealed_set_run: kpi.sealed?.status === 'completed',
      input_sha256: kpi.provenance?.preregistration_sha256 ?? null,
      sealed_input_sha256: kpi.sealed?.input_sha256 ?? null,
      population: kpi.provenance?.populations ?? null
    }
  };
}
