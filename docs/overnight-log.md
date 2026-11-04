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
