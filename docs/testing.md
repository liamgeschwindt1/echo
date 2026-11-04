# Testing the simulator

All numbers are simulated. No array choice or hardware requirement is validated by these reports alone.

## Shared experiments and CLI

Run `npm run benchmark -- --experiment smoke --out baselines/smoke.json`.
`--experiment baseline` selects the full fixed scene library and three seeds.
An experiment JSON contains `name`, `scenes` (IDs), `seeds` (integer count or
explicit integers), `base_settings`, `base_values`, `sweeps`, `mode`, and optional
`metrics`. Each sweep uses `{variable, values, group}` or
`{variable, range: {min, max, steps}, group}`.

Modes are `one-at-a-time` (base plus individual changes), `grid` (full cross),
`random`, `latin-hypercube` (stratified samples of discrete listed values), and
`paired` (two `configs` with settings and/or variable values). Random sampling
uses `sample_seed`, default 20261104. `samples` defaults to 20; `max_runs` to 2000.
Above-cap experiments are rejected before rendering. Reduction removes random/LHS
samples, then seed repetitions, then variable values; it never silently truncates
a result. Both seed partitions and the requested held-out fraction are preserved
when both exist, including custom explicit IDs. An impossible cap asks for fewer
scenes/modes or a larger cap rather than silently making a one-seed pilot.
The default all-library preset reduces to 1800 runs with all nine arrays and seeds
1/101, instead of dropping four array alternatives.

Defaults include both realism off and on, measured-only inference. Add
`analysis_modes: ["measured_only", "truth_assisted"]` to quantify the optimistic
source-window upper bound. Realism on uses heading 2.5 deg, gain 1 dB, mic position
5 mm, noise correlation 0.3; explicit swept variables override those values.
The effective settings, not the realism label, are authoritative.

Use `--compare baselines/baseline-0-v2.json --fail-on-regress` to gate tracked metrics
with explicit `tolerances` (metric to absolute tolerance, default zero). A metric
becoming unavailable is a regression. Missing configs fail. Runtime is not gated.
Calibration compares distance from 68.27%/95.45%, not simply bigger-is-better.
Comparisons match variable values rather than configuration list order, and reject
different scene/seed populations or wrong-fix targets. A delta on different grading
data is not a regression result.
Scoring conventions must also match. Schema 0.10 fixes false unmatched counts
for separate sound bursts: one-to-one assignment applies to overlapping
emission-time intervals, while disjoint episodes may share a source. Every
assigned episode enters error/track/calibration metrics; source coverage cannot
exceed 100%. Simultaneous unmatched hypotheses still count wrong. Clip-active
intervals are not checked by this scorer.

Use `node scripts/benchmark-rescore.mjs --from old.json --out rescored.json`
to re-score stored inference explicitly. It writes JSON/CSV/HTML, preserves the
original and records scoring provenance. Re-score both reports under the same
convention before comparing; the command also supports `--compare` and
`--fail-on-regress`. No audio or inference is recomputed.
Manifests snapshot display targets, including `placeholder: true`; later edits
to `docs/targets.json` cannot silently change what an archived report used.

Large sequential CLI sweeps may use `--discard-renders`. Default caching is
unchanged. This opt-in removes raw audio/provenance only after all jobs sharing
the exact key complete, and retains whole results for resume/replay. Interrupted
groups retain their audio. Use a separate `--cache` directory for any concurrent
discard-mode experiment; cross-process cleanup is not protected. Browser
IndexedDB retention remains unchanged.

## Variable groups

Hardware errors vary unmeasured orientation, microphone gain, geometry and noise
correlation. Environment varies ambient/self-noise, air and reflection/diffraction.
Sources vary recorded clip, level, centroid-relative range, count, level difference,
linear speed and height. Array/nodes selects library arrays, node count, spacing,
height and layout. Algorithm thresholds vary existing analysis gates and window
policies; these gates affect **truth-assisted only**, not the independent measured
pipeline. Site keeps a fraction of existing buildings; scene picker controls presets.
Clock, wind and coloured noise are not implemented and are not offered as fake knobs.

Measured-only quality uses PHAT coherence normalised by the fully coherent
in-band peak, not the much smaller inverse-FFT amplitude. The existing 0.25
threshold is uncalibrated. Legacy truth-assisted near-zero consensus cost ties
can diverge across JS runtimes even with identical audio and whole-event bearings.
A weight-aware repair was rejected after suspect metrics regressed. Browser
parity exercises the default measured-only pipeline, not that rejected solver.
The current microphone gain term scales signal, ambient and self-noise together.
Positive scalar gains ideally cancel in PHAT. A flat gain sensitivity curve is
therefore a model property, not evidence that real microphone phase/frequency
mismatch is harmless.

