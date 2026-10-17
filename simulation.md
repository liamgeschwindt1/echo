# Estate Acoustics simulator: build instructions (MVP)

Version 0.1 · 17 Oct 2026 · for the developer or Claude Code

## 1. Purpose

A web simulator that answers two questions the phone rig cannot:

1. How far away can each sound label still be classified once distance, air and noise lower the level?
2. How accurately can a few 4-microphone nodes put an event on a map?

It is a design tool, not validation. Free-field results are optimistic. Do not present simulated detection rates as evidence that the real system works or that buyers will pay.

## 2. Scope

**In the MVP**

- Top-down black-and-white map with a metre scale.
- Every object has x, y, z coordinates (metres; x east, y north, z up). Physics runs in 3D. The display is a flat top-down slice.
- Nodes with four microphones, with an editable mic layout.
- Sound sources placed from a clip library, arranged on a video-editor-style timeline.
- Free-field propagation plus air absorption, ground reflection and temperature and humidity.
- A **Create** step that renders every mic signal, runs YAMNet and CLAP, localises each event and caches everything.
- Play, pause, speed control and scrubbing of the cached result.
- Wavefront display generated automatically from the audio of each clip.
- Save and load scenarios as JSON.

**Deliberately out of scope for now**

- Buildings, walls, obstacles, reflections other than the ground, diffraction.
- Moving sources (but see the keyframe rule in section 5).
- Wind, temperature gradients, rain.
- Scenario clock time and priority by hour. The output shows label, group and confidence, not the hour-based priority.
- Background and decoy tracks. A decoy such as fireworks is simply another clip the user can place. A single scenario-wide noise level still exists (section 6.5), because without it everything is audible at any distance.
- 3D view (the next version).
- Cross-node timing (TDOA between nodes). Localisation uses bearings only, so loose clock sync is not modelled.

## 3. Open decision before starting

**Standalone page or inside the developer's repo (`/workspaces/echo`)?**

Reusing the developer's CLAP and YAMNet code means the simulator tests exactly what runs on the phone. This spec is written standalone-first. All model access goes through the adapter in section 7, so the developer's pipeline can replace the standalone one without touching the rest. If the repo is used, import its catalogue (81 labels, groups, target-share rule, YAMNet corroboration) and do not reimplement it.

