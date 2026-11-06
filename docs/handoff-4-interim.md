# Mission 4 interim handoff (phase 0/1 checkpoint)

Superseded by [`handoff-4.md`](handoff-4.md) and [`overnight-report-4.md`](overnight-report-4.md). The interim checklist below predates the X1 completion and budget review.

## Completed

- Mission branch `overnight/localisation-4` was created from `origin/overnight/localisation-3a`; 3A prerequisites passed. No changes were pushed to `main`.
- X0/X1 diagnostic checkpoint `cf77d52` is pushed. X0 analyzes only the frozen 3A baseline; no new simulation jobs or inference changes were made.
- X0 now uses exact source clip durations from archived sample counts and render sample rates. Three-source events have any in-clip bearing on 3+ nodes in 78.5-87.9% of cases, but 3+ pre-track bearings within 10 degrees in only 1.6-4.7%. The original source-aligned track label is post-hoc scoring, not engine assignment output. Archived data cannot identify pre-filter rejection causes or prove the label is stricter than physical detectability. Corrected report: `docs/experiments/matrix-r3-detectability.md`.
- X1's preregistered 140-run sweep completed on ten fixed open/ground/stationary sites, counts 2-8, legacy solver, and off/on profiles. In this fixed cohort, three-source scene coverage rises from 20% at N2 to 100% at N8 in both profiles, but N8 three-source within-10m rates are 66.7% off / 53.3% on and 3+-node detectability is only 20.0% / 13.3%. N8 duplicate-fix scene rates are 60% / 40%. Five sites per cell make this descriptive, not a general node-count optimum. Full site-cluster intervals: `docs/experiments/mission4-x1-node-count-results.md`.
- C1 joint-fusion candidate is opt-in via `measured_fusion_mode=joint`; legacy remains the default. It reuses weighted consensus for inlier selection, fits compatible static bearings jointly with a Huber loss, selects disjoint node tracks, and reports model covariance/radius. This candidate and its confidence remain unaccepted and uncalibrated; moving tracks retain legacy behavior.
- C1 paired smoke completed all 72 jobs. Rule four failed: three training groups violate calibration/scene-fix guards, and validation/on loses one of six fixes without significant paired endpoint improvement. Keep legacy default; joint remains experimental and unpromoted. Results and reproducible analysis: `baselines/mission4-c1-smoke.json.gz`, `baselines/mission4-c1-smoke-analysis.json`, `docs/experiments/mission4-c1-smoke.md`.
- Full sim-core suite passes 296/296 after helper extraction. The full candidate/fix changes are isolated behind opt-in joint mode; no default solver behavior changed.
- Required install-profile draft is in `docs/install-requirements.md`.

## Next (at this interim checkpoint only)

1. Run matrix-standard validation and remaining mission priorities as scheduled; keep joint mode unpromoted.
2. Preserve final three hours for code freeze, one sealed run, final reports and docs, final handoff, and actual GitHub CI inspection.
