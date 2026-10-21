# Simulator technical architecture

This document explains all the simulation code under `src/sim/`, how the pieces connect, and the maths and assumptions behind each stage. It describes the code as it is now. For the product spec see [simulation.md](simulation.md) and [simulation-guide.md](simulation-guide.md).

## 1. What the simulator does

Given a scenario (nodes with 4 microphones, sound sources playing audio clips, optional concrete buildings, air and noise settings), the simulator:

1. Finds every sound path from each source to each microphone (direct, ground bounce, wall bounces, diffraction over building edges).
2. Renders the 4-channel microphone signal of every node, in the frequency domain, with delay, spreading, air absorption, reflection losses and noise.
3. Finds when each source is audible, estimates a bearing per node (GCC-PHAT + plane-wave fit), and intersects bearings into a position fix.
4. Reports uncertainty, path diagnostics, back-traced candidate positions through building reflections, and error against the known truth.
5. Optionally computes a reach map (level or SNR field), side-view sections, repeats and parameter sweeps.

It is a design tool. Free-field plus first-order geometry is optimistic. Placeholder constants (concrete absorption, diffraction formula, PHAT penalty, clip levels) are flagged `placeholder` in code and in exports.

Coordinates: metres, x east, y north, z up. Time in seconds. Pressure in Pascals inside the physics; digital floats only at the mic output.

## 2. Layout

```
sim.html                 page shell (top bar, tools, map canvas, inspector, timeline, dialogs)
src/sim/main.js          UI controller: state, map/3D drawing, inspector, timeline, playback, workers
src/sim/clips.js         clip library: manifest, generated test clips, decoding
src/sim/models.js        YAMNet + CLAP runner loading (browser only)
src/sim/renderWorker.js  worker: render+analyse, component renders, reach field
src/sim/sweepWorker.js   worker: repeated trials and sweeps
src/sim/style.css        styling
src/sim/ui/micview.js    "mic's-eye view" panel (traces, spectrogram, GCC, audit, exports)
src/sim/ui/view3d.js     orbit camera + projector for the 3D view
src/sim/core/*.js        pure, DOM-free simulation code (runs in browser, worker and Node tests)
scripts/sim-*.mjs        acceptance and calibration scripts
test/sim-*.test.js       node:test suites (see section 11)
```

Design rule: everything under `core/` is pure and deterministic given the scenario and seed. It has no DOM, no `fetch`, no global state, so it runs identically in the Web Worker, the UI thread and Node tests. `main.js` and `ui/` own all drawing and I/O.

## 3. Data model ([scenario.js](src/sim/core/scenario.js))

```
scenario = {
  version: '0.2',
  settings: { ...DEFAULT_SETTINGS },
  nodes:     [{ id, position:[x,y,z], rotation_deg, mic_layout, mic_spacing_m }],
  sources:   [{ id, clip, keyframes:[{ t, position:[x,y,z] }], level_1m_db, start_s }],
  buildings: [{ id, position:[cx,cy], size:[w,d,h], rotation_deg:0 }]
}
```

