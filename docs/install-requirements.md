# Installation requirements (mission 4 working draft)

This document records what the current simulator-based evidence supports for install profiles. It is not field validation.

## T8 status

No new minimum node count, mounting tolerance or installation tier was
established. LE-0 remains default. The opt-in event-derived heading calibration
requires observable fixes across nodes; neither the delivered T4 smoke nor the
T8 eight-run diagnostic applied a calibration. It therefore does not establish
a usable self-calibrated installation profile.

Notch height, Doppler and sound-speed estimators require observations not yet
delivered to the measured runtime interface. Do not supply simulator truth to
fulfil installation inputs. Assumed-building-copy requirements remain
unmeasured because that track was not delivered.

Node-count/install frontiers, heading and position tolerances, aerial 3D
requirements and sealed install-profile comparisons remain unavailable.
The missing observations and acceptance gates are documented in
`docs/tracks/integration/interfaces.md` and `docs/localisation-conclusion.md`.

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
