# Track T1 handoff (interim)

## 1) Landed (commits pending)

- A0.6 core infrastructure files created:
  - `scripts/engine-kpi.mjs`
  - `engines/kpi-schema.json`
  - `engines/registry.json`
  - `engines/LE-0/engine.json`
  - `engines/LE-0/kpi.json`
  - `engines/LE-0/refs.json`
  - `packages/sim-core/test/sim-engine-kpi.test.js`
  - `docs/tracks/infra/engine-registry.md`
  - `docs/tracks/infra/metrics.md`

## 2) Rejected/reverted

- None yet.

## 3) Unfinished items

- MUST: Backfill LE-0 (`engines/LE-0/*`) from `baselines/matrix-baseline-r3.json` + `baselines/matrix-baseline-r3.full.json.gz`.
- MUST: Run targeted tests for `engine-kpi`.
- MUST: Start A0.1 sharded workflow implementation and docs.
- OPTIONAL: A0.5 mismatched-physics mode.

## 4) Repo state

- Branch: `overnight/loc5-infra`
- Head: `ff75074` + uncommitted track changes
- CI: not run yet for this branch state
- Prereg hashes:
  - matrix prereg: `6b5f325fe8fb292ffdc87cc8ad245857d9193de8546b4f87c5c5b01643ac29a5`
  - sealed input hash (not run): `a2fe9499ec853c2e5a3d6e2ececef9ca30410adb7454ed39a211c2fdf072a78c`

## 5) Headline metrics against 3A baseline

- `events_within_10m_misses_counted`: 0.3093 (95% CI 0.2641, 0.3578)
- `horizontal_median_m`: 7.2614
- `horizontal_p90_m`: 37.4802
- `scene_fix_rate`: 0.7822
- `source_fix_rate`: 0.4936
- 3D and aerial headline KPIs unavailable in 3A baseline are preserved as null.

## 6) Merge-readiness checklist

- Tests pass: targeted test passed (`node --test packages/sim-core/test/sim-engine-kpi.test.js`)
- Default output unchanged smoke/goldens: pending
- Shared-file touches listed: none yet
- New options/defaults listed: none in this step
- Schema/doc fragments: written in track docs

## 7) Open questions for owner

- None at this interim stage.
