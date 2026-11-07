# Infra track log (T1)

Assumption: 10 h session budget with final 90 min reserved for handoff.

## 2026-11-06

- 16:20 UTC — step A0.6 start; precondition checks pass at `ff75074`; branch `overnight/loc5-infra`; disk not yet sampled in this log.
- 16:35 UTC — added `scripts/engine-kpi.mjs`, `engines/kpi-schema.json`, and tests scaffold for deterministic KPI generation with null preservation.
- 16:45 UTC — backfilled LE-0 from `baselines/matrix-baseline-r3.json` + `baselines/matrix-baseline-r3.full.json.gz`; generated `engines/LE-0/*` and `engines/registry.json`.
- 16:55 UTC — added sharded evaluation workflow and scripts (`benchmark-shard-plan`, `benchmark-shard`, `benchmark-shard-merge`, `benchmark-shard-compare`) plus design doc `docs/experiments/sharded-evaluation.md`.
- 17:05 UTC — local verification run complete on `matrix-r3-smoke`: local run, 2-shard run, merge, and equality check passed (summary metrics excluding `runtime_ms`).
