# Localisation conclusion: T8 integration, evaluation incomplete

## Plain-language conclusion

The existing engine, **LE-0**, is still the default. Five delivered development
tracks were combined without changing its smoke-test inference. The only new
registered engine, **LE-1**, turned on heading self-calibration, but the small
diagnostic test did not have enough observable information to apply a
calibration. It is not promoted. This does not prove calibration cannot help.

There is **no selected new winner**, completed matrix sealed test or final
stress exam. The required remote workflow is unavailable and several measured
interfaces and safety gates are unfinished. All results are synthetic; none
establish field performance, an installation guarantee or a hardware winner.

## Engines and comparable evidence

LE-0 is the baseline at `ff75074`. LE-1 uses integration source-content hash
`d1eb705837c420b40a65dec187e39194ea52f374ebc18cdf7026e7134e4f2461`
with `measured_heading_self_calibration=1`, parent LE-0, status rejected for
promotion. It is not a selected-engine freeze.

The preregistered diagnostic used `sparse_20` and `random_5`, seeds 1 and 101,
realism off/on and measured-only analysis: eight runs per engine, two sites.
Calibration applied in 0/8 LE-1 runs. Both engines have identical endpoints.
The table gives site-clustered 95% intervals; all rows have two sites/eight
runs per engine. Rate deltas are percentage points.

| Metric | LE-0 | LE-1 | LE-1 minus LE-0, paired 95% interval |
|---|---|---|---|
| Events within 10 m, misses included | 50% [0, 100] | 50% [0, 100] | 0 [0, 0] pp |
| Scene fix rate | 50% [0, 100] | 50% [0, 100] | 0 [0, 0] pp |
| Source fix rate | 50% [0, 100] | 50% [0, 100] | 0 [0, 0] pp |
| Unflagged wrong-fix rate | 0% [0, 0] | 0% [0, 0] | 0 [0, 0] pp |
| Horizontal median, conditional on a fix | 1.197 m [1.197, 1.197] | 1.197 m [1.197, 1.197] | 0 [0, 0] m |
| Horizontal p90, conditional on a fix | 3.817 m [3.817, 3.817] | 3.817 m [3.817, 3.817] | 0 [0, 0] m |
| Bearing within 1 sigma | 62.5% [62.5, 62.5] | 62.5% [62.5, 62.5] | 0 [0, 0] pp |
| Bearing within 2 sigma | 75% [75, 75] | 75% [75, 75] | 0 [0, 0] pp |

These are not acceptance-scale estimates. Only one site contributes fixes,
which explains degenerate conditional-error/calibration intervals. Train
partitions have one site and null intervals. Full realism/train/validation
tables, detectable-subset metrics, risk/confidence metrics and counts are in
`baselines/integration-round1-diagnostics.json`; raw reports are the adjacent
LE-0/LE-1 gzip archives. No significant improvement is claimed. Official
24-cell on/surveyed validation was not dispatched.

For orientation only, the **different** historical LE-0 matrix archive has
606 runs/202 sites: 30.93% [26.41, 35.78] within 10 m, 78.22%
[73.10, 82.84] scene coverage, median 7.261 m [4.914, 10.557] and p90
37.480 m [36.069, 38.759]. These are pooled archive endpoints, not the
diagnostic population or the selection-rule population. LE-1 differences
against that historical KPI sheet are null. Never subtract the two tables.

## What remains unestablished

| Requested result | Evidence available now | Final/sealed tier or frontier |
|---|---|---|
| Horizontal metrics and calibration by all 24 cells | Historical LE-0 sheet; tiny matched diagnostic | null |
| Minimum nodes by tier, 2-8-node curve and duplicates | Historical studies only; no new final frontier | null |
| Install profile and heading/position tolerance by tier | No accepted calibration/install sweep | null |
| Assumed-copy exact/coarse/poor harm and building frontier | Buildings track not delivered | null |
| Aerial 3D fix rate and height error | No delivered measured cue-to-fusion path | null |
| Moving-source error, continuity and time to fix | No completed new frozen-engine moving suite | null |
| Six-hour tracker drift, leaks and memory | No final soak run | null |
| Sealed comparison and both detectable subsets | No matrix sealed attempt | null |

