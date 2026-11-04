# Claims ledger

**No real-world accuracy claim is validated.** “Simulated” means software/model
evidence, not a deployed-device result. Anything outside this ledger is unproven.
The final round-two report links the frozen sealed-test figures.

| Potential claim | Status | Evidence / conditions | Caveat |
|---|---|---|---|
| The measured pipeline runs without source truth | Simulated | Restricted runner input; measured-pipeline and recording tests | It still assumes nominal surveyed geometry and declared settings |
| Fixes are within 10 m at the target range | Not validated | Round-one/final round-two measured reports | Misses and wrong fixes prevent a general accuracy claim |
| Uncertainty has nominal 68%/95% coverage | Not validated | Per-condition calibration in stored reports | Existing intervals are weak; rejected recalibration is not deployed |
| A per-fix wrong probability is calibrated | Simulated, rejected | `baselines/round2-confidence-*`, train coefficients and validation bins | Failed rule four; offline only; simulator-to-real shift unmeasured |
| A 90% radius guarantees field coverage | Not validated | Train-quantile trial and empirical validation coverage | Correlated simulated episodes are not an independent conformal guarantee |
| Multi-node global assignment improves the product | Simulated, rejected | Complete global/global-uncertainty trial reports | Calibration and/or paired improvement guards failed |
| Two nodes have discriminative deployed confidence | Not validated | B1 trial can discriminate; retained legacy flags cannot | Useful-rate zero can coexist with zero silent-wrong rate |
| The measured localiser estimates elevation/3D | Not validated | No retained measured elevation implementation | Editor truth-assisted 3D must not be presented as measured-only |
| A particular array is the best hardware | Not validated | Round-one complete array/sensitivity evidence | Endpoint flips, algorithm failures and no real measurements; no robust winner |
| Realism settings represent measured hardware | Not validated | Placeholder ledger and `prototype-plan.md` | Heading, position, noise, reflection and correlation need recording calibration |
| Scalar gain robustness proves phase robustness | Not validated | Scalar gain cancels ideal PHAT | Frequency/phase mismatch is a different, unbuilt model |
| Identical render optimisations preserve audio | Simulated | Preregistered full-render/audio/inference hash comparison | Only the exact profiled populations and unchanged goldens support this |
| Renderer performance is substantially improved | Simulated, inconclusive | Complete two-repetition seven-source/12-mic timing study | Seven-source render1.006x; static12-mic render0.860x; no robust renderer speedup |
| Clock offset/drift model follows its declared mapping | Simulated | Ramp/impulse checks and separate clock golden | Linear resampling approximation, not synchronisation validation or an inter-node TDOA constraint |
| Wind/urban/rain noise represents a real site | Not validated | Seeded placeholder spectra and56-run synthetic smoke | No fitted weather/site measurements or propagation-gradient model |
| Browser and Node resolve consensus ties alike | Simulated | Actual Chromium/Node pair/fix parity regression | Numerical determinism is not field localisation accuracy |
| ESC-50 labelling accuracy generalises to a site | Not validated | Separate real-model range/noise/normalisation study | One clip per class; propagation/noise remain synthetic |
| Real WAV/CSV ingestion works | Simulated | Synthetic multichannel round-trip and CLI tests | No real recording evaluated; recording constraints documented |
| Per-zone noise shares are accurate | Not validated | No attribution experiment completed | A phone level recording is not contribution ground truth |
| Prototype hardware tolerances meet targets | Not validated | Proposed rigs/sample sizes/imports in `prototype-plan.md` | No derived hardware requirement or measured tolerance claim |

Only independently acquired, sealed real recordings may move an accuracy claim
to **validated**, with exact conditions and uncertainty attached. Passing CI,
simulation goldens, good conditional medians or an oracle label is insufficient.
