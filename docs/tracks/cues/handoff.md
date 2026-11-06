# T5 CUES handoff

## 1) Landed work (with files)

- Cue modules:
  - `packages/sim-core/src/ext/cues/notch-height.js`
  - `packages/sim-core/src/ext/cues/doppler-range.js`
  - `packages/sim-core/src/ext/cues/sound-speed.js`
  - `packages/sim-core/src/ext/cues/weather-render.js`
- Renderer integration (opt-in weather mismatch, default OFF):
  - `packages/sim-core/src/render.js`
- Unit tests:
  - `packages/sim-core/src/ext/cues/notch-height.test.js`
  - `packages/sim-core/src/ext/cues/doppler-range.test.js`
  - `packages/sim-core/src/ext/cues/sound-speed.test.js`
  - `packages/sim-core/src/ext/cues/weather-render.test.js`
  - `packages/sim-core/src/ext/cues/weather-render-off.test.js`
  - `packages/sim-core/src/ext/cues/weather-render-golden.test.js`
- Track-local evaluation harness:
  - `scripts/cues-track-eval.mjs`
- Outputs:
  - `baselines/cues-track-eval-2026-11-06T16-26-14-032Z.json`
  - `baselines/cues-matrix-smoke-2026-11-06.json`
  - `baselines/cues-matrix-smoke-2026-11-06.csv`
  - `baselines/cues-matrix-smoke-2026-11-06.html`
- Track docs:
  - `docs/tracks/cues/interfaces.md`
  - `docs/tracks/cues/log.md`
  - `docs/tracks/cues/report.md`
  - `docs/tracks/cues/levers.json`
  - `docs/tracks/cues/claims-fragment.md`
  - `docs/tracks/cues/sim-md-fragment.md`
  - `docs/tracks/cues/prereg/*.json`

## 2) Rejected / reverted steps

- None reverted in this session.

## 3) Unfinished items (priority)

1. **MUST**: T8 integration of cue outputs into fusion/tracker runtime path (this track kept modules standalone by rule).
2. **MUST**: Full acceptance-table evaluation under track-wide paired train/validation criteria once integrated.
3. **OPTIONAL**: Extend weather mismatch from direct-path-only advection to reflected/diffracted path travel-time model.

## 4) Repo state

- Branch: `overnight/loc5-cues`
- Head commit: `b8bf94b22e9ce444ab09d7518050448a00e64b13`
- CI result: no GitHub Actions run triggered yet for this branch/commit (`gh run list --branch overnight/loc5-cues` returned empty at 2026-11-06T16:44Z).
- Prereg hashes:
  - notch-height-study.json: `73ae7b1a2296c7b12f44ac3b0deaef826dd482df2065bb2472defcb47f8143ac`
  - doppler-range-study.json: `271e570e0cc46bc68cf1d870b99f4cbdbdcfa820ea10828c2e95f9eb1a088c39`
  - weather-sound-speed-study.json: `a23c41b960bf7065d35349867b9ce37a33be92c3f824d030a102096f188ca483`
  - aerial-check-study.json: `e84e841eac57dd333bf08fa319e5d47e308f0ddd6efa868ab825566a2e824a80`

## 5) Headline metrics vs 3A baseline

- Matrix smoke regression check against `baselines/matrix-smoke-r3.json` produced **0 tracked regressions** (`pass=true`) with defaults off.
- Track-local cue outcomes are in `baselines/cues-track-eval-2026-11-06T16-26-14-032Z.json`:
  - notch height MAE 0.55 m (usable cases),
  - Doppler proxy RMSE gain 47.97% vs bearing-only,
  - sound-speed correction reduced 100 m range error 1.13 m -> 0.046 m,
  - aerial cue-assisted height error 88.5 m -> 2.23 m on fixed cases.

## 6) Merge-readiness checklist

- [x] Tests pass (new cue tests + `sim-realism` + `sim-golden`).
- [x] Default output unchanged (`weather-render-off.test.js`; matrix smoke compare pass with zero regressions).
- [x] Shared-file touches listed.
- [x] Opt-in defaults documented.
- [x] Schema/doc fragments written under track docs.
- [ ] GitHub Actions run on last commit reviewed (pending push).
- [x] GitHub Actions run check executed (no run triggered yet for this branch).

### Shared-file touches (allowed)

- `packages/sim-core/src/render.js`: added 1 import and weather-delay call sites (no refactor/move).

## 7) Open questions for owner

- Should T8 treat notch cue as hard height prior or soft probabilistic factor in joint fusion?
- Should Doppler cue remain tonal-only gate (`tone_hz` required) or include harmonic comb fallback?
