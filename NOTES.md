# Simulator notes (buildings, mic's-eye view, calculation fixes)

Written while implementing the brief. Everything here describes the code as it is, including the parts that turned out to be weak.

## 0. Answers about the code as it was before this work

These were read from the code at commit `31badd9` plus the later UI commits (before any change in this brief).

**How was `snr_db` computed?**
`snrDb(signal, a, b, settings)` in `analyse.js`: the mean power of **mic 1 only**, **broadband** (no band limit), over the source's analysis window `[a, b]`, minus the analytically known noise power (ambient noise floor and mic self-noise, converted to digital units), divided by that noise power, in dB. The subtraction is floored at 0.1 % of the noise power. The window mean included **every** sound present in the window (other sources too), because it measured the total mic-1 signal. So it was a "signal plus other sources" level over noise, not the SNR of that source alone, and it was not in the localisation band.

**How was `uncertainty_deg` computed?**
`c * max(residual_s, 1/(fs*4)) / spacing`, converted to degrees and clamped to `[1.5, 30]`. `residual_s` is the RMS of the least-squares fit residual of the 6 pair delays against the far-field model. For a clean, single-path signal the residual is a few microseconds or less, so the formula fell to its floor of 1.5 degrees almost every time. It did not depend on SNR, bandwidth, window length or geometry. It was a placeholder and it was not calibrated.

**How was `elevation_deg` derived for the flat-square layout?**
All four mics are coplanar, so the z column of the least-squares system is zero and only the horizontal direction (dx, dy) is solved. The vertical part was filled in as `dz = -sqrt(1 - |h|^2)` where `h = (dx, dy)`, i.e. "assume the source is below". When the fitted `|h|` was 1 or more (timing noise can push it over) it was **clamped** to 1, which gives `dz = 0` and an elevation of exactly 0. That is why some runs showed exactly 0 and others small non-zero numbers. The sign was assumed, never measured.

**How was the GCC-PHAT peak chosen per pair?**
Global maximum of the (4x up-sampled) correlation inside the physically possible lag range `+/-(spacing/c)` plus a few samples, followed by parabolic interpolation around that sample. No "earliest peak", no multipath handling.

**How was the localisation window chosen per source?**
From the **true** geometry: `[start + r/c - 20 ms, start + clip_duration + r/c + 50 ms]` where `r` is the distance from the source to the **node centre** and `clip_duration` is the full clip length (including silent tails). It ignored other sources entirely.

**How was `first_arrival_s` computed?**
`start_s + r/c` with `r` the straight-line distance to the node centre. Direct path only; it was not affected by anything else.

## Regression baseline

Three fixed scenes (`test/golden-scenes.js`) were rendered with the pre-change code and their fingerprints stored in `test/golden/golden.json` (signals) and `test/golden/golden-legacy-analysis.json` (bearings). `test/sim-golden.test.js` checks the signals within 1e-6 (relative) for `reflection_order` 0, 1, 2 and default, with no buildings. The legacy bearing check is skipped only if `GOLDEN_ANALYSIS=off`; it is expected to be re-baselined in phase 3 because windows, SNR and uncertainty change on purpose.

## Formulas and definitions (after this work)

**snr_db**: mean in-band (200-1600 Hz, raised-cosine edges 20 % wide) power of the source's *own* contribution (all paths summed) at mic 1, over its active window, divided by the mean in-band power of ambient plus self noise at mic 1 (measured on the generated noise). `snr_direct_db` uses the direct path only. `snr_broadband_db` is the old definition (total mic-1 power in the window, broadband). `heard` is `snr_db >= min_snr_db`.

**Active window**: first to last 10 ms frame where the source's own in-band power is `window_snr_db` (3 dB, placeholder) above the noise, padded by `window_pad_ms` (10, placeholder) and extended at the end by the path delay spread. Overlaps with other sources' windows are reported (`overlapped_with`, `overlap_s`, `level_diff_db`). With overlap, localisation uses the largest non-overlapped part of at least `min_window_ms` (30, placeholder); otherwise `localisation_status: "unresolved_overlap"`, `reliable: false`, and that node is left out of the position fix (my choice).

