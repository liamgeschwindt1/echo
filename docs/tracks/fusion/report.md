# T4 Fusion report

## Scope completed in this session

- Branch head for this report: `2f5c53e` (`overnight/loc5-fusion`)

- Implemented **A3.1 heading self-calibration** plumbing:
  - new module `packages/sim-core/src/ext/fusion/heading-calibration.js`
  - per-node offset and sigma estimation with observability checks
  - fusion rerun with calibration offsets when available
  - export diagnostics under `extensions.fusion.*`

- Implemented **A3.4 likelihood-product fusion** (opt-in, default OFF):
  - new module `packages/sim-core/src/ext/fusion/likelihood-fusion.js`
  - new mode `measured_fusion_mode=likelihood`
  - one fix per time cluster; no pair-duplicate fix output
  - 90% region radius export in `fix.confidence.radius_90_m`

- Kept legacy default behavior selectable and unchanged by default:
  - default `measured_fusion_mode` remains `legacy`
  - fusion extension fields are emitted only when fusion extension mode is enabled

## Validation

- Focused tests passed:
  - `test/sim-fusion-calibration.test.js`
  - `test/sim-joint-fusion.test.js`
  - `test/sim-measured.test.js`
  - `test/sim-recording.test.js`

- Full package suite passed:
  - `npm test -w @echo/sim-core`
  - 298 pass / 0 fail

## Preregistered studies and outcomes

### fus-1 (`measured_fusion_mode=likelihood`) — **Rejected on smoke**

- Prereg:
  - `docs/tracks/fusion/prereg/fus-1-likelihood-smoke.json`
  - `docs/tracks/fusion/prereg/fus-1-likelihood-smoke-experiment.json`
- Output:
  - `baselines/fusion-fus-1-likelihood-smoke.json` (plus csv/html)
- Held-out, realism on:
  - events within 10 m: legacy `0.3333`, likelihood `0.3333` (no gain)
  - scene fix rate: legacy `0.3333`, likelihood `0.3333` (no gain)
  - unflagged wrong-fix rate: legacy `0`, likelihood `0` (no harm)
  - horizontal median error: legacy `1.2056 m`, likelihood `2.2361 m` (**worse**)

### fus-cal-1 (`measured_heading_self_calibration=1`) — **No effect on smoke**

- Prereg:
  - `docs/tracks/fusion/prereg/fus-cal-1-selfcal-smoke.json`
  - `docs/tracks/fusion/prereg/fus-cal-1-selfcal-smoke-experiment.json`
- Output:
  - `baselines/fusion-fus-cal-1-selfcal-smoke.json` (plus csv/html)
- Diagnostics:
  - enabled runs: 8
  - calibration applied runs: 0
  - reason: insufficient observability in this small smoke population

## Default regression check note

- Ran smoke compare against `baselines/ci-smoke.json`:
  - output: `baselines/fusion-smoke-default.json`
  - compare status reports one regression due **different scoring conventions** in baseline metadata, not a metric drift row.
  - needs T1/T8 baseline refresh/re-score alignment before this gate can be used for pass/fail in this branch.

## Files touched

- Code:
  - `packages/sim-core/src/measured.js`
  - `packages/sim-core/src/joint-fusion.js`
  - `packages/sim-core/src/recording.js`
  - `packages/sim-core/src/ext/fusion/utils.js`
  - `packages/sim-core/src/ext/fusion/heading-calibration.js`
  - `packages/sim-core/src/ext/fusion/likelihood-fusion.js`
  - `packages/sim-core/test/sim-fusion-calibration.test.js`
- Track docs and prereg:
  - `docs/tracks/fusion/*`
  - `baselines/fusion-*`