- One keyframe = a static source; `sourcePosition(src)` returns it (for a moving source, the start of its path). Two or more keyframes (times strictly increasing, scenario seconds) make a moving source that walks the polyline with linear interpolation, waiting at the first keyframe before and at the last one after (`core/motion.js`: `positionAt`, `keyframesAlong` for constant speed, `retime`). `placementErrors` also rejects paths through buildings (sampled every 0.5 m); `scenarioLengthS` runs until the last motion ends.
- Moving render (`render.js` `movingSignal`): knots at most 25 cm of travel apart (hop 10-100 ms, at most 300) over the part of the clip where the source moves; the clip is split with linear hat crossfades that sum to 1, each piece goes through `findPaths` from the knot position into a short transform (pieces padded by 2048 samples) and is overlap-added at its absolute time, then transformed once at full length. A moving source needs the receiving mic (`addSourceSpectrum(..., at = { ni, mi })`), has no full-length clip spectrum and records no audit entries. The path table (`rendered.paths`) holds it at the mid-clip reference position (`rendered.source_positions`). Cutting the far tails of the fractional-delay kernels at the piece edges makes a still path render about -40 dB off the static render.
- Analysis of a moving source: per node the truth is the emitting position for the middle of the localisation window (`emittedPosition`, fixed point on the travel time); centre paths are recomputed there and replace `rendered.paths[ni].centre[si]`; the stated uncertainty adds half the swept azimuth over the window in quadrature; the source `true_position` is the mean of the used nodes' emitting positions. Heatmap: up to 5 sub-sources along the path with crossfaded envelopes (`fieldSources`, `fieldEnvelopes`). Wavefront direct rings are centred on the emitting position; no reflected rings; the reach map uses the path start.
- Buildings are axis-aligned boxes (rotation must be 0), footprint centred on `position`, height `h`.
- `validateScenario` accepts versions `0.1` (no buildings) and `0.2`, merges settings over `DEFAULT_SETTINGS`, checks vectors and sizes, and rejects nodes or sources inside a building below its roofline (`placementErrors`).
- Defaults of note: 15 °C, 70 % RH, ambient noise 45 dB SPL (pink), mic self-noise 30 dB SPL (white), ground reflectivity 0.8, render rate 48 kHz, localisation band 200–1600 Hz, `min_snr_db` 6, `reflection_order` 1, `diffraction_model` `wedge`, `diffraction_order` 2, `path_prune_db` 50, `window_snr_db` 3, pad 10 ms, minimum window 30 ms, and optional impairments (`heading_error_sigma_deg`, `mic_gain_sigma_db`, `mic_position_sigma_mm`, `noise_correlation`) all 0.
- `scenarioLengthS` = last clip end. `renderLengthS` adds the longest travel time + 0.5 s (+0.5 s more when buildings exist, for reflections) so late arrivals are not cut off.
- New sources start at 3 s: the detector needs history to learn the noise floor.

## 4. Pipeline overview

```
Create click (main.js)
  └─ renderWorker.js
       ├─ renderScenario()        core/render.js
       │    ├─ prepareRender()    clip spectra, true mic positions, path table (geometry.js)
       │    ├─ per mic: addSourceSpectrum() for each source -> irfft -> + noise -> * digital gain
       │    └─ per node: computeActivity()  core/activity.js
       └─ analyseScenario()       core/analyse.js   (progressive: true)
            ├─ active windows + overlaps
            ├─ estimateBearing()  core/localise.js  (GCC-PHAT, LS plane wave)
            ├─ azimuthUncertaintyDeg()  core/uncertainty.js
            ├─ pathReport()       core/pathreport.js
            ├─ intersectRays()    core/localise.js
            └─ backtraceCandidates()  core/backtrace.js
  ◄─ { rendered, results }  (mic buffers transferred, not copied)
```

`main.js` stores `rendered` and `results`, flips status to `ready`, and every view (map, 3D, inspector, timeline, mic view, sound playback) reads from those two objects. Editing anything marks status `stale` and shows the "Out of date, press Create" banner.

## 5. Physics ([physics.js](src/sim/core/physics.js), [mics.js](src/sim/core/mics.js), [rng.js](src/sim/core/rng.js))

- Speed of sound `c = 331.3 + 0.606 T` m/s.
- `dbToPa` / `paToDb` with 20 µPa reference.
- `digitalPerPa`: 94 dB SPL (1 Pa rms) maps to -26 dBFS by default (assumed MEMS spec, settings `spl_ref_db`, `dbfs_ref_db`).
- `airAbsorptionDbPerM(f, T, RH, p)`: ISO 9613-1 pure-tone absorption.
- Mic layouts: `flat_square` (corners of a square, side = spacing) and `tetrahedron`. Offsets are rotated about z by `rotation_deg` and translated to the node. `MIC_PAIRS` is the 6 pairs of 4 mics.
- RNG: `mulberry32` plus `streamFor(seed, ...parts)`, an independent stream per (seed, node, mic, kind). Kinds: 1 ambient, 2 self noise, 11 heading error, 12 position error, 13 gain error, 14 common noise. Same seed gives the same result everywhere. `pinkNoise` uses Kellet's filter rescaled to the requested rms; `gaussian` is Box–Muller.

