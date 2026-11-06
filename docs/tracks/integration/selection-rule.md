# T8 engine selection rule

Registered before reading any combined-engine outcome on 2026-11-06.

The primary criterion is events within 10 m, with misses counted as failures,
pooled over all 24 core cells at install profiles `on` and `surveyed`. Compare
each candidate with its parent and LE-0 on identical jobs using 95%
site-clustered paired intervals. Unequal populations are not ranked.

Acceptance requires train and validation, measured-only, realism on and off:

- Scene coverage must not fall by more than 2 percentage points.
- Unflagged wrong-fix rate must not increase.
- Neither 1-sigma nor 2-sigma calibration may worsen.
- At least one of median horizontal error, p90 horizontal error or risk-coverage
  area must improve with a paired interval excluding zero, or all must be equal.
- Events within 10 m, misses counted, must not worsen.

Confidence-only changes additionally require fix-level Brier score, log loss,
AUROC and reliability evidence. Report overall and both detectable subsets;
unavailable values remain null and cannot satisfy an acceptance constraint.

Among eligible engines, rank the primary paired improvement; break ties by
fewer enabled options. Retain LE-0 if no candidate qualifies. No change becomes
default without the full acceptance evidence. Smoke tests alone cannot select
an engine. Rejecting a lever does not authorize tuning on validation.

At most 12 candidates and three rounds are allowed. Each round must commit its
exact option sets, parent IDs, populations, sites, seeds and input hashes before
execution. Begin with eligible single levers, then forward-greedy combinations,
an all-kept combination and leave-one-out ablations. Rejected track levers are
not relabeled as accepted; standalone cue demonstrations are not localisation
engine evidence.

The sealed population is never a selection population. Dispatch is prohibited
until an eligible engine is frozen and a committed single-attempt ledger and
merge-time second-attempt refusal are operational.
