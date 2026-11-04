import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BUILTIN_ARRAYS } from '../packages/sim-core/src/arrays.js';
import { idealHardwareBudget } from './lib/hardware-budget.mjs';

const root = new URL('../', import.meta.url), sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const path = new URL('docs/experiments/round2-hardware-budget.json', root);
if (process.argv[2] === 'register') {
  const bytes = await readFile(new URL('docs/targets.json', root)), targets = JSON.parse(bytes);
  await writeFile(path, JSON.stringify({
    kind: 'deterministic-ideal-error-budget-preregistration', targets, targets_sha256: sha(bytes),
    variables: { range_m: targets.max_reference_range_m, median_m: targets.metrics.horizontal_median_m.max,
      p90_m: targets.metrics.horizontal_p90_m.max, temperature_c: 20,
      azimuths_deg: Array.from({ length: 360 }, (_, i) => i) },
    arrays: BUILTIN_ARRAYS.map((a) => ({ id: a.id, mics_mm: Object.values(a.mics) })),
    seeds: [], renders: 0,
    method: 'Deterministic geometry only, not a rendering/detection experiment. Two independent orthogonal horizontal bearings at equal50m range. Zero-mean Gaussian equal angular errors and linearised intersection: radial median=R*sigma*sqrt(2ln2),p90=R*sigma*sqrt(2ln10). Invert both targets, take smaller angular sigma. Reuse existing bearingError at1us independent mic timing noise for every integer azimuth0..359deg/elevation0. Worst sampled error sets full-budget per-mic delay ceiling; equivalent independent isotropic mic-position sigma=c*delay. Heading gets full angular budget. Each ceiling separately consumes all variance; no other errors, bias, multipath, housing, aliasing, missing detections or confidence failures. No self-noise or inter-node sync requirement is identifiable. Not an operational hardware specification or hardware ranking.'
  }, null, 2) + '\n', { flag: 'wx' });
  console.log('Registered all9 exact geometries and360 directions each; no budget results calculated.');
} else if (process.argv[2] === 'analyse') {
  const bytes = await readFile(path), registration = JSON.parse(bytes);
  if (registration.arrays.length !== 9) throw new Error('Expected all nine registered geometries');
  const rows = registration.arrays.map((a) => ({ array: a.id, ...idealHardwareBudget(a.mics_mm, registration.variables) }));
  await writeFile(new URL('baselines/round2-hardware-budget.json', root), JSON.stringify({
    kind: 'echo-ideal-hardware-budget', schema: 1, complete: true, registration_sha256: sha(bytes), registration, rows,
    status: 'Analytic, simulated assumptions only. These are optimistic component-only ceilings, not derived sufficient hardware requirements. Coverage/useful/confidence targets remain unproven.'
  }, null, 2) + '\n');
  console.log('Complete9-array/3240-direction ideal calculation; no hardware winner or empirical tolerance.');
} else throw new Error('Usage: node scripts/hardware-budget.mjs register|analyse');
