# Overnight localisation log

## Round 2 start (2026-11-04 09:25 UTC)

- Branch `overnight/localisation-2` starts at round-one final `099a0d0`.
- Read the round-one log/report, rejected solver manifests and exact consensus
  trace. Preserve all originals and signal goldens.
- No standalone sealed-baseline files exist in this checkout. The round-one
  frozen eight random sites and previously held-out seed now count as validation.
- Generate and commit 40 new random sites with fresh high-range site/render seeds
  before outcomes. Exact populations and acceptance interpretation are recorded
  in `docs/round2-method.md` and `docs/experiments/round2-*.json`.
- Initial disk 50% (8.8 GiB available), 2 CPUs. Sequential discard-mode studies
  use distinct caches. Previous seven-source rendering averaged 202.24 s on the
  four-mic study; do not use the 5 s placeholder for scheduling.

## Round 2 A1/A2 retained (09:42 UTC)

- Preregistration commit `56c197e` froze 40 new sites and render seed3103170130,
  input SHA-256 `a93368c737533c8988a0a8301a5bbde304dcc298661a0367ca6c365d52971ce6`.
  The sealed study has not run. Train68 / validation82 measured runs are fixed.
- Added exclusive-create persistent sealed-attempt ledger, input-hash validation,
  mandatory explicit override reason, three-way splits and 85% startup disk guard.
- Added scene-level useful/silent-wrong rates, confidence-tie-grouped risk curve,
  unanswered-tail-penalised area, provisional target colours, and useful-rate
  default ranking. No conditional median can silently substitute for coverage.
- Added paired aggregate bootstrap rule-4 comparison (`--acceptance round2`);
  legacy strict comparisons remain available for the original CI contract.
- Restored dependencies only after the missing `@echo/shared` validation failure.
  Corrected schema assertion for explicit0.14 bump. Core255/app32/build passed;
  16-run preregistered smoke passed rule4 with all inference outcomes equal.
  All existing signal/analysis golden files are untouched. Disk53%.

## Round 2 B1 trial rejected (09:42 UTC)

- Hyperparameters/features/population were committed in `a026dd4` before fitting.
  Runtime features see nominal geometry, accepted mixture windows and buildings,
  not source positions, true overlap, path identity or hidden hardware errors.
- Train-only standardised L2 logistic regression and scene-fold Platt calibration
  produce exported coefficients. Training has112 fix episodes. Threshold0.0567794
  is fixed from training wrong predictions; no validation threshold search.
- Full150-run stored-inference replay keeps every position/track/calibration
  unchanged. Risk areas: train off0.588235→0.372308, on0.705882→0.477089;
  validation off0.658537→0.536523, on0.756098→0.706520.
- Three partitions pass; validation/on paired95% interval includes zero
  [-0.093595,0]. Therefore reject **despite** the favourable point estimate.
  Silent-wrong scene rate remains0 throughout. The flag is discriminative:
  useful rates26.47%/2.94% train off/on and9.76%/4.88% validation off/on.
- Proposed90% geometric radius empirical coverage92.59%/93.62% train,
  94.59%/92.31% validation. These are correlated simulated episodes, not an
  independent real-world conformal guarantee. Brier scores and reliability
  bins, complete tables and exact model are preserved in `baselines/round2-confidence-*`.
- Confidence is **not wired as the default inference** after rejection. Offline
  training/replay infrastructure remains for reproducibility, not a promoted
  optional failed solver. No claim that positional accuracy improved.

## Round 2 heartbeat and rejected association (10:15 UTC)

- Disk 57%, about 7.6 GiB free. Sealed inputs remain unrun. Current step:
  completed performance populations, real-model labelling running sequentially,
  recording/prototype integration and final validation preparation.
- Both preregistered global-assignment candidates rejected. They generated 82
  three-plus-node fixes, but ordinary global fusion worsened off-realism
  calibration; train-fitted empirical intervals still worsened validation/on
  calibration (0.50 to 0.8923 versus nominal 0.6827). Validation/on paired
  improvement intervals also touched zero. Full 150-run evidence, models and
  reasons are retained; default fusion is unchanged.
