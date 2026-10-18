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
- Info panel text for the new SNR definition was not updated.
- Time-resolved wedges: bearings from growing windows (20 ms doubling) are precomputed at Create and shown by the playhead.

## First-order diffraction (option, default off)

`diffraction_order` is 0 or 1 (default 0). At 0 nothing changes: no diffracted paths, signals identical (test `diffraction_order 0 changes nothing`, plus the golden scenes). It is saved, loaded and exported with the scenario settings and marks results stale when changed.

At 1, a microphone whose direct path is blocked gets one diffracted path per building edge: the four vertical corners and the four roof edges. On each edge the point with the shortest source-edge-microphone length is found (golden-section search; the sum of distances is convex along an edge). The path is kept only if both legs miss all *other* buildings. The diffracting building itself is not checked, because the brief says "other buildings": it is treated as a screen at that edge. For a thick box this lets a leg pass through the building's own volume, which a real path could not do; a real path round a box needs two bends (not modelled).

Path model: delay = length / c, spreading 1 / length (1 m floor), air absorption on the total length, then a frequency-domain loss `min(10 log10(3 + 20 N), 20)` with `N = 2 delta / lambda`, `delta` = total length minus the straight-line distance, `lambda = c / f`. Diagnostics list the path with type `diffracted`, surface id `b1:corner-sw` or `b1:roof-north`, and the arrival direction is from the array centre to the edge point. `level_db_re_direct` uses the loss at 1 kHz as one broadband figure. By-path view, arrival markers, picked-path logic and `fix_suspect` treat it like any non-direct path.

**ISO 9613-2 check**: I could not open the standard here (no copy in the repo, no network use), so this is from memory of ISO 9613-2:1996 section 7.4: single diffraction attenuation `Dz = 10 lg(3 + (C2 / lambda) C3 z Kmet)`, `C3 = 1` for single diffraction, `Kmet = 1` (no meteorology here), `C2 = 20` when ground reflections are treated separately and `C2 = 40` when they are not, and the result capped at 20 dB for single diffraction (25 dB for double). The brief's `3 + 20 N` with `N = 2 delta / lambda` equals `3 + 40 delta / lambda`, i.e. `C2 = 40`, which fits because diffracted paths get no separate ground bounce here. The 20 dB cap matches. Please check these numbers against the standard text before relying on them; this is an engineering approximation, the formula is for thin screens, and applying it only to blocked paths makes the level step at the shadow boundary.

Checks: loss is 4.77 dB at N = 0 (about 5 dB) and hits the 20 dB cap for large N; a node behind a 100 m tall building (source off to one side) reports a bearing at a corner (error against the true source more than 10 degrees) and the picked path is `diffracted`; on a thin screen the 200 Hz tone is 5.8 dB quieter-loss than 3 kHz, less than the 9 dB a single path would give because several edge paths add up. Wave rings still do not diffract.