Each variable in `benchmark/variables.js` specifies group, unit, description,
default range and render/analysis classification. Add its transform in
`applyValues`; add tests proving it changes the intended quantity and does not
mutate the base scenario. A new scene goes in `benchmark/scenes.js`. Freeze the
split before evaluating it; do not move a poor scene into the training set.
Transforms have fixed order independent of JSON key order: node count/array/layout,
spacing, source count/levels/height/motion, then centroid-relative range. Combined
layout and spacing sweeps therefore preserve the requested spacing.

## Presets

Hardware error robustness and Noise and environment sensitivity change each error
alone. Array ranking compares every library array. Detection range vs noise and
Node count and spacing cross two variables. Threshold tuning varies legacy gates.
Overlapping sources varies count and level differences. Realism on vs off pairs
identical scenes/seeds. Full regression uses the whole library and no parameter
sweeps. Presets are editable experiments, not tuned accuracy claims.
The library includes opt-in `ball12_d180_sub4_maxvol` (A1/C1/C2/C3), a
maximum-volume noncoplanar four-mic alternative. Legacy `ball12_d180_sub4`
remains coplanar for compatibility and is marked accordingly. Select the new
model explicitly; no editor/benchmark default changes. Held-out random sites
pin their original array choices even when the library grows.

`npm run benchmark -- --experiment docs/experiments/array-pilot.json --out baselines/array-pilot.json`
runs a predeclared two-site pilot across every library array, both pipelines,
both realism profiles and seeds 1/101. Its limited scene coverage cannot
establish a hardware winner.

`docs/experiments/array-full.json` freezes the full 1350-run measured-only
study: all 25 sites, nine arrays, seeds 1/2/101, realism off/on. It contains
612 train and 738 held-out runs. The eight `array-heading`, `array-gain`,
`array-position`, `array-correlation`, `array-noise-floor`, `array-self-noise`,
`array-ground` and `array-source-level` experiments each contain 144 runs.
Those are limited two-site endpoint sensitivity studies, not full-scene
hardware acceptance tests. No clock sensitivity is claimed.
The original full study is preserved as an explicitly cancelled 167/1350
checkpoint, not a population-balanced ranking. The predeclared budget replacement
`array-full-budget.json` keeps every site/array and both realism profiles with
seeds 1/101: 900 runs, 306 train and 594 held-out.
That replacement completed all900 cases. Exact results are in
`baselines/array-full-budget.json.gz` and readable CSV/HTML companions. Report
coverage and tails alongside any conditional median leader; no hardware
acceptance limit follows from these simulated mixed-range comparisons.
All eight144-run endpoint grids also completed (1152 total); their lossless
JSON archives and CSV/HTML companions are in `baselines/`. See
`overnight-report.md` for the split/profile-specific ranking flips and limits.

Large study JSON files use lossless timestamp-free gzip; CSV and standalone HTML
remain directly readable. Run `gzip -dk baselines/array-pilot.json.gz` before
passing its JSON to CLI comparison tools. Archives retain full per-run inference,
settings and producer provenance; no fields were stripped to reduce file size.

## Regression CI

`.github/workflows/sim-regression.yml` runs core/app unit tests, the app build,
and `docs/experiments/ci-smoke.json` against `baselines/ci-smoke.json`.
The fixed Node 24.22.2 reference includes actual measured-only fixes, both realism
profiles and held-out site/seed cases; it cannot pass merely by reproducing the
old all-no-fix gate bug. ESC-50 audio is fetched at the manifest's pinned revision.
Model files are committed. JSON/CSV/HTML artifacts are retained even on regression.

To reproduce the benchmark locally, run:

```
npm run benchmark -- --experiment docs/experiments/ci-smoke.json --compare baselines/ci-smoke.json --fail-on-regress --discard-renders --out artifacts/ci-smoke.json
```

Default metric tolerances remain zero, with the shared numerical comparison
allowance. This is a small regression fixture, not a substitute for the full
grading and array studies. Runtime is recorded rather than performance-gated.

## Reading results

Open **Testing** in the simulator side menu. Select scenes (or snapshot the editor),
expand a variable group, tick variables and enter values/ranges, then click **Test**.
The default small experiment is one 20 m scene, five seeds, realism off/on and
measured-only. Presets populate the entire form and may need **Reduce samples /
values** before running. The app uses a coordinator worker and two compute workers;
rendering and aggregation never block the UI thread.
Workers sharing a cold audio key wait for one render, then analyse independently
as soon as the audio is persisted. This avoids duplicate expensive rendering
without serialising analysis-only sweeps. Separate concurrent experiments are
not protected by a cross-process render lock.

Pause stops dispatch after active work; Resume continues. Cancel saves completed
jobs and a partial report. Saved runs live in IndexedDB, with names and notes;
reopen an interrupted run and choose **Resume unfinished**. New code or changed
audio invalidates reusable jobs. Browser storage is not a permanent archive:
download JSON for reproducibility. Export CSV, standalone HTML or copy the summary.
Upload a baseline JSON or use **Compare** on another saved run for delta tables.
Only paired A/B mode provides a paired significance test.

