# Overnight localisation log

## Rules and decisions (2026-11-04)

- Work only on `overnight/localisation`; no main pushes. Each retained logical step gets its own commit after core tests and benchmark.
- Preserve all signal goldens. No new physics in the first tiers.
- Use existing recorded ESC-50 assets for benchmarks, not substitute synthetic sound labels. Custom editor clips are recorded in the reproducibility manifest by content hash.
- Existing `measured.js` is a separate mixture-only, horizontal multi-source pipeline. Reuse it, score only after inference, and explicitly report its missing elevation and association limitations. Do not pass truth-assisted source windows to it.
- Split scenes and seeds before baseline. At least 30% of scene IDs and seeds are held out. Held-out outputs are reports only, not threshold selection inputs.
- Error target starts at 10 m. Report no-fix separately, and track unmatched measured fixes so missing detections cannot make wrong-fix metrics look better.
- Tier 0/1 take priority. Later tiers are deferred rather than left half implemented. No claim of real-world validation or eight hours of completed computation.

## Initial inspection

- Clean worktree on `main`, starting revision `e3bc12a`.
- Schema 0.6 only adds render audit/export reporting. Schema 0.5 changes the track gate and 3D fix fallback; final bearing windows still use the same analysis code. Schema numbers themselves never select bearing logic. No historical 0.4/0.6 revisions exist in this checkout, so exact historic bearing changes cannot be proven from revision comparison. Snapshot settings, clip bytes, source windows and their chosen policy must be compared, not schema tags.
- Exports include labelling only when `labelEvents` completes; enabled setting alone is not labelling data. Model availability will be checked separately; never fabricate a block.
- Existing analysis mutates moving-source path diagnostics inside the render object. Benchmark must clone cached render data before truth-assisted analysis to avoid order-dependent reuse.

## Step 0: benchmark foundation (kept)

- Added shared data experiments, grid/OAT/random/Latin-hypercube/paired modes, preflight cap, variable transforms, deterministic render/result caches, bounded Node workers and a common pause/cancel/resume scheduler.
- Added 25 scene IDs: six upgrade scenes, original seven-source export, two aerial engine-surrogate scenes, sparse ranges, simultaneous level differences, corner/bad geometry and eight held-out random sites. Original export fixtures are now shared source modules; test imports re-export them.
- Added source/audio manifests, per-source/node scores, cluster-bootstrap CI, paired sign-flip testing, train/held-out + realism + inference partitions, failure atlas, detection-by-range, ranking-flip checks and standalone JSON/CSV/HTML.
- Initial tests failed because dependencies were absent; restored with `npm ci --no-audit --no-fund`. Required core suite then passed **214/214**; signal goldens stayed untouched.
- Smoke baseline: 16 runs. Repeated run with `--compare baselines/baseline-smoke.json --fail-on-regress` had **zero tracked regressions**. Full 300-run baseline is computing without any solver changes; seven-source rendering/analysis is much slower than the initial time estimate. Time estimate remains explicitly rough, not a promise.
- Real YAMNet/CLAP clean-clip regression ran successfully in the core suite. Models can run here. Benchmark labelling remains unavailable rather than substituting oracle labels; the export omission is explained by incomplete/not-requested `labelEvents`, not a missing export field.
- Native browser WAV decoding may resample differently than the CLI. Benchmark now shares explicit PCM16/float32 decoding plus `resampleSinc`; hashes verify exact clip identity.
- Existing measured thresholds are exported as `measured_*` placeholders. Editor's default pipeline is unchanged; benchmark defaults measured-only. No new propagation physics was added.
- Limits: measured elevation/3D and label accuracy unavailable; measured association remains greedy/two-node and calibration uses track medians. Within-site seeds are not independent sites. No hardware winner is inferred from conditional error alone.

## Consensus investigation (rejected and removed)

