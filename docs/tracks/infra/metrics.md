# Metrics contract (T1 additive)

All metrics are simulator outputs for localisation/tracking only.

## Metric object shape

Each KPI value uses:

```json
{
  "value": 0.0,
  "interval95": [0.0, 0.0],
  "n_sites": 0,
  "n_runs": 0,
  "unit": "fraction|m|deg|s|count|events|score|nats|null"
}
```

Rules:

- `value: null` means unavailable. Never encode unavailable as `0`.
- `interval95` is site-clustered when source report has per-site support; otherwise `null`.
- `n_sites`/`n_runs` carry the support count for the metric block.

## Headline JSON names

- `events_within_10m_misses_counted`
- `horizontal_p90_m`
- `horizontal_median_m`
- `scene_fix_rate`
- `source_fix_rate`
- `unflagged_wrong_fix_rate`
- `within_1sigma`
- `within_2sigma`
- `error_3d_p90_m`
- `aerial_3d_fix_rate`
- `aerial_height_error_m`
- `track_median_error_m`
- `track_continuity`
- `time_to_fix_s`
- `id_switches`
- `detectable_3_node_fraction`
- `detectable_3_node_events_within_10m`
- `detectable_3_node_event_count`

## Comparison JSON names

In `comparisons.vs_parent.metrics.*` and `comparisons.vs_le0.metrics.*`:

```json
{
  "delta": 0.0,
  "interval95": [0.0, 0.0],
  "n_sites": 0,
  "n_runs": 0,
  "unit": "..."
}
```

Delta is `current - baseline` for same metric name.
