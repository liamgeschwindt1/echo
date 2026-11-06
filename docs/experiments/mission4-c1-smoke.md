# Mission 4 C1 paired smoke result

The frozen 72-job smoke completed: 36 paired legacy/joint jobs across train/validation and off/on/surveyed profiles. Analysis uses the existing round-2 rule-four comparator with 2,000 whole-scene/seed bootstrap draws and 95% intervals. This smoke is not full acceptance.

| Split | Profile | Pairs | Legacy scene fix | Joint scene fix | Legacy within 1σ | Joint within 1σ | P90 delta [95% CI] m | Risk-area delta [95% CI] | Rule-four group |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| train | off | 6 | 100.0% | 100.0% | 73.1% | 77.8% | -35.008 [-38.240, 0.461] | -1.000 [-1.000, -1.000] | FAIL: within_1sigma fails guard |
| train | on | 6 | 100.0% | 83.3% | 62.5% | 68.2% | -3.521 [-8.125, -2.073] | -0.667 [-1.000, -0.333] | FAIL: scene_fix_rate fails guard |
| train | surveyed | 6 | 100.0% | 100.0% | 75.0% | 83.0% | -2.791 [-4.560, 0.213] | -1.000 [-1.000, -1.000] | FAIL: within_1sigma fails guard |
| validation | off | 6 | 100.0% | 100.0% | 62.5% | 63.0% | -4.934 [-5.981, 0.758] | -0.500 [-0.833, -0.167] | PASS |
| validation | on | 6 | 100.0% | 83.3% | 50.0% | 63.2% | -23.136 [-24.758, 0.535] | -0.333 [-0.667, 0.000] | FAIL: scene_fix_rate fails guard; No paired median/p90/risk-area improvement with CI excluding zero |
| validation | surveyed | 6 | 100.0% | 100.0% | 23.1% | 63.0% | -21.607 [-40.616, 2.879] | -0.667 [-1.000, -0.333] | PASS |

Overall smoke decision: **FAIL**. Keep legacy as default and joint mode opt-in. The smoke does not support promotion.

Training guards fail for off-realism 1σ calibration, on-realism scene-fix rate, and surveyed 1σ calibration. Validation on-realism scene-fix rate falls from 100% to 83.3%, and no endpoint improvement has a paired interval wholly below zero in that group. Validation off and surveyed groups pass, but cannot override failures elsewhere. Unflagged wrong-fix rate is zero for both solvers in all six groups. The covariance-derived confidence remains uncalibrated.

Full group metrics and intervals are in `baselines/mission4-c1-smoke-analysis.json`; source report is `baselines/mission4-c1-smoke.json.gz`.
