# T2 measured-pipeline interface

T2 adds one opt-in extension output from `analyseMeasured`:

- `results.extensions.multisource` (present only when any `ms_*` mode is enabled in `scenario.settings`)

Fields:

- `config`: resolved multisource options from `ms_*` settings.
- `node_summaries[]`: per-node candidate count and methods used.
- `candidates.<node_id>[]`: bearing candidates (method, time, azimuth, confidence; plus harmonic metadata when present).
- `associations[]`: cross-node groups from spectral/temporal similarity with 3+ node ghost-consistency gate.
- `notes[]`: runtime caveats.

No fusion-core edits were made. Legacy `nodes` and `fixes` remain unchanged when `ms_*` modes are off.
