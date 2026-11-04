# Round 2 method

Work branches from round one's final commit `099a0d0`, not the merge commit.
Never push main. Round one's held-out sites and seed 101 are validation, not
unseen test. No separate sealed-baseline file exists in that revision; the
frozen random-site input hash in the log and regression test is preserved.

`round2-sealed.json` preregisters 40 new random sites and a new render seed.
Only input generation is permitted before its final execution. Baseline and
final inference use the same site/seed/profile population in one sealed study.
The seal is consumed on starting, even if execution fails.

`round2-evaluation.json` fixes the train/validation population before results.
Stored round-one measured inference may be replayed for confidence-only changes;
this avoids rerendering identical audio and does not imply a rendering speedup.
Training may use truth labels **after** inference. Runtime confidence must use
mixtures, nominal geometry and declared settings only. Validation is accept/reject
only. Rejected trial evidence remains separate from accepted defaults.

Acceptance follows the mission's rule 4, replacing precision-only vetoes.
Calibration is distance to nominal 68.27%/95.45%, not maximising overcoverage.
Paired intervals resample complete matching scene/seed runs; no-fix pairs remain
in the population, never substituted with zero error. A new endpoint becoming
unavailable fails the guard. All-equal means exact equality of relevant outcomes,
not overlapping intervals. Single-site results cannot establish acceptance.

The rejected weighted and predictive solvers may be reconsidered only under this
changed rule, together with a discriminating confidence model. Their old
truth-assisted single-site results do not establish measured-only improvement.
No robust hardware winner or real-world validation is presumed.

Final algorithm freeze is recorded in the sealed registration before execution.
At the initial freeze, all five candidates failed; both sealed configurations use the
same retained legacy algorithm. The reserved unused confidence-mode keys are
removed, not silently treated as a calibrated model. The40 physical inputs and
their original hash do not change. A subsequently preregistered sixth spatial
trial is a different hypothesis, not a retuned rejected solver. Its complete
train/validation decision and any integration gates must precede the final
seal; partial results cannot change the freeze. No tuning uses test outcomes.

The additional balanced variance study is descriptive research after closing
these solver trials, not another acceptance attempt. It compares retained and
already rejected diagnostic processing on identical node tracks. It does not
complete the missing measured3D/multi-peak/tracker upgrades or a full hardware
ranking. Its exact population and limitations were committed before execution.
