# Overnight localisation report, round 4

## Outcome

Mission 4 completed X0/X1 diagnostics, an opt-in joint-fusion implementation, its paired smoke, and the preregistered node-count rerun. The joint candidate failed rule-four smoke guards, so legacy remains the default. No inference behavior was promoted.

Work ran on `overnight/localisation-4`, based on `origin/overnight/localisation-3a`. All pushes stayed on the mission branch; `main` was not changed. The available mission window was set to `T = 10 h` from 07:29 UTC.

## Results

- **X0 detectability:** Analysis of the frozen 3A baseline now uses exact archived clip samples and render sample rates. For three-source events, 78.5-87.9% have an in-clip bearing on at least three nodes, but only 1.6-4.7% have three pre-track bearings within 10 degrees. The source-aligned track label is post-hoc scoring, not an engine assignment output. Archived inference cannot identify pre-filter rejection causes or prove the label stricter than physical detectability. Full report: [`matrix-r3-detectability.md`](experiments/matrix-r3-detectability.md).
- **C1 joint fusion:** Added opt-in `measured_fusion_mode=joint` for compatible static bearings, retaining legacy as default and moving tracks on legacy behavior. Full sim-core suite passed 296/296 after implementation.
- **C1 smoke:** All 72 frozen jobs completed. Rule four failed in four of six partitions: train/off and train/surveyed failed 1-sigma calibration; train/on and validation/on each lost one of six fixes, with validation/on lacking a significant endpoint improvement. Validation/off and validation/surveyed passed. Unflagged wrong-fix rate was zero in all six groups. Keep joint mode unpromoted; covariance-derived confidence remains uncalibrated. Results: [`mission4-c1-smoke.md`](experiments/mission4-c1-smoke.md), [comparison JSON](../baselines/mission4-c1-smoke-analysis.json), and [compressed full report](../baselines/mission4-c1-smoke.json.gz).
- **X1 node-count sweep:** All 140 jobs completed across ten fixed open/ground/stationary sites, counts 2-8, and off/on profiles. In this cohort, three-source scene-fix rate rose from 20% at N2 to 100% at N8 in both profiles. At N8, three-source events within 10 m were 66.7% off / 53.3% on; source-aligned detection at 3+ nodes was 20.0% / 13.3%; duplicate-fix scene rates were 60% / 40%. Five sites per cell make this descriptive, not a general node-count optimum. Full 95% site-cluster intervals: [`mission4-x1-node-count-results.md`](experiments/mission4-x1-node-count-results.md).

All outcomes are synthetic. They do not establish field accuracy, hardware requirements, or a universally optimal node count. The required install-profile draft is in [`install-requirements.md`](install-requirements.md); self-calibration remains pending.

## Budget-limited work not run

- The registered `matrix-standard` population contains 216 jobs. Recorded p90 estimation was 57,538,070 ms total, or about 8.0 hours at two workers. At the 08:23 UTC budget check, only about 6 hours remained before preserving the final three-hour reserve. It was not started; C1 had already failed smoke and legacy behavior was unchanged.
- The existing sealed design contains 480 runnable jobs. Its recorded p90 estimate was 131,470,029 ms, or about 18.3 hours at two workers, exceeding the full 10-hour mission window. No sealed attempt was started or consumed, and no partial sealed run was made.
- `matrix-full` and realism-decomposition were not run. No change to populations or acceptance criteria was made to fit these studies into the remaining budget.

Because neither the full matrix-standard validation nor the single sealed evaluation fit the available compute budget, this is a blocked handoff rather than a complete mission acceptance. Do not describe the candidate as accepted or the sealed evaluation as passed.

## Evidence and validation

- X0 source baseline: `baselines/matrix-baseline-r3.full.json.gz`, SHA-256 `1dae27871b53cfc678b744ac1cccc35206da6634e488672c26acec42fb61f066`.
- C1 raw paired report: `baselines/mission4-c1-smoke.json.gz`, SHA-256 `e61049aaf7f575d966d4b02d73e4f3dd3d15b3cf8384d79268f91b2c374da749`.
- X1 raw sweep report: `baselines/mission4-x1-node-count.json.gz`, SHA-256 `9892cf23bad79f4744c7e17c87fff234353e32f005f030f6a35c8af2cfff67ff`.
- Full sim-core test suite: 296/296 passed. GitHub Actions run `42188155457` on `db54ecf` passed in 11m54s, including sim-core, sim app, production build, sealed-evidence verifier, browser/CLI, and the finite CI benchmark. The first run exposed a stale CI baseline scoring version; workflow now re-scores stored baseline inference before comparison. No inference or rendering changes were made to fix it.
- Reproducible report-generation scripts and detailed operational decisions are linked from the [Mission 4 overnight log](overnight-log.md).