- Browser/CLI end-to-end testing found an actual reproducibility bug, not just different WAV decoders. PCM SHA-256 and whole-event results matched, but a legacy rolling fix selected n1/n2 in Chromium and n2/n3 in Node. At the first diverging track fix, horizontal error was 0.257293 m vs 0.079816 m. Pair costs near machine zero are used to break equal-count consensus ties; tiny arithmetic differences change the chosen pair, then propagation-aligned windows diverge.
- Implemented positive-weight, forward-ray, deterministic consensus experimentally. Four new solver/property regressions and existing upgrade tests passed (35 targeted tests total); browser/CLI eight-run parity passed. Defaults-only smoke also had zero regressions, but that was not sufficient evidence to keep the optional solver.
- Replayed the original **training-only** seven-source seed 1, realism off, truth-assisted, reusing exact cached audio. First verified legacy scores exactly reproduced the baseline. Median horizontal error improved **21.5058 -> 11.0777 m**, p90 **36.4976 -> 26.7930 m**, within 10 m **14.29% -> 42.86%**, track count **20 -> 21**, median track error **7.7501 -> 3.7344 m**. s8 improved **25.3632 -> 6.5593 m**, s11 **36.4976 -> 3.6362 m**.
- However suspect recall regressed **66.67% -> 50%** and precision **80% -> 40%**. Under the no-regression rule the entire optional solver and its thresholds were **removed before commit**, not promoted or hidden behind a flag. `baselines/consensus-seven-source.json` preserves the rejected experiment's evidence, not an available preset. No held-out outputs were inspected to choose it.
- s1 already has four legacy track fixes on this exact shared-decoder replay; the reported zero-fix case is not reproduced. s12 remains a 21.5058 m unflagged error. These are not claimed fixed.

## Measured quality and benchmark correctness

- Found an exact unit mismatch: `windowTdoas` raw PHAT peak has maximum `2 * band_bins / (FFT_length * 4)`, under 0.015 for 200-1600 Hz at 48 kHz. `measured.js` compared it with `min_peak=0.25`, rejecting even perfectly coherent windows.
- Added dimensionless `peak_normalized`, leaving raw peak/TDOA unchanged. Measured-only quality uses that value and the **unchanged** 0.25 placeholder gate. This is a mathematical normalisation repair, not threshold tuning. Added coherent/silent-window tests and a nonempty poisoned-truth test that must form tracks.
- Corrected resume validation for changed PCM hashes, runtime, exact settings/custom scenes and error target. Checkpoints are persisted only after attaching their identity. Cache/run manifests now identify runtime.
- Integer seed counts reserve at least 30% held-out seeds (when count >=2), without duplicating ID 101 for large counts. A single-seed pilot is explicitly not seed holdout validation.
- OAT no longer silently removes a requested value merely because it equals a library default; scene/realism bases differ. Analysis-mode overrides no longer duplicate jobs or inflate estimates.
- Fixed combined-sweep transform order: node layout then spacing, source count then levels, range after node geometry. Reordered JSON keys cannot change an experiment's meaning. Comparison matches variable values instead of config order and fails on changed scene/seed populations or wrong-fix targets. Tornado never substitutes zero for unavailable sensitivity.
- Initial retained repair smoke: **16 runs, zero tracked regressions**. Newly available measured error/precision metrics have no old finite counterpart; this is not proof of good accuracy. Final verification repeats after the benchmark correctness changes.
- Retained-step validation: required core suite **223/223** passed with all signal/analysis goldens untouched; targeted final benchmark/measured regressions **26/26** passed, including an additional paired-config identity case. Final 16-run smoke again had **zero tracked regressions**. This changes availability, not established real-world accuracy.

## Testing workspace

- Added scene checkboxes, held-out/current-editor selection, groups with list/range/default controls, presets, cap/reduction, modes, estimates, two compute workers plus coordinator, pause/cancel and IndexedDB checkpoints.
- Shared tables/CI, SVG lines/bands, heatmap, tornado, ranking-flip diagnostics, baseline/saved-run deltas, downloads and clipboard summary. Names and notes persist with each saved run.
- Headless browser verification is available, not skipped. The first legacy eight-run sweep exposed reproducibility failure rather than passing on no-fix equality. Its weighted rerun passed, but that solver was subsequently rejected. Final browser verification must exercise the retained measured-only pipeline, require a real fix, and replace the screenshot.
- Before normalisation repair, default measured-only returned **no fixes** even on the glass sweep. That was a genuine gate bug, not evidence that the scene was impossible.
- The editor still uses legacy truth-assisted Create. Measured drill-down opens saved horizontal inference with an explicitly assumed display height, not invented elevation.
- Final retained measured-only browser/CLI sweep **4/4 runs**, with actual fixes, matched scores/CI to **1e-7**. The test pauses only after a completed checkpoint, reloads, resumes, exports all three formats and drills down. App tests **31/31** and production build passed. Screenshots now show retained code: `testing-setup.png` and `testing-results.png`; wide metrics scroll within their table.
- A strengthened browser test initially hit its 30 s first-progress timeout while the full core suite and baseline ran concurrently. Increased only compute wait to 120 s (overall harness 600 s); numerical tolerance stayed fixed. Rerun passed in 100 s.
- Four-run glass pilot has duplicate pairwise fixes: unmatched fixes count wrong, so wrong-fix fraction is **50%** despite small matched-position errors. Realism-on uncertainty remains badly calibrated. No hardware recommendation follows.

