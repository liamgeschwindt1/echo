# Track T1 report (in progress)

Status: in progress. This report currently covers A0.6 landing work only.

## Landed

- Engine KPI schema added: `engines/kpi-schema.json`.
- Engine registry writer script added: `scripts/engine-kpi.mjs`.
- Script test added: `packages/sim-core/test/sim-engine-kpi.test.js`.
- Registry docs added: `docs/tracks/infra/engine-registry.md`.
- Metric field contract added: `docs/tracks/infra/metrics.md`.
- LE-0 backfilled from 3A baseline artifacts:
  - `engines/LE-0/engine.json`
  - `engines/LE-0/kpi.json`
  - `engines/LE-0/refs.json`
  - `engines/registry.json`
- Sharded evaluation stack added:
  - workflow: `.github/workflows/benchmark-sharded.yml`
  - planning/execution/merge scripts:
    - `scripts/benchmark-shard-plan.mjs`
    - `scripts/benchmark-shard.mjs`
    - `scripts/benchmark-shard-merge.mjs`
    - `scripts/benchmark-shard-compare.mjs`
  - design doc: `docs/experiments/sharded-evaluation.md`
- Sharded smoke verification evidence saved: `baselines/infra-sharded-smoke-check.json`.

## Headline metrics against 3A baseline

From `engines/LE-0/kpi.json`:

- `events_within_10m_misses_counted`: 0.3093 (95% CI 0.2641, 0.3578)
- `horizontal_median_m`: 7.2614
- `horizontal_p90_m`: 37.4802
- `scene_fix_rate`: 0.7822
- `source_fix_rate`: 0.4936
- `unflagged_wrong_fix_rate`: 0.0000
- `within_1sigma`: 0.4137
- `within_2sigma`: 0.5848
- `error_3d_p90_m`: null (unavailable in 3A baseline)
- `aerial_3d_fix_rate`: null (unavailable in 3A baseline)
- `aerial_height_error_m`: null (unavailable in 3A baseline)

## Pending in this track

Priority order (remaining): A0.1, A0.3, A0.2, A0.4, A0.5.

## A0.1 verification notes (matrix-smoke)

- Evidence file: `baselines/infra-sharded-smoke-check.json` (36 jobs total; 18 jobs per shard in two-shard verification).
- Equality check:
  - command family recorded in baseline evidence JSON
  - result: equal summary metrics (excluding `runtime_ms`)
- Timed shard wall-clock:
  - shard 0: 62.75 s for 18 jobs
  - shard 1: 90.36 s for 18 jobs
  - merge: 1.12 s

## Registered population counts and estimates

- Matrix standard (`docs/experiments/matrix-r3-standard.json`):
  - registered jobs: 216
  - estimated minutes at 2 workers: 479.48 min (~8.0 h)
- Sealed design (`docs/experiments/matrix-r3-sealed.json`):
  - registered jobs: 480
  - estimated minutes at 2 workers: 1095.58 min (~18.3 h)
  - sealed input hash: `a2fe9499ec853c2e5a3d6e2ececef9ca30410adb7454ed39a211c2fdf072a78c`

## Notes

- No sealed set run was started.
- No shared docs outside `docs/tracks/infra/*` were edited.
- Prereg/source hashes consumed:
  - preregistration: `6b5f325fe8fb292ffdc87cc8ad245857d9193de8546b4f87c5c5b01643ac29a5`
  - sealed input (not run): `a2fe9499ec853c2e5a3d6e2ececef9ca30410adb7454ed39a211c2fdf072a78c`
- Remaining A0.1 gap: sealed attempt ledger claim/enforcement is not wired yet.
