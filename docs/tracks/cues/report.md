# T5 CUES report (branch `overnight/loc5-cues`)

## Scope executed

- A4.5 notch-height cue module and tests.
- A4.6 Doppler range cue module and tests.
- A6 weather mismatch placeholder in renderer (new file, opt-in default OFF) and sound-speed correction module/tests.
- A4.4 aerial check harness and track-local drone/aerial runs.

## Preregistered studies and evidence

- `docs/tracks/cues/prereg/notch-height-study.json`
- `docs/tracks/cues/prereg/doppler-range-study.json`
- `docs/tracks/cues/prereg/weather-sound-speed-study.json`
- `docs/tracks/cues/prereg/aerial-check-study.json`
- Result bundle: `baselines/cues-track-eval-2026-11-06T16-26-14-032Z.json`

## Headline outcomes (track-local cue harness)

- **Notch height cue (A4.5)**:
  - usable cases: 48, unknown/fail: 16 (all from zero-reflectivity regime)
  - height MAE: **0.55 m**
  - height p90 abs error: **1.65 m**
  - ground-vs-aerial accuracy: **1.00**
- **Doppler cue (A4.6)**:
  - speed MAE: **2.31 m/s**
  - closest-range MAE: **26.08 m**
  - proxy single-node track RMSE: bearing-only **49.82 m** vs with Doppler **25.92 m** (gain **47.97%**)
- **Weather + sound speed (A6)**:
  - mean speed error without correction: **3.89 m/s**
  - with correction: **0.16 m/s**
  - mean range error at 100 m without correction: **1.13 m**
  - with correction: **0.046 m**
- **Aerial checks (A4.4)**:
  - base 3D fix rate: **0.40**
  - cue-assisted 3D fix rate: **0.40** (cue improves z only when base returns xy)
  - base mean 3D error: **89.50 m** (95% CI [58.71, 120.28])
  - cue-assisted mean 3D error: **13.02 m** (95% CI [5.20, 20.85])
  - base mean height error: **88.5 m**; cue-assisted **2.23 m**

## LE-0 safety checks (default behavior unchanged)

- Cue module unit tests: pass (`node --test packages/sim-core/src/ext/cues/*.test.js`).
- Existing regression checks: pass (`sim-realism.test.js`, `sim-golden.test.js`).
- Matrix smoke run: `baselines/cues-matrix-smoke-2026-11-06.json`.
- Paired compare vs LE-0 smoke baseline (`baselines/matrix-smoke-r3.json`): **pass=true, regressions=0**.

## Limits and failures

- Notch cue degrades to unknown in no-reflection cases (expected).
- Doppler range fit remains noisy at tested SNR/speed grid; integration to T4 tracker/fusion deferred to T8 by design.
- Aerial fix rate not improved because this track does not modify fusion core; only height estimate improves when a base fix exists.
