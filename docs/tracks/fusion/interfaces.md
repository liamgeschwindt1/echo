# Fusion extension interfaces (T4)

This track keeps fusion-only extension points opt-in and default OFF.

## 1) Likelihood grid layer (`measured_fusion_mode=likelihood`)

Runtime entry:

- `analyseMeasured(..., { options })` in `packages/sim-core/src/measured.js`
- delegates to `fuseLikelihoodTracks(...)` in `packages/sim-core/src/ext/fusion/likelihood-fusion.js`

Interface contract:

- **Inputs**: per-node measured tracks (`nodeResults`), speed of sound, and measured options.
- **Outputs**: one fix per cluster with:
  - `final_position`
  - `confidence.radius_90_m`
  - `extensions.fusion.mode = "likelihood_product"`
  - `extensions.fusion.grid_step_m`
- **No pair-fix duplicates**: cluster-level solve emits one fix for one cross-node time cluster.

Current weighting hooks:

- Bearing sigma term (existing measured sigma + spread + optional calibration sigma)
- Outlier floor (`measured_likelihood_outlier_floor`)
- Per-node reliability from track residual and coherence peak

Planned T3/T8 hook:

- Add optional external visibility weight:
  - `context.visibilityWeight(nodeId, gridPoint) -> [0..1]`
  - default 1.0 when not provided.

## 2) Heading self-calibration layer (`measured_heading_self_calibration`)

Runtime entry:

- `headingCalibration(...)` in `packages/sim-core/src/ext/fusion/heading-calibration.js`

Interface contract:

- **Inputs**: node tracks + provisional fixes
- **Outputs**:
  - per-node heading offset estimate
  - per-node heading offset sigma
  - observability diagnostics
  - install profile tag (`surveyed` or `self_calibrated`)

Consumption:

- calibration offsets/sigmas are fed back into the second fusion pass
- node-level outputs exported at `nodes[].extensions.fusion.*`
- run-level diagnostics exported at `extensions.fusion.heading_calibration`

## 3) Extra observation / association plug points

T4 keeps these explicit in measured fusion context:

- `context.calibration[nodeIndex] = { offset_deg, sigma_deg }` (implemented)
- `context.visibilityWeight(...)` (planned, default identity)
- `context.rangeMeasurements` (reserved for T5 Doppler/range cue integration; default absent)
- `context.associationHints` (reserved for T6 causal/birth-death gating; default absent)

The runtime must remain valid when each optional input is missing.
