# Engine registry and KPI flow (T1)

## Files

- `engines/registry.json`: ordered list of engines (`id`, `parent`, `date`, `status`, `branch`, `source_hash`).
- `engines/<id>/engine.json`: frozen engine metadata and option set.
- `engines/<id>/kpi.json`: KPI sheet matching `engines/kpi-schema.json`.
- `engines/<id>/refs.json`: report paths and hashes used to build KPI.
- `scripts/engine-kpi.mjs`: writes all three engine files and updates registry.

## Add an engine

```bash
node scripts/engine-kpi.mjs \
  --engine-id LE-<n> \
  --parent-id LE-<n-1> \
  --status candidate \
  --branch <branch> \
  --source-hash <code-hash> \
  --option-set '{"measured_fusion_mode":"joint"}' \
  --report <benchmark-report.json> \
  --report <matrix-summary.json>
```

Notes:

- Reports may include `.json` and `.json.gz`.
- If both current and baseline engines include benchmark run-level reports, paired site-clustered delta intervals are computed for headline metrics.
- Missing metrics remain `null`.

## Dashboard read contract

Dashboard reads:

1. `engines/registry.json` to enumerate engine IDs.
2. `engines/<id>/kpi.json` for headline, breakdowns and comparisons.
3. `engines/<id>/engine.json` for option labels and status.
4. `engines/<id>/refs.json` for provenance links.

`kpi.json` keeps additive sections; consumers should ignore unknown keys.
