# Simulator notes (buildings, mic's-eye view, calculation fixes)

Written while implementing the brief. Everything here describes the code as it is, including the parts that turned out to be weak.

## 0. Answers about the code as it was before this work

These were read from the code at commit `31badd9` plus the later UI commits (before any change in this brief).

**How was `snr_db` computed?**
`snrDb(signal, a, b, settings)` in `analyse.js`: the mean power of **mic 1 only**, **broadband** (no band limit), over the source's analysis window `[a, b]`, minus the analytically known noise power (ambient noise floor and mic self-noise, converted to digital units), divided by that noise power, in dB. The subtraction is floored at 0.1 % of the noise power. The window mean included **every** sound present in the window (other sources too), because it measured the total mic-1 signal. So it was a "signal plus other sources" level over noise, not the SNR of that source alone, and it was not in the localisation band.

**How was `uncertainty_deg` computed?**
`c * max(residual_s, 1/(fs*4)) / spacing`, converted to degrees and clamped to `[1.5, 30]`. `residual_s` is the RMS of the least-squares fit residual of the 6 pair delays against the far-field model. For a clean, single-path signal the residual is a few microseconds or less, so the formula fell to its floor of 1.5 degrees almost every time. It did not depend on SNR, bandwidth, window length or geometry. It was a placeholder and it was not calibrated.

**How was `elevation_deg` derived for the flat-square layout?**
All four mics are coplanar, so the z column of the least-squares system is zero and only the horizontal direction (dx, dy) is solved. The vertical part was filled in as `dz = -sqrt(1 - |h|^2)` where `h = (dx, dy)`, i.e. "assume the source is below". When the fitted `|h|` was 1 or more (timing noise can push it over) it was **clamped** to 1, which gives `dz = 0` and an elevation of exactly 0. That is why some runs showed exactly 0 and others small non-zero numbers. The sign was assumed, never measured.

**How was the GCC-PHAT peak chosen per pair?**
Global maximum of the (4x up-sampled) correlation inside the physically possible lag range `+/-(spacing/c)` plus a few samples, followed by parabolic interpolation around that sample. No "earliest peak", no multipath handling.

**How was the localisation window chosen per source?**
From the **true** geometry: `[start + r/c - 20 ms, start + clip_duration + r/c + 50 ms]` where `r` is the distance from the source to the **node centre** and `clip_duration` is the full clip length (including silent tails). It ignored other sources entirely.

**How was `first_arrival_s` computed?**
`start_s + r/c` with `r` the straight-line distance to the node centre. Direct path only; it was not affected by anything else.

## Regression baseline

Three fixed scenes (`test/golden-scenes.js`) were rendered with the pre-change code and their fingerprints stored in `test/golden/golden.json` (signals) and `test/golden/golden-legacy-analysis.json` (bearings). `test/sim-golden.test.js` checks the signals within 1e-6 (relative) for `reflection_order` 0, 1, 2 and default, with no buildings. The legacy bearing check is skipped only if `GOLDEN_ANALYSIS=off`; it is expected to be re-baselined in phase 3 because windows, SNR and uncertainty change on purpose.
