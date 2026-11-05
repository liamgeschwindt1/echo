# Overnight localisation report, round 2

## Outcome

**No algorithm or confidence candidate passed the preregistered acceptance rule.**
The deployed measured localiser remains the round-one horizontal pair-association
pipeline. Do not describe this round as a demonstrated accuracy upgrade. Six
complete trials, including renewed weighted/predictive consensus under the new
rule, were rejected and preserved offline. There is **no robust hardware winner**.

Retained work improves measurement integrity, reproducibility, recording
readiness and experimental realism. Real models ran in the labelling study.
All physical/noise models and all accuracy evidence remain simulated; no real
recording, site or prototype has validated accuracy or uncertainty.

Work is on `overnight/localisation-2`, branched from `099a0d0`; no main push.
Schema0.16 adds explicit opt-in physics notes. Existing signal/analysis golden
files are unchanged; new physics has its own separate golden.

## Method and populations

- Train68 / validation82 measured runs,25 original sites, seeds1/2/101, both
  realism profiles. Round-one held-out data is validation, never a new test.
- Forty new random sites and render seed3103170130 were committed before any
  inference. Frozen physical-input SHA-256:
  `a93368c737533c8988a0a8301a5bbde304dcc298661a0367ca6c365d52971ce6`.
- Both sealed algorithm labels intentionally use the retained legacy solver:
  no candidate was accepted. Reserved, unused confidence-mode keys were removed
  at freeze rather than implying a deployed calibrated model. The registered
  physical inputs did not change.
- Core source freeze:
  `2f7230fc50b341ad0c3fbd147bad728cc9fe6bb92e2fbc748bc25cf7c1a1bf38`.
  The seal is consumed on start, including failure; an override needs a recorded
  reason. There has been no test-driven tuning. After execution, a producer
  snapshot/export-error-handling bug was repaired; inference/physics/scoring
  files stayed frozen and the original producer hash was not rewritten.
- Rule4 compares all four train/validation x realism partitions: coverage loss
  at most2 percentage points, no increase in silent-wrong scene rate, calibration
  distance to68.27%/95.45% no worse, and a paired median/p90/risk-area improvement
  whose95% interval excludes zero, or all outcomes equal. Precision alone no
  longer vetoes a change. Unmatched fixes and missing intervals are not hidden.

Random sites are synthetic, many beyond the provisional50m design target.
Conditional errors omit misses; coverage and useful/silent-wrong rates therefore
belong beside every error table. Run bootstrap units share site geometry. A
simulation interval is not a real-world guarantee.
The sealed population contains160 jobs but only80 physical site/profile cases:
40 new sites x two realism profiles x two identical algorithm labels. Labels
are not independent test repetitions. Site-generation seeds are distinct; the
shared new render seed correlates hardware/noise draws across sites, so these
intervals do not sample a broad independent hardware-error population.

The single sealed process needed a documented **storage-only intervention**:
config-major scheduling retained audio for the second identical label. Before
disk85%, an audited script verified all consumers had the exact completed
whole-result cache key and removed63 raw renders/origins(3.94GB). It did not
remove inference or change settings/producer metadata. The seal ledger records
the amendment; `round2-sealed-storage.json` records every preserved result hash.
The original automatic discard-policy field remains unchanged; this exception
must accompany its interpretation. Every preserved hash verified unchanged;
all80 second-label jobs hit whole-result caches and all raw renders were removed.

## Baseline versus final

The fresh final evaluation completed150/150. Every inference and score object
exactly equals the reference; all four acceptance partitions pass by equality.
**Baseline and final are the same in this table**, not two competing accuracy
claims. Full paired decisions are in
[`round2-final.html`](../baselines/round2-final.html); full inference/provenance
is retained losslessly in `baselines/round2-final.json.gz`.

| Split / realism | N | Scenes answered | Median / p90m | Wrong fixes | Useful / silent-wrong scenes |1sigma /2sigma | Risk area |
|---|---:|---:|---:|---:|---:|---:|---:|
| Train/off |34 |70.59% |0.526 /24.631 |28.33% |0% /0% |76.85% /76.85% |0.5882 |
| Train/on |34 |67.65% |6.873 /24.885 |40.38% |0% /0% |22.34% /50.00% |0.7059 |
| Validation/off |41 |51.22% |0.438 /21.774 |23.08% |0% /0% |81.08% /82.43% |0.6585 |
| Validation/on |41 |31.71% |2.494 /26.747 |24.14% |0% /0% |50.00% /78.85% |0.7561 |

Errors are conditional on matched fix episodes; wrong fixes include unmatched
hypotheses. Calibration is associated-node track-median **bearing** coverage,
not positional ellipse coverage. Every retained two-node fix is suspect, so
zero silent-wrong rate is vacuous and useful rate is also zero.

