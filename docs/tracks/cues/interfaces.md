# T5 cue module interfaces

All interfaces are track-local, opt-in and placeholder-calibrated. T8 will wire them into fusion/tracking.

## `packages/sim-core/src/ext/cues/notch-height.js`

- `notchSpacingHz(notchFrequenciesHz: number[]): number | null`
  - **Input**: ascending notch frequency picks for one node.
  - **Output**: robust median notch spacing in Hz.
  - **Uncertainty**: not returned directly; propagated by `estimateHeightFromNodeCue`.
- `estimateHeightFromNodeCue(nodeCue, options?): NodeHeightEstimate`
  - **Input**:
    - `node_id`
    - `node_height_m`
    - `horizontal_range_m`
    - `spacing_hz` or `notch_frequencies_hz`
    - optional `ground_reflectivity`, `notch_snr_db`
  - **Output**:
    - `height_m`, `sigma_m`, `spacing_hz`, `warnings[]`, `usable`
  - **Uncertainty model**: spacing jitter and reflectivity penalty (placeholder).
- `estimateNotchHeightCue(nodeCues, options?): NotchHeightCueResult`
  - **Input**: list of per-node cues.
  - **Output**:
    - fused `height_m`, `sigma_m`
    - `aerial_probability`, `ground_probability`, class (`ground|aerial|unknown`)
    - per-node diagnostics.
  - **Uncertainty model**: inverse-variance fusion from per-node `sigma_m`.

## `packages/sim-core/src/ext/cues/doppler-range.js`

- `dopplerFrequencyHz({ tone_hz, speed_mps, closest_range_m, closest_time_s, sample_time_s, sound_speed_mps? }): number`
  - **Input**: tonal source kinematics and sample time.
  - **Output**: expected observed tone frequency.
- `estimateDopplerCue(samples, options): DopplerEstimate`
  - **Input**:
    - `samples[]` with `{ time_s, frequency_hz }`
    - `tone_hz`
    - optional speed/range bounds and sound speed.
  - **Output**:
    - `speed_mps`, `closest_range_m`, `closest_time_s`
    - `sigma_speed_mps`, `sigma_range_m`
    - `rmse_hz`, `usable`.
  - **Uncertainty model**: residual-scaled placeholder sigma from fit RMSE.
- `dopplerRangeMeasurementAt(estimate, timeS): { time_s, range_m, sigma_m } | null`
  - **Input**: Doppler fit and target time.
  - **Output**: range-like measurement for tracker integration.
  - **Uncertainty model**: range sigma + propagated speed sigma over `|dt|`.

## `packages/sim-core/src/ext/cues/sound-speed.js`

- `estimateSoundSpeed(observation, options?): SoundSpeedEstimate`
  - **Input**:
    - inter-node pair observations: `{ distance_m, time_s, time_sigma_s? }[]`
    - optional `temperature_sensor_c`
    - optional `nominal_temperature_c`
  - **Output**:
    - `sound_speed_mps`, `sigma_mps`
    - `correction_scale` (vs nominal speed)
    - diagnostics (`pair_count`, `used_temperature_sensor`, `usable`).
  - **Uncertainty model**: inverse-variance weighted robust mean from pair timing and sensor prior.
- `correctedDistance(distanceM, estimate): number`
- `correctedTravelTime(distanceM, estimate): number | null`

## `packages/sim-core/src/ext/cues/weather-render.js`

- `cueWeatherState(settings): CueWeatherState`
  - **Input**:
    - `cue_weather_temp_offset_c` (default `0`)
    - `cue_weather_wind_mps` (default `0`)
    - `cue_weather_wind_from_deg` (default `0`)
    - `cue_weather_wind_coupling` (default `1`)
  - **Output**:
    - `enabled`
    - `true_temperature_c`
    - `base_speed_mps`
    - `wind_vector_mps`
    - `wind_coupling`.
- `cuePathDelayS(path, sourcePosition, receiverPosition, weather): number`
  - **Input**: path metadata and direct-ray geometry.
  - **Output**: weather-adjusted propagation delay.
  - **Uncertainty model**: none yet; deterministic placeholder propagation.
