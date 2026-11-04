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
Above-cap experiments are rejected before rendering. Reduction removes values,
then seeds; it never silently truncates a result.

Defaults include both realism off and on, measured-only inference. Add
`analysis_modes: ["measured_only", "truth_assisted"]` to quantify the optimistic
source-window upper bound. Realism on uses heading 2.5 deg, gain 1 dB, mic position
5 mm, noise correlation 0.3; explicit swept variables override those values.
The effective settings, not the realism label, are authoritative.

Use `--compare baselines/baseline-0.json --fail-on-regress` to gate tracked metrics
with explicit `tolerances` (metric to absolute tolerance, default zero). A metric
becoming unavailable is a regression. Missing configs fail. Runtime is not gated.
Calibration compares distance from 68.27%/95.45%, not simply bigger-is-better.
Comparisons match variable values rather than configuration list order, and reject
different scene/seed populations or wrong-fix targets. A delta on different grading
data is not a regression result.

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

## Reading results

Open **Testing** in the simulator side menu. Select scenes (or snapshot the editor),
expand a variable group, tick variables and enter values/ranges, then click **Test**.
The default small experiment is one 20 m scene, five seeds, realism off/on and
measured-only. Presets populate the entire form and may need **Reduce samples /
values** before running. The app uses a coordinator worker and two compute workers;
rendering and aggregation never block the UI thread.

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

Measured-only scoring assigns inferred tracks one-to-one to true source paths
**after** inference, with no error gate. Association is greedy, not optimal.
Measured detection means associated fused node tracks. Its bearing calibration
unit is median track error at a node, unlike one chosen window in truth-assisted.
These limitations matter when comparing pipelines. Measured 3D/elevation and
model labelling metrics are null.
