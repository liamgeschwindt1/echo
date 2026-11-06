# Mission 4 X0 detectability diagnostic (matrix r3 baseline)

This diagnostic uses the frozen 3A complete baseline report only. No new simulation jobs were run and no inference code was changed. Clip bounds use exact archived audio sample counts and each scenario's render sample rate. Source alignment is scoring-only: truth is read after inference, not by the engine.

## Labels

- **Original (unchanged):** `detectable_3_nodes` = three or more nodes have source-aligned measured tracks during source clip within 10 degrees of truth.
- **Added for availability context:** `bearing_available_3_nodes` = three or more nodes have any measured bearing window during source clip.
- **Added for in-clip sensitivity context:** `track_within10_any_time_3_nodes` = three or more nodes have track windows within 10 degrees of truth at any time (in or out of source clip).

## Event-level rates for three-source events

| Profile | Events | detectable_3_nodes | bearing_available_3_nodes | within10_in_clip_3_nodes | track_within10_any_time_3_nodes |
|---|---:|---:|---:|---:|---:|
| off | 321 | 0.6% | 87.9% | 3.1% | 2.2% |
| on | 321 | 0.3% | 78.5% | 1.6% | 0.6% |
| surveyed | 321 | 1.2% | 86.9% | 4.7% | 2.8% |

## Why events fail original detectability label

| Profile | Non-detectable events | Fewer than 3 nodes with any accepted in-clip bearing | At least 3 bearings, but fewer than 3 within 10° | Within-10° windows fail track/clip confirmation |
|---|---:|---:|---:|---:|
| off | 319 | 12.2% | 85.3% | 2.5% |
| on | 320 | 21.6% | 76.9% | 1.6% |
| surveyed | 317 | 13.2% | 83.3% | 3.5% |

## Node-stage decomposition (three-source node-events)

| Profile | Node-events | Candidate bearing in clip | Kept bearing window in clip | Track window in clip | Window within 10° in clip | Source-aligned track within 10° in clip (original) | Within 10° at any track time | No accepted candidate before first kept window | Kept window absent from retained track |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| off | 1545 | 100.0% | 83.1% | 74.0% | 24.9% | 21.7% | 21.9% | 16.9% | 9.1% |
| on | 1545 | 99.0% | 74.8% | 64.7% | 21.0% | 17.9% | 18.4% | 24.3% | 10.1% |
| surveyed | 1545 | 100.0% | 84.7% | 74.6% | 25.7% | 21.7% | 22.4% | 15.3% | 10.1% |

The archived inference does not retain pre-filter rejection reasons. Candidate loss cannot be separated into level, overlap, coherence or window-overlap causes. These are observable pipeline stages, not causal attributions. The source-aligned label is a post-hoc scoring result, not an engine association output.

## Decision for C1 focus

The original label is not shown to be stricter than physics allows. Any-window availability is much higher (78.5–87.9%), but only 1.6–4.7% of source events have three pre-track bearing windows within 10° under exact clip bounds. That establishes poor bearing quality/alignment in this mixture population, not a physical upper bound or proof another estimator cannot do better. Keep the original label unchanged; report the new availability label beside it, never as equivalent detectability. C1 should prioritize multi-source bearing quality before assignment/fusion refinement.
