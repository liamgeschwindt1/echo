import { randomBytes, createHash } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { randomScene, SCENES } from '../packages/sim-core/src/benchmark/scenes.js';
import { canonical } from '../packages/sim-core/src/benchmark/cache.js';

const root = new URL('../', import.meta.url);
const target = new URL('docs/experiments/round2-sealed.json', root);
try {
  await access(target);
  throw new Error('Round-two preregistration already exists; never regenerate sealed inputs');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const seeds = new Set();
const fresh = () => {
  let seed;
  do { seed = randomBytes(4).readUInt32LE() | 0x80000000; seed >>>= 0; } while (seeds.has(seed));
  seeds.add(seed);
  return seed;
};
const sites = Array.from({ length: 40 }, (_, i) => {
  const site_seed = fresh();
  return { id: `sealed2_${String(i + 1).padStart(2, '0')}`, site_seed, scene: randomScene(site_seed) };
});
const renderSeed = fresh();
const common = {
  mode: 'grid', sweeps: [], analysis_modes: ['measured_only'], realism: ['off', 'on'],
  wrong_fix_m: 10, bootstrap_samples: 1000, permutation_samples: 4000, max_runs: 2000
};
const sealed = {
  ...common, name: 'Round 2 sealed test: baseline and frozen final', sealed: true,
  scenes: sites.map((s) => s.id), seeds: [renderSeed], held_out_seeds: [],
  scene_splits: Object.fromEntries(sites.map((s) => [s.id, 'test'])),
  custom_scenes: Object.fromEntries(sites.map((s) => [s.id, s.scene])),
  mode: 'paired', configs: [
    { name: 'Round 1 measured baseline', settings: { measured_confidence_mode: 'legacy' } },
    { name: 'Frozen round 2 candidate', settings: { measured_confidence_mode: 'calibrated' } }
  ],
  preregistration: {
    created_at: new Date().toISOString(), site_seeds: sites.map(({ id, site_seed }) => ({ id, site_seed })),
    rule: 'Run once at the end. Failed/interrupted attempts consume the seal. No tuning on test. Explicit override must include a reason.',
    input_sha256: createHash('sha256').update(canonical({ sites, renderSeed })).digest('hex'),
    population: '40 independently generated new sites; one new render seed; both realism profiles; identical populations for both frozen algorithms',
    caveat: 'Random simulator sites, not real-world validation; repeated realism/algorithm conditions share site geometry.'
  }
};
await writeFile(target, JSON.stringify(sealed, null, 2) + '\n');
const evaluation = {
  ...common, name: 'Round 2 fixed train and validation population', scenes: SCENES.map((s) => s.id),
  seeds: [1, 2, 101], held_out_seeds: [101],
  scene_splits: Object.fromEntries(SCENES.filter((s) => s.split === 'held-out').map((s) => [s.id, 'validation'])),
  preregistration: {
    created_at: new Date().toISOString(), reference: 'baselines/final-1.json',
    training: 'Round-one train scene AND seed 1 or 2 (68 measured runs including realism).',
    validation: 'Any round-one held-out scene OR seed 101 (82 measured runs including realism).',
    model: 'Standardised L2 logistic regression, deterministic gradient descent; train-only site cross-fitting for conformal residual calibration. No validation threshold search.',
    acceptance: 'Rule 4, every train/validation x off/on partition: coverage loss <=0.02; silent-wrong/scene no increase; 1/2 sigma distance from nominal no worse; paired median/p90/risk-area CI strictly better or every inference and score equal.',
    candidates: ['calibrated confidence only', 'weighted forward consensus', 'predictive leave-one-out', 'realism-scaled uncertainty'],
    ranking: 'No ranking from partial or unequal populations; useful scene rate is primary coverage-adjusted endpoint.'
  }
};
await writeFile(new URL('docs/experiments/round2-evaluation.json', root), JSON.stringify(evaluation, null, 2) + '\n');
console.log(`Sealed input SHA-256: ${sealed.preregistration.input_sha256}; 40 new sites, ${sealed.seeds[0]} render seed.`);