## Renderer cache reuse (kept)

- Full original baseline remains in flight. Seven-source rendering takes minutes per scene/seed, far beyond the initial rough estimate. Avoid recomputing identical audio after analysis-only source edits.
- Added parsed renderer dependency-graph fingerprint (cycles, static/dynamic literal imports and re-exports), distinct from full analysis code hash. Unknown/nonlocal dependency graphs fail explicitly. Added a small declared `es-module-lexer` dependency; no propagation code changed.
- Audio cache keys include renderer fingerprint and Node/V8/platform/architecture. Whole results still include full code hash. Producer sidecars preserve actual audio provenance; missing provenance is an explicit error, never a success-shaped fallback.
- Legacy migration is manual and conservative: compare all renderer sources to a committed revision, verify nominal inputs/PCM hashes/runtime, independently re-render one control byte-for-byte, and retain explicit dirty-source audit assumptions in the export. Hard links avoid duplicating audio; whole inference is never migrated.
- Historical baseline manifests predate runtime recording. Queried the actual still-running baseline process executable and command, not a guessed version; recorded the observation in `docs/experiments/baseline-runtime.json`.
- First cache smoke: **16/16 audio hits**, **0 ms rendering**, zero tracked regressions. Core suite **228/228** passed; app **31/31**, build and actual browser/CLI E2E passed.
- Added shared worker-pool single-flight per exact audio key. Workers release waiting jobs after audio is persisted, before analysis finishes; real two-worker/two-pipeline test verifies one cold render. No cross-process locking claim. Cancellation/failure waiters are tested.
- App Vite HTML/proxy test printed passes but did not exit because speculative pretransforms raced server shutdown. Disabled speculative pretransforms only in that unit-test server; isolated and full app tests now exit normally. No forced process exit or browser feature removal.
- Final required core suite **231/231** passed; targeted **33/33** passed. Repeated 16-run smoke again had **zero tracked regressions**, **16/16 audio hits**, **0 ms rendering**. App **31/31**, production build and actual browser/CLI E2E passed after single-flight integration. All pre-existing golden files remain untouched.

## Repeated-event scoring correction (kept)

- Training sparse20/seed1, realism off, has two measured episodes at **3.1516-4.3268 s** and **5.0452-5.4215 s**, both near the same true source. They are separate bursts, not simultaneous duplicate hypotheses. The earlier **50% wrong** pilot statement reflects a scorer bug and must not be used as evidence of algorithm failure.
- Scope correction: apply one-to-one matching only to overlapping emission-time intervals, using inferred timestamps; no new threshold. Every assigned episode enters error/track/calibration metrics rather than selecting only the closest. Source coverage stays capped. Simultaneous unmatched hypotheses still count wrong; clip-active intervals remain unchecked.
- Old reports remain unchanged. Added explicit re-scoring with separate provenance and cleared obsolete whole-result cache keys. Unlike scoring conventions cannot be compared. Re-score the before and after reports with identical rules; do not claim a scoring correction as an inference improvement.
- New tests check separate bursts, simultaneous/touching duplicates, inclusion of wrong earlier/later episodes, missing timestamps, capped coverage and unchanged original inference/provenance.
- Required core suite **236/236** passed, followed by final targeted **39/39**, including the additional all-episode failure-atlas test. App **31/31**, production build and actual browser/CLI E2E passed. Updated screenshots were visually inspected.
- Explicitly re-scored the retained 0.8 reference, then reran the shared 16-run benchmark: **zero regressions**, **16/16 audio hits**. All **16 complete inferences are deeply identical** to 0.8; scores exactly equal reference re-scoring. This is not an inference accuracy improvement.
- Corrected training sparse20 pilot: realism off median **0.122945 m**, **128** track fixes, wrong fraction **0%**; realism on median **3.816520 m**, **114** track fixes, wrong fraction **0%**, **0% within 1 sigma**. The higher conditional error includes all episodes instead of cherry-picking the closest. Uncertainty remains unacceptable with hardware errors.
