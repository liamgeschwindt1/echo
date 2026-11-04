// The seven exported runs (schema 0.3) the sim-upgrade brief was written from, as fixtures. Each scenario is copied
// from the export's `scenario` block (settings, nodes, sources, buildings); `before` keeps the 0.3 results that matter
// for the before/after comparison (per-node azimuth error and reported sigma, fix error, fix height, track fixes).
// The full 0.3 exports are not stored: rerendering the scenario with the same seed reproduces the audio.
// SIMULATED results only: unvalidated physics, no housing scattering, wind, rain or facade scattering.
import { validateScenario } from '../scenario.js';

// Settings shared by every export (scenario version 0.2). Keys added in 0.4 take their defaults.
const SETTINGS = {
  temperature_c: 15, humidity_pct: 70, pressure_kpa: 101.325, noise_floor_db_spl: 45, mic_self_noise_db_spl: 30,
  ground_reflectivity: 0.8, slice_height_m: 1.5, seed: 1, render_sample_rate: 48000, localisation_band_hz: [200, 1600],
  min_snr_db: 6, reflection_order: 1, block_direct_behind_buildings: true, diffraction_model: 'wedge', diffraction_order: 2,
  heatmap_backdrop: 0.25, path_prune_db: 50, picked_path_tolerance_deg: 5, window_snr_db: 3, window_pad_ms: 10,
  min_window_ms: 30, heading_error_sigma_deg: 0, mic_gain_sigma_db: 0, mic_position_sigma_mm: 0, noise_correlation: 0,
  air_absorption: true, spl_ref_db: 94, dbfs_ref_db: -26, noise_enabled: true, reach_cell_m: 2, reach_reflection_order: 2
};

// ball12_d180 offsets exactly as the exports carry them (mic_layout 'custom').
const BALL12 = [
  [0.0546, 0, 0.0715], [-0.0273, 0.0473, 0.0715], [-0.0273, -0.0473, 0.0715],
  [0.0442, 0.0766, 0.0169], [-0.0884, 0, 0.0169], [0.0442, -0.0766, 0.0169],
  [0.0884, 0, -0.0169], [-0.0442, 0.0766, -0.0169], [-0.0442, -0.0766, -0.0169],
  [0.0273, 0.0473, -0.0715], [-0.0546, 0, -0.0715], [0.0273, -0.0473, -0.0715]
];

const ball = (id, x, y) => ({
  id, position: [x, y, 5], rotation_deg: 0, mic_layout: 'custom', mic_spacing_m: 0.1,
  mic_array: 'ball12_d180', mic_array_name: '12-mic icosahedral ball, D180', mic_offsets_m: BALL12.map((p) => [...p])
});
const flat = (id, x, y) => ({ id, position: [x, y, 5], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 });
const fixed = (id, clip, x, y, level, start) => ({ id, clip, keyframes: [{ t: 0, position: [x, y, 1.5] }], level_1m_db: level, start_s: start });
const moving = (id, clip, start, t0, p0, t1, p1) => ({
  id, clip, keyframes: [{ t: t0, position: [...p0, 1.5] }, { t: t1, position: [...p1, 1.5] }], level_1m_db: 95, start_s: start
});
const box = (id, x, y, w, d) => ({ id, position: [x, y], size: [w, d, 15], rotation_deg: 0 });

const CORRIDOR = [box('b7', 20.75, 54.25, 144.5, 32.5), box('b8', 21, -9.5, 143, 30)];
const LONG_CORRIDOR = [box('b7', -23.0625, 100.1875, 300.875, 30.375), box('b8', -24.5, -4, 298, 21)];
const GLASS_CORRIDOR = fixed('s1', 'glass_breaking', 25, 20, 100, 3);
const GLASS_OPEN = fixed('s1', 'glass_breaking', 36.2, 75.3, 100, 3);

// n(az error deg, reported sigma deg); fix: horizontal / 3D error m and fix z m (null when no fix).
const n = (az, sigma) => ({ az, sigma });
const fix = (h, d3, z) => ({ horiz_m: h, err3d_m: d3, z_m: z });

