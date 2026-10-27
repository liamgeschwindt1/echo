// Scenario A heading-error sweep: fix error vs heading sigma. SIMULATED only; diffraction model unvalidated.
// Usage: node scripts/sim-heading-sweep.mjs [--seeds 50] [--label heading-before]
import { writeFileSync } from 'node:fs';
import { runOne, quantile } from '../test/suite-lib.js';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const seeds = Number(arg('seeds', 50));
const label = arg('label', 'heading-sweep');
const rows = [];
for (const sigma of [0, 0.5, 1, 2.5, 5]) {
  const recs = [];
  for (let s = 1; s <= seeds; s++) recs.push(...(await runOne('A', s, { settings: { heading_error_sigma_deg: sigma } })));
  const errs = recs.map((r) => r.error_m).filter((v) => v != null);
  const row = {
    heading_sigma_deg: sigma,
    n: recs.length,
    localised_frac: recs.filter((r) => r.localised).length / recs.length,
    error_m_median: quantile(errs, 0.5),
    error_m_p90: quantile(errs, 0.9),
    wrong_but_reliable_rate: recs.filter((r) => r.wrong_but_reliable).length / recs.length
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(new URL(`../docs/suite/${label}.json`, import.meta.url), JSON.stringify({ label, simulated_only: true, rows }, null, 1));
