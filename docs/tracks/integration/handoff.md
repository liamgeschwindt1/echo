# T8 handoff

## State

Branch: `overnight/loc5-integration`. Base:
`ff75074dca26a633b0aadae1a81a674db728030d`.
Last pushed checkpoint before these reporting changes: `861a97a`.
Resolve the final tip from this branch's log; no selected/frozen commit exists.
Engine source-content hash:
`d1eb705837c420b40a65dec187e39194ea52f374ebc18cdf7026e7134e4f2461`.

Five delivered tracks merged; buildings/causal not delivered. LE-0 remains
default; LE-1 is rejected for promotion after zero applied calibrations in
eight diagnostic runs. No new positioning default. No matrix sealed attempt
or final-suite job has run. Do **not** use "RESUME T8 FROM STEP 5": its frozen
checkpoint prerequisite is absent.

## What landed

Merge commits: infra `98b8765`, cues `2556f36`, multisource `adb2ece`, fusion
`86442ce`, dashboards `7e14c47`. Integration fixes: paired KPI bootstrap
`3e12301`, sealed fail-closed entrypoints `85a916f`, exact legacy default
restoration `a280c1e`, actual registry/dashboard assets and schema 0.19
`7de1d1e`, diagnostic results `23125a2`, dense-urban grouping/preregistration
`861a97a`. The final report/evidence commit follows that checkpoint.

The two merge conflict resolutions retained all weather/rotor paths and both
multisource/fusion extensions. Failed fusion-default evidence remains in
`baselines/integration-gate-fusion*`; corrected evidence is `fusion-fixed*`.
No signal golden was changed. Full details: `report.md`.

## Merge-readiness checklist

- Full local final gate passed: core 307, cues 11, app 44, build and 16-run
  smoke; zero tracked regressions and zero serialized inference changes.
  Dense-urban KPI tests also passed. All three browser tests passed.
- Default output preserved against fresh base; schema metadata intentionally
  changes once, 0.18 to 0.19. Original signal goldens untouched.
- Existing shared-file changes and counts are listed in `file-touches.tsv`
  (net from base, including delivered work; this inventory excludes itself).
- New behaviour stays opt-in: `ms_*` off; rotor off; `cue_weather_*` zero;
  heading self-calibration zero; `measured_fusion_mode=legacy`.
  Joint/likelihood remain alternatives, not promoted defaults.
- Claims/SIM fragments are consolidated with explicit limits in shared docs.
  Missing observations are never replaced with simulator truth.
- Last previously verified GitHub run: 42313367287, success, source
  `297c339a8b6fe33d2054f7fb7c4dc737dc40521d`. Final code receipt pending at
  this report checkpoint; do not infer a final pass from the older run.
- **Not acceptance-ready:** measured wire-up and official validation
  incomplete; sealed controls/workflow publication incomplete.

## Registration hashes (SHA-256)

| File under `docs/tracks/integration/` | Hash |
|---|---|
| `selection-rule.md` | `40a95489371052001aba04610c2a7d47953d2019e02940f5912a45fc0618bddd` |
| `prereg/default-gates.json` | `56b7092fd30905589d42b2ad2dfdbcb8bb60ef976c61416eb42d169145ed1450` |
| `prereg/round-1.json` | `3815b05e369dbc86d23138c6357ebff7eed617cbc542b945f67101cc88054206` |
| `prereg/round-1-le0-smoke.json` | `68866fb6ad146587f9173fffc41d3c31233dbf932d22bcfc06ab75cb922238aa` |
| `prereg/round-1-le1-smoke.json` | `2200c9e55c7be1adeb597b9d6d3c7503b183306154b4064632e33be3b1bf8ed1` |
| `prereg/building-audit.json` | `16342e3464466228861c5ee622277e960e4cc34b623140350b6b5477501d14d1` |

## Resume priorities

1. **MUST** Publish sharded workflow through normal review; respect no main
   pushes/no T8 workflow edits. Dispatch returned HTTP 404.
2. **MUST** Complete honest measured interfaces and uncertainty calibration,
   then official train/validation candidate acceptance under the fixed rule.
3. **MUST** Audit sealed ledger/freeze/retry/second-attempt controls before
   lifting fail-closed guards; select/freeze/default decision and sealed run.
4. **MUST** Run remote throughput calibration and preregister disjoint fresh
   final jobs; resume only incomplete registered jobs after a genuine freeze.
5. **MUST** Generate final suite KPIs, intervals, attribution and frontiers
   from real outputs. Current final registry has zero registered jobs.
6. **OPTIONAL** New rounds for absent buildings/causal deliveries.

Historical LE-0 headline versus the 3A archive is unchanged; the eight-run
LE-1 diagnostic is not that population and has null cross-history deltas.
See `docs/localisation-conclusion.md` for the actual matched table.

Open owner actions are the prerequisites above, not unanswered design choices.
No field/hardware claim is allowed. All unavailable sealed/final results,
tiers, 3D fixes, frontiers and disjointness evidence remain null.
