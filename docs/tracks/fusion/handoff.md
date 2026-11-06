# T4 fusion handoff

## 1) What landed

- **Code landed**
  - `packages/sim-core/src/ext/fusion/utils.js`
  - `packages/sim-core/src/ext/fusion/heading-calibration.js`
  - `packages/sim-core/src/ext/fusion/likelihood-fusion.js`
  - `packages/sim-core/src/measured.js`
  - `packages/sim-core/src/joint-fusion.js`
  - `packages/sim-core/src/recording.js`
  - `packages/sim-core/test/sim-fusion-calibration.test.js`

- **Track artifacts landed**
  - `docs/tracks/fusion/prereg/*.json`
  - `docs/tracks/fusion/interfaces.md`
  - `docs/tracks/fusion/install-requirements-fragment.md`
  - `docs/tracks/fusion/schema-proposal.md`
  - `docs/tracks/fusion/claims-fragment.md`
  - `docs/tracks/fusion/sim-md-fragment.md`
  - `docs/tracks/fusion/levers.json`
  - `docs/tracks/fusion/log.md`
  - `docs/tracks/fusion/report.md`
  - `docs/tracks/fusion/handoff-interim.md`

## 2) Rejected or not accepted with evidence

- **fus-1 likelihood fusion** rejected on smoke:
  - Evidence: `baselines/fusion-fus-1-likelihood-smoke.json`
  - Held-out realism-on median horizontal error worsened (`1.2056 m` -> `2.2361 m`) with no coverage gain.

- **fus-cal-1 self calibration** not accepted (no applied calibrations on smoke):
  - Evidence: `baselines/fusion-fus-cal-1-selfcal-smoke.json`
  - Enabled runs 8, applied runs 0 (insufficient observability).

## 3) Unfinished items (priority order)

1. **MUST** A3.2 honest uncertainty fitting with train/validation folds and calibration targets.
2. **MUST** Node-count 2..8 sweep for legacy/joint/likelihood with duplicate-fix and wrong-fix intervals.
3. **MUST** A4.1 measured elevation + honest 3D covariance integration and aerial-cell scoring.
4. **MUST** A4.2 covariance conditioning crossing rule and old-rule selector.
5. **MUST** A4.3 flat-array above/below hypothesis handling (no default below).
6. **MUST** A5 tracking baseline (bearing-only EKF/PF), gating, birth/death, update-window sweeps.
7. **OPTIONAL** Calibration-walk mode wiring for `measured_heading_self_calibration=2` once surveyed-point input is finalized.

## 4) Repo state

- Branch: `overnight/loc5-fusion`
- Base commit: `ff75074`
- Head commit: `2f5c53e`
- CI in-session validation:
  - `npm test -w @echo/sim-core` passed (298 pass / 0 fail)
  - smoke compare against `baselines/ci-smoke.json` reports scoring-convention mismatch (`baselines/fusion-smoke-default.json`)
- Preregistration hashes:
  - `docs/tracks/fusion/prereg/fus-1-likelihood-smoke-experiment.json`: `ca6d1332d50d017d05dc7db7be5feed60abcdaffae1fcb2d4055ae1d6823b4be`
  - `docs/tracks/fusion/prereg/fus-1-likelihood-smoke.json`: `b0844a6c9aa13140ab67616ed17d5071f1a3c368515c8da0f2790082402c55d9`
  - `docs/tracks/fusion/prereg/fus-cal-1-selfcal-smoke-experiment.json`: `7d5515b27b5ff92780d2d518e59bb2de94f361b1eb4f55f371ecbda8bdfd9ba0`
  - `docs/tracks/fusion/prereg/fus-cal-1-selfcal-smoke.json`: `bc0dc7a3704465ad7606ad3ae3db81e73b91ee96cb23cc60883e16bd74d7a3f4`

## 5) Headline metrics against 3A baseline sheet

- New smoke outputs:
  - `baselines/fusion-fus-1-likelihood-smoke.json`
  - `baselines/fusion-fus-cal-1-selfcal-smoke.json`
- 3A matrix baseline reference remains `baselines/matrix-baseline-r3.json`.
- This session did not rerun full matrix populations; headline statements are smoke-only and not merged into global KPI sheet.

## 6) Merge-readiness checklist

- [x] tests pass (`@echo/sim-core`)
- [x] default fusion mode remains `legacy`
- [x] new behavior is opt-in (`likelihood`, self-calibration)
- [x] shared-file touches listed below
- [x] schema/doc fragments written in track area
- [ ] smoke zero-regression gate against `baselines/ci-smoke.json` (blocked by scoring-convention mismatch in baseline compare metadata)

Shared-file touches:

- `packages/sim-core/src/measured.js` (fusion-mode dispatch, optional calibration rerun, extension export)
- `packages/sim-core/src/joint-fusion.js` (optional calibration-aware track bearing)
- `packages/sim-core/src/recording.js` (allow `measured_fusion_mode=likelihood`)

## 7) Open questions for owner

- Should T4 add `measured_fusion_mode` as a formal benchmark variable in `benchmark/variables.js`, or keep paired-config-only experiments until T8?
- Should scoring-convention compare gate be re-based by T1/T8 before requiring branch-level smoke pass/fail?