- The exact historical leave-one-out trace is in the truth-assisted solver,
  not `analyseMeasured`. A repair there cannot establish a measured-only gain.
  No new verdict is claimed for the round-one rejected weighted/LOO repairs.
- A3 original eight-run population finished: every microphone and inference hash
  matches. Full-render V8 serialization is unstable even between baseline
  repetitions. This is invalid instrumentation, not a passing invariant or a
  demonstrated signal change. Preserve both originals, commit a canonical
  value/typed-byte hashing amendment before repeating the entire population.
- Synthetic WAV/truth/calibration CLI round-trip and actual browser/Node consensus
  parity passed targeted checks. No real data has been evaluated. Prototype
  protocols explicitly distinguish proposed sample sizes from measurements.

## Round 2 heartbeat (11:02 UTC)

- Disk57%, 7.6GiB free. Sealed inputs remain unrun. Full core/app/build/browser
  gates and the16-run rule-four smoke are running before retained-step commits.
- Corrected canonical eight-render performance comparison matches every audio,
  render-value and inference hash. Seven-source observed render/analysis ratios
  are1.006/1.088; 12-mic static ratios0.860/1.018. Two repetitions do not establish
  a robust speedup; the static render was slower.
- Weighted-forward and predictive-LOO measured adaptations both failed the full
  preregistered acceptance rule. The root trace is repaired in offline tests, but
  off-realism/validation calibration worsens and validation/on intervals touch
  zero. Neither solver nor the rejected confidence model is a runtime default.
- Actual labelling study completed36 renders/144 model predictions: raw27/72,
  normalised28/72 correct. Normalisation does not rescue range collapse.
- New clocks/weather/urban noise are opt-in placeholders with separate goldens.
  Their56-run study is still pending. No sync-gated TDOA, scattering or microphone
  frequency/phase model is claimed. Synthetic WAV round-trip works; no real data.

## Round 2 heartbeat and budget (11:42 UTC)

- Disk58% at last check, over7GiB available. Fresh150-run evaluation is at the
  expensive seven-source cases; no final/partial accuracy table is reported.
  Complete56-run opt-in physics study finished; every8-case profile answered
  all scenes, but this easy population does not establish hardware tolerance.
- Measured p90 scheduling: fresh evaluation8,173,387ms, descriptive variance
  6,866,753ms, reserved sealed execution6,649,426ms. Studies run sequentially in
  separate discard-render caches. A900-run full array rerender estimates
  36,160,048ms(about10h) alone, so it is not started. No partial array ranking.
- Five solver/confidence trials are closed/rejected; source freeze and actual
  retained settings were committed before sealed outcomes. Forty physical
  inputs still match the original hash; the test remains unrun.
- Preregistered separate known-POI attribution prototype:24 mixture plus12
  reference renders. Conservative mixture proxy319,712ms plus references;
  run only after the current studies, before the sealed test. This is not a
  new localiser or a validated road/bar share product.
- Actual remoteCI41820176719 at6eea56b passed279 core,34 app, build,2 browser/CLI
  cases and measured benchmark. Logs read. First push returned transient500;
  retry succeeded to branch2 only. No main push.
- Existing OSM main/fallback upstreams both failed for Canary Wharf/Battersea;
  no matching offline map cache found. Skip rather than invent footprints.
- A fixed-population power diagnostic finds only3 wrong validation/on scenes
  among41:4.436% bootstrap probability of no wrong scene, giving zero delta
  for confidence-only ordering. Preserve the rule and population unchanged.

## Round 2 heartbeat and complete evaluation (12:22 UTC)

- Disk58%,7.3GiB free. Fresh150/150 final evaluation completed; all inference
  and scoring objects exactly equal the re-scored reference. Every train/
  validation x realism partition passes rule4 by all-equal, not improvement.
  The270-run variance population is now running; no partial ranking is reported.
