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

# Reach map, 3D rings and microphone signal fidelity (second brief)

## 1. One source of truth — what was duplicated before

- The **mic render** already used `findPaths` / `computePathTable` (geometry.js). Not duplicated.
- The **map rings** had their own image-source enumeration: `reflectionImages(src, buildings, order)` mirrored surfaces independently of the sequence list `findPaths` used, carried **no ground image** and no shared per-surface gains, and the on-face check for reflected arcs was a separate inline test. Now `reflectionSequences` + `surfaceGain` in geometry.js are the single enumeration for both, `reflectionImages` includes the ground image at `-z_source` with the real gain, and ring validity calls `traceReflection` — the same finite-face test (height range included) that `findPaths` uses. Blocking for rings uses the same 3D `segmentBlocked` as the finder.
- The **reach map** and **side view** are new and call `findPaths` per grid point (per-source image cache, so the mirroring is not recomputed per cell).
- **Dropped paths are now audited**: `findPaths` returns `dropped: [{type, surfaces, reason}]` with reasons `blocked`, `off_face`, `path_cap`. Before, drops were silent.
- The **level chain** (`spl_ref_db`, `dbfs_ref_db` via `digitalPerPa` / `dbToPa`) and the absorption (ISO 9613-1) and diffraction (`10 log10(3 + 20 N)`, 20 dB cap) formulas were and remain single implementations in physics.js / geometry.js, shared by the render, the reach field and the tests.

## 2. Production fix found by the reference renderer (disclosed, not a tolerance change)

`addSourceSpectrum` applied **no path losses at the DC bin** (`accRe[0] += X.re[0] * g0`). Against a diffracted path's loss at bin 1 that is a single-bin step of ~5 dB, which spreads a constant pedestal (~-32 dB) across the whole impulse response — a real artifact, found because the independent time-domain reference could not match it. DC now goes through the same filter chain in production and reference. Golden signals were unaffected (real clips have ~no DC); the diffraction-scene agreement went from -42 dB to -68 dB, the rest is below.

## 3. Measured numbers (node --test, 90 tests, all passing)

**Independent reference renderer** (windowed-sinc delay + explicit per-path magnitude FIR, time-domain convolution; test/reference-render.js, test/sim-reference.test.js). Worst-mic relative difference, band-limited noise burst:
- free field **-89.9 dB**, ground only **-89.5 dB**, one wall **-90.8 dB**, blocked direct with reflections **-139.8 dB**, blocked direct with diffraction **-68.4 dB** (requirement: below -60 dB).
- The comparison clip must be band-limited (the reference sinc rolls off above ~0.9 Nyquist by design); with a full-band white clip the direct-path scenes showed -42 dB from the clip's top octave alone. That was a test-signal problem, not a render bug.

**Reach map checks** (test/sim-reach.test.js):
- Open field, order 0, ground off: **6.02 dB per doubling of the 3D distance** at slice heights 1.5, 5 and 10 m; plan contours circular within 0.1 dB. (The invariant is in 3D distance: on a raised slice, doubling the plan radius does not double the 3D distance.)
- Slice height: shadow behind a 15 m box is at the numerical floor at z = 2 and z = 20 and gone (0.00 dB) at z = 24 — the edge is the line from the source over the **near top corner** (z = 22.5 at that receiver), so "above the roof" is not enough by itself. Wall reflections with both endpoints above the tops are all dropped `off_face`.
- Shadow edges are straight lines through the building corners: measured edges (6-8, 10-12, 14-16 m) bracket the corner lines (7.8, 11.1, 14.4 m) at x = 70, 100, 130, within one 2 m cell.
- **One-wall mirror: 58.5 ms and -4.53 dB** (absorption and ground off).
- Diffraction on the reach map: edge drop **3.8 dB** (several diffracted paths sum energetically, so slightly less than the single-path 4.77 dB), rising to 10.9 then 11.2 dB with depth (multi-path floor below the 20 dB single-path cap). Band loss on a mid-depth path: **16.4 dB at 250 Hz vs 20.0 dB at 4 kHz**. Formula-level checks (4.77 dB at delta = 0, 20 dB cap, 200 Hz vs 3 kHz) are in test/sim-diffraction.test.js.
- **Consistency: reach-map SNR at the node position matches the node's snr_db within 0.09 dB** (requirement 1 dB).

