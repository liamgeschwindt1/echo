# T8 integration report

## Result

Integration is persisted but the requested evaluation program is **incomplete**.
Five delivered tracks are merged. LE-0 remains default; LE-1 is rejected for
promotion on diagnostics. No selected-engine freeze, matrix sealed attempt or
final stress suite exists. This report records actual work, not substitute
performance results.

The base `ff75074dca26a633b0aadae1a81a674db728030d` and all four required
precondition files were verified before work. Infra and fusion handoffs/levers
were present. The origin fetch refspec covered only main, so remote heads were
queried and delivered branches fetched explicitly.

## Delivered merges

| Track | Delivered head | Merge commit | Gate evidence |
|---|---|---|---|
| Infra | `17e3c2025557cdd74f4c1cf7eab6b0ba9839d0d2` | `98b8765` | `baselines/integration-gate-infra*` |
| Cues | `93e5afb7a9cf38c2baa5d35320b4b9b28639370f` | `2556f36` | `baselines/integration-gate-cues*`, 11 standalone cue tests |
| Causal | Not delivered | None | Excluded |
| Multisource | `1cc129ee451f44815a37032d3e061dcae7979ad2` | `adb2ece` | `baselines/integration-gate-multisource*` |
| Buildings | Not delivered | None | Excluded |
| Fusion | `f81e4821f9afffef74b92ddec158a9b949052758` | `86442ce` | Failed `integration-gate-fusion*`; corrected `integration-gate-fusion-fixed*` |
| Dashboards | `a0af27e45101b0f87a6fe6a0ef537d07a24f10eb` | `7e14c47` | `baselines/integration-gate-dashboards*` |

No other track branch was changed or rebased. No main push was made.

### Conflicts and tightly coupled fixes

1. `render.js` adjacent imports: retained both weather and rotor imports and
   both call paths.
2. `measured.js` imports/pipeline return: retained multisource extraction,
   fusion/calibration dispatch and both sibling extension blocks.
3. Fusion default regression: zero-offset azimuth wrapping introduced roughly
   1e-14 coordinate changes, and new option fields changed default inference
   serialization. Commit `a280c1e` preserves the untouched bearing and shares
   option resolution across benchmark/recording/export. Failure evidence was
   retained; the corrected complete inference matches the fresh base exactly.

No delivered change was silently discarded. Each delivered merge ran core
tests, app tests, production build and the 16-run smoke; cue tests were added
explicitly once their nonstandard location was identified.

API naming deviation: T4 delivered the existing `measured_fusion_mode` selector
and new `measured_heading_self_calibration` name rather than a `fus_*` namespace.
Integration preserves that documented API instead of silently renaming the
registered option. Both stay opt-in/default-off relative to legacy. Prefix
normalization or an explicit compatible alias remains a pre-promotion task.

## Reporting, schema and safety

- `3e12301`: KPI deltas now require identical complete paired physical
  populations. Pooled endpoints are recomputed on sampled whole sites rather
  than averaging per-site quantile changes. Missing self-deltas stay null.
- `85a916f`: sealed planner/executor/merger fail closed while distributed
  attempt controls are unfinished. Tests use fake inputs, not sealed scenes.
- `7de1d1e`: actual T1 registry/KPI objects are served in dev/production and
  adapted by the dashboard; offline export reads registered artifacts.
  Published intervals, counts, pooled populations and profile populations
  remain distinct. Paired intervals are never synthesized from marginal CIs.
- Export schema was bumped once, 0.18 to 0.19, documenting multisource/fusion
  extension proposals. Signal goldens were not updated.
- `861a97a`: building breakdowns include the actual `dense_urban` label.
  Its focused KPI tests passed; the subsequent GitHub regression must cover
  this change together with the final code.

Initial dependency failures were resolved with required `npm ci` (213
packages); manifests were unchanged. Browser validation initially lacked
Chromium, so the existing Playwright browser/dependencies were installed.
A fixture-history hash made a real-data test select LE-1 accidentally;
the test now selects LE-0 explicitly, without weakening published-value
assertions. Test-generated screenshots were restored.

## Engine registration and evidence