- Committed `2924ef5` before outcomes:60 available-node/spacing cases and288
  equal nine-design range/ambient-floor cases. Measured p90 estimates are
  1,292,465ms and3,521,018ms. With the conservative variance, attribution and
  sealed reservations plus an hour for reporting/CI, these fit the19:25UTC
  budget. Start them only after the current study, sequentially with distinct
  discard caches and disk preflight; seal remains the last study.
- These are descriptive studies of the retained solver, not another algorithm
  tuning attempt or the full improved-engine array ranking. Report actual
  nodes used, not just nodes available. Track presence is only a detection
  proxy. Two observed seed ranges are not reliable population95% intervals.
  Hardware requirements stay null when the appropriate impairment was not
  swept or target compliance is not demonstrated.

## Round 2 placement method and gates (12:46 UTC)

- Disk58%, over7GiB available. Variance remains the only rendering study.
  Mandatory sealed inputs remain unrun; default inference/core freeze unchanged.
- Placement is an independent frontend geometry diagnostic, not another solver.
  `6486caf` registered exact20 simulated cases and source-point predictions
  before outcomes. Before any run, clarified the existing1m near-field
  exclusion and hardened sigma/grid input validation; physical cases and
  predictions are unchanged. The committed helper hash records this amendment.
  Measured p90 estimate610,327ms fits the budget before the sealed test.
- Core279 and frontend38 tests pass. Actual-browser placement/history checks
  and the retained16-case smoke will run after variance, not concurrently with
  a science render. History now accepts generated/nightly summaries directly;
  bad uploads report errors and preserve the previous displayed dataset.
- Before their first runs, node-count/range/placement registrations explicitly
  use validation labels for seed101. Scene/seed/variable populations are
  unchanged. Existing realism/variance archives retain their actual legacy
  "held-out" metadata; that means seen validation, never the sealed test.

## Round 2 heartbeat and completed descriptive evidence (13:43 UTC)

- Disk58% by df at last check, over7GiB available (statfs preflight about60%).
  Core freeze2f7230fc remains exact. Sealed40-site input remains unrun.
- Variance completed270/270 renders and540 algorithm rows. One fixed site,
  three12-mic geometries/five seed clusters: realism explains60.49% of total
  conditional RMSE variance and59.04% of bounded scene-loss variance; array
  geometry0.69%/0.76%. This is not a causal all-site hardware conclusion.
  Full intervals/rows are preserved;499/500 conditional draws identifiable.
- Independent placement/history views pass281 core,38 app, production build,
  actual2 browser/CLI tests and16-case rule-four smoke with zero regressions.
  Geometry assumptions are not a calibrated error radius; runtime fusion stays
  pair-only. The20 registered placement simulations are still pending.
- Completed all2052 known array/endpoint archive regradings, preserving source
  hashes/producers and without rerendering. Useful-rate rankings are all ties.
  Secondary risk-area point leaders flip with realism, ambient floor and source
  level; no hardware winner. Initial HTML formatting passed an array instead of
  a report object: full JSON/CSV were already complete. Fixed presentation and
  rendered from that exact JSON, without rerunning inference or metrics.
- The9x360-direction ideal geometry calculation is complete. Its component-only
  ceilings are not sufficient specifications; self-noise/sync requirements
  remain null. New math tests pass in the281-case core suite.
- Sequential node-count, placement, attribution and range/noise studies now run
  with disk/time preflight before each. Reserve the measured sealed estimate
  and a full hour for reporting/CI. No further localisation tuning is scheduled.

## Round 2 bounded spatial-method amendment (13:58 UTC)

- The earlier no-further-trial plan is amended **before any sealed outcome**:
  commit6ac185c preregisters one new150-case B5/B4 hypothesis, full-rank3D
  plane-wave DOA plus stationary spatial intersections. This is not a repeat
  of rejected global/consensus association; existing pair flags remain.