### Single sealed test, complete

The single execution completed all160 jobs:40 sites x two profiles x two
identical solver labels. Every paired inference and score is exactly equal.
No sealed outcome selected a setting or model. The full report is archived in
`baselines/round2-sealed.json.gz`, with readable CSV/HTML companions.

| Sealed profile | N | Scenes answered | Median / p90m | Wrong fixes | Useful / silent-wrong scenes |1sigma /2sigma | Risk area |
|---|---:|---:|---:|---:|---:|---:|---:|
| Off, baseline=final |40 |57.50% |1.619 /5.275 |34.09% |0% /0% |100% /100% |0.7250 |
| On, baseline=final |40 |20.00% |14.966 /100.828 |63.64% |0% /0% |44.44% /72.22% |0.9250 |

Both labels have the same95% intervals. Off/on scene coverage:
[42.5%,72.5%]/[7.5%,32.5%]; median error:
[0.915,3.148]/[4.797,26.700]m; p90:
[3.208,10.860]/[14.966,100.828]m; risk area:
[0.575,0.850]/[0.825,1]. On wrong-fix rate is7/11 hypotheses,
95%CI[25.00%,90.91%]. Associated-node bearing1sigma/2sigma on intervals are
[18.75%,75.00%]/[55.56%,93.75%]. These are run-bootstrap intervals under
the recorded seed correlation, not hardware-independent or field guarantees.

**Export failure and recovery, not a second test:** after160/160 jobs, CLI JSON
serialization failed because `sealed.producer` referenced the caller manifest,
which then referenced the seal. The original process exited1; do not describe
it as an uninterrupted successful CLI export. All80 physical inference/score
caches were complete and immutable. A dedicated recovery checked every original
dispatch/progress line, cache key, original producer and the63 storage hashes;
it replaced only that metadata back-reference with the exact pre-dispatch ledger
snapshot and reconstructed the two recorded labels. Shared aggregation/exports
then ran without rendering, inference, scoring, a seal start or an override.
The original producer remains809b527/core2f7230fc. The ledger contains exactly
one `started`, a storage amendment, the export failure and recovered completion.
`baselines/round2-sealed-recovery.json` records original cache/log/script/output
hashes. The producer-snapshot regression now guards against caller mutation;
CLI also logs failures during export, not just during inference. Export fields
remain schema0.16's intended structure; no new result field was introduced.
The80 original cyclic V8 caches and original execution log are independently
preserved in `baselines/round2-sealed-original.tar.gz`; all hashes and original
inference/scores verify against the recovered JSON. Summary of those checks:
`baselines/round2-final-verification.json`. The metadata-only repaired source
fingerprint is2078b5c4; renderer fingerprint39d44f7b is unchanged. All seven
round-one golden files are byte-for-byte unchanged.

Per-category baseline/final, rejected-spatial and sealed calibration is in
`baselines/round2-category-calibration.json`, with declared available-bearing
counts and unchanged preregistered groups. It is descriptive, not fitted on
test categories. See the [plain-language state summary](state-of-the-engine.md).

Sealed errors-on physical subgroups (overlapping, not controlled causal
contrasts) expose the calibration population:

| Category | Scenes | Associated bearing episodes | Scene coverage |1sigma /2sigma |
|---|---:|---:|---:|---:|
| Two available nodes |12 |0 |0% |null /null |
| Three-plus available nodes |28 |18 |28.57% |44.44% /72.22% |
| Buildings present |31 |12 |16.13% |50.00% /66.67% |
| No buildings |9 |6 |33.33% |33.33% /83.33% |

Actual retained fusion is still two-node even when more nodes are available.
All40 new sites have one stationary source below10m: the sealed population does
not independently establish aerial, moving or simultaneous-source performance.
No-bearing groups retain null calibration, not perfect or zero coverage.

The reference derives unchanged round-one measured inference from
`baselines/final-1.json`, re-scored with the current aggregation and explicit
provenance. No original archive is overwritten.

## All six rejected candidates

Every trial completed150/150 cases. Full guard tables, paired intervals,
reliability bins and train-only model coefficients are retained in the linked
HTML/JSON archives; nulls are not converted to zero.

