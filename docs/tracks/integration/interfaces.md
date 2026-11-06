# Integration boundaries and missing prerequisites

This is an inventory of delivered interfaces, not an assertion that the
requested positioning connections have been completed.

| Connection | Delivered state | Remaining gate |
|---|---|---|
| Multisource extraction and association | Mixture-derived candidates and association diagnostics under `extensions.multisource`; retained alongside fusion diagnostics | No association-to-track adapter or acceptance-scale three-source evidence. Single candidate windows cannot be treated as independent complete tracks. |
| Likelihood and joint alternatives | Selectable by `measured_fusion_mode`; legacy default preserved | Likelihood failed the T4 smoke endpoint; joint remains subject to calibrated-covariance prerequisite. |
| Heading calibration | Optional second fusion pass, with observability diagnostics | No applied calibration in delivered smoke; train/validation calibration fitting and node-count frontier unfinished. |
| Notch height | Standalone estimator accepts already extracted notch spacing and horizontal range | No mixture-to-notch extractor or honest range observation delivered. Do not feed source truth or claim aerial runtime fixes. |
| Doppler | Standalone estimator accepts observed frequency history and known rest tone | No mixture-to-frequency/association stream or tracker measurement consumer delivered. No runtime motion improvement established. |
| Sound speed | Standalone estimator accepts sensor temperature or known-distance timing pairs | No delivered sensor-observation contract at the measured boundary. Source range/time truth must not be substituted. |
| Buildings and assumed copy | Not delivered | Branch absent on origin; no weighting/twin-profile conclusions. |
| Causal front end | Not delivered | Branch absent on origin; no causal latency/rolling-buffer claims. |
| Dashboard | T1 registry and KPI schema differ from T7's initial adapter | Integration must normalize actual KPI objects and serve registered JSON in dev and production, without averaging quantiles or inventing paired intervals. |

Unavailable measurements and unimplemented connections remain unavailable.
Default-off component demonstrations are not acceptance evidence for a complete
engine, and enabling a no-op option does not create a distinct algorithm for a
sealed comparison.
