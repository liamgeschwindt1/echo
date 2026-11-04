# Simulator architecture and trust boundaries

## Acoustic path

`scenario.js` validates nominal node geometry, source trajectories, buildings and
settings. `render.js` finds propagation paths through `geometry.js`/`diffraction.js`,
renders microphone mixtures, and separately retains simulator-only activity and
path audits. Rendered microphone positions include both nominal and true geometry;
inference must use nominal geometry, not `mic_positions_true`.

The existing editor calls `analyseScenario`: source-specific activity windows,
truth-assisted SNR/overlap, bearing estimation, robust fix, common-emission-time
alpha-beta tracking, backtrace and post-hoc scoring. This is intentionally labelled
**truth-assisted**. Optional labelling runs separately; enabled does not mean
completed. `buildExport` includes a labelling block only when actual results exist.

`measured.js` is the alternative pipeline: mixture windows, PHAT quality checks,
neighbour agreement, per-node tracks, cross-node pair association, static fit /
bearing-only EKF. Its input has no sources, true positions, start times, per-source
power or paths. It currently estimates horizontal position only and fuses two-node
track pairs; it does not implement full multi-node association.

## Benchmark path

```
JSON experiment / Testing form
  -> experiment.js: validation, exact count, cap, deterministic jobs
  -> variables.js + scenes.js: immutable transforms and fixed train/hold-out split
  -> runner.js: cache keys, render, isolated inference, post-inference scoring
  -> score.js: source/node errors and unmatched fixes (truth allowed ONLY here)
  -> metrics.js: run-level bootstrap, paired deltas, rankings, failure atlas
  -> report.js: shared tables, SVG plots, CSV, standalone HTML
```

Cap reduction preserves both seed partitions and their requested held-out minimum
before thinning variable alternatives. Explicit IDs are retained, not replaced;
an impossible split/cap combination errors. This helper is shared by CLI callers
and the Testing form.

In measured-only mode, `runner.js` constructs a restricted sensor scenario and
sensor data object. Only nominal node geometry, settings, buildings, microphone
mixtures and sample rate cross that boundary. Ground truth stays in the scorer.
Scoring association is greedy, ungated and one-to-one among overlapping
emission-time intervals; disjoint episodes may share a source. Every assigned
episode enters error, track and calibration metrics, while detection/source
coverage uses unique truth sources. Explicit re-scoring preserves inference and
records separate scoring provenance; comparisons reject unlike conventions.
Clip-active intervals are not checked. Missing
elevation, 3D error and labelling are null, not successful zero-error results.

`node.js` adapts file assets, source/audio hashes, disk cache and `worker_threads`;
`scripts/benchmark.mjs` is CLI orchestration. Browser `benchmarkWorker.js` coordinates
two nested `benchmarkJobWorker.js` workers using the same `runExperiment` and
`runJob`. The UI never duplicates the experiment expansion, solver or statistics.
Worker messages carry progress/errors; IndexedDB checkpoints completed jobs.
Pause stops dispatch, cancellation finishes active jobs, and reopening resumes
only matching code/audio/runtime and exact job/custom-scene settings and scoring
target. Changed source code cannot silently reuse whole results.
The renderer's parsed dependency graph has its own fingerprint: analysis-only
source revisions reuse audio without reusing inference. A provenance sidecar
preserves the actual producer across revisions. Legacy migration is explicit,
with graph/input/runtime/PCM checks and a cold control; dirty historical source
remains an acknowledged audit assumption.
Optional CLI discard mode uses the shared scheduler's last-consumer callback;
only completed render groups lose raw audio/provenance, never whole results.
Interrupted groups remain resumable. There are no cross-process leases, so
concurrent discard-mode experiments must not share a cache. Report manifests
snapshot the display targets and cache policy independently of inference data.
Seeded random sites use a frozen list of original array IDs/order, not the
current library length. Library additions therefore cannot alter held-out
geometry. The opt-in maximum-volume four-mic layout is an exact geometry-only
choice; its independent golden does not replace legacy signal fixtures.

`testing.js` builds forms with existing app design classes and renders shared
report components. `testing-view.js` is a display adapter for saved inference,
not another solver. Horizontal fixes have explicitly assumed display height and
unavailable 3D error. Drill-down never reconstructs a new inference result.