| Candidate | Main measured result | Rejection |
|---|---|---|
| [B1 logistic confidence](../baselines/round2-confidence-trial.html) | Risk area train off/on0.5882/0.7059 to0.3723/0.4771; validation0.6585/0.7561 to0.5365/0.7065 | Validation/on risk delta95%CI[-0.093595,0]; unchanged positions cannot establish another improvement |
| [Global disjoint assignment](../baselines/round2-global-trial.html) |82 three-plus-node fixes; more useful aggregation than independent pairs | Off-realism calibration worsens; validation/on improvement interval touches zero |
| [Global plus empirical intervals](../baselines/round2-global-uncertainty-trial.html) | Train-fitted per-condition intervals; first three partitions pass | Validation/on1sigma0.5000 to0.8923 is farther from nominal; improvement CI also touches zero |
| [Weighted forward consensus](../baselines/round2-weighted-trial.html) | Train/on median6.8735 to6.0917m; validation/on2.4937 to2.3015m;82 multi-node fixes | Train/off and validation calibration guards fail; validation/on paired improvement is not established |
| [Predictive leave-one-out](../baselines/round2-predictive-trial.html) | Identical aggregate outcomes to weighted on this population | Same rejection, not a separately favourable result |
| [Full-rank spatial DOA/static3D](../baselines/round2-spatial-trial.html) | Validation off/on coverage51.22%/31.71% to60.98%/39.02%;42 staticXYZ hypotheses | Train/off and validation2sigma calibration worsen; validation/on risk delta95%CI[-0.146341,0] |

[`round2-decisions.json`](../baselines/round2-decisions.json) contains every
partition/metric and reason. Weighted/predictive validation/on delta intervals:
median[-2.2350,2.0603]m, p90[-20.6863,1.9500]m,
risk[-0.14175,0]. A lower point estimate is not acceptance.

The new rule justifies reconsidering the historical trials: their old
precision-only rejection is no longer sufficient. New trials adapt consensus to
the **measured** proposal groups; they do not present truth-assisted repairs as
measured gains. Weighted survivor support must be at least twice the held-out
node's support before LOO rejection. The exact n1/n3 failure trace now passes an
offline regression; this does not repair the deployed measured localiser.

B1 uses16 observable geometry/quality/map features, standardised L2 logistic
regression, train-site-fold Platt calibration and exported coefficients. Raw
window SNR was not in stored inference, so it is not fabricated as a feature.
The flag discriminates some two-node fixes, but remains offline after rejection.
The proposed90% radius covers92.59%/93.62% train and94.59%/92.31% validation
off/on. This is correlated simulated empirical coverage, not a field conformal
guarantee. B4's analytic heading/mic-position terms were tested only in rejected
trials; scalar gain correctly contributes zero to ideal PHAT.

**Power limitation, not a changed rule:** validation/on has only3 wrong scenes
among41. A whole-run bootstrap omits all three with probability4.436%.
With positions/coverage unchanged, such samples have exactly zero risk-area
delta even for perfect confidence ordering. Thus the central95% upper endpoint
cannot be strictly negative for this confidence-only comparison. We did not
expand validation or waive the rule after seeing this.

### Additional preregistered spatial trial, rejected

After the known descriptive studies, one new B5/B4 hypothesis was registered
before outcomes: full-rank3D plane-wave DOA, observable/declared physical
covariance, spherical track agreement and stationary3D intersections.
Association/flags remain the legacy pairs; moving3D, multi-peak and calibrated
position radii are not supplied. All150 registered cases are required:
66 fresh geometry-eligible renders and84 identical reference inferences.
No partial trial result was used for acceptance. The trial started14:27UTC
with a recorded cold-p90 budget leaving the entire sealed/reporting reserve.
An independent audit matches all198 run/clip PCM identities. Core remains
2f7230fc; experimental schema0.17-spatial is offline only. All150 cases completed
by15:27UTC, including all66 fresh eligible renders and84 exact reference
fallbacks. No runtime source was changed, so rejection requires no core revert.

| Partition | Trial coverage | Trial median/p90m | Trial1sigma/2sigma | Trial risk | Paired median/p90/risk delta95%CI |
|---|---:|---:|---:|---:|---|
| Train/off |76.47% |1.690/24.631 |56.76%/56.76% |0.5882 |[0,3.557];[-0.939,7.407];[-1.11e-16,2.22e-16] |
| Train/on |67.65% |6.873/24.885 |22.34%/50.00% |0.7059 |[0,0];[0,0];[0,0] |
| Validation/off |60.98% |0.680/17.028 |63.21%/66.98% |0.6098 |[-0.568,2.159];[-11.343,4.747];[-0.14634,0.04878] |
| Validation/on |39.02% |2.574/26.747 |51.67%/76.67% |0.6829 |[-1.035,3.040];[-17.156,2.726];[-0.14634,0] |

Useful and silent-wrong rates remain zero in all four partitions. Compare the
baseline table above; the full archived guard table marks each pass/fail.
Train/on is unchanged, not an improvement. The42 upgraded static hypotheses
(38 off/four on) include unmatched hypotheses: they are not42 accurate3D
measurements. Moving3D and calibrated positional radii remain unavailable.
The experimental elevation-summary metric is also unavailable; no zero-error
elevation claim is made. Calibration and interval failures reject the candidate
despite better point coverage, without validation-driven parameter adjustment.

