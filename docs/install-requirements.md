# Installation requirements (mission 4 working draft)

This document records what the current simulator-based evidence supports for install profiles. It is not field validation.

## Profile definitions in current matrix studies

- **raw (`on`)**: nominal install with default realism errors (heading, mic position, gain, correlated noise).
- **surveyed**: nominal geometry with surveyed-node assumptions used by existing matrix profiles.
- **self-calibrated**: **not established yet** in Mission 4. This profile remains pending C2 heading self-calibration evidence.

## Current minimum install requirements (simulation-only)

- Node positions must be known in a consistent local coordinate frame.
- Node clocks must be stable enough for current bearing-window tracking assumptions.
- Array orientation metadata must be present; unmeasured heading error remains a dominant risk.
- Building footprints are optional for the retained pipeline, but required for blocked-path experiments (C4/E2+).

## Open requirements to be set by mission work

- Quantified heading-offset observability threshold for self-calibration (C2).
- Uncertainty scaling per install profile with validation coverage checks (C3).
- Twin profile requirements (exact/coarse/poor) after E1-E3 evaluation.

## Limits

- No requirement here is a real-world deployment guarantee.
- Hardware tier or array winner claims require sealed and real-recording evidence.