**uncertainty_deg** (1 sigma, azimuth): Carter / Cramer-Rao delay variance for a flat band-limited signal, `(1-g2) / (2 T g2 (4 pi^2/3)(f2^3-f1^3))` with `g2 = (s/(1+s))^2`, per-mic timing error `sigma_tau/sqrt(2)`, then a least-squares plane-wave fit: `var(az) = c^2 var_t / (cos^2(el) * sum_k((p_k - mean p).e_az)^2)`. A floor of 1/8 of a quarter-step of the up-sampled correlation applies (fitted to the calibration run, so a placeholder). `uncertainty_valid` is false when the picked path is not direct or the overlap was unresolved.

**Elevation**: flat arrays report `elevation_raw_deg` (magnitude, null when the fit was impossible and clamped), `elevation_deg` (assumed below), `elevation_sign_assumed: true`, `elevation_confidence` ("low" near the horizon or when clamped). Tetrahedron arrays solve the sign (tested).

## Results of the checks

1. **Regression**: signals identical within 1e-6 for orders 0, 1, 2 and default (`test/sim-golden.test.js`). Bearings changed on purpose (new windows): clean click sources moved 0.0 to 0.4 degrees; tone sources moved by up to 56 degrees because tones plus the ground bounce are multipath-sensitive. Old values are kept in `test/golden/golden-legacy-analysis.json`; the new baseline is `golden-phase3.json`.
2. **One-wall mirror**: direct 30.20 m, reflected 50.12 m, delay difference 58.5 ms, level -4.53 dB (test passes at 0.05 dB). Render also checked.
3. **Blocked direct path**: `direct_blocked` true, no direct component in the By-path render, `first_arrival_s` is the earliest reflection.
4. **Placement**: rejected inside a building below its roofline (core and UI).
5. **Determinism**: identical paths and signals for the same seed.
6. **Mic view consistency**: direct arrivals within one sample of `start + r_k/c` at every mic; by-source amplitude ratio matches spreading loss; component sums equal the main render.
7. **Overlap case** (`scripts/sim-overlap-check.mjs`, real clips): the horn is **not** flagged as overlapped with the fireworks. The ESC-50 horn clip is padded with silence, so its active window is 8.58-9.26 s; the fireworks' is 13.07-18.13 s. The old fixed 5 s window (8.57-13.64 s) did contain the fireworks onset: it reproduces the -22.3 degree result exactly. With the fireworks moved to 25 s the old method gives 28.7 degrees (true 27.6). The new method gives 27.6 (error 0.0) in both cases. So the hypothesis was right about the cause, but the cause was the window definition, not an overlap of real active windows.
8. **SNR**: the horn's old 37.6 dB was inflated by the fireworks onset inside its 5 s window. New broadband figure for the horn is 21.2 dB; the fireworks' is 38.8 dB, same as before. In-band energy shares: horn 33 %, fireworks 78 %, so band-limiting is not the cause. It was a bug (window contamination), now fixed.
9. **Uncertainty calibration** (`scripts/sim-uncertainty-calibration.mjs`, 10 scenes x 50 seeds): empirical-spread to stated ratio, noise only: 1.25 to 2.1 for click and burst scenes (median 1.97 over all ten), but **11 to 13 for the two pure-tone scenes** because the flat-band assumption fails for narrowband signals. With the ground bounce on, ratios are 1.8 to 3.5 (bias from the bounce is not in the formula). This does not meet "roughly 1 to 2" for tones or with the ground bounce. Before lowering the timing floor the median was 1.15 (noise only) and 1.52 (ground on) but the stated value was nearly constant (about 0.2 degrees) in every scene, so it did not track the signal; I chose the more honest version.
10. **Sweeps** run with buildings and report the share of trials where a reflection was picked.
11. **UI**: smoke-tested in headless Chromium (open, Create, select node, mic view, by-source components, add building by dragging, stale banner, wedges at several playhead times) with no console errors. Resize handles and delete were not exercised by script.

## Not done or done differently

- Alternative "earliest strong peak" estimator: not added (optional).
- Stretch realism settings (heading error, gain mismatch, mic position error, correlated noise) exist in the scenario and render but have no UI controls.
- Create time: about 11 s for the 3-node, 1-source demo in headless Chromium (progressive wedge analysis included). I did not measure the old time or the 4-node, 4-source, 6-building scene.
- The info panel now distinguishes the coherent microphone SNR from the incoherent reach-map estimate (see the update below).
- Time-resolved wedges: bearings from growing windows (20 ms doubling) are precomputed at Create and shown by the playhead.

## First-order diffraction (option, default off)