- Nominal geometry alone identifies66 eligible cases/11 sites. Their prior
  measured render+analysis total is995,993ms. Three analytic tests verify known
  directions, heading/position covariance and a known3D intersection. No
  experimental scene inference has run yet.
- Experimental code lives only in scripts; core fingerprint remains2f7230fc.
  The current sequential range study is untouched. Start this trial only after
  all current nonsealed studies finish, and only if twice the measured-strata
  estimate, the entire sealed estimate and60min reporting/CI fit the deadline.
  All150 cases must complete;84 ineligible geometries retain exact reference
  inference with explicit mixed-producer provenance. No partial ranking.
- No empirical multiplier is fitted. Physical covariance is an unvalidated
  approximation, moving fixes remain horizontal, and static positional radius
  stays unavailable. Rule four decides acceptance without validation tuning.
- GitHub Actions41841490921 at87a9687 reports success; the final-head run is
  still required. Main remains untouched.

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

## Protected cap reduction (kept, schema0.13)

- Found a real shared-builder bug: reducing five seeds to three returned **[1,2,3]**, dropping both held-out IDs **101/102**. The UI happened to regenerate IDs from its count, but direct shared-engine callers received a different, invalid holdout population. Also, the default 2700-run array preset previously dropped nine arrays to five to fit 1500 runs.
- Least-changing scientific interpretation: reduce repeated samples before dropping experimental alternatives, while retaining both existing seed partitions and the requested held-out fraction. Custom IDs stay custom. Default array preset now keeps all nine arrays with **[1,101]**, **1800 runs**. An impossible cap fails explicitly; a one-seed pilot must not be created silently from a split experiment.
- Validate explicit `held_out_seeds` as unique unsigned integers. Uses existing cap/fraction settings; no new tuned threshold, renderer or localisation change.
- All 11 preregistered study job populations were snapshotted before this repair. Verify deep equality afterward. The already-running full array worker retains its original0.12 source manifest; later studies may record0.13. Their uncapped job populations, renderer and inference source remain unchanged.
- Final validation uses a separate cache containing hard links to the 150 protected original inputs and exact migrated provenance, so it cannot race raw cleanup in the sequential array studies. No cross-process shared-cache safety is assumed.
- Required core **246/246**, app **32/32**, production build and actual four-run browser/CLI end-to-end parity passed. Sixteen-run `protected-cap-smoke` has **zero tracked regressions**. All 11 preregistered study job populations are deeply identical before/after this helper repair. Existing goldens remain unchanged.

## Array compute budget adjustment (before reading array outcomes)

- Cloud allocation has **2 CPUs**. Stage timings, not accuracy outcomes, show the first four-mic full-scene array took about20 minutes; its six seven_source renders averaged **202.24 s rendering / 3.98 s analysis** each while other validation ran. Twelve-mic render cost and larger pair counts make the1350-run plan risk consuming the remaining night before all nine arrays or placeholder studies finish.
- Gracefully checkpoint the original1350-run study and preserve it as explicitly incomplete. Do not rank arrays from that unequal partial population. Its specification remains unchanged.
- Preregister `array-full-budget.json`: **900 runs**, every original25 site and all nine arrays, realism off/on, seeds **[1,101]**. This reduces repeated training seeds only; **32% of sites and50% of seeds** remain held out. Expected **306 train /594 held-out** runs. Seed1 is retained by deterministic lowest-ID rule, not observed performance.
- The new full study runs the actual current0.13 source, without disguising code hashes or migrating old inference. This may repeat completed0.12 work; reproducibility wins over a cache shortcut. The original144-run two-pipeline pilot is already complete and preserved. Eight endpoint grids remain fixed. All JSON archives retain exact full inference, compressed losslessly with timestamp-free gzip to fit cloud/GitHub storage; CSV/HTML remain directly readable.
- Original full study checkpoint is explicitly **167/1350, cancelled:true**, archived as `array-full-partial`; no unequal-population ranking is reported. The900-run replacement started at **04:24:56 UTC**. Endpoint scheduling prioritises heading, position and noise before scalar gain because the verified gain model ideally cancels in PHAT; values/populations remain preregistered. Stop and report partial work if the night budget prevents completion.

