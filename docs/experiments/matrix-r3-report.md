# Mission 3A: Round 3 matrix report

## Status and evidence

Mission 3A's registered matrix baseline is complete. The corrected input contains
588 generated sites: 96 train, 300 validation (including generalisation and
density sites), and 192 sealed core sites. The runnable baseline used 202 sites
and completed all 606 measured-only jobs across `off`, `on`, and `surveyed`
profiles. Render audio was discarded after its consumers completed; the exact
complete report is preserved as
[`matrix-baseline-r3.full.json.gz`](../../baselines/matrix-baseline-r3.full.json.gz)
and summarized in
[`matrix-baseline-r3.json`](../../baselines/matrix-baseline-r3.json).

The frozen pre-outcome design hash is
`6b5f325fe8fb292ffdc87cc8ad245857d9193de8546b4f87c5c5b01643ac29a5`. The
generated input hash is
`99e9e973c25b7809839ebea4f55360d2a33604618b97ecaca69054e4af46a8ed`; frozen
sealed input hash is
`a2fe9499ec853c2e5a3d6e2ececef9ca30410adb7454ed39a211c2fdf072a78c`. The
sealed package has 240 scenes (192 sealed core and 48 generalisation) and was
not run.

Cold timing probes completed 18/18 and 72/72 with zero cache hits. Corrected
source counts and source heights were verified in the timing, smoke, and
baseline inputs. The 36-run matrix smoke completed. Earlier zero-source and
source-height-invalid trials are retained under `*-invalid-*` names and are
excluded from this report.

## Core matrix outcomes

The following values pool the 120 core sites by profile; event rates use all
expected source events as denominator, so misses count as failures. Median and
p90 position errors are conditional on assigned fixes. Values are synthetic
diagnostics, not field performance.

| Profile | Events within 10 m | Detectable at 3+ nodes | Within 10 m among detectable | Median error | P90 error |
|---|---:|---:|---:|---:|---:|
| off | 39.6% | 25.4% | 98.4% | 3.8 m | 37.0 m |
| on | 31.3% | 24.2% | 93.1% | 7.0 m | 37.0 m |
| surveyed | 36.7% | 26.3% | 95.2% | 5.9 m | 37.2 m |

Source count separates outcomes sharply:

| Sources | Profile | Events within 10 m | Detectable at 3+ nodes | Median error | P90 error |
|---:|---|---:|---:|---:|---:|
| 1 | off | 98.3% | 98.3% | 3.1 m | 10.9 m |
| 1 | on | 93.3% | 95.0% | 4.9 m | 13.1 m |
| 1 | surveyed | 95.0% | 98.3% | 3.2 m | 12.5 m |
| 3 | off | 20.0% | 1.1% | 22.1 m | 39.7 m |
| 3 | on | 10.6% | 0.6% | 29.6 m | 41.1 m |
| 3 | surveyed | 17.2% | 2.2% | 26.6 m | 39.5 m |

Conditional accuracy among detectable three-source events has a tiny
denominator; it should not be read as evidence of good multi-source performance.
Per-fix probability metrics are null because included measured fixes do not
provide `p_wrong`. No calibration or probability-ranking claim is available.

Each core cell has five independent sites per profile and is reportable as a
descriptive cell. Train-only groups have two sites and validation-only groups
have three, so neither split qualifies for tier colors or population rankings.
All 30 density/profile groups contain only three or four sites and are marked
insufficient. Generalisation has 48 sites per profile:

| Profile | Events within 10 m | Median error | P90 error |
|---|---:|---:|---:|
| off | 32.4% | 13.2 m | 38.0 m |
| on | 24.5% | 14.4 m | 39.9 m |
| surveyed | 29.4% | 16.7 m | 38.6 m |

## Interpretation and handoff

The one-source cases are substantially more detectable than three-source cases.
Source-aligned detection at three or more nodes is especially scarce for
three-source events; this is the clearest next diagnostic target. No solver
change was selected or accepted from these outcomes. Owner-editable targets
remain placeholders, and the synthetic study does not validate field
performance.

The separately registered `matrix-standard` and `matrix-full` tiers and the
realism-decomposition experiment were not run. The sealed set remains reserved
for Mission 3D and must not be executed during follow-up work on Mission 3A.
Use the complete report and per-cell summary as the frozen synthetic reference;
do not tune against sealed inputs or interpret undersized groups as population
rankings.

Validation completed: core tests 294/294, simulation app tests 39/39, echo app
tests 8/8, production build, and browser/CLI end-to-end checks 2/2 passed. The
build emitted existing dependency and bundle-size warnings.
