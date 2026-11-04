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
- Initially interpreted separate glass episodes as duplicate/wrong pairwise fixes (**50%**). That was a scoring bug, not an algorithm failure: corrected explicitly in the repeated-event section below. Realism-on uncertainty remains badly calibrated. No hardware recommendation follows.

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

## Noncoplanar four-mic alternative (kept)

- Compatibility-first interpretation: preserve `ball12_d180_sub4` coordinates/name and all default layouts; mark its rank deficiency in library notes. Add explicit `ball12_d180_sub4_maxvol` rather than silently changing old recordings/scenes.
- Exact maximum-volume enumeration chooses **A1/C1/C2/C3**, volume **299297.648 mm3** among all **495** subsets. Integer tenths-of-mm determinants make six equal maxima exact; first original mic order wins. No scene outcomes or tunable threshold enter the choice.
- Before extending the library, recorded the complete eight-site held-out input hash **46235eebc422b57db997fcb40d482f6cb191d21e7957043f423e0a02a18e9d71**. Freeze original array IDs/order in the generator. Regression verifies the hash remains identical, not merely that the same site IDs exist.
- Generated only new `golden-array-max-volume.json`; all pre-existing signal/analysis goldens remain untouched. Geometry/frozen-input/new-golden/benchmark targeted tests **33/33** passed.
- Predeclared a 144-run all-nine-array pilot, sparse20/random5, seeds 1/101, both realism states and both pipelines. Scope is deliberately smaller than full-library hardware validation; no result is yet claimed.
- Storage reached 90% during original baseline rendering. Audited cache files by exact producer code/schema and inode link count, then removed only **20 obsolete 0.8 audio files (837 MiB)**. All live 0.7 baseline audio, current renderer audio, whole results and report artifacts remain intact.
- Required core suite **241/241**, app **31/31**, production build and actual browser/CLI E2E passed. Shared 16-run smoke had **zero regressions**, **16/16 audio hits**. All existing scenario inputs, complete inferences and scores are deeply identical to the 0.10 reference.
- Original full baseline completed **300/300** at approximately 03:18 UTC, saved unchanged as `baselines/baseline-0.{json,csv,html}`. Held-out scores have not been used to choose anything. Audio cache plus original data now leaves under 1 GiB free, so larger array runs need explicit bounded render retention before execution.

## Bounded sequential sweeps (kept)

- Cloud disk reached **97%** at original-baseline completion. Add opt-in CLI `--discard-renders`; default Node/browser caching remains unchanged. Shared scheduler calls cleanup only after all consumers of an exact audio key finish. Whole results and interrupted groups remain cached. No cross-process lease: concurrent discard-mode experiments must use separate cache directories.
- Snapshot exact display targets and placeholder marker in report manifests, and render HTML against that snapshot rather than reading a possibly changed target file at the end.
- Tests cover one cold render feeding both pipelines in retain and discard modes, last-consumer ordering, interrupted-group retention, cleanup-error propagation, and whole-result replay after raw audio is gone.
- Required core **243/243**, targeted **45/45**, app **31/31**, production build and actual browser/CLI E2E passed. Default 16-run smoke had **zero regressions**. Actual four-run isolated CLI discard test left **0 raw inputs**, **4 whole results**, and correct target/cache-policy metadata.
- Original 300-run baseline audio migration verified all **150** unique inputs: **142** newly hard-linked, **8** already present. Independent cold near_wall/seed1 control matched every microphone byte plus path/activity diagnostics. Original source/runtime dirty-audit assumptions remain explicit. Re-scored baseline to v2 without changing any inference.
- Expired another **14** individually audited development-only 0.7 audio files (**494 MiB**), after comparing exact producer hashes with completed baseline producer **ca41e67bb04098fd15a2d2fdc1d702ea5fcf216cd1d3df56efc65b2729023aff**. All **150 original-baseline audio keys**, current canonical audio, whole results and reports remain intact. A preliminary cleanup guard correctly refused to classify the real smoke producer as obsolete; no files were removed by that refused attempt.
- Predeclared eight endpoint grids for all nine arrays, using existing UI ranges only: heading 0/5 deg, gain 0/2 dB, position 0/10 mm, correlation 0/0.6, ambient 30/60 dB SPL, self-noise 20/40 dB SPL, ground 0/0.8, source level 90/110 dB SPL. Each has 144 measured-only runs on the same two-site/two-seed split; 1152 total. Swept variables explicitly override the corresponding realism-profile value. No timing sweep is offered because timing realism is not built.

## Final grading and preregistered full array ranking

- Original full baseline is preserved untouched as `baselines/baseline-0.json` (300 runs, 25 sites; 136 train / 164 held-out). Its explicit v2 score migration has 300/300 deeply identical inference objects. Final default-engine grading now uses that like-for-like scoring reference, no changed tolerances.
- Before inspecting final or array outcomes, expanded the preregistered array study to all 25 sites, seeds 1/2/101, all nine layouts, realism off/on, measured-only: **1350 runs**. This supersedes the pilot as the main ranking if completed. The 144-run two-pipeline pilot and eight 144-run endpoint grids remain useful secondary studies, not substitutes for full-scene coverage.
- Two CPU workers and opt-in per-render-group cleanup keep memory/storage bounded. Run studies sequentially, not concurrently against a discard-mode shared cache. No new threshold is selected from any final/held-out result.