Click any metric cell, then select an exact scene/seed to open its settings and
saved inference in the editor. Measured-only drill-down uses an explicitly assumed
display height and unavailable 3D error. Pressing the existing editor **Create**
still runs its legacy truth-assisted analysis; it does not replace the saved
benchmark inference.
Measured drill-down displays the best matched episode per source. All assigned
episodes remain in benchmark metrics and exported inference.

Summary cells show point estimates and bootstrap confidence intervals. No-fix
errors are null and excluded from error quantiles; coverage is reported separately.
Wrong fixes exceed `wrong_fix_m` (10 m default, placeholder target). Suspect recall
is the fraction of wrong fixes flagged; precision is the fraction of flags wrong.
No wrong fixes means recall is unavailable, not 100%. Unmatched measured fixes
count as wrong, so duplicate tracks cannot improve precision silently.

Line plots show a metric vs a numeric variable with bootstrap bands. Heatmaps
show two-variable cells in a single split/realism/mode context; extra dimensions
need filtering. Tornado ranks maximum absolute departure from the base. Array
ranking uses point estimates, reports ties, and only attributes a ranking flip
when exactly one context variable changes. CI overlap is not proof of a winner.
Paired A/B reports bootstrap mean paired deltas and sign-flip p-values for
complete identical scene/seed pairs. They are exploratory, without multiplicity
correction. Do not select thresholds on held-out results.

## Cache, speed and reproducibility

Integer seed counts with two or more seeds reserve at least 30% as held-out
(IDs starting at 101, skipped by training IDs). Five seeds are `[1, 2, 3, 101, 102]`.
One-seed pilots have no seed holdout; explicit lists use `held_out_seeds`, default
`[101]`. OAT includes the base plus every requested value, because nominal defaults
are not necessarily the actual base in every scene or realism state.

Node uses a bounded `worker_threads` pool (`--workers`, default at most 2), disk
cache `.benchmark-cache/`. Cache identity includes exact source content hash,
clip PCM SHA-256, runtime, geometry, effective settings and seed. Analysis-only changes
reuse rendered audio; complete-result keys additionally include analysis settings,
schema and scoring target. Moving-source diagnostics cannot mutate cached audio.
SIGINT stops dispatch, completes active work and writes an incomplete report;
rerunning uses cached complete jobs. No result from changed code is resumed.

Resume validates completed-job identity, custom scene, error target and matching
audio/code/runtime before reuse. Every result records git revision (and dirty flag), source content hash, schema,
all settings, seeds, variable values and audio checksums. Schema version alone
cannot reproduce bearings. Schema 0.6 added audit only; source windows, settings
and clip content are needed to explain historical bearing differences. This
checkout has no pre-0.6 history, so exact old differences remain unproven.

Since schema 0.9, audio uses the complete parsed renderer dependency fingerprint,
not the unrelated analysis source hash. Full results still use the full code hash.
Actual audio producer provenance is retained across analysis revisions. Node cache
keys also distinguish platform and architecture. Legacy caches are not implicitly
trusted: `scripts/benchmark-reuse-renders.mjs` requires a source revision, matching
runtime evidence for incomplete old records, unchanged inputs/PCM, a byte-identical
cold control and explicit acknowledgement of dirty-source audit assumptions.
See SIM.md for the command. Do not treat an acknowledged assumption as proof.

Measured-only scoring assigns inferred tracks one-to-one to true source paths
**after** inference, with no error gate. Association is greedy, not optimal.
Measured detection means associated fused node tracks. Its bearing calibration
unit is median track error at a node, unlike one chosen window in truth-assisted.
These limitations matter when comparing pipelines. Measured 3D/elevation and
model labelling metrics are null.
# Round 2 metrics and sealed tests

Reports now include **useful fix rate** (scenes with a correct, unflagged fix /
all scenes), **unflagged-wrong fix rate** (scenes emitting at least one unflagged
wrong or unmatched fix / all scenes), and risk-coverage curves. Useful and
silent-wrong rates may both be positive in a multi-source scene; useful does not
certify that every event was correct. Risk is the fraction of answered scenes
with any wrong/unmatched fix. Confidence orders whole scenes by their least
confident emitted fix; ties are admitted together, never ordered using truth.
Metre error is unavailable if an unmatched hypothesis has unknown error.
Risk area integrates the step curve over all scenes, charging unanswered
coverage a risk of 1. This prevents a nearly silent array winning on a
conditional median. Default array rankings use useful scene rate. All new target
colours are provisional and preserve nulls.

`--sealed` is required for a sealed experiment. Its registered site/input hash
is checked before inference. A durable, exclusive-create ledger under
`docs/experiments/sealed-runs/` consumes the test attempt at start, including
failed or cancelled attempts. Repeating requires `--sealed-override "reason"`;
the reason and producer are recorded in the ledger and manifest. Keep this
ledger with the reports and repository; it is a local persistent guard, not a
remote access-control mechanism. Explicit `scene_splits` support train,
validation and test without changing legacy experiment partitions.
