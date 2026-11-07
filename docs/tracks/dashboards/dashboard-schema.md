# Dashboard schema mapping (pre-kpi-schema phase)

Until `engines/kpi-schema.json` and `engines/<id>/kpi.json` exist on `origin/overnight/loc5-infra`, T7 reads LE-0 from `baselines/matrix-baseline-r3.json` and maps fields into dashboard blocks.

## Source files

- `baselines/matrix-baseline-r3.json`
- `docs/targets.json` (placeholder tier bounds for colouring)

## Mapping

- **Engine metadata**
  - `id`: fixed `LE-0`
  - `status`: fixed `baseline`
  - `source_hash`: `producer.code_version`
  - `refs`: `{ baseline: "baselines/matrix-baseline-r3.json" }`

- **Headline KPIs (per install profile)**
  - Aggregated as weighted means over cell rows of matching profile (`results` key suffix: `off`, `on`, `surveyed`), weighted by `metric.n_runs`.
  - Metrics shown: `events_within_10m_misses_counted`, `horizontal_p90_m`, `horizontal_median_m`, `scene_fix_rate`, `source_fix_rate`, `unflagged_wrong_fix_rate`, `within_1sigma`, `within_2sigma`, `error_3d_median_m`, `track_median_error_m`, `track_continuity`, `time_to_fix_s`.
  - Missing/empty values map to `null` and render as **not measured**.

- **24-cell matrix heatmap**
  - `cells[*].factors` and `cells[*].results[split/profile/mode].metrics.events_within_10m_misses_counted`
  - Site/runs from metric metadata (`n_sites`, `n_runs`)
  - Insufficient marker when `n_sites < 5` or result status is `insufficient`

- **Source-count split**
  - Group by `cells[*].factors.simultaneous_sources` (1 vs 3) within selected profile.
  - Aggregated metrics: `events_within_10m_misses_counted`, `horizontal_median_m`, `horizontal_p90_m`.

- **Node-count curve**
  - `node_density[*]` mapped directly.
  - Metrics: `events_within_10m_misses_counted`, `scene_fix_rate`, `source_fix_rate`.

- **Install-profile comparison**
  - Aggregated per profile across cells.
  - Metrics: `events_within_10m_misses_counted`, `horizontal_median_m`, `unflagged_wrong_fix_rate`.

- **Detectable subsets**
  - Aggregated per profile:
    - `detectable_3_node_fraction`
    - `detectable_3_node_events_within_10m`

- **Building vs open**
  - `open`: rows where `factors.environment === "open"`
  - `building`: rows where `factors.environment !== "open"`
  - Metric shown for both buckets: `events_within_10m_misses_counted`.

- **Tracking KPIs**
  - Aggregated per profile:
    - `track_median_error_m`
    - `track_continuity`
    - `time_to_fix_s`

- **Integrity strip**
  - `population`: `population`
  - `input hash`: `input_sha256`
  - `sealed input hash`: `sealed_input_sha256`
  - `sealed set run`: fixed `false` for LE-0 baseline adapter

## Switch plan when kpi schema lands

When `engines/kpi-schema.json` and `engines/<id>/kpi.json` are available, dashboard reader should prefer engine KPI files and keep baseline adapter only as fallback.
