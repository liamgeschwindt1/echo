# Mission 4 handoff

## Status

Diagnostic studies and C1 smoke are complete. No solver change passed acceptance; legacy remains the default. Mission is **not fully accepted** because the registered `matrix-standard` and sealed evaluations did not fit the ten-hour compute budget.

## Branch and evidence

- Work is on `overnight/localisation-4`, based on `origin/overnight/localisation-3a`. No push to `main`.
- X0 source-detectability correction and X1 baseline analysis: `docs/experiments/matrix-r3-detectability.md` and `docs/experiments/matrix-r4-node-count-reconciliation.md`.
- C1 implementation is opt-in only. Its paired smoke failed four of six rule-four partitions; retain legacy default. See `docs/experiments/mission4-c1-smoke.md`.
- X1 completed all 140 preregistered jobs. See `docs/experiments/mission4-x1-node-count-results.md` and the compressed full report at `baselines/mission4-x1-node-count.json.gz`.
- Full sim-core suite passed 296/296. GitHub Actions status is recorded in the overnight log and round-4 report.

## Deferred

The registered `matrix-standard` run was not started: estimated p90 is about 8 hours at two workers, longer than the six-hour window before the reserved final three hours. The sealed design's 480 jobs estimate to about 18.3 hours at two workers, beyond the full `T = 10 h` mission budget. No sealed attempt was consumed and no partial run was made. `matrix-full` and realism-decomposition also remain unrun.

Next mission window should allow enough uninterrupted time for the complete preregistered validation and sealed population. Do not promote joint mode or claim sealed acceptance from the current evidence.