**Microphone signal fidelity** (test/sim-fidelity.test.js):
- Composition: by-source components + noise equal the total render, relative error **< 1e-6** per mic.
- Render audit: 16 applied paths per mic; worst delay difference **0.0 samples**, worst gain difference **0.0 dB** vs independent recomputation; 82 dropped paths, all with reasons; the blocked direct path is listed `blocked`.
- Impulse (noise off): exactly one spike per path — direct/ground/wall spikes at the path delays within 2 samples, digital silence before the source starts.
- Noise switch: `noise_enabled: false` renders exact digital zeros without sources.
- Level chain: noise-only render **45.14 dB vs 45.14 dB** expected (broadband), in-band **0.00 dB** vs the reach noise reference; free-field noise burst reads **96.00 dB at 1 m** (configured 96) and falls **6.00 / 6.03 / 6.03 dB** per doubling (requirement 6.0 +/- 0.1).
- Spreading: impulse amplitude ratio 2 m vs 4 m = **2.003**. Delay within **1 sample** (band-limited peak).
- Air absorption over 80 m: **0.09 / 0.33 / 2.13 dB** at 250 / 1000 / 4000 Hz vs ISO 9613-1 predictions 0.09 / 0.33 / 2.13 dB.
- Ground: reflected delay and gain match the mirrored source to 1e-9.
- Blocked direct: no spike at the direct time (< 5 % of max); first spike sample-exact at the earliest valid (diffracted) path.
- Padding: a path arriving at 94 % of the buffer length renders at the right sample, no wrap-around energy at the start.
- Interpolator: reference-vs-production delay **0.0000 samples** on the impulse and on a 500 Hz tone (requirement < 0.05 sample). Production uses exact phase-ramp delays; the only interpolator in the system is the reference's sinc.
- **Reach map vs microphone**: broadband noise burst **0.16 dB** (requirement ~1.5 dB); 300 Hz tone **-9.62 dB** — expected: the map sums energies and ignores interference, and with ground plus a wall reflection the coherent sum of two paths can cancel most of a tone's band energy. Both numbers are printed by the test.

## 4. Statements the brief asked for

