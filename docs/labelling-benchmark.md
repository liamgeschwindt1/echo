# Round-two labelling benchmark

The actual YAMNet MediaPipe/WASM and quantised CLAP ONNX models ran on the
preregistered complete population in `round2-labelling.json`: 36 rendered scenes,
144 model predictions, 72 known-label oracles. Model/audio/config hashes and
per-prediction outcomes are in `baselines/round2-labelling.json`.

These are real ESC-50 clips through **synthetic propagation and noise**, not field
recordings. One glass, horn and dog clip each is a smoke population, not a
class-balanced generalisation dataset. Both microphones/nodes share a rendered
source; the 144 predictions are not 144 independent source examples.

| Input | Glass correct | Horn correct | Dog correct | Overall | Correct and associated with a measured fix |
|---|---:|---:|---:|---:|---:|
| Raw | 11/24 | 0/24 | 16/24 | 27/72 (37.5%) | 25/72 |
| Whole-record RMS normalised to -20 dBFS | 12/24 | 0/24 | 16/24 | 28/72 (38.9%) | 26/72 |

| Actual node-source distance | Raw correct | Normalised correct |
|---|---:|---:|
| 15.81 m | 16/24 | 16/24 |
| 52.20 m | 7/24 | 8/24 |
| 150.75 m | 4/24 | 4/24 |

The registered source offsets from the node-pair centroid are 5/50/150 m; nodes
are at x = -15/+15 m, so these are **not** the microphone ranges. Noise floors
30/60 dB SPL, seeds 1/101 and both nodes are equally represented in every range
and normalisation row. Empty SNR bins stay null. Detection-band peak SNR is
simulator scoring information, never a model input or an event-window oracle.

The label oracle knows source presence and label: 72/72 by construction. It is
not measured detection performance. Model scoring uses the highest-confidence
labelled period from the complete mixture record, without truth-derived crops;
extra periods and frame-level false-positive rates are not comprehensively
scored by this small benchmark. A label/fix association means temporal overlap
with the relevant measured node track, not a correct, unflagged spatial fix.

**Normalisation did not rescue range collapse here**: only one prediction
changed from wrong to correct. The horn remains unlabelled even at high
scoring-only SNR; this study cannot assign that failure to a particular model
gate because complete intermediate model diagnostics were not retained.
Do not infer a production normalisation fix or a real-world label accuracy.
The next independent study needs multiple held-out clips per class and
stage-level rejection traces; its population must be registered before running.

The Testing tab's Labelling section loads this complete report and refuses a
partial population. `node scripts/benchmark-labelling.mjs --discard-renders`
runs the registered model population; do not overwrite the retained evidence
for an exploratory rerun.
