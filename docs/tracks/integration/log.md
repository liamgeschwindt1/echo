# T8 integration log

- 2026-11-07T00:23:01Z: Read successful GitHub regression 42317475067 for
  `116aafbc0f31bb8d5a44fbe1c2d3502c0c75f179`: 308 core, 44 app and three
  browser tests, build, archived round-two integrity and CI comparison.
  Archived metadata/logs. Latest measured disk 59%; removed only the named
  temporary base worktree and its dependency symlink. No sealed attempt or
  new performance default. Saving docs-only receipt, then verifying its
  branch-tip CI without another self-referential evidence commit.

- 2026-11-07T00:13:03Z: Disk 59% used. Final local gate passed (307 core,
  11 cue, 44 app tests, build, 16-run smoke with zero tracked/byte changes);
  browser suite passed all three tests. Archived building audit completed
  without new inference. Official workflow, selection, sealed and final-suite
  prerequisites remain blocked. Writing explicit incomplete-program reports,
  suite cuts and a non-step-5 resume handoff; LE-0 remains default.

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
- Fusion gate failed exact inference parity on 8 measured runs despite zero
  tracked metric regressions. Failure evidence:
  `baselines/integration-gate-fusion*`. Causes: wrapping already valid bearings
  when the calibration offset is zero (roughly 1e-14 coordinate changes) and
  exporting 12 new default option fields. Preserve raw azimuth with zero offset
  and share opt-in option resolution across benchmark, recordings and export.
  Added exact default-option and combined-extension truth-boundary tests.
- Corrected fusion integration passed full gates and byte identity; dashboard
  track then merged without conflicts and passed all merge gates.
- T7/T1 integration defects reproduced and fixed: registry is an array, KPI
  metrics use `interval95` and nested breakdowns, and JSON artifacts were not
  served by the app. Registry assets now serve in development and production;
  static export consumes the real registry. Adapter preserves pooled versus
  per-profile populations and published intervals. UI no longer averages
  quantiles or presents subtraction of marginal intervals as a paired interval.
  Targeted app tests passed.
- Export metadata receives the single integration bump 0.18 -> 0.19 for
  delivered multisource/fusion extensions. This is intentionally a metadata
  change; default inference and signal fixtures must still match base bytes.
- Registered LE-1 before diagnostics at commit `297c339`: self-calibration
  enabled, source content hash
  `d1eb705837c420b40a65dec187e39194ea52f374ebc18cdf7026e7134e4f2461`.
  Two matched diagnostic reports completed (8 runs each). Calibration applied
  in 0/8 runs. Pooled within-10-m delta 0 with site-paired interval [0, 0],
  two sites; train partitions each have one site and null intervals. This is
  not official matrix-standard evidence. LE-1 is rejected for promotion,
  not declared a universally ineffective method.
- No greedy/all-kept/ablation round is justified without accepted single-lever
  evidence. LE-0 remains default. No selected-engine freeze, sealed claim,
  sealed dispatch or final stress population was created.
- Browser test initially lacked Chromium; installed it with
  `npx playwright install chromium --with-deps`. Real-registry browser assertion
  then caught a test setup error: fixture navigation retained `#engine=LE-1`.
  Explicitly select LE-0 before asserting its published KPI. No engine outcome
  or option was changed.
- Existing regression workflow dispatched successfully for commit `297c339`
  (run 42313367287). This does not make the absent sharded workflow available.
- 2026-11-07T00:08:03Z heartbeat: disk 58%; final local gates running; regression
  run 42313367287 completed successfully. No new heavy study started.
- Found a KPI grouping defect: T1's building breakdown included `mixed` and
  `dense`, but the actual matrix label is `dense_urban`. Include that label.
  Register a separate offline baseline audit before deriving filtered results;
  no render, sealed input or generator modification is involved.