## Exact-output performance and determinism

The complete amended eight-render population matches every microphone byte,
canonical full-render value and measured inference hash. Original V8
serialization evidence is preserved as invalid instrumentation: its whole-value
hash differed even between identical baseline repetitions. A committed
methodology amendment preceded a full replacement population.

| Population, two repetitions | Baseline render / candidate ms | Baseline analysis / candidate ms | Observed ratios |
|---|---|---|---|
| seven_source |387504 /385058 |15875 /14592 | render1.006x; analysis1.088x |
| sparse_20,12-mic ball |5605 /6516 |6564 /6447 | render0.860x; analysis1.018x |

These are small, sequential-order, noisy samples, **not a robust renderer
speedup**. Static rendering was slower. Cached moving-knot spectra, Hann windows
and phasors preserve arithmetic/output; raw repetitions and comparisons are in
`baselines/round2-performance-*`. The baseline substitutes099a0d0 render/localise
source while sharing the remaining default-only modules.
The first baseline seven-source profile spends365.7s in per-mic rendering,
9.17s in activity,3.56s in noise and0.25s in clip spectra. The dominant
per-mic path/filter work remains; whole-analysis timing does not establish
individual analysis-stage speedups.

Legacy truth-assisted ties now compare inlier count, cost rounded to1e-10
squared-sigma units, then canonical node-pair IDs. Actual Chromium/Node pair and
fix parity passes. This numerical repair is distinct from solver accuracy.
Twelve seeded random scenes also pass actual-fix, finite-export and identical
rerun checks.

## Opt-in realism

The complete56-run preregistered study covers sparse_20/corner, seeds1/101,
realism off/on, baseline plus six OAT profiles. Every profile has8 cases.
All8 scenes per profile obtain a fix, but these easy scenes are not the full
population and do not establish robust noise/clock tolerance.

| Profile | Median / p90m |1sigma /2sigma |
|---|---|---|
| Default |1.101 /4.243 |75.00% /81.25% |
| Offset sigma5ms |1.152 /4.331 |75.00% /81.25% |
| Drift sigma100ppm |1.115 /4.243 |75.00% /81.25% |
| Wind5m/s |1.064 /4.290 |81.25% /84.38% |
| Urban55dBSPL |1.126 /5.096 |84.38% /87.50% |
| Rain55dBSPL |1.128 /4.104 |78.57% /85.71% |
| Ambient variation6dB |1.085 /4.368 |78.13% /84.38% |

Absent/zero parameters remain OFF; original DEFAULT_SETTINGS and frozen sites
are unchanged. Clocks share one linear resampling map within each node.
Wind is a140Hz low-pass Gaussian placeholder,55dBSPL at5m/s with pressure
proportional to speed squared; urban/rain spectra and slow envelopes are also
assumptions. Noise powers are record averages and activity times remain global.
No sync-gated TDOA, scattering, microphone frequency/phase or source-directivity
model is implemented. No measured weather/hardware validation is claimed.

Canary Wharf and Battersea are skipped: both existing OSM upstreams failed to
fetch each requested site, and no matching offline map cache was found. There
are no invented footprints or real-site benchmark claims.

## Labelling, attribution and variance

Actual YAMNet/CLAP ran on36 renders and144 predictions;72 known-label oracles
are separate. Raw27/72 correct(37.5%) versus RMS-normalised28/72(38.9%).
Glass11/24 to12/24, horn0/24 to0/24, dog16/24 unchanged. Raw range accuracies
16/24,7/24,4/24 become16/24,8/24,4/24 at actual mic ranges15.81/52.20/150.75m.
Normalisation does not rescue range collapse. The highest-confidence period
only is scored; intermediate model gates do not establish the horn-failure
cause. One clip/class and shared-node source audio limit generalisation.
No production normalisation change is kept. See
[labelling benchmark](labelling-benchmark.md).

### Complete variance decomposition

The preregistered270 renders yield540 algorithm rows: retained legacy and the
already rejected predictive diagnostic on identical tracks, without refitting.
Both answer151/270 cases. Legacy emits143 unmatched hypotheses versus1 for
the diagnostic; that observation does not override its failed acceptance trial.

Shapley shares below are percentages of **total response variance**, not just
explained variance. Intervals use500 whole-seed bootstrap draws/five clusters.

| Factor | Conditional matched RMSE share,95%CI | Bounded scene-loss share,95%CI |
|---|---:|---:|
| Array geometry |0.69% [0.24,2.64] |0.76% [0.41,1.69] |
| Available node count |2.53% [0.60,5.79] |3.47% [2.35,4.56] |
| Mean pair spacing |1.51% [0.49,4.23] |0.83% [0.53,1.10] |
| Diagnostic algorithm |0.026% [0.002,0.057] |3.31% [2.95,3.99] |
| Original hardware realism bundle |60.49% [48.40,78.59] |59.04% [55.06,63.23] |
| Unexplained / interactions |34.75% [13.09,48.35] |32.60% [29.00,35.28] |

