# Proposed install requirements fragment (T4)

## New install profile: `self-calibrated` (fusion track fragment)

Definition for this profile:

- Start from surveyed node coordinates.
- Allow unknown per-node heading offsets as nuisance parameters.
- Fit offsets from accumulated multi-node events (or calibration-walk events), with observability checks.
- Feed offset uncertainty into bearing sigma before fusion.

Minimum evidence to mark a run `self-calibrated`:

- At least `measured_heading_self_calibration_min_nodes` observable nodes.
- At least `measured_heading_self_calibration_min_fixes` usable fixes per observable node.
- Non-singular calibration normal equations.

If any requirement fails, profile falls back to `surveyed` and reports:

- `extensions.fusion.heading_calibration.reason`
- `extensions.fusion.heading_calibration.nodes_observable`
- `extensions.fusion.heading_calibration.events_used`

This fragment only proposes wording for `docs/install-requirements.md`. No shared doc edited in this track.
