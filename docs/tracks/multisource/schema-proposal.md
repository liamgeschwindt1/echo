# Proposed export schema update (deferred to T8)

Current track writes new data under existing extension namespace only:

- `results.extensions.multisource.*`

No schema bump made in T2.

When integration happens, schema notes should document:

1. Multisource candidate methods (`multi_peak`, `tf_histogram`, `harmonic_comb`).
2. Association output shape and ghost-consistency gate.
3. Label-assist mode semantics (`off`, `oracle`, `injected`) as association priors only.