Targets remain placeholders from `docs/targets.json`. No tier, minimum
installation, scale boundary or breakpoint is inferred from missing data.
There is no fresh, exhaustive failure attribution from which to rank causes.
Known development blockers, in priority order, are measured multisource
association, honest uncertainty calibration, missing cue observations and
missing building/causal integration. That is a work-priority list, not measured
failure frequencies.

## Building-population discrepancy

The preregistered offline audit of the archived non-sealed matrix selected
measured-only, realism-on, ground, stationary, single-source core cells.
Each environment has five sites/five runs. Open and mixed have 100% within
10 m [100, 100]; dense urban has **80% [40, 100]**, while all three have
100% scene coverage [100, 100]. Nominal blocked direct rays were 0/25,
0/25 and 4/25 respectively; these are geometry counts, not causal estimates.
Reflections, diffraction and blocking were enabled in building scenes.

The round-two 16.13% versus 33.33% statement compared descriptive subgroups
with different geometry, range and node availability (31 buildings-present
sites versus nine without buildings). It was not a randomized building effect.
The matrix mostly line-of-sight single-source population and the distinction
between scene coverage and events within 10 m explain why those numbers
cannot be subtracted or treated as contradictory estimates of one causal
quantity. Five-site intervals are coarse; all-success intervals are not
certainty about new sites. See `baselines/integration-building-audit.json`.

## Decisions for every delivered lever

| Lever | Decision | Evidence / missing gate |
|---|---|---|
| Multisource multi-peak/time-frequency/comb candidates, association and label prior | Keep opt-in, not accepted as an engine improvement | Components/diagnostics only; measured association-to-fusion adapter and full acceptance absent |
| Rotor source model | Keep opt-in synthetic test model | Placeholder source physics, no hardware or classifier claim |
| Likelihood fusion (`fus-1`) | Reject promotion; implementation remains opt-in | Delivered T4 smoke did not improve accepted endpoints |
| Joint fusion | Keep opt-in | Previous calibration rejection remains unresolved |
| Heading calibration (`fus-cal-1`, LE-1) | Reject promotion; implementation remains opt-in | T4 and T8 smoke applied no calibration; official validation absent |
| Notch/Doppler/sound-speed cues | Keep standalone/opt-in, not wired using truth | No honest measured observation stream or runtime acceptance |
| Weather mismatch | Keep opt-in | Synthetic direct-path placeholder, default zero |
| Infrastructure and dashboard reporting | Keep reporting changes | Published-value, population-matching and browser checks; no position change |
| Building weighting and causal front end | Not delivered, no decision | Branches absent |

No new position-changing lever becomes default. Candidate combinations,
all-kept/leave-one-out engines, a selection freeze and default-decision commit
remain unfinished rather than being fabricated from component results.

## Allowed claims and next evidence

Allowed: five delivered tracks merged, default smoke inference preserved,
schema/reporting repaired, and one registered diagnostic configuration rejected
for promotion with its real evidence. Forbidden: a new accuracy winner,
completed final exam/sealed test, field validation, hardware ranking, measured
aerial improvement, causal building benefit, or unmeasured installation tiers.

Before any real-world claim, obtain synchronized raw microphone recordings
with independently surveyed source trajectories and node poses; then measure
clock/heading/position uncertainty and sound speed; then collect overlapping
sources and varied obstruction/weather cases with independent labels.
Preregister held-out comparisons before outcomes, including honest missed
events and calibration. These are future evidence requirements, not data
collected here. Classification, general event detection, hardware comparison
and digital-twin onboarding remain outside this program.

Open engineering questions are whether mixture-derived candidates can be
associated without truth, whether covariance can be calibrated across sites,
and which cues remain identifiable under overlap. Workflow publication,
distributed sealed controls and these missing interfaces must be resolved
before the final program can resume. `docs/tracks/integration/suite-plan.md`
records all cuts; this is not a step-5 resume checkpoint.
