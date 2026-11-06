# Mission 4 interim handoff (phase 0/1 checkpoint)

## Completed

- Mission branch `overnight/localisation-4` was created from `origin/overnight/localisation-3a`; 3A prerequisites passed. No changes were pushed to `main`.
- X0/X1 diagnostic checkpoint `cf77d52` is pushed. X0 analyzes only the frozen 3A baseline; no new simulation jobs or inference changes were made.
- X0 now uses exact source clip durations from archived sample counts and render sample rates. Three-source events have any in-clip bearing on 3+ nodes in 78.5-87.9% of cases, but 3+ pre-track bearings within 10 degrees in only 1.6-4.7%. The original source-aligned track label is post-hoc scoring, not engine assignment output. Archived data cannot identify pre-filter rejection causes or prove the label is stricter than physical detectability. Corrected report: `docs/experiments/matrix-r3-detectability.md`.
- X1 baseline reconciliation is descriptive and underpowered outside five-node cells; it does not support a full 2-8 node trend. A separate 140-run sweep on ten fixed open/ground/stationary sites, counts 2-8, legacy solver, and off/on profiles is preregistered in `docs/experiments/mission4-x1.json` and `docs/experiments/mission4-x1-node-count.json`.
- C1 joint-fusion candidate is opt-in via `measured_fusion_mode=joint`; legacy remains the default. It reuses weighted consensus for inlier selection, fits compatible static bearings jointly with a Huber loss, selects disjoint node tracks, and reports model covariance/radius. This candidate and its confidence remain unaccepted and uncalibrated; moving tracks retain legacy behavior.
- C1 paired smoke completed all 72 jobs. Rule four failed: three training groups violate calibration/scene-fix guards, and validation/on loses one of six fixes without significant paired endpoint improvement. Keep legacy default; joint remains experimental and unpromoted. Results and reproducible analysis: `baselines/mission4-c1-smoke.json.gz`, `baselines/mission4-c1-smoke-analysis.json`, `docs/experiments/mission4-c1-smoke.md`.
- Full sim-core suite passes 296/296 after helper extraction. The full candidate/fix changes are isolated behind opt-in joint mode; no default solver behavior changed.
- Required install-profile draft is in `docs/install-requirements.md`.

## Next

1. Run the preregistered X1 node-count sweep and update its report with measured 2-8 node results.
2. Run matrix-standard validation and remaining mission priorities as scheduled; keep joint mode unpromoted.
3. Preserve final three hours for code freeze, one sealed run, final reports and docs, final handoff, and actual GitHub CI inspection.
