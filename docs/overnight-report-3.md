# Overnight localisation report, round 3

## Outcome and scope

Mission 3A completed the preregistered descriptive matrix baseline. It did not
select or validate a solver change. The retained inference remains unchanged;
all outcomes are synthetic and must not be presented as field performance or a
hardware recommendation.

The corrected generator produced 588 sites across the preregistered train,
validation, sealed, generalisation, and density populations. The runnable
baseline used 202 sites: 120 core sites across 24 factor cells, 48
generalisation sites, and 34 density sites after the preregistered runtime
cut. All 606 measured-only jobs completed across `off`, `on`, and `surveyed`
profiles. The 240-scene sealed package was generated and hashed but not run;
it remains reserved for Mission 3D.

The detailed matrix tables, metric definitions, and subgroup limitations are
in the [Mission 3A matrix report](experiments/matrix-r3-report.md). The full
baseline is preserved at
[`matrix-baseline-r3.full.json.gz`](../baselines/matrix-baseline-r3.full.json.gz);
the readable summary is
[`matrix-baseline-r3.json`](../baselines/matrix-baseline-r3.json). The frozen
design, populations, and run evidence are recorded in
[`matrix-r3.json`](experiments/matrix-r3.json).

## Method and integrity

- The preregistered design hash is
  `6b5f325fe8fb292ffdc87cc8ad245857d9193de8546b4f87c5c5b01643ac29a5`.
  Corrected generated-input hash is
  `99e9e973c25b7809839ebea4f55360d2a33604618b97ecaca69054e4af46a8ed`;
  the sealed-input hash is
  `a2fe9499ec853c2e5a3d6e2ececef9ca30410adb7454ed39a211c2fdf072a78c`.
- The first generator pass mapped simultaneous-source count incorrectly,
  yielding empty-source runs. A later pass also mapped source height
  incorrectly, yielding aerial sources in affected runs. Those runs and
  manifests are retained with `invalid` names and excluded from all results.
- The generator was corrected, source paths were sampled more densely for
  building protection, and affected populations were regenerated before
  grading. Correct source counts and heights were checked in the corrected
  inputs.
- Cold timing probes completed 18/18 and 72/72 with zero cache hits. The
  corrected 36-run smoke and 606-run baseline also completed. Baseline audio
  was discarded after use; the complete report remains losslessly archived.
- No sealed jobs ran, and no accuracy outcome was used to change the design,
  select a runtime setting, or tune inference.

## Results and interpretation

Across core sites, events within 10 m (with missed events counted as failures)
were 39.6% for `off`, 31.3% for `on`, and 36.7% for `surveyed`. For one-source
scenes, the corresponding rates were 98.3%, 93.3%, and 95.0%; for three-source
scenes, they were 20.0%, 10.6%, and 17.2%. Source-aligned detection at three
or more nodes was also rare in three-source scenes. This is the clearest
diagnostic weakness in this population, not evidence that a different solver
would improve it.

Core cells have five sites per profile and are descriptive. Train-only groups
have two sites, validation-only groups have three, and density/profile groups
have three or four; these undersized groups do not support tier colors or
population rankings. Generalisation has 48 sites per profile. Conditional
position-error quantiles omit misses, so read them alongside all-event
coverage. Per-fix probability metrics are unavailable where `p_wrong` is
missing; null does not mean zero error or perfect calibration.

These are synthetic diagnostics under placeholder settings. They do not
establish real-world accuracy, calibrated probabilities, or hardware
requirements. `matrix-standard`, `matrix-full`, realism decomposition, and
sealed execution remain unrun. Keep the sealed inputs untouched and do not
tune to this descriptive baseline.

## Validation and handoff

Core tests passed 294/294, simulation app tests 39/39, echo app tests 8/8,
production build passed, and browser/CLI end-to-end checks passed 2/2. The
build emitted existing dependency and bundle-size warnings. Full chronological
decisions and operational evidence are in the [overnight log](overnight-log.md).
