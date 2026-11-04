# State of the engine: round 2

**This is a research simulator, not a validated field localiser. No accuracy or
confidence upgrade passed this round's acceptance rule.** Six complete candidate
trials were rejected; the retained algorithm is unchanged.

## What the new unseen test says

Forty new random sites were frozen before outcomes and evaluated once, with and
without simulated hardware errors. Baseline and final are exactly identical:
two algorithm labels do not mean two independent tests.

| Result | Hardware errors off | Hardware errors on |
|---|---:|---:|
| Sites producing any fix |23/40 (57.5%) |8/40 (20%) |
| Median error, when a fix can be matched |1.62m |14.97m |
|90th-percentile matched error |5.28m |100.83m |
| Wrong or unmatched fix hypotheses |34.1% |63.6% |
| Bearing estimates inside their stated1sigma /2sigma intervals |100% /100% |44.4% /72.2% |
| Sites with a correct, unflagged fix |0% |0% |

These are synthetic, single-stationary-source, mixed-range sites, not a dedicated
test at50m or an unseen moving/aerial/multi-source evaluation. Error
quantiles exclude missed fixes; the8/40 figure is essential context. Only11 fix
hypotheses were emitted with errors on, so uncertainty is wide: site coverage's
95% interval is7.5%..32.5%; the median-error interval is4.80..26.70m.
Hardware/noise draws share one render seed across sites.

The confidence flag is conservative but unhelpful: every retained two-node fix
is suspect. Zero unflagged wrong fixes therefore does **not** show a useful
confidence system. The bearing intervals should cover roughly68%/95% if
calibrated; they do not. They are not calibrated position-radius guarantees.

## What works, and what remains assumption

The Testing tab and CLI share reproducible scoring, coverage-aware risk metrics,
target colours, history and a geometry-only placement view. Complete evidence
retains misses and unavailable values. WAV/geometry/truth ingestion works on
synthetic round-trips; no real recording has been tested. The new clock and
weather/noise options are OFF by default and explicitly unmeasured placeholders.

Real labelling models ran on real clips through simulated propagation. Input
normalisation changed only one of72 predictions from wrong to correct; it did
not solve range collapse. The separate noise-share prototype assumes known
source locations and calibrated levels; it cannot yet justify real "road60%,
venue25%" claims.

**No robust hardware winner.** Complete archived array comparisons have zero
useful-fix rates and endpoint-dependent secondary leaders. A narrow variance
study is dominated by the assumed hardware-error bundle, not array geometry,
but is not a universal causal result. Scattering, complex mic response and
directivity are still unbuilt.

The next defensible step is the [prototype measurement plan](prototype-plan.md):
surveyed three-node recordings, independently verified timing, measured
heading/mic/noise calibration, and separate development and sealed real sessions.
The [full report](overnight-report-2.md) records rejected changes, intervals,
unfinished scope and the sealed export's metadata-only recovery; the
[claims ledger](claims.md) permits no field-validated accuracy claim.
