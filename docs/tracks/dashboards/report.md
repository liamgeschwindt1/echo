# T7 dashboards report

## Scope and assumptions

- Track-only execution on branch `dashboards/1` from base commit `ff75074`.
- Time-plan assumption: 10-hour session budget from track instructions; last 90 minutes reserved for handoff outputs.
- No solver, renderer, scoring, workflow, or schema-version edits.

## Landed work

Commit: `b5bb619`

1. Added a new **Dashboards** workspace in the simulator app nav and panel routing.
2. Implemented **Engines** dashboard page with:
   - Engine selector dropdown from registry order.
   - Back/forward buttons and ArrowLeft/ArrowRight history navigation.
   - URL hash persistence via `#engine=<id>`.
   - Engine metadata strip (id, parent, date, status, source hash, option set, refs path).
   - KPI body blocks: headline KPIs, matrix heatmap by install profile, source-count split, node-count curve, install-profile comparison, detectable subsets, building/open split, tracking KPIs, failure-attribution placeholder.
   - Comparison toggle: none / previous engine / LE-0 with explicit arrow + text deltas.
   - Integrity strip including population/sample metadata, sealed-set state, and input hashes.
   - Null-safe rendering as **not measured**.
   - Synthetic-data banner and placeholder targets note.
3. Added menu entries for deferred areas with explicit **later** notes:
   - Labelling
   - Event detection and false alarms
   - Digital twin
   - Hardware and arrays
   - System
4. Added baseline adapter path for pre-schema phase:
   - Reads `baselines/matrix-baseline-r3.json` when engine registry/KPI files are absent.
   - Mapping written in `docs/tracks/dashboards/dashboard-schema.md`.
5. Added standalone offline export:
   - Script: `apps/sim/scripts/export-engines-dashboard.mjs`
   - Output generated: `docs/tracks/dashboards/engines-dashboard.html`
6. Added tests:
   - Unit: `apps/sim/test/dashboards.test.js`
   - E2E: `apps/sim/e2e/dashboards.test.mjs` with fixture engines under `apps/sim/e2e/fixtures/engines-fixtures.mjs`
7. Added screenshot artifact:
   - `docs/tracks/dashboards/engines-page.png`

## Rejected or reverted

- None.

## Validation run

- `npm run test -w @echo/sim` ✅
- `node --test --test-timeout=600000 apps/sim/e2e/dashboards.test.mjs` ✅
- `npm run build -w @echo/sim` ✅

## Headline metrics vs 3A baseline (LE-0, mapped profile=on)

- Events within 10 m (misses counted): **0.5194**
- Median horizontal error (m): **11.2064**
- P90 horizontal error (m): **23.2834**
- Scene fix rate: **0.7917**
- Source fix rate: **0.6611**
- Unflagged wrong-fix rate: **0**

UI changes do not alter these values; dashboard reads and displays baseline-derived KPIs.
