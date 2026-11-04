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

In measured-only mode, `runner.js` constructs a restricted sensor scenario and
sensor data object. Only nominal node geometry, settings, buildings, microphone
mixtures and sample rate cross that boundary. Ground truth stays in the scorer.
Scoring association is explicitly greedy, one-to-one and ungated. Missing
elevation, 3D error and labelling are null, not successful zero-error results.

`node.js` adapts file assets, source/audio hashes, disk cache and `worker_threads`;
`scripts/benchmark.mjs` is CLI orchestration. Browser `benchmarkWorker.js` coordinates
two nested `benchmarkJobWorker.js` workers using the same `runExperiment` and
`runJob`. The UI never duplicates the experiment expansion, solver or statistics.
Worker messages carry progress/errors; IndexedDB checkpoints completed jobs.
Pause stops dispatch, cancellation finishes active jobs, and reopening resumes
only matching code/audio/runtime and exact job/custom-scene settings and scoring
target. Changed source code cannot silently reuse whole results.

`testing.js` builds forms with existing app design classes and renders shared
report components. `testing-view.js` is a display adapter for saved inference,
not another solver. Horizontal fixes have explicitly assumed display height and
unavailable 3D error. Drill-down never reconstructs a new inference result.

## Important limitations

- The renderer is not validated against real recordings; no housing scattering,
  inter-node clocks, rain, wind or source directivity realism was added.
- Default legacy consensus can choose different tied pair hypotheses on different
  JS runtimes. A weight-aware repair improved errors but regressed suspect flags
  and was removed. It is not available as a hidden experimental option.
- Measured-only PHAT quality now uses coherence normalised by the fully coherent
  in-band peak. The previous raw-peak unit mismatch rejected every coherent
  default-band window. The unchanged 0.25 gate is still not empirically calibrated.
- Existing measured heuristics and all new benchmark targets are placeholders.
  Bootstrap run units still share site geometry. A conditional error winner with
  poor coverage is not a hardware recommendation.
- The standalone app editor remains truth-assisted after pressing Create, even
  when opened from a measured benchmark snapshot. The snapshot notice says so.
