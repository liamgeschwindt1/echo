function metric(value, ci, n = 6) {
  return { value, ci, n_runs: n, n_sites: n, confidence: 0.95 };
}

function buildKpi(scale) {
  const profiles = ['off', 'on', 'surveyed', 'self-calibrated'];
  const cell = (environment, source_height, motion, simultaneous_sources, value) => ({
    factors: { environment, source_height, motion, simultaneous_sources },
    status: 'reported',
    n_scenes: 6,
    metrics: {
      events_within_10m_misses_counted: metric(value, [Math.max(0, value - 0.05), Math.min(1, value + 0.05)]),
      horizontal_median_m: metric(4 - scale, [3 - scale, 5 - scale]),
      horizontal_p90_m: metric(9 - scale, [8 - scale, 10 - scale]),
      scene_fix_rate: metric(0.85 + scale * 0.03, [0.8, 0.9]),
      source_fix_rate: metric(0.8 + scale * 0.03, [0.74, 0.86]),
      unflagged_wrong_fix_rate: metric(Math.max(0.01, 0.08 - scale * 0.02), [0.02, 0.1]),
      within_1sigma: metric(0.62 + scale * 0.01, [0.57, 0.67]),
      within_2sigma: metric(0.91 + scale * 0.01, [0.87, 0.95]),
      track_median_error_m: metric(4 - scale * 0.5, [3.5, 4.5]),
      track_continuity: metric(0.82 + scale * 0.02, [0.78, 0.86]),
      time_to_fix_s: metric(2.3 - scale * 0.2, [2, 2.6])
    }
  });
  const cells = [];
  for (const environment of ['open', 'dense_urban']) {
    for (const source_height of ['ground', 'aerial']) {
      for (const motion of ['stationary', 'moving']) {
        for (const simultaneous_sources of [1, 3]) {
          cells.push(cell(environment, source_height, motion, simultaneous_sources, 0.74 + scale * 0.04 - (simultaneous_sources === 3 ? 0.15 : 0)));
        }
      }
    }
  }
  const matrix = Object.fromEntries(profiles.map((profile, index) => [profile, cells.map((entry) => ({
    ...entry,
    metrics: {
      ...entry.metrics,
      events_within_10m_misses_counted: metric(Math.max(0.1, entry.metrics.events_within_10m_misses_counted.value - index * 0.03), [0.5, 0.95])
    }
  }))]));
  const headline = Object.fromEntries(profiles.map((profile, index) => [profile, {
    events_within_10m_misses_counted: metric(0.8 + scale * 0.04 - index * 0.03, [0.72, 0.9]),
    horizontal_p90_m: metric(10 - scale - index * 0.2, [8.5, 11.2]),
    horizontal_median_m: metric(3.5 - scale * 0.4 - index * 0.1, [3, 4]),
    scene_fix_rate: metric(0.83 + scale * 0.03, [0.78, 0.89]),
    source_fix_rate: metric(0.78 + scale * 0.03, [0.72, 0.85]),
    unflagged_wrong_fix_rate: metric(Math.max(0.01, 0.07 - scale * 0.02), [0.03, 0.09]),
    within_1sigma: metric(0.61 + scale * 0.01, [0.55, 0.67]),
    within_2sigma: metric(0.9 + scale * 0.01, [0.86, 0.94]),
    error_3d_median_m: metric(null, null),
    track_median_error_m: metric(4 - scale * 0.4, [3.4, 4.4]),
    track_continuity: metric(0.82 + scale * 0.02, [0.77, 0.86]),
    time_to_fix_s: metric(2.1 - scale * 0.2, [1.8, 2.4])
  }]));
  return {
    headline,
    matrix,
    source_count_split: Object.fromEntries(profiles.map((profile) => [profile, [
      { source_count: 1, metrics: { events_within_10m_misses_counted: metric(0.9 + scale * 0.03, [0.84, 0.94]), horizontal_median_m: metric(2.4 - scale * 0.2, [2, 2.8]), horizontal_p90_m: metric(5 - scale * 0.2, [4.4, 5.6]) } },
      { source_count: 3, metrics: { events_within_10m_misses_counted: metric(0.55 + scale * 0.04, [0.49, 0.63]), horizontal_median_m: metric(7 - scale * 0.2, [6.4, 7.6]), horizontal_p90_m: metric(14 - scale * 0.3, [13.2, 14.8]) } }
    ] ])),
    node_count_curve: [2, 3, 4, 5, 6, 7, 8].map((count) => ({
      node_count: count,
      realism: 'on',
      metrics: {
        events_within_10m_misses_counted: metric(0.3 + count * 0.07 + scale * 0.01, [0.2, 0.9], 8),
        scene_fix_rate: metric(0.4 + count * 0.07, [0.3, 0.95], 8),
        source_fix_rate: metric(0.38 + count * 0.07, [0.28, 0.92], 8)
      }
    })),
    install_profile_comparison: profiles.map((profile, index) => ({
      profile,
      metrics: {
        events_within_10m_misses_counted: metric(0.85 + scale * 0.03 - index * 0.04, [0.76, 0.92]),
        horizontal_median_m: metric(3.2 - scale * 0.2 + index * 0.4, [2.9, 4.1]),
        unflagged_wrong_fix_rate: metric(0.06 - scale * 0.01 + index * 0.01, [0.03, 0.08])
      }
    })),
    detectable_subsets: profiles.map((profile) => ({
      profile,
      detectable_3_node_fraction: metric(0.63 + scale * 0.02, [0.57, 0.7]),
      detectable_3_node_events_within_10m: metric(0.8 + scale * 0.02, [0.73, 0.86])
    })),
    building_vs_open: profiles.map((profile) => ({
      profile,
      open: metric(0.89 + scale * 0.02, [0.84, 0.95]),
      building: metric(0.62 + scale * 0.03, [0.56, 0.7])
    })),
    failure_attribution: [{ cause: 'insufficient bearings', value: 0.3 }, { cause: 'duplicate fixes', value: 0.2 }],
    tracking: profiles.map((profile) => ({
      profile,
      track_median_error_m: metric(3.8 - scale * 0.4, [3.2, 4.4]),
      track_continuity: metric(0.81 + scale * 0.02, [0.76, 0.86]),
      time_to_fix_s: metric(2.3 - scale * 0.2, [1.9, 2.6])
    })),
    integrity: {
      sealed_set_run: false,
      input_sha256: `${profileHash(scale)}-input`,
      sealed_input_sha256: `${profileHash(scale)}-sealed`,
      population: { runs: 240, sites: 48 }
    }
  };
}

function profileHash(scale) {
  return `${(1000 + scale).toString(16).padStart(8, '0')}`;
}

export const fixtureRegistry = {
  engines: [
    { id: 'LE-0' },
    { id: 'LE-1' },
    { id: 'LE-2' }
  ]
};

export const fixtureEngines = {
  'LE-0': {
    engine: { id: 'LE-0', parent: null, date: '2026-11-01', status: 'baseline', source_hash: 'hash-le0', option_set: {} },
    refs: { reports: ['baselines/matrix-baseline-r3.json'] },
    kpi: buildKpi(0)
  },
  'LE-1': {
    engine: { id: 'LE-1', parent: 'LE-0', date: '2026-11-02', status: 'candidate', source_hash: 'hash-le1', option_set: { ms_gate: true } },
    refs: { reports: ['baselines/multisource-sample.json'] },
    kpi: buildKpi(1)
  },
  'LE-2': {
    engine: { id: 'LE-2', parent: 'LE-1', date: '2026-11-03', status: 'selected', source_hash: 'hash-le2', option_set: { ms_gate: true, bld_weight: true } },
    refs: { reports: ['baselines/integration-sample.json'] },
    kpi: buildKpi(2)
  }
};