## CLI argument safety (kept)

- A usage probe exposed that unrecognised `--help` silently started the default smoke experiment. Gracefully cancelled that owned process; its incidental output is not grading evidence.
- Use Node's strict argument parser, provide no-compute help, and reject unknown/missing flags or `--fail-on-regress` without `--compare` before allocating workers. This protects unattended runs from success-shaped typo fallbacks.
- No inference/rendering/export field changes; schema0.13 changelog records CLI semantics. The already-running full-array workers retain their exact prior source manifest.
- Core **248/248**, app **32/32** and production build passed. `final-1` completed **300/300**, **zero regressions**, **300 audio hits,0ms render**. Every inference and score object, and every non-runtime summary/CI, is deeply identical to `final-0`. Runtime legitimately differs under concurrent compute and is not gated.
- The full-array study began before the cap commit and preserves that dirty producer identity. Its loaded source corresponds to the cap repair; later endpoint workers use the CLI-changelog revision. Only metadata/argument handling changed, not rendering or inference. No report producer hash is rewritten to disguise this.

## Complete full-scene array study (reporting only)

- Budget replacement completed **900/900 at07:45:27 UTC**, **306train/594held-out**, all25sites/all9arrays/off-on/seeds1,101. Exact full inference is archived losslessly (18.3MB); original1350 specification/167-run partial remain separate and unmodified.
- Conditional median leader changes with realism: train **dome12_d230 -> flat4_100**; held-out **puck12_d210 -> ball12_d180_sub6**. Held-out on: sub6 median/p90 **3.523/25.446m**, scene coverage **21.2%**; flat square **5.568/29.036m**, coverage **72.7%**, wrong fixes **42.3%**. This is not a hardware winner.
- Legacy coplanar sub4 has no measured fixes; opt-in maximum-volume subset restores coverage but has held-out on median/p90 **9.254/47.404m**, coverage57.6%, wrong fixes55.6%. Preserve this regression-looking comparison honestly; it is an optional geometry comparison, not a default solver change.
- All tables preserve nulls. A temporary reporting probe multiplied null percentages by100 and subtracted missing medians; corrected before documentation. Missing results are never reported as zero or a robustness improvement. Repository metrics already handled nulls correctly.
- Eight fixed endpoint grids continue sequentially. Final required core **248/248** and smoke **16/16,zero regressions** passed against unchanged source. Smoke used the independent validation cache, not the discard-mode study cache.

## Completed endpoint studies and final handoff

- All eight fixed endpoint grids completed **1152/1152**, each144 with36train/108held-out. Every exact job ID/population matches its preregistered JSON, every report is uncancelled, and all full inference is archived losslessly. No graded outcome selected a threshold or changed inference.
- Conditional point leaders flip in at least one tested context for heading, mic position, ambient floor, ground reflectivity, noise correlation and source level. No scalar-gain or self-noise endpoint flip was observed; neither absence proves hardware robustness. Gain cancellation is built into ideal PHAT under this scalar model.
- The final source remains byte-identical to revisionef2108c for core/app inference and CLI. Final local core248/smoke16, app32/build and actual browser parity are green; remote final-source CI41778060382 also passed248/32/build/eight-case benchmark.
- Existing signal/analysis golden files remain unchanged; only the opt-in maximum-volume geometry has a new signal golden. No original baseline is overwritten. Original1350 partial remains explicitly cancelled, not used as a fair ranking.
- Final report documents all known failures, rejected solver trials, mixed-range/coverage/CI limitations, and deferred tiers. Rough5000ms/run estimates can underestimate expensive seven-source/12-mic work substantially; they are placeholders, not scheduling guarantees.
- Work finished at approximately09:06UTC after an approximately00:58UTC start (about8h08, including final predeclared grids and reporting). The small overrun completed the last fixed grid rather than leave an ambiguous partial study.
