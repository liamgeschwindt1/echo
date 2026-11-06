# SIM.md fragment (T4)

## Measured fusion options (opt-in)

- `measured_fusion_mode` now accepts:
  - `legacy` (default pairwise)
  - `joint` (existing joint fit path)
  - `likelihood` (new grid likelihood-product fusion)

- `measured_heading_self_calibration`:
  - `0`: off (default)
  - `1`: event-derived heading self-calibration pass
  - `2`: reserved calibration-walk mode (interface only in this track)

## Notes

- New fusion fields are in `extensions.fusion.*`.
- Legacy default path stays unchanged when new options are OFF.
- All constants are placeholders, simulator-only, not field-calibrated.