Conditional RMSE uses302 answered algorithm rows; loss uses all540, with
misses/unmatched cases costing1. There are499 identifiable conditional draws
and500 loss draws; unavailable draws are not zero. This is **one fixed
free-field site, three12-mic geometries and five seeds**, not a causal hardware
decomposition for all scenes. Geometry includes180/230mm aperture differences;
housing scattering is absent. Assumptions dominate this narrow experiment,
but the tiny conditional algorithm share does not mean association is
unimportant: it omits misses and unmatched hypotheses.
Full rows/method/intervals: `baselines/round2-variance.json`.

### Complete noise-attribution prototype

All24 mixtures and12 isolated-reference renders completed. Three continuous
independent white/Rademacher sources stand in for traffic, venue and HVAC;
these are **not recordings of those classes**. Known POIs and inverse-square
NNLS estimate shares at a declared receptor. Truth uses independently rendered
source energies, not nominal recipe fractions. Source position, independence,
spectra, calibrated node levels and propagation assumptions are placeholders.

| Nodes / realism | Mixtures | Identifiable | Mean absolute share error,pp | Two observed seed means,pp |
|---|---:|---:|---:|---:|
|2/off |4 |0 |null |null, null |
|2/on |4 |0 |null |null, null |
|3/off |4 |4 |3.00 |2.96,3.04 |
|3/on |4 |4 |9.24 |7.21,11.26 |
|6/off |4 |4 |2.44 |2.42,2.46 |
|6/on |4 |4 |10.31 |15.85,4.77 |

Two seed means are not95% confidence intervals. More nodes do not reliably
remove gain/geometry model mismatch. All eight two-node cases are explicitly
underdetermined, not zero-error successes. Nearest-POI localisation association
is a separate diagnostic:36/38 emitted hypotheses fall within the association
gate, including duplicates; this is not event/label accuracy. Shares do not use
truth-selected fixes. Full assumptions, levels, shares and errors:
`baselines/round2-attribution.json`.

### Node count and placement checks

The complete60-case flat4 study varies available nodes2..6, mean pair
spacing20/40/80m and seeds1/101, both realism profiles, at one50m free-field
source. Every produced fix still uses **two nodes**, not N-node fusion.
Each table cell below pools all three spacings/two seeds, six scenes:

| Available nodes | Off: coverage; median/p90m | On: coverage; median/p90m | On wrong fixes | On risk area |
|---|---|---|---:|---:|
|2 |100%;0.319/0.816 |50%;3.343/8.227 |0% |0.5000 |
|3 |100%;0.240/0.642 |100%;5.426/9.867 |8.33% |0.1667 |
|4 |100%;0.279/0.512 |100%;8.131/19.377 |60.00% |0.8333 |
|5 |100%;0.160/0.310 |100%;7.453/16.554 |68.18% |1.0000 |
|6 |100%;0.175/0.468 |100%;4.118/12.471 |66.67% |1.0000 |

The third available node helps **coverage on this population**, not conditional
error or full3-node fusion. Additional disjoint pair hypotheses create unmatched
duplicates; scene risk can be1 despite small matched errors. Useful rate stays
zero. The complete spacing/seed/split table is in
[`round2-node-count.html`](../baselines/round2-node-count.html); this is not an
independent multi-site confidence interval or a universal optimal node count.

Pooling all five counts/two seeds gives ten scenes per spacing/profile:

| Mean pair spacing,m | Off median/p90m | On median/p90m | On coverage / risk area |
|---|---:|---:|---:|
|20 |0.284/0.816 |10.075/19.377 |90% /0.7000 |
|40 |0.126/0.427 |4.857/10.950 |90% /0.7000 |
|80 |0.255/0.642 |3.258/11.569 |90% /0.7000 |

These mixed-count contrasts do not isolate a universal spacing optimum.

All20 frozen greedy-placement simulations completed,18 with a matched fix.
The predicted RMS uses all available bearings and an assumed2.5degree sigma;
the deployed solver uses pairs and has systematic bias:

| N | Predicted geometry RMS,m | Observed off RMSE, seed range,m | Observed on RMSE, seed range,m |
|---|---:|---:|---:|
|2 |4.447 |0.142..0.206 |null, null |
|3 |2.390 |0.087..0.157 |3.516..6.099 |
|4 |1.996 |0.074..0.131 |2.829..3.115 |
|5 |1.772 |0.075..0.086 |2.640..2.807 |
|6 |1.534 |0.036..0.086 |1.723..3.782 |

