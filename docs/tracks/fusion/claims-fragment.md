# Claims fragment (T4)

- Added opt-in measured fusion mode `likelihood` (default remains `legacy`).
- Added opt-in heading self-calibration pass (`measured_heading_self_calibration`, default OFF).
- Exported fusion diagnostics under `extensions.fusion.*` without schema bump.
- Full `@echo/sim-core` test suite passed after these changes.
- On smoke population:
  - likelihood mode did **not** improve headline error/coverage versus legacy.
  - self-calibration mode produced no applied calibrations (insufficient observability in this tiny smoke population).

No real-world validation is claimed.
