# Mission 4 X0 detectability diagnostic (matrix r3 baseline)

This diagnostic uses the frozen 3A complete baseline report only. No new simulation jobs were run and no inference code was changed.

## Labels

- **Original (unchanged):** `detectable_3_nodes` = three or more nodes have source-aligned measured tracks during source clip within 10 degrees of truth.
- **Added for physics-feasibility context:** `bearing_available_3_nodes` = three or more nodes have any measured bearing window during source clip.
- **Added for in-clip sensitivity check:** `track_within10_any_time_3_nodes` = three or more nodes have track windows within 10 degrees of truth at any time (in or out of source clip).

## Event-level rates for three-source events

| Profile | Events | detectable_3_nodes | bearing_available_3_nodes | within10_in_clip_3_nodes | track_within10_any_time_3_nodes |
|---|---:|---:|---:|---:|---:|
| off | 321 | 0.6% | 83.2% | 0.3% | 2.2% |
| on | 321 | 0.3% | 64.5% | 0.0% | 0.6% |
| surveyed | 321 | 1.2% | 84.1% | 0.9% | 2.8% |

## Why events fail original detectability label

| Profile | Non-detectable events | No 3 nodes with any in-clip bearing | Bearings present but not within 10° on 3 nodes | Lost at assignment stage | Lost at association stage |
|---|---:|---:|---:|---:|---:|
| off | 319 | 16.9% | 82.8% | 0.3% | 0.0% |
| on | 320 | 35.6% | 64.4% | 0.0% | 0.0% |
| surveyed | 317 | 16.1% | 83.3% | 0.6% | 0.0% |

## Node-stage decomposition (three-source node-events)

| Profile | Node-events | Candidate in clip | Bearing window in clip | Track window in clip | Bearing within 10° in clip | Assigned within clip (original) | Within 10° at any track time | Candidate lost before window (overlap/quality gate) | Window lost before track |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| off | 1545 | 99.4% | 74.4% | 65.2% | 20.6% | 21.7% | 21.9% | 25.0% | 9.1% |
| on | 1545 | 96.5% | 63.9% | 54.4% | 16.8% | 17.9% | 18.4% | 32.6% | 9.5% |
| surveyed | 1545 | 99.2% | 74.2% | 64.1% | 20.8% | 21.7% | 22.4% | 25.0% | 10.1% |

## Decision for C1 focus

C1 should focus first on **bearing quality in multi-source overlap**, not source assignment or fusion tie-breaks. Most failures already have candidate windows and often in-clip windows, but fewer than three nodes stay within 10° in clip. The original label remains unchanged for sealed comparability, and the new `bearing_available_3_nodes` label is reported beside it to avoid conflating physics availability with angular-accuracy failure.