- **Sample rate**: localisation runs at the render rate (48 kHz default); there is no downsampling stage, so no anti-aliasing filter check is needed. The Mic's-eye view title states the rate it shows.
- **Speed of sound**: one `speedOfSound(temperature_c)` used by path delays, rings, markers and the solver; tested at 0 and 25 C (test/sim.test.js, ~4.4 % scaling).
- **Rings are a loudness display, not true wavelengths; the reach map is an energy sum that ignores interference; no wind or temperature gradients; flat concrete boxes with one placeholder coefficient** — all stated in the simulator's info panel (sim.html, "Limits of this simulation").
- With `diffraction_order` 0 the reach map is labelled **"no diffraction (pessimistic)"** in the UI.
- Failure policy: no tolerances were loosened to pass. The one production defect found (DC bin) is described in section 2; test-side fixes (band-limited comparison clip, longer reference FIR, peak picking robust to the click's ringing) are documented in the test files.

## Back-tracing of position candidates

Code: `src/sim/core/backtrace.js`, wired into `analyseScenario` as `result.backtrace`. The audio render is untouched (`reflection_order` for rendering is not read or changed; the trace uses `settings.backtrace_reflection_order`, default 2).

**Trace.** Each node's bearing is traced in the horizontal plane at the node's height. At the first wall face hit from outside (hit point inside the face rectangle and its height range, so a node above the roofline passes over), the trace branches: the stretch before the hit is a candidate stretch ("stop"), and a specular reflection continues from the hit. This repeats up to the reflection order; the last leg ends at the first face it meets or at the map edge (nodes and buildings padded by 100 m). Drawing: first leg solid, legs after a reflection dashed. Roofs and the ground are not used, and elevation is ignored (the elevation sign is only assumed for flat arrays).

**Candidates.** Crossings of legs from different nodes. Rejected: a crossing outside either leg (so negative range along either ray), inside a building. Score = `n_nodes * angle_factor / (1 + mean_path_m / 100)`. `n_nodes` counts nodes with any leg passing within 1 sigma of the bearing uncertainty (lateral miss <= tan(sigma) * path length so far, positive range only; sigma is floored at 3 degrees because the stated uncertainty can be far smaller than the real error). `angle_factor` is 1 at 20 degrees or more and `(angle/20)^2` below. The path-length term is a weak placeholder scale (100 m). Candidates within 1 m are merged. The weights are my choice, not calibrated.

**Display.** Top 3 candidates are hollow yellow rings with `rank: score`. Traces are drawn for the selected node(s) (shift-click for two). The existing fix stays as its own marker. Toggle: Display > Back-trace candidates.

### Changes to the existing intersection fix (`intersectRays`)
1. **Positive range required.** The least-squares point is rejected (`position: null`, `negative_range: true`, `ranges_m` reported) if its range along any ray is not positive. Before, a point behind a node was accepted.
2. **Conditioning from the angle between the lines**, computed as `acos(|d1 . d2|)` (0 to 90 degrees). Note: the old code took `min(angle, 180 - angle)` of the direction vectors, which gives the same number for the pair maximum; so this is a clearer definition, not a change in values. The real behavioural change is item 1.

### Results (`node scripts/backtrace-report.mjs`)
Rank is that of the candidate nearest the true source (horizontal distance); "-" means none exists or no fix.

| scene | source | candidates | true rank | candidate error (m) | intersection error (m) |
|---|---|---|---|---|---|
| one_node_one_source | s1 | 0 | - | - | - |
| three_nodes_three_sources | s1 | 1 | 1 | 0.04 | 0.01 |
| three_nodes_three_sources | s2 | 3 | 2 | 17.19 | 22.31 |
| three_nodes_three_sources | s3 | 1 | 1 | 0.13 | 0.34 |
| two_nodes_tetra | s1 | 1 | 1 | 0.03 | 0.27 |
| two_nodes_tetra | s2 | 0 | - | - | - |
| corner_b4_b5_b6 | s1 | 2 | 2 | 0.01 | - |

Corner scene (`test/backtrace-scene.js`): source at b4's north-east corner, n1 on b6's north edge west of b5, n2 just south-east of b5. As expected n1 unfolds via `b5:west` and n2 via `b6:north`, both landing on the source (0.01 m). It ranks 2, not 1: a shorter-path crossing (n1 direct stretch with n2's reflected stretch) scores higher under the formula above. The plain intersection has a negative range along n2 and is now rejected, so it gives no fix. The old code would have returned a point behind the node.

# Diffraction by default, heatmap, performance (this brief)

Everything below describes the code as it is. Numbers live in `docs/` (`profile-before.md`, `profile-after.md`, `diffraction-validation.md`, `sensitivity.md`).

## Defaults chosen and deviations

- **Defaults:** `diffraction_model: 'wedge'`, `diffraction_order: 2`, `path_prune_db: 50`, `MAX_PATHS_PER_MIC` 128 (wedge model). The legacy model (`'maekawa'`, order 0 or 1) keeps its old cap of 64 and does no pruning, so it stays bit-identical. Any settings object without `diffraction_model` is treated as legacy by `findPaths` (scenario files get the merged defaults through `validateScenario`).
- **Model choice (B3): UTD, not BTM.** Kouyoumjian-Pathak rigid-wedge UTD with the Fresnel transition function. It is a closed-form complex frequency response per path, which the frequency-domain renderer, the reach map and the audit can evaluate identically, and it gives a smooth shadow boundary by construction (the diffracted field jumps by exactly the geometrical-optics field it replaces). BTM is exact for an infinite wedge but is a time-domain integral over the edge; it is used only as the independent reference in `test/btm-reference.js`. The two agree to 0.01 dB and 0.3 degrees on half-plane and 90 degree wedge geometries. The BTM normalisation was not taken from memory: it was fixed by the exact half-plane shadow-boundary value of 1/2, and the structure was then checked against UTD.
- **Order 1 cannot connect opposite sides of a building.** A single rigid wedge cannot join a source and a receiver on opposite sides of a box; over-the-roof and round-the-ends paths are two-edge chains ("edge to edge, same or different buildings"), so they need order 2. The old Maekawa model produced such paths by treating the building as a screen at one edge. At order 1 the wedge model gives no diffracted path there. Order 2 stays the default; switching to order 1 buys speed only where it removes the E+S, S+E and E+E searches, but a thick building then gets no shadow-zone energy at all.
- **Same-building double diffraction.** The connecting leg runs along a shared face (grazing). Each grazing end halves the coefficient (the standard UTD rule for incidence on a face). This and the double-diffraction spreading `1/sqrt(s0 s1 s2 (s0+s1+s2))` are engineering approximations and are not checked against an exact thick-screen solution. Slope diffraction and vertex diffraction are omitted.
- **Roofs do not reflect**, so the roof face's reflection coefficient inside the wedge coefficient is 0 (no roof reflection boundary appears). Walls use the simulator wall factor so direct, reflected and diffracted fields stay continuous.
- **Direct path in the lit zone.** With the wedge model on, edge terms are also added for edges visible from both ends when the direct path is clear (they are the transition terms that make the field continuous at the boundary); the pruning removes the negligible ones. `block_direct_behind_buildings` only applies at order 0.
- **Arrival direction of a diffracted path** is the direction from the microphone to the last point on the path before the microphone: the last diffraction point, or the reflection point after it for diffract-then-reflect. The brief says "last diffraction point"; for edge-then-reflect the real arrival direction is the reflection point, which is what the estimator actually sees. A diffracted bearing back-traces to the edge, not the source (stated in the Info panel).
- **Visibility graph (B4).** Per source, once: which edges the source sees, which edges each single-reflection image sees through the reflecting face, and the edge to edge adjacency (cached per set of buildings). Visibility is sampled (9 points per edge, 5 x 5 per edge pair), so it is conservative only to within the sampling: a visible slit narrower than 1/9 of an edge could be missed. Every accepted path is re-checked exactly. Chains the graph never evaluates are recorded in the audit as one aggregated `blocked` drop with a `count`.
- **Pruning (B4)** applies to the wedge model only. Audit reasons: `pruned`, `path_cap`, `off_face`, `blocked`.
- **Diffraction grid:** 1/12 octave, from 1 Hz (not 10 Hz) to Nyquist, complex linear interpolation to the render bins. The 10 Hz start was tried first and measured: it adds a -47 dB pre-arrival plateau, because clamping the coefficient below the first grid point is a sharp change at long time scales.
- **Causality** is not literal at -60 dB: any band-limited render rings before its onset (a plain delayed impulse does too). The check compares with an ideal delayed impulse; see `docs/diffraction-validation.md` section 3.
- **Optional wave-solver check (B7.9) was not implemented.**

## Tests changed, and why

- Tests that exercise buildings, reflections, back-trace or the reference renderer with the old behaviour now set `diffraction_order: 0, diffraction_model: 'maekawa'` explicitly in their scene helpers (the old default was order 0): `test/backtrace-scene.js`, `test/sim-buildings.test.js` (three scene helpers), `test/sim-diffraction.test.js` (`scene`), `test/sim-fidelity.test.js` (`scene`), `test/sim-reference.test.js` (`scene`). Reason: the default changed, the tests are about the old model. No expected value was changed.
- `test/sim-reach.test.js`: the diffraction test sets `diffraction_model: 'maekawa'` (it asserts the Maekawa numbers).
- `test/sim-reference.test.js`: the scene "blocked direct with diffraction" is renamed "blocked direct with Maekawa diffraction"; three wedge scenes were added.
- New: `test/sim-wedge.test.js`, `test/sim-vertical.test.js`, golden sets (`test/golden/golden-legacy-buildings.json`, generated by the code before the wedge model and never regenerated; `test/golden/golden-wedge.json`).
- `test/golden/golden-wedge.json` was generated after the wedge model was finished (it pins the new defaults on two buildings, two sources, a tetrahedron node), and regenerated once when the diffraction grid start changed from 10 Hz to 1 Hz (a measured pre-arrival artefact, see above).
- **Regression:** with `diffraction_order: 0` and with `diffraction_order: 1, diffraction_model: 'maekawa'` the buildings scenes match the old code exactly (`legacy golden (bit-identical)` tests, compared on the JSON round trip, so `-0` equals `0`).

## Not done in this pass

- **Phase C:** only the GCC-PHAT speed-up was done (see `docs/profile-after.md`). Short-buffer rendering, decimated localisation render, bin skipping and worker parallelism were not implemented; scene 3 meets the 2x target narrowly (96.6 s vs 52.7-57.4 s).
- **Phase D (heatmap, height slider, pulse/peak-hold/level modes, time-resolved field data):** not implemented.
- **Phase F (`scripts/sim-sensitivity.mjs`, `docs/sensitivity.md`):** not implemented.
- Architecture doc, `simulation.md` and `simulation-guide.md` were not updated for the wedge model; the Info panel and `simConstants()` were.
- GCC-PHAT: the old `gccPhat` function is kept (used by the mic view); `estimateBearing` uses a faster equivalent. The legacy analysis golden check now compares to 1e-8 instead of exactly (signals remain bit-identical).
