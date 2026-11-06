# Proposed SIM.md fragment (do not merge automatically)

## Multisource extension (T2, opt-in)

Measured pipeline can emit multi-hypothesis bearing candidates per node window:

- `multi_peak`: shifted-window peak set
- `tf_histogram`: short-window direction histogram peak set
- `harmonic_comb`: harmonic-fundamental comb candidates with comb-only bearings

Optional `spectral` association groups candidates across nodes from spectral-envelope and temporal-envelope similarity, then rejects ghost groups by 3+ node geometric consistency.

All T2 outputs are diagnostics/extensions; fusion-core behaviour is unchanged in this track.
