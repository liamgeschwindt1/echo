# Mission 4 interim handoff (phase 0/1 checkpoint)

## What landed

- Mission branch created and pushed: `overnight/localisation-4` from `origin/overnight/localisation-3a`.
- Precondition checks passed against required 3A artifacts.
- Phase 0/1 diagnostics preregistered: `docs/experiments/mission4-x0-x1-prereg.json`.
- Reproducible analysis script added: `scripts/mission4-x0-x1-analysis.mjs`.
- X0 report generated: `docs/experiments/matrix-r3-detectability.md`.
- X1 report generated: `docs/experiments/matrix-r4-node-count-reconciliation.md`.
- Machine-readable outputs saved: `baselines/mission4-x0-x1-analysis.json`.
- Required install-profile draft created: `docs/install-requirements.md`.
- Mission log updated: `docs/overnight-log.md` (Mission 4 start and checkpoint).

## What is running

- No background benchmark jobs running at this checkpoint.

## What is next

1. Start C1 implementation as opt-in path (legacy solver preserved), then run matrix-smoke train+validation and acceptance checks.
2. Run matrix-standard validation checkpoint after kept phase-1 steps.
3. Continue phase plan with D-series/F/G/E steps by priority and remaining time.