## 6. Geometry and path finding ([geometry.js](src/sim/core/geometry.js))

All path logic lives in `findPaths`. The render, wavefront rings, reach map, path diagnostics and mic view all use it, so they cannot disagree.

**Surfaces** (`buildSurfaces`): the ground plane (z = 0) and four vertical faces per building. Roofs block sound but never reflect (a `ROOF_STUB` comment marks where to add them).

**Reflection sequences** (`reflectionSequences`): ordered lists of surfaces up to `reflection_order`. Order 0 means a single ground bounce only; higher orders use all enabled surfaces. The ground is skipped when `ground_reflectivity` is 0. Consecutive repeats of the same surface are excluded.

**Image-source method** (`imagesFor`, `traceReflection`): mirror the source across each surface in sequence; trace back from the mic to the final image, intersecting each surface plane (`hit`). A path is rejected if a specular point misses the finite face, the source or mic is on the wrong side (`outward`), or any leg is blocked by a building (`segmentBlocked`, a slab test on boxes shrunk by 1e-6 so grazing is not blocking).

**Per path result**: `{ type, surfaces, length, gain, image, hits, delay_s }`. `type` is `direct`, `ground`, `wall` (any wall in the sequence) or `diffracted`. `gain` is the product of per-surface pressure gains (`surfaceGain`): ground = `ground_reflectivity`, wall = `sqrt(1 - 0.03)` (`CONCRETE_ABSORPTION` placeholder). Spreading is applied later.

**Direct path**: included unless blocked by a building and `block_direct_behind_buildings` is true.

