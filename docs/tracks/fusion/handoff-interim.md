# T4 fusion interim handoff

## Landed so far

- Added opt-in likelihood fusion mode (`measured_fusion_mode=likelihood`).
- Added opt-in heading self-calibration (`measured_heading_self_calibration`).
- Added fusion extension modules and test coverage.
- Full `@echo/sim-core` tests pass.

## Current evidence

- `baselines/fusion-fus-1-likelihood-smoke.json` (likelihood rejected on smoke)
- `baselines/fusion-fus-cal-1-selfcal-smoke.json` (self-cal no effect on smoke)

## Next MUST items

1. Run larger prereg population with enough multi-node fixes for calibration observability.
2. Add node-count (2..8) sweep focused on multi-source cells for duplicate/wrong-fix headline.
3. Implement A4.1/A4.2/A4.3 on accepted fusion path.
4. Start A5 tracking experiments with update-rate/window sweeps.