`diffraction_order` is 0 or 1 (default 0). At 0 nothing changes: no diffracted paths, signals identical (test `diffraction_order 0 changes nothing`, plus the golden scenes). It is saved, loaded and exported with the scenario settings and marks results stale when changed.

At 1, a microphone whose direct path is blocked gets one diffracted path per building edge: the four vertical corners and the four roof edges. On each edge the point with the shortest source-edge-microphone length is found (golden-section search; the sum of distances is convex along an edge). The path is kept only if both legs miss all *other* buildings. The diffracting building itself is not checked, because the brief says "other buildings": it is treated as a screen at that edge. For a thick box this lets a leg pass through the building's own volume, which a real path could not do; a real path round a box needs two bends (not modelled).

Path model: delay = length / c, spreading 1 / length (1 m floor), air absorption on the total length, then a frequency-domain loss `min(10 log10(3 + 20 N), 20)` with `N = 2 delta / lambda`, `delta` = total length minus the straight-line distance, `lambda = c / f`. Diagnostics list the path with type `diffracted`, surface id `b1:corner-sw` or `b1:roof-north`, and the arrival direction is from the array centre to the edge point. `level_db_re_direct` uses the loss at 1 kHz as one broadband figure. By-path view, arrival markers, picked-path logic and `fix_suspect` treat it like any non-direct path.

**ISO 9613-2 check**: I could not open the standard here (no copy in the repo, no network use), so this is from memory of ISO 9613-2:1996 section 7.4: single diffraction attenuation `Dz = 10 lg(3 + (C2 / lambda) C3 z Kmet)`, `C3 = 1` for single diffraction, `Kmet = 1` (no meteorology here), `C2 = 20` when ground reflections are treated separately and `C2 = 40` when they are not, and the result capped at 20 dB for single diffraction (25 dB for double). The brief's `3 + 20 N` with `N = 2 delta / lambda` equals `3 + 40 delta / lambda`, i.e. `C2 = 40`, which fits because diffracted paths get no separate ground bounce here. The 20 dB cap matches. Please check these numbers against the standard text before relying on them; this is an engineering approximation, the formula is for thin screens, and applying it only to blocked paths makes the level step at the shadow boundary.

Checks: loss is 4.77 dB at N = 0 (about 5 dB) and hits the 20 dB cap for large N; a node behind a 100 m tall building (source off to one side) reports a bearing at a corner (error against the true source more than 10 degrees) and the picked path is `diffracted`; on a thin screen the 200 Hz tone is 5.8 dB quieter-loss than 3 kHz, less than the 9 dB a single path would give because several edge paths add up. Diffracted loudness is now drawn using cached path-finder probes (see below).

## Shared 3D display and microphone fidelity update

### What was duplicated

Before this update, audio, components and node diagnostics already used `geometry.findPaths`, with paths calculated separately for each microphone. The ring display did not: it enumerated wall-only image sources and called `segmentBlocked`/`traceReflection` directly. It omitted the ground image and diffracted paths and did not follow the renderer's blocking toggle or path cap. `findPaths` also contained a second implementation of the reflection backtrace already present in `traceReflection`.

The backtrace now has one implementation. Audio, diagnostics, ring visibility, the reach field and side view all obtain their paths from `findPaths`. Image enumeration only proposes sphere cross-sections; every drawn arc sample is validated by the finder, including finite face bounds, height, blocking and the cap. Cached screen-space visibility probes cull invisible candidates; narrow features below the 8-pixel probe spacing can be omitted, but illuminated arc samples still receive an exact path check. Candidate-only queries are used only when the maximum possible path count cannot reach the global cap. Ground and mixed ground/wall images are included; the first ground image has height `-z_source`.

The production spectral summation and default microphone signals were deliberately preserved. The new noise-off switch bypasses ambient and self-noise; it does not subtract noise after rendering. Analysis handles infinite noise-free SNR and silent sources without NaNs.

### Reach map and side view

Use **Display → Reach map**, choose all sources, the selected source, or an explicit source, and press **Compute reach / side view**. The grid covers the current viewport at the slice height. Cell size defaults to 2 m; `reach_reflection_order` defaults to 2 independently of the existing audio `reflection_order`. Set both orders equal for comparisons. Draw a line with **Draw side view** to calculate a vertical section; height markers are projected onto that line and labelled with their perpendicular offset.

