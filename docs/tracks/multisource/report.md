# Track T2 report (session partial)

## Scope completed in this session

1. Added opt-in multisource extension package:
   - `options.js` (`ms_*` option resolution, default off)
   - `candidates.js` (multi-peak, time-frequency histogram proxy, harmonic-comb candidates)
   - `association.js` (spectral+temporal cross-node grouping with 3+ node ghost-consistency gate)
   - `index.js` (pipeline orchestration)
2. Added one measured-pipeline hook that emits `results.extensions.multisource` only when `ms_*` modes are enabled.
3. Added opt-in rotor source model in new renderer extension file and hooked render clip sourcing through it.
4. Added focused test coverage and regression guard evidence.

## Validation run in this session

- `node --test packages/sim-core/test/sim-multisource.test.js packages/sim-core/test/sim-measured.test.js` (pass)
- `node --test packages/sim-core/test/sim-golden.test.js` (pass)
- Evidence: `baselines/multisource-unit-tests-20261106.json`

## Not completed yet

- No preregistered benchmark populations were executed yet (`docs/tracks/multisource/prereg/a1-multisource-smoke-v1.json` is registered only).
- No KPI/interval table against `baselines/matrix-baseline-r3.json` yet.
- A1.3 oracle benefit gating vs injected confusion-rate pass not run yet.

## Notes

- All new behaviour is opt-in and default OFF.
- No fusion core edits were made.
- Export schema version unchanged; extension data is under `results.extensions.multisource.*`.