export const EXPORT_SCENES = {
  // results.json: ball + flat square in a street corridor. 0.3 fix 90.6 m off (2-node ray crossing at 18 deg).
  corridor_mixed: {
    file: 'results.json',
    scenario: { nodes: [ball('n9', -95.6, 23.1), flat('n11', 133.4, 21.4)], sources: [GLASS_CORRIDOR], buildings: CORRIDOR },
    before: { s1: { nodes: { n9: n(2.48, 0.0425), n11: n(0.21, 0.0720) }, ...fix(90.57, 90.59, -0.36), track_fixes: 10 } }
  },
  // results (1).json: same corridor, both balls. 0.3: no fix (rays 3.6 deg apart).
  corridor_ball: {
    file: 'results (1).json',
    scenario: { nodes: [ball('n9', -95.6, 23.1), ball('n11', 133.4, 21.4)], sources: [GLASS_CORRIDOR], buildings: CORRIDOR },
    before: { s1: { nodes: { n9: n(2.48, 0.0425), n11: n(0.67, 0.0383) }, ...fix(null, null, null), track_fixes: 1 } }
  },
  // results (2).json: same corridor, both flat squares. 0.3: 5.5 m horizontally but z = -29 m underground.
  corridor_flat: {
    file: 'results (2).json',
    scenario: { nodes: [flat('n9', -95.6, 23.1), flat('n11', 133.4, 21.4)], sources: [GLASS_CORRIDOR], buildings: CORRIDOR },
    before: { s1: { nodes: { n9: n(2.28, 0.0782), n11: n(0.21, 0.0720) }, ...fix(5.52, 31.41, -29.42), track_fixes: 14 } }
  },
  // results (3).json: long corridor, far nodes (205 m and 98 m). 0.3: 44 m off, z = -10 m.
  long_corridor_far: {
    file: 'results (3).json',
    scenario: { nodes: [ball('n9', -168.8, 76.8), flat('n11', 113.7, 14.9)], sources: [GLASS_OPEN], buildings: LONG_CORRIDOR },
    before: { s1: { nodes: { n9: n(4.42, 0.0748), n11: n(1.82, 0.0694) }, ...fix(44.39, 45.88, -10.10), track_fixes: 8 } }
  },
  // results (4).json: long corridor, nearer nodes. 0.3: 0.9 m (the good case).
  long_corridor: {
    file: 'results (4).json',
    scenario: { nodes: [ball('n9', -86.6, 78.8), flat('n11', 59.2, 13.3)], sources: [GLASS_OPEN], buildings: LONG_CORRIDOR },
    before: { s1: { nodes: { n9: n(0.27, 0.0544), n11: n(0.47, 0.0458) }, ...fix(0.93, 2.91, 4.26), track_fixes: 12 } }
  },
  // results (5).json: five nodes, seven buildings. 0.3: 21 m with two bad bearings (n9 no signal, n18 77 deg off).
  five_node: {
    file: 'results (5).json',
    scenario: {
      nodes: [ball('n9', -86.6, 78.8), flat('n11', 59.2, 13.3), ball('n18', -42.8, 145.8), ball('n19', -53.3, -17.6), ball('n20', 78.3, 124.3)],
      sources: [GLASS_OPEN],
      buildings: [
        box('b7', -22, 79.5, 39, 29.875), box('b8', -70.5, 6.5, 45.5, 35), box('b13', 106.25, 9, 35.5, 42),
        box('b14', 103, 115.75, 42, 40.5), box('b15', 65.75, 63.75, 35.5, 31.5), box('b16', 21.75, -28.5, 44.5, 45),
        box('b17', -72.25, 134.5, 52.5, 29)
      ]
    },
    before: {
      s1: {
        nodes: { n9: n(67.77, 90), n11: n(0.40, 0.0631), n18: n(77.44, 0.0436), n19: n(5.21, 0.0683), n20: n(1.72, 0.0252) },
        ...fix(21.05, 21.08, 2.58), track_fixes: 10
      }
    }
  },
  // results (6).json: four nodes, seven sources (three moving engines, three horns, glass). 0.3: one fix (s8).
  seven_source: {
    file: 'results (6).json',
    scenario: {
      nodes: [ball('n1', 11.5, 22.4), ball('n2', 27.3, -17), ball('n3', 13.3, 59.7), ball('n7', -37.5, 36.9)],
      sources: [
        fixed('s1', 'glass_breaking', 25, 20, 100, 3),
        moving('s8', 'engine', 0, 0, [20.5, 53.9], 5, [20.3, 31.9]),
        moving('s9', 'engine', 0.62, 0.62, [-26.4, 29.7], 5.62, [2, 29.9]),
        moving('s10', 'engine', 1.14, 1.14, [21.3, -2.8], 6.14, [20.7, 17.5]),
        fixed('s11', 'car_horn', -14.6, 35.8, 105, 0.37),
        fixed('s12', 'car_horn', 23.8, 43.3, 105, 4.04),
        fixed('s13', 'car_horn', 17.6, 4.3, 105, 3)
      ],
      buildings: [box('b4', -10.25, 48.25, 41.5, 16.5), box('b5', 47.375, 22.625, 33.75, 67.25), box('b6', -16.5, 4.25, 51, 30.5)]
    },
    before: {
      s1: { nodes: { n1: n(27.16, 0.0149), n2: n(1.40, 0.0160), n3: n(13.81, 0.0153), n7: n(0.65, 0.0233) }, ...fix(null, null, null), track_fixes: 0 },
      s8: { nodes: { n1: n(6.03, 0.428), n2: n(5.49, 0.391), n3: n(3.44, 4.98), n7: n(13.96, 6.53) }, ...fix(3.62, 3.83, 0.23), track_fixes: 3 },
      s9: { nodes: { n1: n(177.02, 13.69), n2: n(28.18, 2.99), n3: n(48.48, 6.80), n7: n(5.57, 1.07) }, ...fix(null, null, null), track_fixes: 0 },
      s10: { nodes: { n1: n(112.16, 90), n2: n(169.30, 64.82), n3: n(82.40, 90), n7: n(88.42, 90) }, ...fix(null, null, null), track_fixes: 0 },
      s11: { nodes: { n1: n(2.80, 0.0146), n2: n(29.39, 0.340), n3: n(90.21, 0.2305), n7: n(8.62, 0.0147) }, ...fix(null, null, null), track_fixes: 0 },
      s12: { nodes: { n1: n(7.20, 0.0147), n2: n(3.44, 0.0213), n3: n(1.71, 0.0147), n7: n(21.90, 0.0428) }, ...fix(null, null, null), track_fixes: 0 },
      s13: { nodes: { n1: n(56.33, 0.0150), n2: n(9.68, 0.0146), n3: n(1.20, 0.0191), n7: n(19.44, 0.108) }, ...fix(null, null, null), track_fixes: 0 }
    }
  }
};

export const EXPORT_IDS = Object.keys(EXPORT_SCENES);

export function exportScenario(id, settings = {}) {
  const { scenario } = EXPORT_SCENES[id];
  return validateScenario({ version: '0.2', settings: { ...SETTINGS, ...settings }, ...structuredClone(scenario) });
}
