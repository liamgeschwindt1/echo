# T8 integration log

- 2026-11-06T23:00:53Z: Started T8 only. Assume a 10-hour budget, with the final
  90 minutes reserved for reporting. Disk 47% used. Base
  `ff75074dca26a633b0aadae1a81a674db728030d` exists with all four required files.
- The origin fetch refspec covers only main. Explicitly queried remote heads
  and fetched the delivered track heads rather than misclassifying them as
  absent.
- Delivered heads: infra `17e3c2025557cdd74f4c1cf7eab6b0ba9839d0d2`;
  cues `93e5afb7a9cf38c2baa5d35320b4b9b28639370f`;
  multisource `1cc129ee451f44815a37032d3e061dcae7979ad2`;
  fusion `f81e4821f9afffef74b92ddec158a9b949052758`;
  dashboards `a0af27e45101b0f87a6fe6a0ef537d07a24f10eb`.
- Causal and buildings branches are absent from origin and excluded as not
  delivered. Required infra and fusion handoffs and levers files are present.
- Infra merged without conflicts. Running its full core-test gate.
  Infrastructure reports sealed-attempt controls unfinished. The sharded
  workflow is not listed on origin's default branch. No sealed execution,
  claim, regeneration or outcome inspection has occurred.
- Selection rule registered before any combined-engine outcome. Existing CI
  explicitly re-scores the historical smoke baseline; follow that procedure
  instead of weakening acceptance tolerances or comparing scoring versions.
- Initial core/app/smoke commands failed because workspace dependencies were
  missing (`ERR_MODULE_NOT_FOUND`, including `@echo/shared`). Ran `npm ci`;
  it installed 213 packages. Repeating all gates sequentially with two smoke
  workers. No dependency manifest changed.
- Sharded dispatch probe failed with HTTP 404: `benchmark-sharded.yml` is not
  on the default branch. `gh workflow list --all` lists only Simulator
  regression and Copilot cloud agent. T8 cannot push main or edit workflows.
  Consequently remote matrix-standard, throughput calibration and the final
  sharded suite are blocked pending publication of T1's workflow by the owner.
  Local integration checks can continue; no substitute sealed run is allowed.
- Infra full gates passed after install: 297 core tests, 39 app tests, build,
  and existing CI smoke with zero tracked regressions. Inspection of expanded
  jobs proved CI smoke is 8 runs; the requested 16-run population is preset
  `smoke` (includes truth-assisted and measured-only). Corrected preregistration
  before running that population. Generate a fresh reference from detached base
  source rather than treating an older archived smoke as byte-identical LE-0.
- Infra and cues 16-run gates passed and were pushed. The standalone cue tests
  also passed (11 tests); these live under `src/ext/cues` and are not included
  by the core package's `test/*.test.js` glob, so subsequent gates include them
  explicitly.
- Multisource merge conflict 1: adjacent imports in `render.js`. Resolution:
  retain both weather-delay and rotor-signal imports and both call paths.
  No track code dropped.
- Added fail-closed checks to all three sharded entrypoints. They reject sealed
  inputs before expansion/inference/merge while the required ledger controls
  remain missing. A subprocess regression test uses fake inputs only.
- Multisource gates passed, including byte-identical complete inference on all
  16 base smoke jobs. Fusion merge conflict 2: imports and pipeline return in
  `measured.js`. Resolution: retain multisource extraction, fusion/calibration
  passes and both sibling `extensions.multisource` / `extensions.fusion`
  blocks. No new positioning connection or default promotion is implied.
- Corrected T1's KPI comparison helper: unmatched populations now leave deltas
  null, and paired bootstrap recomputes pooled endpoints on whole sampled site
  clusters instead of averaging site quantiles. Missing self-comparison metrics
  remain null. Targeted regression tests passed.
