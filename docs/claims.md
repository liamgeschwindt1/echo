# Claims ledger

**No real-world accuracy claim is validated.** “Simulated” means software/model
evidence, not a deployed-device result. Anything outside this ledger is unproven.
The final round-two report links the frozen sealed-test figures.

## T8 integration additions

No new localisation or tracking performance claim is accepted. Infrastructure,
cues, multisource, fusion and dashboards were merged; causal and buildings were
not delivered. LE-0 stays default. LE-1 is a diagnostic self-calibration
configuration, rejected for promotion, with no applied calibrations in eight
runs. Official matrix selection, the matrix sealed run and the final stress
suite remain blocked, not successful.

| Potential claim | Status | Evidence / conditions | Caveat |
|---|---|---|---|
| Default inference survived integration unchanged | Simulated regression evidence | `baselines/integration-gate-final.json`, fresh base 16-run reference and unchanged signal goldens | Export metadata advances to schema 0.19; not field validation |
| Multisource candidates improve source localisation | Not established | T2 mixture-derived candidate/association diagnostics retained under `extensions.multisource` | No accepted association-to-fusion adapter or full multisource acceptance population |
| Likelihood fusion is an accepted improvement | Simulated, rejected for promotion | T4 smoke evidence and `docs/tracks/fusion/report.md` | Legacy remains default |
| Heading self-calibration improves the retained engine | Not established | `baselines/integration-round1-diagnostics.json`: 0/8 runs applied calibration | Two sites only; no official matrix validation, no universal ineffectiveness claim |
| Notch/Doppler/sound-speed cues improve the runtime engine | Component demonstrations only | T5 preregistrations, tests and standalone synthetic evaluation | No delivered measured-observation stream into fusion/tracking; no new runtime aerial accuracy claim |
| Weather mismatch is a calibrated environmental model | Not validated | Default-off renderer temperature/wind placeholders and T5 tests | Direct-path approximation, not measured propagation |
| Engine-history dashboard reports published KPIs | Simulated reporting checks | Actual registry/KPI adapter, dev/production JSON assets, live and offline browser checks | Unlike populations are not ranked; unavailable intervals remain unavailable |
| Dense buildings causally improve or halve coverage | Not established | `baselines/integration-building-audit.json` and historical round-two descriptive subgroups | Different geometry/range/node populations; matrix one-source scenes are mostly line-of-sight |

These additions consolidate the delivered tracks' claims fragments with their
limits. Standalone cue error reductions are not a complete-engine KPI. No
building-aware or causal-runtime claim is made for undelivered tracks.

## Historical claims and limits

| Potential claim | Status | Evidence / conditions | Caveat |
|---|---|---|---|
| The measured pipeline runs without source truth | Simulated | Restricted runner input; measured-pipeline and recording tests | It still assumes nominal surveyed geometry and declared settings |
| Fixes are within 10 m at the target range | Not validated | Sealed errors-on:8/40 sites answered; matched median14.97m, p90100.83m; mixed-range sites | Not a dedicated50m test; misses and wrong fixes prevent a general accuracy claim |
| Uncertainty has nominal 68%/95% coverage | Not validated | Sealed errors-on bearing coverage44.4%/72.2%; per-condition/category reports | Not calibrated positional ellipses; rejected recalibration is not deployed |
| A per-fix wrong probability is calibrated | Simulated, rejected | `baselines/round2-confidence-*`, train coefficients and validation bins | Failed rule four; offline only; simulator-to-real shift unmeasured |
| A 90% radius guarantees field coverage | Not validated | Train-quantile trial and empirical validation coverage | Correlated simulated episodes are not an independent conformal guarantee |
| Multi-node global assignment improves the product | Simulated, rejected | Complete global/global-uncertainty trial reports | Calibration and/or paired improvement guards failed |
| Two nodes have discriminative deployed confidence | Not validated | B1 trial can discriminate; retained legacy flags cannot | Useful-rate zero can coexist with zero silent-wrong rate |
| The measured localiser estimates elevation/3D | Simulated, rejected trial only | Complete150-case spatial trial produced42 staticXYZ hypotheses but failed calibration/improvement guards | No retained measured3D; hypotheses include unmatched fixes; editor truth-assisted3D is not measured-only |
| A particular array is the best hardware | Not validated | Complete2052-case archived regrading and fresh150-case retained-solver check | Old inference, not a new improved-engine rerender; useful-rate ties, endpoint flips and no real measurements |
| Realism settings represent measured hardware | Not validated | Placeholder ledger and `prototype-plan.md` | Heading, position, noise, reflection and correlation need recording calibration |
| Scalar gain robustness proves phase robustness | Not validated | Scalar gain cancels ideal PHAT | Frequency/phase mismatch is a different, unbuilt model |
| Identical render optimisations preserve audio | Simulated | Preregistered full-render/audio/inference hash comparison | Only the exact profiled populations and unchanged goldens support this |
| Renderer performance is substantially improved | Simulated, inconclusive | Complete two-repetition seven-source/12-mic timing study | Seven-source render1.006x; static12-mic render0.860x; no robust renderer speedup |
| Clock offset/drift model follows its declared mapping | Simulated | Ramp/impulse checks and separate clock golden | Linear resampling approximation, not synchronisation validation or an inter-node TDOA constraint |
| Wind/urban/rain noise represents a real site | Not validated | Seeded placeholder spectra and56-run synthetic smoke | No fitted weather/site measurements or propagation-gradient model |
| Browser and Node resolve consensus ties alike | Simulated | Actual Chromium/Node pair/fix parity regression | Numerical determinism is not field localisation accuracy |
| ESC-50 labelling accuracy generalises to a site | Not validated | Separate real-model range/noise/normalisation study | One clip per class; propagation/noise remain synthetic |
| Real WAV/CSV ingestion works | Simulated | Synthetic multichannel round-trip and CLI tests | No real recording evaluated; recording constraints documented |
| Per-zone noise shares are accurate | Simulated prototype only | Complete36-render known-POI study;3-node mean share error3.00pp off/9.24pp on | Synthetic independent noise sources, known points and level assumptions; two-node shares unavailable; no field accuracy claim |
| More available nodes ensure more accurate fixes | Not validated | Complete60-case count/spacing study | Third-node availability improves coverage in this site, but actual fusion remains two-node and higher counts produce duplicates |
| The placement map predicts calibrated accuracy | Not validated | Geometry-only view and20 preregistered checks | Missed fixes and biased observed errors disagree with the ideal scale; no mounting safety/detection claim |
| Prototype hardware tolerances meet targets | Not validated | Ideal9x360-direction component budgets and `prototype-plan.md` | Separate full-budget ceilings are not sufficient specifications; self-noise/sync requirements remain null |

Only independently acquired, sealed real recordings may move an accuracy claim
to **validated**, with exact conditions and uncertainty attached. Passing CI,
simulation goldens, good conditional medians or an oracle label is insufficient.
