# Schema proposal (T4)

No schema bump was made in this track.

New fusion diagnostics are exported under existing extension space:

- `results.extensions.fusion.install_profile`
- `results.extensions.fusion.heading_calibration`
- `results.nodes[].extensions.fusion.heading_offset_deg`
- `results.nodes[].extensions.fusion.heading_offset_sigma_deg`
- `results.fixes[].extensions.fusion.*`

Proposed future schema bump note for integration track:

- Document `measured_fusion_mode=likelihood` output fields and heading self-calibration diagnostics as stable extension fields.
- Keep backward compatibility by preserving legacy result shape when fusion extensions are not enabled.
