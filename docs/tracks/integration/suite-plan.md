# Final-suite plan: blocked before throughput calibration

## Status and budget

No selected engine is frozen, no matrix sealed run has occurred, and no final
exam jobs are registered or executed. This file records real cuts and missing
estimates; it is not an executable preregistration or a completed suite.
`registry.json` is the authoritative empty final-job registry.

The assumed session budget is ten hours from 2026-11-06T23:00:53Z, reserving the
last 90 minutes for reporting. At 2026-11-07T00:13:03Z disk was 59% used.
The target remains at least 5,000 final jobs, with a 20,000-job stretch target.
Neither target was launched. No hypothetical timings were substituted for
measurements.

T1's `benchmark-sharded.yml` exists in the integration branch but is not
registered on the default branch. Dispatch returned HTTP 404 before any shard
started. T8 cannot publish to main or edit workflows. The required approximately
50-job throughput calibration therefore cannot start. Granted concurrency,
jobs per shard, sparse/mixed/seven-source/12-mic/4-mic remote wall times,
Actions minutes, artifact sizes and failure rate are all **null**.

Recorded local diagnostics took 38.507 seconds summed across eight LE-0 runs
and 37.032 seconds across eight LE-1 runs. The final local 16-run smoke command
took 63.03 seconds wall time. These small existing CI scenes are not the
representative remote calibration and cannot price the requested final suite.
The recorded T1 matrix-standard estimate is about eight hours for 216 jobs at
two local workers, so running multiple official candidates locally is not a
valid replacement within this budget.

## Required restart order

1. Publish T1's workflow through the owner's normal review process; require
   at most 20 concurrent jobs and a maximum four-hour shard.
2. Finish honest measured interfaces and full train/validation acceptance.
   Resume from the integration gates, **not** from step 5. Keep LE-0 unchanged
   until a separately recorded accepted decision.
3. Implement committed sealed claim, source/input/job freeze,
   infrastructure-only retry ledger and merge-time second-attempt refusal.
   Only then remove the temporary fail-closed sealed guards.
4. Select and freeze an accepted engine, make the separate default decision,
   then execute the one permitted sealed attempt on distinct algorithms.
5. Dispatch the representative calibration; calculate layer costs from its
   logs and actual remaining time. Commit a fresh exact suite registration
   with site/seed disjointness proof before any final outcome is read.

## Layer allocation and cuts

All numerical allocations and cost estimates below are null, not zero
performance. No fresh population or disjointness proof exists.

| Layer | Planned scope | Current cut / reason |
|---|---|---|
| L1 | 24 cells, four install profiles, building-copy profiles; 24 sites/cell target, 10 floor, ablations at least 8 | Blocked: no frozen selected engine or remote timing budget |
| L2 | Five-level factor sweeps, crossed factors and tier breakpoints | Cut after L1 prerequisite failure; no bisection or frontier is claimed |
| L3 | Node/install/heading/position tier frontiers | Cut: no balanced fresh measurements |
| L4 | Dropout, wrong copies, noise/range/motion/source stress, six-hour tracker soak | Cut: no calibrated cost or final frozen engine; no soak claim |
| L5 | Fresh determinism/parity/invariance/seed/cache/physics properties | Cut as a final-exam layer; ordinary regression tests are retained but are not this population |
| L6 | Analysis of all available evidence | Completed for existing diagnostic/archive evidence only; final-suite variance decomposition, attribution and tier maps unavailable |

Cuts preserve the priority order; L2-L5 were not substituted for missing L1.
The external prerequisite blocks every final layer, rather than a discretionary
decision to spend the reporting reserve.

## Analysis that exists

The diagnostic report includes pooled and partitioned site-clustered intervals
and paired comparisons on identical scene/seed/profile jobs. One-site
partitions have null intervals; fixed-site-only quantiles can have degenerate
intervals and must not be interpreted as precision. There is no fresh
cell-wise hypothesis family, so Holm/BH-adjusted final-suite significance,
factor variance decomposition, exhaustive event failure attribution and tier
breakpoints remain null. No multiplicity-adjusted improvement is claimed.

The archived building audit is descriptive and preregistered separately; its
five-site groups cannot establish causal building harm or a precise frontier.
Raw diagnostic reports remain losslessly compressed. `baselines/extreme/manifest.json`
records the blocked state, not synthetic stand-in results.
