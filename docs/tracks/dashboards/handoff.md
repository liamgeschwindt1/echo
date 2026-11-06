# T7 dashboards handoff

## 1) What landed (with commits)

- Commit `b5bb619`: dashboard UI, engine-history navigation, fallback LE-0 baseline reader, deferred-area placeholders, unit/e2e tests, offline export script, and T7 docs/artifacts.

## 2) Rejected or reverted (with evidence paths)

- None rejected, none reverted.

## 3) Unfinished items (priority order)

1. **MUST**: Switch primary reader from baseline adapter to `engines/<id>/kpi.json` + `engines/kpi-schema.json` when T1 publishes schema and files on origin.
2. **OPTIONAL**: Extend KPI renderer to consume richer paired-interval structures if future KPI schema adds explicit delta blocks.
3. **OPTIONAL**: Add more screenshot variants for each placeholder page.

## 4) Repo state

- Branch: `dashboards/1`
- Base commit used: `ff75074`
- Current HEAD commit: `b5bb619`
- CI result: local validation run only (GitHub Actions run not triggered in this session)
- Preregistration hashes: none created (UI track; no new experiment study run)

## 5) Headline metrics against 3A baseline

From LE-0 baseline adapter (`baselines/matrix-baseline-r3.json`, profile `on`):

- events_within_10m_misses_counted: `0.5194`
- horizontal_median_m: `11.2064`
- horizontal_p90_m: `23.2834`
- scene_fix_rate: `0.7917`
- source_fix_rate: `0.6611`
- unflagged_wrong_fix_rate: `0`

## 6) Merge-readiness checklist

- [x] Tests pass (local): sim unit tests + dashboards e2e
- [x] Production build passes
- [x] Default localiser output unchanged (UI-only; no solver/renderer/scoring edits)
- [x] Goldens untouched
- [x] Shared-file touches listed:
  - `apps/sim/index.html` (+2/-0)
  - `apps/sim/src/main.js` (+5/-1)
  - `apps/sim/src/style.css` (+27/-0)
  - `apps/sim/package.json` (+1/-0)
- [x] Opt-in defaults and behavior:
  - No engine-behavior option added; dashboard appears in UI nav, engine math unchanged.
- [x] Schema/doc fragments written:
  - `docs/tracks/dashboards/dashboard-schema.md`
  - `docs/tracks/dashboards/claims-fragment.md`
  - `docs/tracks/dashboards/sim-md-fragment.md`

## 7) Open questions for owner

- Should the Dashboards workspace be its own top-level nav item (current) or nested under Testing after integration?
- For the upcoming KPI schema, should profile naming stay exactly `off|on|surveyed|self-calibrated` in file keys, or include aliases?