These are checks that expose disagreement, **not validation of calibrated map
accuracy**. Off errors are much smaller than the assumed noise scale; on
matched RMS exceeds it by1.12..2.55x. Both N2/on cases fail despite finite
geometry predictions. RMSE omits misses/unmatched duplicates, which remain
visible in the full20-row `baselines/round2-placement-summary.json`.
The app's geometry-only view, obstacle mask and deterministic suggestions
do not modify the editor, predict signal detection or certify mount locations.

### Complete range/noise grid

All288 cases completed: nine arrays, centroid reference ranges20/50/100/200m,
ambient30/60dBSPL, seeds1/101 and both realism profiles. There are three nodes
with mean pair spacing40m, glass105dB at1m, and no ground/reflection/diffraction.
The table gives **stable-track node presence percentages**, ambient30/60 in
each cell, not a false-alarm-controlled detection probability:

| Array |50m/off,30/60 |50m/on,30/60 |200m/on,30/60 |
|---|---:|---:|---:|
| flat4_100 |100/100 |83.3/83.3 |83.3/16.7 |
| ball12_d180 |66.7/16.7 |0/0 |16.7/0 |
| ball12_d180_sub4 |0/0 |0/0 |0/0 |
| ball12_d180_sub6 |66.7/66.7 |16.7/16.7 |50/0 |
| ball12_d180_sub8 |83.3/66.7 |16.7/16.7 |33.3/0 |
| planar12_d180 |100/100 |50/50 |50/0 |
| dome12_d230 |100/100 |16.7/16.7 |16.7/0 |
| puck12_d210 |83.3/100 |0/0 |16.7/0 |
| ball12_d180_sub4_maxvol |83.3/83.3 |50/66.7 |83.3/0 |

All nine200m/on/60dB cells have zero fused scene coverage; the flat4 still has
one node with a stable track across the two seeds. There are non-monotonic
algorithm/gating cells: maxvol50m/on fused coverage is50% at30dB and100% at60dB.
This does not show that noise improves hardware. Two seeds, no noise-only
negative control, uncalibrated gates and processing failures cannot establish
a detection range or hardware winner. Useful-fix rate is zero everywhere.

Every cell, the two observed seed values/ranges, coverage and error nulls are in
`baselines/round2-range-noise-summary.json` and the full JSON/CSV/HTML report.
All nine required mic-self-noise, heading and timing entries stay **null**:
ambient noise was swept, heading was bundled with other errors, no synced TDOA
was tested, and the useful-fix target was not met. The following ideal geometry
ceilings must not be substituted for measured requirements.

### Complete coverage-aware regrading of known arrays

All2052 registered archive cases completed: the900-run all-site/all-nine-array
population and all eight144-run endpoint grids. Inference is the original known
round-one inference, **not a new rerender or an improved-engine experiment**.
The retained solver is unchanged on the fresh150-case comparison. Source
hashes/producers and the complete split/profile tables with500 whole-run
bootstrap intervals are in
[`round2-arrays-regraded.html`](../baselines/round2-arrays-regraded.html).

Useful-scene-rate primary rankings are all ties, with no unique winner.
For orientation, here is the complete validation/on partition of the900-run
archive,33 registered cases per array, in library order rather than median order:

| Array | Answered scenes | Conditional median / p90m | Useful scenes | Risk area,95%CI |
|---|---:|---:|---:|---:|
| flat4_100 |72.73% |5.568 /29.036 |0% |0.6667 [0.4848,0.8182] |
| ball12_d180 |3.03% |4.464 /4.464 |0% |0.9697 [0.9091,1.0000] |
| ball12_d180_sub4 |0% |null /null |0% |1.0000 [1.0000,1.0000] |
| ball12_d180_sub6 |21.21% |3.523 /25.446 |0% |0.8788 [0.7576,0.9697] |
| ball12_d180_sub8 |15.15% |8.926 /26.396 |0% |0.8788 [0.7576,0.9697] |
| planar12_d180 |39.39% |5.901 /16.153 |0% |0.6667 [0.4848,0.8182] |
| dome12_d230 |6.06% |3.841 /7.044 |0% |0.9394 [0.8485,1.0000] |
| puck12_d210 |3.03% |4.573 /4.573 |0% |0.9697 [0.9091,1.0000] |
| ball12_d180_sub4_maxvol |57.58% |9.254 /47.404 |0% |0.7576 [0.6061,0.8788] |

Ball/puck conditional errors come from one answered scene each. Their degenerate
conditional-error bootstrap intervals do not establish precision: draws without
an error are unavailable, not zero. Coverage/risk intervals retain misses.
Repeated seeds within a site are correlated.

Secondary risk-area point leaders flip from sub8 to flat4 with realism on the
full **train** population; planar12 to flat4 with ambient30 to60dBSPL on
**validation**; flat4 to planar12 with source90 to110dB on **validation**.
Other tested endpoint leader flips were not observed; this is not robustness
proof. There is no paired all-nine-array sealed ranking. **No robust winner.**

