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
