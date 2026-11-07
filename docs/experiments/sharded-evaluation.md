# Sharded benchmark evaluation (A0.1)

## Goal

Run preregistered benchmark populations in parallel shards while preserving deterministic job membership and merged report shape.

## Workflow

File: `.github/workflows/benchmark-sharded.yml`

- Trigger: `workflow_dispatch`.
- Limits:
  - max parallel shard jobs: 20
  - shard timeout: 6 hours
- Inputs:
  - `experiment` (preset or JSON path)
  - `shards` (1-20)
  - `workers` (per shard)
  - `merged_output`

## Shard mechanics

1. Plan stage computes full registered job list with `buildJobs`.
2. Jobs are split into fixed contiguous slices (`start = floor(i*N/S)`, `end = floor((i+1)*N/S)`).
3. Each shard runs only its slice with:
   - own cache directory
   - `--discard-renders`
4. Each shard uploads `json/csv/html` artifact.
5. Merge stage verifies:
   - every expected job id appears exactly once
   - no extra job ids
   - all shard source hashes match
   - shard input hash matches dispatch input hash
6. Merge stage writes final report in the same benchmark format (`echo-sim-benchmark`).

## Scripts

- `scripts/benchmark-shard-plan.mjs`
- `scripts/benchmark-shard.mjs`
- `scripts/benchmark-shard-merge.mjs`
- `scripts/benchmark-shard-compare.mjs` (local vs sharded summary equality check excluding `runtime_ms`)

## Sealed-run support note

This workflow can execute fixed registered populations and enforce exact job coverage. Sealed ledger claim/attempt controls are still pending integration in this track before sealed use by T8.