## Round-two evaluation and external recordings

Explicit scene splits add train/validation/test without reclassifying the old
held-out data as unseen. Node-only `benchmark/sealed.js` hashes the physical
population and atomically claims a persistent attempt before dispatch. It never
runs in the browser or nightly CI. Overrides require a manifest-recorded reason.
The producer is deep-snapshotted before attaching the seal to its caller, so
metadata cannot form a reference cycle; CLI lifecycle failure recording covers
exports as well as inference. Round two required an explicitly audited recovery
of exports from complete immutable caches after discovering that bug. This
does not rerun inference or rewrite its original producer.
Rule-four acceptance uses paired whole-run resampling in every declared
train/validation and realism partition. Risk curves keep confidence ties intact;
their area penalises the unanswered tail. Default rankings use useful scene rate
and refuse unequal/partial scene-seed populations.

Rejected logistic confidence and exact global-assignment solvers live in
`scripts/lib/`, with exported train-only coefficients and full trial evidence.
They are not settings in `analyseMeasured`. Default pair association remains
unchanged; extracting pair proposals enables offline research without enabling
a hidden failed solver. Nonparametric trial intervals are explicitly different
from Gaussian sigma/twice-sigma intervals.

`recording.js` decodes channel-preserving RIFF PCM/float WAV, validates nominal
geometry and invokes the same restricted measured pipeline. Independent
timestamped truth is converted to local ENU only for post-inference scoring;
missing/out-of-gap truth stays null. Calibration requires declared disjoint
quiet/signal intervals and a surveyed source. CLI and `recordingWorker.js` share
these APIs. WAV truth is never used to pick bearings or fixes. No real recording
has been evaluated; synthetic round-trip tests are a software integration check.

Testing's history/labelling views load stored reports rather than rerunning or
refitting them. Historical timing strata come from complete recorded runs.
Nightly Actions is configured but only becomes scheduled after the workflow is
present on the default branch.

`ui/placement.js` is independent of inference. It uses nominal nodes, known
footprints and explicit sigma/range assumptions to show a21x21 linearised
geometry map and deterministic N2..6 suggestions. It neither reads source truth
nor changes the editor. Its predictions must not be confused with the retained
pair-only solver, obstruction-aware acoustic propagation or calibrated coverage.
Uploaded schema2 history preserves the prior display on validation errors and
does not authenticate externally supplied reports.

The variance and noise-attribution research scripts are separate from runtime
localisation. The former compares a frozen rejected diagnostic solver without
refitting; the latter estimates three declared POI powers from nominal geometry
and node levels. Actual localiser fixes are association diagnostics, not hidden
source truth or position priors inferred by an oracle. Underdetermined shares
are explicitly unavailable. Neither is a validated hardware/product model.

## Important limitations

- The renderer is not validated against real recordings. Opt-in clock offset/drift
  uses common per-node linear resampling; default is OFF. Wind/urban/rain and slow
  ambient variation are seeded placeholder spectra, not fitted measurements.
  Clock audit is simulator-only; activity times remain global and noise powers
  are record averages. No sync-gated TDOA, housing scattering, microphone
  frequency/phase response or source directivity is implemented.
- Microphone gain is one positive scalar applied after signal, ambient and self-noise
  are summed (`render.js`). It ideally cancels in PHAT. Gain-sweep insensitivity
  does not establish robustness to frequency/phase mismatch or preamplifier noise.
- Legacy consensus now resolves count/cost ties by quantised cost and canonical
  pair IDs, with a real Chromium/Node parity regression. This fixes reproducibility,
  not the high-weight-node leave-one-out root cause. Round-one weight-aware
  repairs remain rejected; no measured-only improvement follows from that path.
- Measured-only PHAT quality now uses coherence normalised by the fully coherent
  in-band peak. The previous raw-peak unit mismatch rejected every coherent
  default-band window. The unchanged 0.25 gate is still not empirically calibrated.
- Existing measured heuristics and all new benchmark targets are placeholders.
  Bootstrap run units still share site geometry. A conditional error winner with
  poor coverage is not a hardware recommendation.
- The standalone app editor remains truth-assisted after pressing Create, even
  when opened from a measured benchmark snapshot. The snapshot notice says so.