The900-run full nine-array rerender was **not started**: measured historical
p90 estimates give36,160,048ms(about10h), exceeding the remaining budget even
before the mandatory sealed run. There is no accepted improved algorithm to
rank. The original complete round-one arrays/endpoints remain evidence of
processing/placeholder sensitivity, not a new improved-engine hardware ranking.

### Ideal component budgets, not hardware requirements

The complete deterministic9-array x360-direction calculation reuses the
existing ideal timing-noise geometry model. At two orthogonal50m bearings,
zero-mean equal Gaussian errors and linearised intersection, the5m median
target limits bearing sigma to4.866degrees (the10m p90 target is looser).
Each column below consumes the **entire** error budget separately.

| Geometry | Independent per-mic delay sigma ceiling,us | Equivalent independent mic-position sigma,mm |
|---|---:|---:|
| flat4_100 |24.73 |8.49 |
| ball12_d180 |44.51 |15.28 |
| ball12_d180_sub4 |unavailable |unavailable |
| ball12_d180_sub6 |26.79 |9.20 |
| ball12_d180_sub8 |37.89 |13.01 |
| planar12_d180 |43.54 |14.95 |
| dome12_d230 |54.23 |18.62 |
| puck12_d210 |63.59 |21.84 |
| ball12_d180_sub4_maxvol |26.78 |9.20 |

These are optimistic analytic component ceilings, **not sufficient hardware
specifications, simultaneous allowances, measured ADC noise or an array
ranking**. Heading alone has the same4.866degree full-budget ceiling when
geometry is identifiable. The legacy coplanar subset is unidentifiable in
the existing ideal fit; null does not mean a zero-noise requirement.
Mic self-noise and inter-node synchronisation requirements remain null:
no appropriate validated SNR/detection or synced-TDOA model establishes them.
Coverage, useful-fix and confidence targets are not established by this
calculation. Source/method: `baselines/round2-hardware-budget.json`.

## Real-data readiness and prototype plan

WAV/geometry ingestion, external CSV/Flightradar conversion/scoring, and
noise/gain/heading calibration run end-to-end on rendered multichannel WAV.
Actual-fix browser/Node inference and input hashes match; malformed recordings
fail explicitly. Unknown truth/SPL/3D stays null. This is a software integration
check, **not real-data validation**.

The [prototype plan](prototype-plan.md) specifies cheap rigs, sample counts,
imports and held-session checks for every ranking-sensitive placeholder plus
timing, wind, phase response and scattering. It includes a surveyed3-node
aircraft/authorised Flightradar protocol and one-node phone/reference site-noise
protocol. Proposed sample counts are not measurements or derived tolerances.

## Retained infrastructure and validation

Shared CLI/Testing metrics include risk curves/area, useful fix rate,
silent-wrong scene rate, provisional target colours and exact-population
ranking guards. Missing eligible sigma makes calibration unavailable. Physical
inputs must match before algorithm acceptance; truth-assisted results cannot
establish rule-four acceptance.

Smoke/standard/full tiers are16/100/2700 runs. Timing estimates use measured
strata, not5s placeholders. History includes complete reports and physical-input
identity; different populations are not a longitudinal improvement. Nightly
standard CI is configured for02:20UTC but scheduling only activates after the
workflow reaches the default branch. The sealed set is never nightly input.

Actual GitHub Actions run41848917910 at35a2056 succeeded:286 core,38 app,
production build,2 Chromium/Node end-to-end cases and the finite measured
zero-regression benchmark. Logs were read; this is not an assumed CI result.
After the sealed export repair, the local complete core gate passes287/287
and the unchanged16-case smoke passes rule4 with no regressions. Final app
tests38/38, production build and actual Chromium/Node parity2/2 also pass.
The small known regression control is not another science population or
test-set tuning.
The final evidence-head workflow also verifies the complete sealed population,
paired equality, original80 cache/log hashes and storage/recovery provenance.
Its actual conclusion and logs are read from GitHub after publication; a local
pass or an older remote run is not substituted for that final-head gate.

## Scope not completed