## Finite measured CI reference (kept)

- Added a GitHub workflow with read-only permissions, exact Node **24.22.2**, core tests, eight measured-only regression cases, realism off/on and the same scene/seed holdout discipline. Model files are committed; the workflow fetches pinned ESC-50 audio rather than silently skipping the real-model test.
- Installed the missing Node 24 runtime only after `node24` failed. Its independently cold-rendered eight-run replay passed `--fail-on-regress` against the new reference. Default metric tolerances remain zero.
- Official actionlint **1.7.12** binary checksum verified; workflow lint passed. Exact CI runtime validation passed **243/243 core**, **31/31 app** and the production build. Independently cold-rendered eight-run replay had **zero regressions**. Both train/off and train/on reference cases contain actual fixes. This is local validation, not a claim that GitHub Actions has executed remotely.
- Existing model-runtime/Vite warnings remain visible. No signal or analysis golden changed. CI changes do not alter inference/export format; schema stays 0.12.

## Exact consensus decision trace (investigation only)

- Added `docs/experiments/consensus-trace.json` from read-only instrumentation of the retained solver on training seven_source/seed1/off/s8. Final point, inliers and rejected nodes deeply match the original baseline.
- Initial consensus kept all four usable nodes. Its refit residuals for n1/n3 were **0.03899 / 0.01945 sigma**. Leave-one-out then rejected reliable n1 at **160.45496 sigma** against n2/n3/n7, and reliable n3 at **24.50194 sigma** against n2/n7. Final survivor weights were only **0.0001985 / 0.0009554**, versus rejected **0.05812 / 0.08837**.
- The exported rejection residual is recalculated at the final surviving fit, **not** the leave-one-out point that triggered rejection. Therefore its number need not equal or exceed the rejection-time gate. The reported exact **0.4** case was not reproduced in the available scene/settings/seeds; do not claim otherwise. This trace confirms the structural cause and low-weight-consensus failure, not a kept solver repair.

## Final default grading (kept)

- `baselines/final-0.json`: **300/300**, **zero tracked regressions** against explicit original-inference scoring v2. **300 audio hits, 0 ms rendering, 16 whole-result hits**. All **150 truth-assisted score objects are deeply identical** to the reference.
- Measured-only restored actual fixes rather than improving an already functioning measured estimator. Train/off median/p90 **0.5261/24.6307 m**, train/on **6.8735/24.8845 m**; held-out/off **0.4380/21.7738 m**, held-out/on **2.4937/26.7466 m**. Realism-on scene coverage is **67.65% train / 31.71% held-out**; conditional medians must not be used alone.
- Realism-on measured wrong-fix fractions are **40.38% train / 24.14% held-out**. Every measured two-node fix is low-confidence: **100% suspect recall is not a discriminating classifier**. One-sigma bearing coverage remains **22.34% train / 50.00% held-out**. No calibrated hardware claim follows.
- Held-out outcomes are now read for reporting only. All array studies/endpoints were fixed beforehand, and no new threshold is selected from these outcomes.
- Real remote workflow **41769397157**, revision **208a8e2**, completed successfully: **243 core**, **31 app**, production build and eight-run zero-regression benchmark. Logs retained in the session artifacts. The earlier local-only qualification remains historical; remote execution is now observed.

## Predictive leave-one-out experiment (rejected, repository source untouched)

- Tested the first-principles 2D leave-one-out denominator including predicted-point covariance from the other rays, rather than treating that prediction as exact. Uses only bearings/nominal geometry and existing thresholds; no new tuned threshold.
- In-process module hook records the exact transformed source SHA-256, base hash and trial identity. It reuses protected original audio but never reads/writes inference cache. No repository inference code changed, so concurrent preregistered array studies retain their declared source.
- Training seven_source/seed1/off: median **21.5058 -> 13.2270 m**, p90 **36.4976 -> 32.9615 m**, within10 m **14.29% -> 28.57%**, track count **20 -> 21**, track median **7.7501 -> 3.6882 m**. s8 **25.3632 -> 6.4801 m**, s11 **36.4976 -> 32.9615 m**.
- Suspect recall **66.67% -> 60%** and precision **80% -> 60%** regress. Rejected under the same no-regression rule; not extended to held-out cases, not kept behind a hidden option. Evidence is `baselines/predictive-loo-seven-source.json`.

## Gain-model assumption regression (kept)

- Confirmed renderer gain scales signal plus ambient and self-noise together. Positive scalar gains cancel in ideal PHAT. Separate seeded streams prevent gain sweeps from shifting heading/position/noise random draws.
- Added a nonzero-delay, unequal-positive-gain PHAT invariance regression and documented that gain sweeps do not model microphone frequency/phase response. This is a test/documentation change only: no renderer, inference, threshold or export-format change (schema0.12).
- Required core **244/244** passed. Sixteen-run default smoke again had **zero tracked regressions**. No goldens changed.
