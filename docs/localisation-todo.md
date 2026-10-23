# Multi-source localisation: status and todo

All numbers anywhere in this effort are **simulated only**. The ground model is idealised and the diffraction model is unvalidated. Nothing here is a real-world accuracy claim.

## Done
- Phase 0 inspection: accept/reject in `analyseScenario` (`src/sim/core/analyse.js`) uses oracle per-source power. `estimateBearing` already runs on the mixture.
- Fixed-seed suite A-E (`test/suite-lib.js`, `scripts/sim-suite.mjs`, `test/sim-suite.test.js`). Error sources ON (heading 2.5 deg, gain 1 dB, position 5 mm), 3 stand-in building boxes, layout scale spreads ranges about 15-130 m. Primary WBR = reliable fix with error over 10 m; 5 m and 3 m are secondary.
- Heading sweep for scenario A (`scripts/sim-heading-sweep.mjs`).
- Baseline on the OLD layout (before range spreading): `docs/suite/baseline-v1-layout.json`, `docs/suite/heading-before-v1-layout.json`.
- First draft of the measured-only localiser: `src/sim/core/measured.js` (not imported anywhere yet, never run, thresholds uncalibrated). `windowTdoas` is now exported from `localise.js` for it.

## Baseline highlights (old layout, 50 seeds, old code)
- A glass: median error 4.9 m, WBR(3 m) 76%. Heading sweep: 4.5 m at 0 deg, 6.8 m at 5 deg, so heading is not the main error.
- D glass: 0% localised (rejected as `unresolved_overlap`, oracle SINR about 10 dB).
- D engine: track coverage 0%, fix error about 72 m (arrival-time stamping).
- C dog: 100% localised, median 31 m error, all marked reliable.

## Todo
1. Rerun the baseline with the new range-spread layout on UNCHANGED analysis code (`node scripts/sim-suite.mjs --label baseline --seeds 50`, then the heading sweep). About 45 min for the suite on 2 cores. Keep it as the "before".
2. Phase 1: wire `measured.js` into the suite (`localiser: 'measured'`), run it, calibrate `MEASURED_DEFAULTS` across scenarios B, C, D (not D alone). Accept/reject must use no mixture SNR and no ground truth. Score by matching fixes to truth in the scorer only. Count ghost fixes.
3. Phase 1: replace `src.start_s` in `analyseScenario` emission-time logic with a measured onset. Keep `overlapped_with` as scoring metadata (test/sim.test.js ~line 223).
4. Phase 2: stamp positions at emission time (done in `measured.js` draft, untested), third node option, ground-constrained height, `low_confidence` for two-node fixes.
5. Phase 2: estimate each node's heading offset from confident fixes; report recovery.
6. Phase 2: `localisation_band_hz` configurable per scenario; simulated mixed-spacing (5 cm and 15 cm) experiment behind a setting; report the result either way.
7. Height from ground bounce: mixture-only delay between direct and ground-reflected arrival, gated by the expected geometry of the 2D fix, `z` with sigma and `source_height_measured`, never used in the 2D solve. `ground_type` setting (hard / grass). Scenarios at heights 0, 1.5, 5, 15 m; broadband vs tonal; range bins 10-20, 20-40, 40-80, 80-120 m; 50+ seeds.
8. Update `NOTES.md` (about line 35) and `sim_technical_architecture.md` (about line 143), which still describe the oracle behaviour.
9. Replace the 3 stand-in boxes with real building footprints when available.

## Acceptance targets (simulated)
- Single isolated source: median under 5 m and p90 under 10 m up to 50 m; median under 10 m at 50-100 m.
- Scenario C: each source gets a bearing within targets or is marked unreliable; WBR(10 m) under 10%.
- Scenario D engine: track coverage over 70%, track median error under 10 m against the true path at emission time.
- Scenario D glass: localised on at least 70% of seeds within targets.
- Footsteps: documented as undetectable beyond about 20 m, not scored as a failure.
- WBR must not rise versus the baseline.