**Diffraction, wedge model (default)** ([diffraction.js](src/sim/core/diffraction.js), [edges.js](src/sim/core/edges.js)). Each box has 8 edges (4 vertical corners `bN:edge:SW|SE|NE|NW`, 4 roof edges `bN:roof:south|north|west|east`), each a rigid 90° wedge (n = 3/2). The coefficient is the Kouyoumjian–Pathak uniform theory of diffraction with the Fresnel transition function F, complex and frequency dependent, spherical incidence (`L = s s' sin²β / (s + s')`). It is causal, and the diffracted field jumps across the shadow boundary by exactly the geometrical-optics field it replaces, so direct + diffracted is continuous (about −6 dB on the boundary). Walls use the wall factor and roofs a reflection coefficient of 0 (roofs do not reflect). Chains found by `wedgeCandidates`: order 1 = `E` (one edge); order 2 adds `SE` (reflect then edge), `ES` (edge then reflect, via the receiver image) and `EE` (two edges, on different buildings or round the same one; the grazing connecting leg halves the coefficient, the standard UTD face rule). Double diffraction uses spreading `1/sqrt(s0 s1 s2 (s0+s1+s2))` and is an engineering approximation. Slope and vertex diffraction are omitted. A path carries `diffraction = { chain, terms[], spread }` and `gain = bounce gain × spread × length` so the usual `gain/length` factor gives the UTD spreading. Each leg must be unobstructed by every building (the diffracting building's own faces are touched only along the edge; grazing allowed by the 1e-6 shrink and the angle tolerance).
- **Visibility graph** (`buildSourceGraph`, once per source, shared by the render table and the reach/heatmap grids): edges the source sees, edges seen from each single-reflection image through the reflecting face, and the cached edge-to-edge adjacency (9 samples per edge, 5×5 per pair; accepted paths are re-checked exactly). Per receiver only the receiver-side legs are tested.
- **Direct path** with the wedge model: replaced by the diffracted field in the shadow (no step); `block_direct_behind_buildings` applies only at order 0 or with the legacy model.
- **Pruning**: a path is dropped when it is more than `path_prune_db` below the strongest path at each of 250 Hz, 1 kHz and 4 kHz (`pathPressure`). `MAX_PATHS_PER_MIC` = 128 is a safety cap (keeps the strongest at 1 kHz).
- **Legacy model** (`diffraction_model: 'maekawa'`, kept for comparison and regression): when the direct path is blocked and order ≥ 1, `shortestEdgePoint` finds the point on each edge minimising src→point→mic length; legs are checked against the other buildings only; loss `min(10 log10(3 + 20 N), 20)` dB with `N = 2 δ f / c` (`diffractionLossDb`); magnitude only. Cap 64, no pruning.
- **Directions**: a diffracted path's arrival direction is mic → its last point (last edge, or the reflection point after it). A diffracted bearing back-traces to the edge, not the source.

**Caps and audit**: at most `MAX_PATHS_PER_MIC` = 64 paths (direct first, then shortest). Every rejected candidate is recorded in `dropped` with a reason: `off_face`, `blocked`, `path_cap` or `pruned` (aggregated chains the visibility graph never evaluated are one `blocked` entry with a `count`). Nothing is dropped silently.

**`computePathTable`**: per node, per mic and per source, plus an array-centre entry per source (`centre`) used for diagnostics and windows. `reflectionImages` exposes image sources for wavefront drawing, from the same enumeration.

**`simConstants()`** is written into exports so placeholders are not mistaken for measurements.

## 7. Rendering ([render.js](src/sim/core/render.js))

Rendering is done per mic in the frequency domain; there is no time-domain convolution.

1. **Source calibration** (`clipGainPa`): scale the clip so its loudest 125 ms RMS window equals `level_1m_db` at 1 m, in Pascals.
2. **Spectra** (`prepareRender`): each scaled clip is FFT'd once at size `n = nextPow2(total)`.
3. **True mic positions** (`trueMicPositions`): nominal positions, optionally perturbed by heading and per-mic position error. The estimator later assumes the nominal ones.
4. **Per path** (`addSourceSpectrum`): for each bin `k`, multiply the source spectrum by `g0 · exp(-α(f_k) · L · ln10/20)` and the phase of a delay `τ = start_s + path.delay_s`. `g0 = gain / max(length, 1)` (1/r spreading with a 1 m floor). Wedge paths use the complex diffraction filter evaluated once on a 1/12-octave grid (1 Hz to Nyquist) and interpolated linearly to the bins (`addWedgePath`); legacy diffracted paths add the Maekawa-type loss per bin. The phase rotation is applied incrementally and re-anchored every 1024 bins to avoid drift. DC goes through the same filter chain (skipping it created a pedestal in the impulse response). With `record`, each applied path is pushed to an audit list (delay in samples, gain at 1 kHz, filter description); the audit reads what the renderer did, never geometry.
5. **Summation**: all sources and paths accumulate in a complex half-spectrum, then `irfft` gives the time signal.
6. **Noise** (`noiseForMic`): ambient pink noise at `noise_floor_db_spl` plus white self-noise at `mic_self_noise_db_spl`, independent streams per mic. `noise_correlation` ρ mixes a node-wide common pink noise: `sqrt(ρ)·common + sqrt(1-ρ)·own`. `noise_enabled=false` renders silence apart from sources.
7. **Digital conversion**: `(signal + noise) * digitalPerPa * micGain`, with optional per-mic gain error.

`renderScenario` returns `{ sample_rate, length, nodes[{ id, mic_positions, mic_positions_true, mics[4] }], paths, activity, audit }`.

Because the signal is built in the frequency domain with circular FFTs, the render length always includes padding (section 3) so wrap-around lands in silence.

### Components ([components.js](src/sim/core/components.js))
`renderComponents(scenario, clips, lengthS, nodeIndex, mode)` re-renders one node with the same code and seed, split by `by_source`, `by_path` (direct / ground / wall / diffracted) or `noise`. Used by the mic view for stacked traces. Runs in the worker.

## 8. Analysis ([analyse.js](src/sim/core/analyse.js) and helpers)

### 8.1 Activity ([activity.js](src/sim/core/activity.js))
`computeActivity` produces, per source, 10 ms-frame power at mic 0 inside the localisation band, for all paths and for the direct path alone, without rendering a full-rate signal per source. It works at 1/8 decimation by taking only the low-frequency part of the spectrum, with raised-cosine band edges (`bandWeight`, 20 % skirts, so a hard cutoff does not ring and stretch windows). It also measures the in-band noise power on the actual generated noise (`noise_band_power`).

### 8.2 Active windows and overlap
- A source's **active window** at a node is first to last frame where its own in-band power is `window_snr_db` (3 dB) above noise, padded by `window_pad_ms` plus the multipath delay spread.
- Windows of other sources that intersect it are **overlaps**. Overlap statistics include seconds overlapped and a level difference (others vs own power).
- If overlapped, localisation uses the longest non-overlapped part when at least `min_window_ms` long (`localised_on: 'non_overlapped_part'`), otherwise status is `unresolved_overlap`. No window at all gives `no_signal`. Windows shorter than the minimum are widened around their midpoint.

### 8.3 Bearing ([localise.js](src/sim/core/localise.js))
- `estimateBearing` computes the six pair TDOAs with `windowTdoas`: two packed complex FFTs for the four mics and a band-limited direct evaluation of the PHAT correlation at the needed lags only (numerically equal to `gccPhat`'s up-sampled inverse FFT to ~1e-10°). `gccPhat`/`gccCurve` are kept for the mic view's curve.
- `gccPhat`: phase-transform cross-correlation of two mics, restricted to the localisation band, 4× up-sampled, parabolic peak refinement. Search range is ± spacing/c.
- `estimateBearing`: TDOA for the 6 mic pairs, then a least-squares plane-wave fit `(p_j - p_i)·u = c·τ`. The direction `u` points toward the source.
  - Flat array: z is unobservable. Solves the horizontal part, clamps `|h| ≤ 1`, and assumes the source is **below** the node (`assumed_below`, `elevation_sign_assumed`).
  - Tetrahedron: full 3D solve, normalised.
  - Returns azimuth, elevation, residual (RMS timing misfit), and an elevation confidence flag.
- `intersectRays`: weighted least-squares closest point to all rays, weight = linear SNR. Rejects the fix when any range along a ray is negative or when no two rays differ by at least 10° (`poorly_conditioned`).
- `angleBetweenDeg` helper.

### 8.4 Uncertainty ([uncertainty.js](src/sim/core/uncertainty.js))
One-sigma azimuth error from a Cramér–Rao-style timing bound: `var(τ) = (1 - γ²) / (2 T γ² (4π²/3)(f2³ - f1³))`, with `γ² = (s/(1+s))²` and `s` the linear SNR. Timing error is floored at a fraction of the up-sampled step (`INTERPOLATION_FLOOR_FRACTION`, fitted placeholder). Four mics with independent timing error give `σ_az = c σ_t / sqrt(Σ((p_k - mean)·e_az)²) / max(cos el, 0.15)`, capped at 90°. Hence the error depends on array geometry and direction. `PHAT_EFFICIENCY_PENALTY` is 1 (placeholder). `scripts/sim-uncertainty-calibration.mjs` compares this against empirical spread.

### 8.5 Per-node result (inside `analyseScenario`)
For every source and node: range, `snr_db` (own in-band power over window ÷ noise), `snr_direct_db`, legacy `snr_broadband_db`, `heard` (`snr >= min_snr_db`), bearing with uncertainty, overlap info, localisation status, `reliable` (status ok), `uncertainty_valid` (direct path picked and not an unresolved overlap), windows, true azimuth/elevation, first arrival time, azimuth error, and the `pathReport` fields.

With `progressive: true` it also computes bearings from growing windows (20 ms, doubling up to the full window). The UI draws these as a direction wedge that tightens as sound accumulates.

### 8.6 Path report ([pathreport.js](src/sim/core/pathreport.js))
From the array-centre path list: per path type, length, delay, level relative to the direct path (or strongest path when direct is blocked), diffraction loss at 1 kHz, and arrival azimuth/elevation. It then answers "which path did the bearing actually follow": the path whose arrival azimuth is within `picked_path_tolerance_deg` (5°) of the estimate. Also direct-to-reflected ratio, delay spread, first-path delay, and bearing error against direct and against the picked path.

### 8.7 Position fix per source
- Nodes used: those with a bearing that `heard` the source and are `reliable`. Nodes excluded for overlap are listed in `excluded_unreliable`.
- Fix by `intersectRays`; errors in 2D and 3D versus truth. `fix_suspect` flags use of a node whose direct path is blocked or whose bearing follows a non-direct path. `ready_s` is when the last used window ends.

### 8.8 Back-trace ([backtrace.js](src/sim/core/backtrace.js))
When bearings may be reflections (buildings present), each node's bearing is traced backwards in the horizontal plane at the node's height. At a wall hit the ray reflects (up to `reflection_order`, default 2) and continues; each stretch is a "leg" (solid for the direct line, dashed after bounces) that may contain the source. Legs from different nodes are crossed (`crossLegs`); a crossing is kept if at least two nodes have a leg passing within their bearing uncertainty (`support`) and it is not inside a building. Score = `n_nodes · angleFactor / (1 + meanPath/100)`, where `angleFactor` penalises crossings below 20°. Candidates are clustered within 1 m and ranked. `scoreAgainstTruth` reports the rank and error of the candidate nearest the true source. Only horizontal reflections are traced.

### 8.9 Detection attach ([match.js](src/sim/core/match.js))
`matchEvents` assigns each labelled detection period to the source whose audible window it overlaps most; unmatched periods are false alerts, unmatched windows are missed. `attachDetections` writes `detected`, first detection time, lag, label, confidence, agreement, YAMNet/CLAP tops onto each node result, then recomputes the fix using only nodes that detected the source, and sets `final` to the most confident node's label.

## 9. Classification ([label.js](src/sim/core/label.js), [models.js](src/sim/models.js))

`classify(audio, rate, mode, { cat, runners })` is an adapter that runs the same detection code as the phone app (`src/core/periods.js`, `catalogue.js`, `settings.js`):

- YAMNet on 0.975 s windows with 0.5 s hop, at 16 kHz (sinc resampled).
- CLAP in `clap5` (5 s / 1.25 s hop) or `clap10` (10 s / 2.5 s hop) modes.
- A 10 Hz RMS/peak level series feeds `PeriodDetector` to find event periods, then `labelPeriods` labels them with model scores. Periods are returned with `start_s`/`end_s` relative to scenario time.

`models.js` loads the catalogue (`/config/labels.json`, `priorities.json`), YAMNet through MediaPipe (`/wasm`, `/model/yamnet.tflite`) and CLAP in a separate worker (`src/clapWorker.js`). It returns the `runners` that `classify` expects, keeping models behind one interface.

Status: this classification path, plus `match.js`, is implemented and covered by `test/sim-label.test.js`, but `main.js` does not call it yet. The UI's Create step currently does render, analysis and localisation only. Detection fields appear in results only when `attachDetections` is called.

## 10. Other core modules

- [dsp.js](src/sim/core/dsp.js): radix-2 `fft` (cached twiddles), `rfft`/`irfft` half-spectrum helpers, `nextPow2`, `resampleLinear`, `resampleSinc` (windowed sinc, used before models).
- [wavefront.js](src/sim/core/wavefront.js): `analyseClip` gives per 10 ms frame RMS, spectral centroid and flatness. `wavefrontRings` returns the sphere cross-section rings on the slice plane at time `t`: the frame that left the source at `t - r/c`, amplitude scaled by 1/r exactly as the render, culled below a floor and thinned to `maxRings`. Reflected rings use image sources.
- [reach.js](src/sim/core/reach.js): reach map and side-view field. Uses `findPaths` (reflection order `reach_reflection_order`, default 2) on a grid. Powers are summed **energetically** (no phase) over three octave bands (250 Hz, 1 kHz, 4 kHz) plus a localisation-band channel, with 1/r², bounce gain², air absorption and diffraction at band centres. Source band powers come from `sourceBandLevels` (clip spectrum, scaled by `clipGainPa`). Noise power is measured deterministically (`noiseBandPowerPa2`). Output: level in dB SPL and SNR over noise per cell; cells inside buildings are masked. Grid kinds: `plan` (horizontal slice) and `section` (vertical cross-section along a line). Impulsive clips read lower than their peak since the whole-clip mean is used.
- [field.js](src/sim/core/field.js) and [ui/heatmap.js](src/sim/ui/heatmap.js): the heatmap. `computeFieldArrivals` stores for the slice height the strongest 16 arrivals per cell and source (delay + per-band pressure² gain from `findPaths`, including reflected and diffracted paths); `clipBandEnvelopes` gives 10 ms band envelopes. Pulse power at time t = Σ arrivals amp² × gain² × envelope(t − start − delay); peak-hold is its running maximum; level is the clip mean (or peak). Memory is estimated first (cells × arrivals × 5 × 4 bytes per source) and the cell size is doubled until it fits 64 MB. It runs in the second worker on the `field` message, independent of Create; the controller debounces 300 ms, shows a 4 m preview then the configured cell, caches several heights and terminates the worker to cancel superseded jobs. The slider is bound to `settings.slice_height_m`, which also drives rings and the reach map.
- [profile.js](src/sim/core/profile.js): optional stage timing (`{ ms, calls }`) used by `scripts/sim-profile.mjs`.
- [sweep.js](src/sim/core/sweep.js): `runTrials` renders and analyses once per seed (`seed + i`) and collects fix success, 2D/3D error and bearing error. `summarise` reports fix rate, median and p90 errors, and the rate of picking a non-direct path. `sweep` varies one parameter, `noise_floor_db_spl`, `distance_scale` (sources scaled around the node centroid) or `node_count`, and returns one summary row per value.
- [spectro.js](src/sim/core/spectro.js): dB magnitude spectrogram for drawing.
- [wav.js](src/sim/core/wav.js): float32 WAV encoder and arrivals CSV for exports.

## 11. UI layer

### [sim.html](sim.html) and [main.js](src/sim/main.js)
`main.js` is one module that owns all state: `scenario`, loaded `clips` (Float32Array at 48 kHz), wavefront `analyses`, `status` (`edit | rendering | ready | stale`), `rendered`, `results`, selection, view transform, playhead `t` and playback speed. It is organised in sections:

| Section | Responsibility |
|---|---|
| clips, clip picker | library from manifest and uploads, `ensureClip`, `addSource` |
| menus, settings, top bar | settings dialog bound to `scenario.settings`, speed slider (log scale), save/load JSON, export results |
| create | validates, loads clips, posts to `renderWorker`, receives `done` |
| map | pan/zoom canvas, grid and scale bar, buildings, nodes, mic glyphs, truth vs estimate and error line, direction cones/wedges, reflected paths, back-trace lines and candidates, wavefront rings, hover tooltip |
| heatmap | `ui/heatmap.js` controller: Display menu (toggle default on, mode Pulse/Peak-hold/Level, band, source, height slider with street/node/roof buttons), cached heights, legend, contour at `min_snr_db` |
| reach map and side view | grid spec, worker requests (`reach` messages, cached by key), image and contour drawing, vertical section dialog |
| picking and editing | hit-testing, dragging, building edits with placement checks |
| inspector | node, source and building fields, result panels per source and node |
| timeline | ruler, clip blocks (drag to retime), playhead, detection and error lanes |
| repeats and sweeps | `sweepWorker` runs, results dialog |
| sound during playback | plays the rendered mic signal or sources through Web Audio, kept in sync with `t` |
| loop | `requestAnimationFrame` advancing `t` by speed, redrawing map, 3D and timeline |

Because physics is deterministic, playback is just scrubbing `t` through cached results. Only Create, components, reach and sweeps compute anything.

The accent colour is used only for estimated positions and error lines.

### [ui/micview.js](src/sim/ui/micview.js)
Mic's-eye panel for the selected node: 4 waveform traces (min/max pyramid so long traces draw fast), spectrogram, arrivals table, audit table (the paths the renderer actually applied), GCC-PHAT curve per mic pair, display modes (total, by source, by path, noise), WAV and CSV export. Component series come from the worker.

### [ui/view3d.js](src/sim/ui/view3d.js)
Canvas 3D view: an orbit camera (`createCamera`, `cameraPosition`) and a perspective projector (`makeProjector`), drawing buildings, nodes, sources, cones and waves with 2D canvas calls (no WebGL).

## 12. Workers and threading

- [renderWorker.js](src/sim/renderWorker.js) handles three message types: default (render + analyse, progress at 90 % for render, then 100 %), `components`, and `reach`. Large buffers are transferred, not copied. A second instance serves reach requests so they do not queue behind a render.
- [sweepWorker.js](src/sim/sweepWorker.js) runs `runTrials` or `sweep` and reports progress.
- Models run in the main thread (YAMNet via MediaPipe) and in `clapWorker.js` (CLAP).
- Workers receive clips as `[id, Float32Array]` pairs and rebuild a `Map`; `lastCreate` snapshots the scenario at Create so component views match the results even after edits.

## 13. Clip library ([clips.js](src/sim/clips.js))

- `loadManifest` reads `/test-audio/manifest.json` (no-store cache) and keeps entries flagged `sim`, plus two generated test clips: `test_impulse` (200–1600 Hz flat) and `test_noise_burst` (50–12 000 Hz flat, exact RMS 1 so loudest-window and mean agree).
- `PLACEHOLDER_LEVELS` gives each real clip a 1 m level in dB SPL. These are placeholders (`confirmed: false`).
- `decodeToMono` decodes via `OfflineAudioContext` to 48 kHz and averages channels. `clipAvailable` guards against the SPA fallback returning `index.html` for a missing file.
- Real clips come from ESC-50 (see `scripts/fetch-sim-audio.mjs`). The simulator page is only built when `SIM_ENABLED=1` ([vite.config.js](vite.config.js)) because of the clip licence.

## 14. Determinism, units and invariants

- Same scenario + seed = bit-identical render. Noise streams are keyed by (seed, node, mic, kind).
- One path finder (`findPaths`) feeds render, rings, reach, diagnostics and mic view.
- The audit records what the renderer applied.
- The estimator assumes nominal mic positions and heading, while the renderer can use perturbed ones, to model calibration error.
- Flat arrays cannot resolve up/down; the code assumes below and flags it.
- SNR is defined in the localisation band at mic 0, own contribution (all paths) over ambient+self noise.

## 15. Tests and scripts

`npm test` runs `node --test test/*.test.js`. Simulator suites: `sim.test.js` (core), `sim-buildings`, `sim-diffraction`, `sim-backtrace`, `sim-components`, `sim-fidelity`, `sim-reference` (against `test/reference-render.js`, an independent time-domain renderer), `sim-golden` (regression against `test/golden/`, scenes in `test/golden-scenes.js`), `sim-wedge`, `sim-vertical`, `sim-field`, `sim-reach`, `sim-sweep`, `sim-label`, `sim-view3d`.

Scripts: `scripts/sim-golden.mjs` regenerates golden data, `sim-overlap-check.mjs` checks overlap and SNR with real clips, `sim-profile.mjs`, `sim-diffraction-validation.mjs` (writes docs/diffraction-validation.md), `sim-heatmap-timing.mjs`, `sim-sensitivity.mjs` (docs/sensitivity.md), `sim-uncertainty-calibration.mjs [seeds]` compares stated and empirical azimuth uncertainty, `fetch-sim-audio.mjs` downloads the clips.

## 16. Known limits

- Moving sources only along drawn straight-line segments at constant speed per path, piecewise rendering (Doppler approximated), axis-aligned buildings, specular reflections only, roofs do not reflect.
- No wind, temperature gradients or rain.
- Diffraction is wedge UTD (orders 1 and 2, double diffraction approximate, no facade scattering, no ground effects at edges); concrete absorption and several other constants are placeholders.
- Bearings only, no cross-node timing.
- Reach map and heatmap are incoherent (no interference).
- Back-trace works in the horizontal plane only.
- Classification is not yet wired into the Create flow.