| Mission surface | Delivered evidence / remaining limit |
|---|---|
| A1/A2 | Single-attempt seal, three-way splits, risk/useful/silent-wrong metrics, coverage-aware ranks and target colours |
| A3 | Exact-output cache changes retained; measured samples do not establish renderer acceleration |
| A4-A7 | Measured timing tiers, deterministic browser parity, seeded fuzz, configured nightly and loadable history; no nightly schedule executed on this non-default branch |
| B1 | Train-only interpretable confidence/radius experiment and full validation; rejected, not a deployed discriminative flag |
| B2 | Both renewed measured consensus methods and high-weight-node regression; both rejected under rule4 |
| B3 | Blocked-path feature in offline confidence; no retained blocked-edge hypothesis solver |
| B4 | Rejected empirical/analytic intervals, per-category descriptive reports; no heading self-calibration or calibrated deployed radius |
| B5 | Complete spatial trial rejected; no new runtime global/multi-peak/moving3D/tracker pipeline |
| B6/B7 | No alias-aware processing study; complete60-case available-node/spacing diagnostic, still pair-only fusion |
| C1/C2 | Clock resampling and placeholder weather/coloured noise OFF by default; no sync-gated TDOA |
| C3-C6 | Scattering/complex mic response/directivity unbuilt; both real OSM sites skipped after upstream/cache failure |
| D1 | Real models ran the complete registered clip/range/noise/normalisation study; no field label validation |
| D2 | Separate36-render known-POI attribution prototype; synthetic independent sources and level assumptions |
| E1/E2 | Complete narrow variance study and2052-case archived regrading; no improved-engine full rerender or nine-array sealed ranking |
| E3 | Complete288-case range/noise grid and ideal component ceilings; controlled detection and required hardware specifications unavailable |
| E4/E5 | Geometry map/suggester,20 simulated disagreement checks and concrete measurement protocols; not calibrated coverage |
| F1 | Synthetic-tested WAV/geometry/truth/calibration CLI and Testing source; no real recording seen |
| G | Claims, architecture/testing/SIM, plain-language sealed state and this full report |

No retained discriminative confidence, heading self-calibration, blocked-edge
measured solver, measured elevation/3D/multi-peak pipeline, full global runtime
assignment, new tracker, alias-aware SRP/subarrays, improved-engine full array
ranking, or validated hardware requirements. The placement view is implemented,
but geometry-only; all20 placement,60 count/spacing and288 range/noise cases
completed. These diagnostics do not calibrate the map or establish hardware
requirements. C1 is partial(no TDOA); C3-C5 are unbuilt. Diagnostic research and a
calibration-file helper must not be presented as these completed features.

## Review order and open decisions

Review the method/seal commits first, then metrics, offline trials, exact-output
caches, deterministic ties, recording/physics, model evidence and prototype
protocol. `git log --reverse 099a0d0..overnight/localisation-2` gives full order.
Key commits in dependency-oriented review order (preregistrations precede their
outcomes; the full log includes intervening evidence/clarification commits):

| Review | Commits | Purpose |
|---|---|---|
|1 |56c197e,38dcd9c,12e03f7 | Three-way method, seal/metrics and actual retained-solver freeze |
|2 |a026dd4,91d2ad1,8d22ceb,6eea56b | Train-only confidence and complete rejected consensus/association evidence |
|3 |ab57058,185e4f1,fbc46fe | Registered profiling, instrumentation correction and exact-output caches |
|4 |be8713a | Canonical legacy consensus and actual browser parity |
|5 |800c112,def3648 | Complete-population grading, timing tiers, history and geometry view |
|6 |0382c8f,6deb4a9,a14a70f | Preregistered opt-in clock/weather physics and complete56-case evidence |
|7 |ec053a7,20335e5 | Preregistered actual-model labelling and normalisation outcomes |
|8 |bde3d0c,0ea55b8 | Synthetic-tested recording tools and concrete real-measurement protocols |
|9 |59adfee,8483834,976b3ab | Preregistered variance design, implementation and complete intervals |
|10 |3591252,6eea56b,b1ffab9 | Separate known-POI attribution and all36 renders |
|11 |2924ef5,03d9f1d,deeff83 | Count/spacing and all-nine-array range/noise populations and complete results |
|12 |6486caf,b61c6f6 | Frozen placement suggestions and20 simulated disagreement checks |
|13 |d3ed1c6,f170423,6eacb6d,87a9687 | Ideal component ceilings and complete archived array regrading |
|14 |6ac185c,6b5df48,809b527 | Novel spatial preregistration, offline implementation and rejection/final freeze |
|15 |64dc91e,51d0e9e | Audited sealed storage intervention and metadata/lifecycle repair |

The final evidence commit contains the single-attempt ledger, immutable original
cache archive, recovered sealed report, category/history data and final claims.

Open decisions for the next round, not requests to change this run:

1. Keep the fixed acceptance rule despite the demonstrated confidence-only power limit,
   or preregister a larger independent validation population next time?
2. Prioritise measured3D/global multi-source inference or the separate
   known-POI noise-first product, rather than selecting hardware from weak fixes?
3. Which surveyed/raw multichannel recordings and independent timing references
   can be acquired first? No simulator-only result substitutes for these.
4. Which housing/mic response and site-noise placeholders should be fitted
   before treating simulated array differences as engineering requirements?