The CLAP checkpoint and the real logit scale (the developer's 18.66 is unconfirmed) must be confirmed in either case.

## 4. User interface

Layout: top bar, left toolbox, centre map, right inspector, bottom timeline.

**Colour scheme.** Black page, white lines and text, greys for secondary elements. One accent colour only, used for estimated positions and error lines. No other colours.

**Top bar**

- Create (primary button), Play/Pause, speed control, time readout.
- Scenario settings: temperature (°C), relative humidity (%), noise floor (dB SPL), ground reflectivity (0 to 1), random seed.
- Save, Load.

**Toolbox (left)**

- Select/move, Add node, Add source (opens the clip library), Delete.

**Map (centre)**

- Square metre grid with a scale bar, pan and zoom.
- Nodes drawn as a small square with four dots for the mics. Sources drawn as a dot with a label.
- Ground-truth position in white, estimated position in the accent colour, with a line between them for the error.
- Wavefront rings (section 8) drawn over the map. A "slice height" setting (default 1.5 m) sets which horizontal plane the rings are shown on.
- Objects can be dragged while editing. After Create, sources and nodes are locked to stop results going stale unnoticed (an edit unlocks and marks results stale, see section 9).

**Inspector (right)**

- Node: position x, y, z (default z = 5 m), rotation, mic layout preset (flat square, tetrahedron), mic spacing (default 0.10 m).
- Source: clip, position x, y, z (default z = 1.5 m), level at 1 m (dB SPL), start time.
- Result panel for the selected node: four waveforms, a spectrogram, and the YAMNet and CLAP labels over time with the agreement flag.

**Timeline (bottom), like a video editor**

- Time ruler, a playhead you can drag, and one track per source with the clip as a draggable block (drag to set start time).
- Clip length is fixed by the audio. No trimming in the MVP.
- Extra result lanes under the tracks: first detection per node (with lag after the true onset), and localisation error over time.
- Scenario length is automatic: end of the last clip plus 10 s, so CLAP's lag is visible.
- Zoom the timeline horizontally.

**Playback**

- Speed from 0.05x to 4x, plus scrub by dragging the playhead. Scrubbing and playback only read the cache, so they are instant.
- Audio is muted below 1x. At 1x, an optional "listen at node/mic" selector plays that mic's rendered signal. This is optional and can be deferred.

## 5. Data model

All positions are x, y, z in metres. A source's position is stored as a keyframe list with exactly one keyframe, so moving sources can be added later without changing the format.

```json
{
  "version": "0.1",
  "settings": {
    "temperature_c": 15,
    "humidity_pct": 70,
    "pressure_kpa": 101.325,
    "noise_floor_db_spl": 45,
    "mic_self_noise_db_spl": 30,
    "ground_reflectivity": 0.8,
    "slice_height_m": 1.5,
    "seed": 1,
    "render_sample_rate": 48000,
    "localisation_band_hz": [200, 1600]
  },
  "nodes": [
    {
      "id": "n1",
      "position": [0, 0, 5],
      "rotation_deg": 0,
      "mic_layout": "flat_square",
      "mic_spacing_m": 0.10
    }
  ],
  "sources": [
    {
      "id": "s1",
      "clip": "gunshot_01",
      "keyframes": [{ "t": 0, "position": [40, 10, 1.5] }],
      "level_1m_db": 120,
      "start_s": 12.0
    }
  ]
}
```

Mic positions are computed from the node position, rotation, layout and spacing. Flat square puts the four mics at the corners of a horizontal square. Tetrahedron uses a regular tetrahedron with the same edge length.

## 6. Physics

Use metres, seconds and Pascals internally. Convert to dB SPL only for display and settings.

### 6.1 Speed of sound

`c = 331.3 + 0.606 * T` (T in °C). Use this value everywhere: the delays in the render, the ring expansion speed and the localisation solver. They must all read the same number.

### 6.2 Path from a source to a mic

For each source and each mic compute the 3D distance `r`. The direct path has:

- **Delay** `r / c`, applied with fractional-sample precision (section 6.6).
- **Spreading loss** pressure scaled by `1 / r`, with `r` floored at 1 m (the level is defined at 1 m).
- **Air absorption** a frequency-dependent filter with attenuation `alpha(f) * r` dB, where `alpha(f)` follows ISO 9613-1 for the scenario's temperature, humidity and pressure. Apply it as a frequency-domain magnitude filter on the source signal for that path. Higher frequencies fade faster, so distant sounds arrive duller.

### 6.3 Ground reflection

For a flat open ground plane at z = 0, add one reflected path from the mirror-image source at `(x, y, -z)`. It has its own distance, delay, spreading loss and air absorption, and is scaled by `ground_reflectivity` (0 turns it off). The direct and reflected paths interfere, which gives realistic level dips. This also slightly biases localisation, which is a realistic effect and should be left in. Default 0.8 is a placeholder for hard ground, not a measured value.

### 6.4 Source level

Each clip in the library has a `level_1m_db` default. The clip is scaled so that its loudest 125 ms RMS window equals the level at 1 m. The user can override it per source. The defaults are placeholders to be confirmed; mark them `confirmed: false` in the manifest.

### 6.5 Noise

- **Ambient noise:** pink noise at `noise_floor_db_spl` at the mic, generated independently per mic from the seeded generator.
- **Mic self-noise:** white noise at `mic_self_noise_db_spl`, independent per mic.

Independent noise per mic is pessimistic for localisation, because real ambient noise is partly correlated between nearby mics. Note this in the UI help text.

The conversion from SPL to digital level assumes 94 dB SPL = -26 dBFS (a typical MEMS microphone spec). This is an assumption and should be an editable constant. The phone rig's level calibration is different.

### 6.6 Fractional delays

Mics 10 cm apart differ by up to about 0.3 ms, which is about 14 samples at 48 kHz. Render at 48 kHz, apply fractional delays with a windowed-sinc interpolator or in the frequency domain, and downsample to each model's sample rate (16 kHz for YAMNet, and whatever CLAP needs) after mixing. Integer-sample delays will make the bearings look quantised and must not be used.

## 7. Render pipeline (the Create button)

Run in a Web Worker with a progress bar. For each node, build four mic signals for the whole scenario:

1. For each source, take the clip, apply level scaling, then for each mic add the direct path and the ground-reflected path (sections 6.2 and 6.3).
2. Sum all sources, then add the ambient noise and mic self-noise per mic (section 6.5).
3. Store the four signals at 48 kHz.
4. **Classification.** Resample the reference mic (mic 1) to each model's rate and run it through the models with the same windows as the rig: YAMNet 0.975 s windows, CLAP 5 s window with a 1.25 s hop and 10 s windows about every 2.5 s as a selectable mode. Apply the existing label groups, group scoring, target-share rule and YAMNet corroboration. Do not apply priority by hour.
5. **Localisation** (section 9).
6. Cache everything: signals, spectrograms, model readings, detections, bearings, position estimates and errors.

**Model adapter.** All model access goes through one function so the developer's pipeline can replace it:

```
classify(audio: Float32Array, sampleRate: number, mode: "clap5" | "clap10")
  -> { yamnet: [{t, scores}], clap: [{t, scores}], periods: [...], labels: [...] }
```

The output labels and groups must match the live rig's catalogue. Include `app` and `catalogue` version fields in the exported results.

## 8. Wavefront display

The rings are a stylised but physically consistent display, generated automatically from each clip's audio. No per-sound hand-authored shapes.

**On clip load (once), compute per 10 ms frame:**

- **RMS loudness** sets ring brightness.
- **Spectral centroid** sets line thickness: low and rumbly is thick and smooth, high is thin.
- **Spectral flatness** sets grain: tonal sounds are clean, noisy sounds are speckled.

**At draw time**, for a source at position `P` and a time `t`, a point at 3D distance `r` from the source shows the clip's frame at time `t - r / c`, with brightness scaled by `1 / r`. This makes the rings the clip's own history travelling outwards, so a gunshot makes one sharp ring and a siren makes a continuous train. The map draws the cross-section of these spheres on the slice-height plane. The visible radius on the slice is `sqrt((c*(t - t0))^2 - dz^2)`, where `dz` is the height difference between the source and the slice.

**Rules**

- The draw must use the same `c` and the same `1 / r` loss as the render, so what you see is what the nodes hear.
- A toggle turns the tone and grain styling on or off (default on). When off, rings are plain loudness pulses.
- A ring that falls below the noise floor fades to nothing.
- Use the precomputed curves, not a live audio analyser. This keeps scrubbing, pause and slow motion free and the scenario deterministic.
- Coarsen the ring spacing automatically when many rings would be on screen, so it stays smooth at high playback speeds.
- Add a visible note: this is loudness over time, not true wavelength.

## 9. Localisation

Runs on the raw four-channel signals, not on CLAP. CLAP only says what the sound was.

**Per node, per detected event window:**

1. Band-limit to `localisation_band_hz` (default 200 to 1600 Hz). With 10 cm spacing, spatial aliasing starts near `c / (2 * spacing)`, about 1.7 kHz, so the default stays below it. A wide-band or high-pitched sound such as a screech will therefore localise worse, which is an expected and useful result. Make the band editable.
2. Compute GCC-PHAT between each of the six mic pairs to get the time difference of arrival, with sub-sample peak interpolation.
3. Solve for the direction vector `d` in the far-field model `(p_j - p_i) · d = c * tdoa_ij`, by least squares over the six pairs. Report an azimuth, an elevation and a residual as a quality measure.

**A flat square array cannot tell above from below.** Assume the source is below the node (nodes sit on lamp posts) and say so in the UI. The tetrahedron layout removes the ambiguity, so the sim can show the difference.

**Across nodes:**

- A single node gives a ray (bearing and elevation) with no range. Draw the ray and report no position.
- Two or more nodes with reasonably non-parallel rays: take the point that minimises the sum of squared perpendicular distances to the rays. Weight each ray by the node's SNR. Report the estimated x, y, z, the error to the true position and the geometry quality (the angle between rays, or the condition number).
- If the rays are nearly parallel, flag the result as poorly conditioned instead of giving a confident position.

**Event matching:** match detections to sources by time overlap with the source's true window. Unmatched detections count as false alerts, and sources with no matching detection count as missed.

## 10. Outputs

For each source:

- True position, estimated position, error in metres (horizontal and 3D).
- SNR at each node.
- Per node: first detection time and lag after the true onset, YAMNet and CLAP top labels, group, target share, agreement flag and any rule flags.
- Final label and confidence.

For the scenario: the number of missed events and false detections. Export the whole result as JSON, including the settings and the seed, so any run can be reproduced.

## 11. State handling

- **Edit** → press Create → **Rendering** → **Ready**.
- In Ready, any edit (move a node, change a clip, temperature, noise, seed) marks the results **stale**. Show a clear "Out of date, press Create" banner and grey the stale results. Do not silently show old results against the new layout.
- Same scenario plus same seed must produce identical results.

## 12. Clip library

- Bundle the planned 15 test clips (13 from ESC-50, gunshot from UrbanSound8K, a scream from a separate source) with a `manifest.json` giving each clip's id, file, expected label, group and a placeholder `level_1m_db` with `confirmed: false`.
- Allow users to upload their own WAV files.
- ESC-50 and UrbanSound8K are non-commercial. Fine for this sim, but they must be kept out of any production build.
- Do not use AudioSet clips to judge YAMNet, since it was trained on them.

## 13. Build order

Test each phase before starting the next.

**Phase A: geometry and physics, no models.** Map, nodes, sources, timeline, propagation and render, wavefront display, bearing and position estimation. Verify with the checks in section 14 using clean test tones and clips.

**Phase B: models.** Plug in YAMNet and CLAP through the adapter, add the results panel and detection lanes.

**Phase C: repeats and sweeps.** Run the same scenario with N seeds (default 50) and report detection rate and error spread. Add a sweep that varies distance, node count and noise level and plots detection rate and position error. This starts to answer how many sensors a site needs.

**Phase D: polish.** Save and load, the optional "listen at mic", the timeline zoom, the stale-result handling.

## 14. Acceptance checks

1. Level halves in pressure (drops 6 dB) per doubling of distance, with air absorption and ground reflection switched off.
2. The delay at each mic equals `r / c` to within a fraction of a sample, and changing the temperature from 0 to 25 °C changes the delays by about 4%.
3. With absorption on, a distant gunshot has measurably less energy above 4 kHz than a near one.
4. A single node with a gunshot at 20 m and high SNR recovers the bearing to within about 2°, and a 3-node setup recovers the position to within about 1 m. Treat these as sanity thresholds to adjust, not as product claims.
5. A high-pitched tone at 3 kHz localises worse than a broadband click, using the default band.
6. The tetrahedron layout resolves the above/below ambiguity that the flat square does not.
7. Same scenario and seed gives bit-identical exports.
8. Rings on the map arrive at each mic at the same time the render places the sound in that mic's signal.
9. The scrubber moves to any time with no re-render, and an edit after Create shows the stale banner.

## 15. Known limits to state in the UI

- Free field plus ground only. Street canyons will be worse, and this is where the sim is most optimistic.
- Uniform temperature and humidity, no wind, static sources.
- Level calibration constants, source levels and ground reflectivity are placeholders until confirmed.
- Localisation timing is only as good as the simulated mics, with no hardware jitter, clock drift or mic mismatch.
- The wave display is stylised. It shows loudness, tone and noisiness, not true wavelength.

## 16. Later versions (not now)

- 3D view with spheres and a free camera.
- Buildings and walls, with image-source reflections and then ray tracing with diffraction.
- Moving sources (more keyframes per source).
- Scenario clock time and priority by hour, background tracks, and decoy tracks.
- Cross-node timing with a clock-error setting.
- Calibration against real recordings from the phone rig at known distances.