Three non-overlapping two-octave bands have nominal centres 250, 1000 and 4000 Hz and limits 125–500, 500–2000 and 2000–8000 Hz. “Total” is the sum of these bands, not full-Nyquist broadband SPL. Clip spectral powers come from the loudest 125 ms window, normalized with the renderer's `clipGainPa`. Each path contributes squared pressure gain: inverse 3D distance (1 m floor), each bounce coefficient once, air attenuation at the band centre, and diffraction loss at that centre. Path and source powers add incoherently. Localisation-band estimates use 24 spectral groups and the analysis band's raised-cosine weights.

Noise uses the analytic stationary spectrum of the actual Kellet pink ambient generator plus white microphone self-noise. SNR uses noise integrated over the same bands. With noise off it is infinite wherever signal power is nonzero. Greyscale is 0–100 dB SPL or 0–50 dB SNR; the amber contour is `min_snr_db`. Building interiors are masked; a slice above a roof is not masked by its footprint. Order 0 diffraction is labelled **no diffraction (pessimistic)**.

`fieldWorker.js` computes grids and sections with progress. Prepared spectra and completed UI results are cached. Scene edits cancel outstanding requests and mark previous overlays stale. Panning or zooming leaves the calculated world bounds unchanged until recomputed. Requests exceeding 60,000 cells, 30 million estimated reflection-candidate checks, or 4,194,304 clip samples fail explicitly instead of silently changing resolution.

Rings retain `rho = sqrt((c*(t-t0))² - dz²)` and brightness spreading based on the 3D radius, not plan-view radius. Reflection candidates include ground and mixed bounces. Diffracted loudness uses 12-pixel path probes and retarded clip-frame RMS, not a fictitious circle centred on a building corner. Rings are a loudness display, not true wavelengths; their centroid-based attenuation is a visual approximation rather than an audio reconstruction.

The model still uses flat concrete boxes, one placeholder energy absorption coefficient of 0.03, no roof reflections, no wind or temperature gradients, no interference in the field map and first-order diffraction only. The existing thin-screen approximation can let a diffracted leg traverse its own building; it tests other buildings only. This was not changed because changing it changes rendered audio.

### Render audit and independent reference

`rendered.applied_paths[node][mic]` is recorded inside spectral accumulation, not reconstructed afterwards. It includes source index, surface sequence, delay in samples, spreading/bounce gain, source calibration, microphone digital gain and filter parameters, including actual attenuation at a probe bin near 1 kHz. `dropped_paths` saves renderer path-finder decisions: blocked direct paths, missed finite faces, wrong-side reflections, blocked legs, disabled elements and cap removals.

The Mic's-eye audit compares saved applied values with a fresh query to the shared geometry, and flags delay errors above 0.05 sample or gain/filter errors above 0.05 dB. Dropped rows come from the saved render, not the fresh query. Total and component signals still use the same spectral/noise helpers; their full-sample relative sum error is tested below `1e-6`.

`test/fidelity-reference.js` is test-only: explicit windowed-sinc fractional-delay and independently integrated per-path filter impulse responses, direct time-domain convolution, and summation. It does not call the production FFT renderer. The comparison scenes use noise off; random noise has a separate independently mixed reference.

### Measured checks

Commands: `npm test`; `SIM_ENABLED=1 npm run build`. Existing golden signal regressions pass. The simulator build passed; the existing third-party ONNX bundle emits an `eval` warning. Browser checks exercised reach computation, progress completion, drawn sections and stale-on-edit with no JavaScript exceptions.