Selection rule commit `9957835` predates combined outcomes. Round registration
`dc15d84` and candidate registration `297c339` predate diagnostic outcomes.
`23125a2` records the resulting matched reports and rejected promotion.

LE-1 enables only `measured_heading_self_calibration=1`, parent LE-0, source
content hash
`d1eb705837c420b40a65dec187e39194ea52f374ebc18cdf7026e7134e4f2461`.
Eight matched measured-only runs per engine, two sites, seeds 1/101,
realism off/on: calibration applied in none. Within-10-m delta is zero,
95% site-paired interval [0, 0]. That is diagnostic equality, not acceptance
on the official 24-cell on/surveyed population. One-site partition intervals
are null. Every registered diagnostic job appears in the raw reports.

The full acceptance table is `baselines/integration-round1-diagnostics.json`;
raw reports are losslessly archived as
`baselines/integration-round1-{le0,le1}.json.gz`. Both engines have KPI/refs
files and are listed in the actual static dashboard export. The historical
606-run/202-site LE-0 headline is not compared numerically with the eight-run
LE-1 headline; unmatched deltas remain null. Both `sealed` and `final_suite`
KPI blocks remain null.

No other candidate or greedy/leave-one-out composition was justified:
likelihood had already failed T4 smoke, multisource candidates are not fused
tracks, cues lack measured observation extraction, and buildings/causal were
not delivered. No accepted lever was relabelled from component-only evidence.

## Archived building audit

The preregistration at `861a97a` predates this offline outcome inspection.
`baselines/integration-building-audit.json` audits the original gzip archive,
verifies its uncompressed hash and does not render or tune.

For measured-only/on/ground/stationary/single-source core cells, each
environment has five sites/five runs. Open and mixed have 100% within 10 m
[100, 100]; dense urban has 80% [40, 100]. Scene coverage is 100% [100, 100]
for all three. Nominal blocked direct rays are 0/25, 0/25 and 4/25.
Building propagation effects were enabled; mostly visible, fixed-design
matrix sites are not comparable to round two's descriptive 31-versus-nine
subgroups. The earlier "buildings halve coverage" wording is not a causal
estimate. Coarse/degenerate five-site intervals must not imply certainty.

## Validation and timing

`baselines/integration-gate-final.json` passed: 307 core tests, 11 standalone
cue tests, 44 app tests, production build, baseline rescore, 16-run smoke with
zero tracked regressions and zero complete-inference changes. The dense-urban
grouping addition also passed its four focused KPI tests. All three browser
tests passed, including live real registry values and the offline export.
Compressed logs are retained alongside the gate evidence.

Recorded final local wall times: core 202.94 s, cue tests 2.63 s, app 1.66 s,
build 5.91 s and smoke 63.03 s. Recorded eight-run inference sums were
38.507 s for LE-0 and 37.032 s for LE-1; these are not remote shard estimates.

The last verified GitHub regression before this report was successful run
42313367287 for `297c339a8b6fe33d2054f7fb7c4dc737dc40521d`.
It does not prove the final commit passed. Final code and documentation
revisions must have their actual run read; the handoff will record the code
receipt after that verification.

## Unfinished, in priority order

1. **MUST** Publish the sharded workflow on default through normal review.
   Dispatch currently returns HTTP 404. T8 has not edited workflows.
2. **MUST** Finish measured candidate/association and cue interfaces plus honest
   uncertainty calibration; execute full paired train/validation acceptance.
3. **MUST** Implement/audit committed single-attempt sealed controls, select
   and freeze an accepted engine, make the separate default decision and run
   the one allowed sealed attempt on distinct algorithms.
4. **MUST** Measure remote throughput, register disjoint fresh final jobs and
   execute L1-L5 within the recorded budget; complete L6 on actual outputs.
5. **MUST** Update final KPI/frontier/attribution claims only from those data.
6. **OPTIONAL** Integrate buildings/causal if later delivered under a new
   preregistered round.

`suite-plan.md`, `registry.json` and `baselines/extreme/manifest.json` record
the blocked state and every layer cut. Ordinary tests are not a stand-in final
exam. This is not a step-5 resume checkpoint. No question was required to
choose the conservative, truth-free interpretation.
