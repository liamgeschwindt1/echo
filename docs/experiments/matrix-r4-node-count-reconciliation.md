# Mission 4 X1 node-count reconciliation (matrix sites, legacy solver)

This reconciliation uses the frozen 3A complete baseline report (`baselines/matrix-baseline-r3.full.json.gz`) and does not alter inference code.

## Matrix-site node-count summary

| Realism | Sources | Nodes | Runs | Scene fix rate | Events within 10 m (misses fail) | Detectable at 3+ nodes | Wrong-fix rate | Unflagged wrong-fix rate | Duplicate-fix scene rate | Mean fixes per scene |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| off | 1 | 2 | 4 | 0.750 | 0.500 | 0.000 | 0.400 | 0.000 | 0.500 | 1.250 |
| off | 1 | 3 | 4 | 0.750 | 0.750 | 0.750 | 0.429 | 0.000 | 0.500 | 1.750 |
| off | 1 | 4 | 2 | 1.000 | 1.000 | 1.000 | 0.733 | 0.000 | 1.000 | 7.500 |
| off | 1 | 5 | 83 | 1.000 | 0.988 | 0.988 | 0.677 | 0.000 | 1.000 | 5.253 |
| off | 1 | 6 | 2 | 1.000 | 1.000 | 1.000 | 0.750 | 0.000 | 1.000 | 6.000 |
| off | 3 | 2 | 4 | 0.000 | 0.000 | 0.000 | null | 0.000 | 0.000 | 0.000 |
| off | 3 | 3 | 4 | 0.250 | 0.083 | 0.000 | 0.500 | 0.000 | 0.000 | 0.500 |
| off | 3 | 4 | 4 | 0.250 | 0.083 | 0.000 | 0.000 | 0.000 | 0.000 | 0.250 |
| off | 3 | 5 | 91 | 0.714 | 0.176 | 0.007 | 0.649 | 0.000 | 0.132 | 1.879 |
| off | 3 | 6 | 4 | 0.250 | 0.250 | 0.000 | 0.000 | 0.000 | 0.000 | 0.750 |
| on | 1 | 2 | 4 | 0.750 | 0.750 | 0.000 | 0.400 | 0.000 | 0.250 | 1.250 |
| on | 1 | 3 | 4 | 1.000 | 0.750 | 0.750 | 0.625 | 0.000 | 0.750 | 2.000 |
| on | 1 | 4 | 2 | 1.000 | 0.500 | 1.000 | 0.917 | 0.000 | 1.000 | 6.000 |
| on | 1 | 5 | 83 | 1.000 | 0.928 | 0.964 | 0.683 | 0.000 | 0.952 | 4.940 |
| on | 1 | 6 | 2 | 1.000 | 0.500 | 1.000 | 0.818 | 0.000 | 1.000 | 5.500 |
| on | 3 | 2 | 4 | 0.000 | 0.000 | 0.000 | null | 0.000 | 0.000 | 0.000 |
| on | 3 | 3 | 4 | 0.500 | 0.000 | 0.000 | 1.000 | 0.000 | 0.000 | 0.500 |
| on | 3 | 4 | 4 | 0.000 | 0.000 | 0.000 | null | 0.000 | 0.000 | 0.000 |
| on | 3 | 5 | 91 | 0.571 | 0.088 | 0.004 | 0.772 | 0.000 | 0.121 | 1.495 |
| on | 3 | 6 | 4 | 0.250 | 0.167 | 0.000 | 0.000 | 0.000 | 0.000 | 0.500 |

## Reconciliation with round-2 observation

Round 2's 8% to 60-68% rise referred to wrong fixes as available nodes increased under pairwise fusion. In this matrix baseline, the same pattern appears as high wrong-fix rates in multi-source five-node runs (`wrong_fix_rate` about 0.649 off and 0.772 on) with large duplicate-fix scene rates, while one-source runs remain strong. The node-count trend is not smooth at 2/3/4/6 because those buckets are tiny in this baseline and node 8 was intentionally excluded from the runnable baseline population. So this reconciliation confirms the **failure mode type** (pairwise duplicate/ambiguous fixes under multi-source load) but is still underpowered for a full 2..8 monotonic curve.