| Check | Measured result |
| --- | --- |
| 90 dB, 1 kHz free-field source, 10 → 20 m | 69.99907 → 63.97847 dB SPL; drop 6.02060 dB |
| Equal 10 m slant ranges in different plan directions/heights | Same 70 dB level within 0.02 dB |
| Horizontal 10 m, receiver raised by 10 m | 66.98877 dB SPL; 3.01030 dB below same-height receiver |
| Straight corner shadows at x=20 / 40 / 60 m | Boundaries y=±10 / ±20 / ±30 m; ±0.01 m probes flip visibility |
| Slice raised from 10 to 15 m | Shadow starts x=15.111116 → 24.000008 m in the test viewport |
| Finite 6 m wall | Hit z=5.99 m reflects; hit z=6.01 m does not |
| Radius at 0.1 s, 0°C / 25°C | 33.130 / 34.645 m at equal height; 31.584757 / 33.170409 m with dz=10 m |
| Ground coefficient 0.8, 10 m, both ends 1.5 m high | Ground length `sqrt(109)` m; incoherent total 72.00527 dB SPL |
| One-wall mirror, air and ground off | Direct 30.20 m, reflected 50.12 m; approximately 58.5 ms later, −4.53 dB |
| Blocked building scene at `[20,0,1.5]` | No-diffraction level `-Infinity`; diffraction enabled 52.14521 dB SPL |
| Reference residual: free / ground / wall | −147.716 / −146.804 / −144.766 dB relative |
| Reference residual: blocked direct with reflections / air / diffraction | −147.117 / −145.807 / −82.646 dB relative |
| Component sum, worst full-sample relative error | `5.124e-8` |
| 500 Hz fractional-delay phase error, worst microphone | `3.772e-8` sample |
| 200–1600 Hz band-limited impulse reference residual | −150.32390 dB |
| Ambient / self-noise, requested 40 / 25 dB SPL | 40.00000 / 24.91255 dB SPL |
| Independently mixed digital noise reference | Relative error ≤ `2.52945e-8`; in-band error ≤ `1.86505e-8` dB |
| Built-in impulse / noise burst at 1 m, configured 90 dB | 89.99998 / 89.99970 dB SPL in reach field |
| Noise-off burst microphone versus localisation-band reach energy | +0.002930 dB |
| Broadband burst localisation SNR, reach versus node | 31.164898 versus 30.878911 dB; gap 0.285987 dB |
| Field benchmark, 10,000 cells, two buildings, reflection order 2 | 522 ms in this environment |

Air absorption is ISO 9613-1 pure-tone attenuation as implemented in `physics.airAbsorptionDbPerM`: classical `f²` absorption plus oxygen/nitrogen relaxation terms, using temperature, relative humidity and pressure (101.325 kPa by default). Field bands use 250/1000/4000 Hz; the renderer evaluates the formula at every FFT frequency. The test at 1 kHz, 100 m checks the field loss against `100*alpha(1000,15,70,101.325)`. This is an implementation-consistency check, not an independent validation against published tables. Diffraction uses `min(10 log10(3 + 40*delta*f/c),20)` dB: 4.77121 dB at the shadow edge, increasing with path excess up to 20 dB, with less loss at low frequency.

### Acceptance failures retained visibly

The following strict assertions remain in test output as failing **TODO** checks; a zero test-process exit code does **not** mean all requested acceptance criteria were met. Thresholds were not relaxed and the audio renderer was not adjusted to hide these failures.

1. **Broadband fractional impulse:** residual −33.502 dB, not below −60 dB. The legacy FFT removes Nyquist and uses periodic rather than finite windowed-sinc interpolation. The requested localisation-band click passes, but a full-band impulse does not.
2. **Circular wraparound:** an out-of-window delayed impulse leaks first-512-sample RMS `0.00128677`, rather than below `1e-8`. The existing `nextPow2(total)` transform does not reserve the longest delay plus filter support. Padding/filter changes would alter the preserved audio baseline.
3. **Stationary noise-band prediction:** eight-second noise realizations differ from the analytic 200–1600 Hz stationary model by −0.24323, −0.00734, +0.31644 and +0.24164 dB across microphones, failing ±0.2 dB. Broadband noise level and deterministic digital composition pass. The generator normalizes finite pink-noise realizations in broadband, not each subband.
4. **Universal reach/node SNR agreement:** a 1 kHz tone with destructive ground interference at 26.355 m gives incoherent localisation reach SNR 24.874677 dB versus coherent node SNR 8.934793 dB: gap 15.939884 dB, not within 1 dB. These quantities cannot universally match while the map ignores interference and the audio is preserved. Moreover, the displayed three-band SNR is not the node's localisation-band SNR, and the map uses peak 125 ms levels rather than the node's active window. The broadband free-field comparison above passes; it is not a universal guarantee.

The final full-suite run reported 103 passing checks and four documented TODO failures; the four targeted audit-UI checks also passed. The reference scenes and delay phase check currently run at 8 kHz, while the display and normal microphone render use 48 kHz. There is not yet a full independent per-band rendered-air-loss/diffraction-tone certification at 48 kHz, nor a measured anti-alias flatness sweep over the localisation band. Existing arrival, temperature and diffraction tests remain in place. These are limits of the verification, not claims of completed certification.
