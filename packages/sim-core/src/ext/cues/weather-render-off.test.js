import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScenario } from '../../render.js';

const hash = (signal) => signal.reduce((acc, x, i) => acc + x * (i % 101), 0);

function scenario() {
  return {
    version: '0.2',
    settings: {
      temperature_c: 15,
      humidity_pct: 70,
      pressure_kpa: 101.325,
      noise_floor_db_spl: 40,
      mic_self_noise_db_spl: 25,
      ground_reflectivity: 0.4,
      seed: 7,
      render_sample_rate: 48000,
      localisation_band_hz: [200, 1600],
      min_snr_db: 6,
      reflection_order: 1,
      block_direct_behind_buildings: true,
      diffraction_model: 'wedge',
      diffraction_order: 2,
      path_prune_db: 50,
      picked_path_tolerance_deg: 5,
      window_snr_db: 3,
      window_pad_ms: 10,
      min_window_ms: 30,
      heading_error_sigma_deg: 0,
      mic_gain_sigma_db: 0,
      mic_position_sigma_mm: 0,
      noise_correlation: 0,
      air_absorption: true,
      spl_ref_db: 94,
      dbfs_ref_db: -26,
      noise_enabled: false,
      analysis_mode: 'truth_assisted',
      cue_weather_temp_offset_c: 0,
      cue_weather_wind_mps: 0,
      cue_weather_wind_from_deg: 0,
      cue_weather_wind_coupling: 1
    },
    nodes: [
      { id: 'n1', position: [0, 0, 5], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 }
    ],
    sources: [
      {
        id: 's1',
        clip: 'tone',
        keyframes: [{ t: 0, position: [25, 10, 30] }],
        level_1m_db: 95,
        start_s: 1
      }
    ],
    buildings: []
  };
}

test('cue weather options at zero keep render output identical', () => {
  const clips = new Map([['tone', Float32Array.from({ length: 48000 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 480 * i / 48000))]]);
  const baseScenario = scenario();
  const weatherScenario = scenario();
  delete baseScenario.settings.cue_weather_temp_offset_c;
  delete baseScenario.settings.cue_weather_wind_mps;
  delete baseScenario.settings.cue_weather_wind_from_deg;
  delete baseScenario.settings.cue_weather_wind_coupling;
  const a = renderScenario(baseScenario, clips, { lengthS: 3 });
  const b = renderScenario(weatherScenario, clips, { lengthS: 3 });
  for (let mi = 0; mi < a.nodes[0].mics.length; mi++) {
    assert.equal(hash(a.nodes[0].mics[mi]), hash(b.nodes[0].mics[mi]));
  }
});
