import { mulberry32 } from '../rng.js';
import { SCENES, DEFAULT_SEEDS, HELD_OUT_SEEDS, REALISM } from './scenes.js';
import { VARIABLES, VARIABLE_MAP, applyValues } from './variables.js';

export const BENCHMARK_DEFAULTS = Object.freeze({
  max_runs: 2000, samples: 20, bootstrap_samples: 500, confidence: 0.95,
  wrong_fix_m: 10, estimated_run_ms: 5000, permutation_samples: 2000, held_out_fraction: 0.3
});
export const BENCHMARK_MODES = ['one-at-a-time', 'grid', 'random', 'latin-hypercube', 'paired'];
export const PRESETS = Object.freeze({
  'Hardware error robustness': { variables: ['heading_error_sigma_deg', 'mic_gain_sigma_db', 'mic_position_sigma_mm', 'noise_correlation'], mode: 'one-at-a-time' },
  'Array ranking': { variables: ['mic_array'], mode: 'grid' },
  'Detection range vs noise': { variables: ['range_m', 'noise_floor_db_spl'], mode: 'grid' },
  'Noise and environment sensitivity': { variables: ['noise_floor_db_spl', 'mic_self_noise_db_spl', 'temperature_c', 'humidity_pct', 'ground_reflectivity'], mode: 'one-at-a-time' },
  'Threshold tuning': { variables: ['min_snr_db', 'fix_min_crossing_deg', 'fix_inlier_gate_sigma', 'track_gate_sigma', 'track_gate_min_deg', 'window_policy', 'onset_window_ms'], mode: 'one-at-a-time' },
  'Node count and spacing': { variables: ['node_count', 'node_spacing_m'], mode: 'grid' },
  'Overlapping sources': { variables: ['source_count', 'level_difference_db'], mode: 'grid' },
  'Realism on vs off': { variables: [], mode: 'paired' },
  'Full regression (compare with baseline)': { variables: [], mode: 'grid' }
});

export function presetExperiment(name = 'Full regression (compare with baseline)') {
  if (name === 'baseline') name = 'Full regression (compare with baseline)';
  if (name === 'smoke') return {
    name, scenes: ['sparse_20', 'random_1'], seeds: [1, 101], sweeps: [], mode: 'grid',
    realism: ['off', 'on'], analysis_modes: ['truth_assisted', 'measured_only']
  };
  const preset = PRESETS[name];
  if (!preset) throw new Error(`Unknown experiment preset: ${name}`);
  return {
    name, scenes: SCENES.map((s) => s.id), seeds: DEFAULT_SEEDS, base_settings: {}, mode: preset.mode,
    sweeps: preset.variables.map((id) => ({ variable: id, values: VARIABLE_MAP.get(id).values, group: VARIABLE_MAP.get(id).group })),
    realism: ['off', 'on'], analysis_modes: ['measured_only', 'truth_assisted'],
    ...(preset.mode === 'paired' ? { configs: [{ name: 'off', settings: REALISM.off }, { name: 'on', settings: REALISM.on }], realism: ['custom'] } : {})
  };
}

export function sweepValues(sweep) {
  const variable = VARIABLE_MAP.get(sweep.variable);
  if (!variable) throw new Error(`Unknown variable: ${sweep.variable}`);
  let values = sweep.values;
  if (sweep.range) {
    const { min, max, steps } = sweep.range;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || !Number.isInteger(steps) || steps < 1 || steps > 10000) throw new Error(`Invalid range for ${sweep.variable}`);
    values = Array.from({ length: steps }, (_, i) => min + (max - min) * i / Math.max(1, steps - 1));
  }
  if (!Array.isArray(values) || !values.length || values.some((v) => v === null || (typeof v !== 'string' && !Number.isFinite(v)))) throw new Error(`No valid values for ${sweep.variable}`);
  if (variable.values.every((v) => typeof v === 'string') && sweep.variable !== 'mic_array' && values.some((v) => !variable.values.includes(v))) throw new Error(`Unsupported value for ${sweep.variable}`);
  if (['node_count', 'source_count'].includes(sweep.variable) && values.some((v) => !Number.isInteger(v) || v < 1 || v > 64)) throw new Error(`Invalid count for ${sweep.variable}`);
  if (['noise_correlation', 'ground_reflectivity', 'building_density'].includes(sweep.variable) && values.some((v) => v < 0 || v > 1)) throw new Error(`Invalid fraction for ${sweep.variable}`);
  return [...new Set(values)];
}

function configCount(e, sweeps) {
  if (e.mode === 'paired') return 2;
  if (e.mode === 'one-at-a-time') return 1 + sweeps.reduce((s, v) => s + v.values.length, 0);
  if (e.mode === 'random' || e.mode === 'latin-hypercube') return e.samples;
  return sweeps.reduce((s, v) => s * v.values.length, 1);
}

function modeRunCount(e) {
  const modes = (values, settings) => values?.analysis_mode || settings?.analysis_mode ? 1 : e.analysis_modes.length;
  const baseModes = modes(e.base_values, e.base_settings);
  if (e.mode === 'paired') return e.configs.reduce((sum, c) => sum + modes(c.values ?? e.base_values, { ...e.base_settings, ...c.settings }), 0);
  if (e.mode === 'one-at-a-time') return baseModes + e.sweeps.reduce((sum, s) => sum + s.values.length * (s.variable === 'analysis_mode' ? 1 : baseModes), 0);
  return configCount(e, e.sweeps) * (e.sweeps.some((s) => s.variable === 'analysis_mode') ? 1 : baseModes);
}

export function normaliseExperiment(input) {
  if (!input || typeof input !== 'object') throw new Error('Experiment must be an object');
  const e = { ...BENCHMARK_DEFAULTS, sweeps: [], base_settings: {}, mode: 'one-at-a-time', realism: ['off', 'on'], analysis_modes: ['measured_only'], ...structuredClone(input) };
  if (!BENCHMARK_MODES.includes(e.mode)) throw new Error(`Unsupported mode: ${e.mode}`);
  if (!Array.isArray(e.scenes) || !e.scenes.length || e.scenes.some((id) => !SCENES.some((s) => s.id === id) && !e.custom_scenes?.[id])) throw new Error('Pick valid benchmark scenes');
  if (new Set(e.scenes).size !== e.scenes.length) throw new Error('Scene IDs must be unique');
  if (e.scene_splits && Object.entries(e.scene_splits).some(([id, split]) => !e.scenes.includes(id) || !['train', 'validation', 'test'].includes(split))) throw new Error('Invalid scene split');
  for (const k of ['max_runs', 'samples', 'bootstrap_samples', 'permutation_samples']) if (!Number.isInteger(e[k]) || e[k] < 1) throw new Error(`${k} must be a positive integer`);
  if (!(e.held_out_fraction >= 0.3 && e.held_out_fraction < 1)) throw new Error('held_out_fraction must be at least 0.3 and below 1');
  if (e.held_out_seeds !== undefined && (!Array.isArray(e.held_out_seeds) || e.held_out_seeds.some((s) => !Number.isSafeInteger(s) || s < 0 || s > 0xffffffff) || new Set(e.held_out_seeds).size !== e.held_out_seeds.length)) throw new Error('Held-out seeds must be unique unsigned integers');
  if (Number.isInteger(e.seeds)) {
    if (e.seeds < 1 || e.seeds > e.max_runs) throw new Error(`Seed count must be between 1 and run cap ${e.max_runs}; reduce seeds first`);
    const held = e.seeds >= 2 ? Math.ceil(e.seeds * e.held_out_fraction) : 0;
    e.held_out_seeds = Array.from({ length: held }, (_, i) => 101 + i);
    const reserved = new Set(e.held_out_seeds), training = [];
    for (let seed = 1; training.length < e.seeds - held; seed++) if (!reserved.has(seed)) training.push(seed);
    e.seeds = [...training, ...e.held_out_seeds];
  }
  if (!Array.isArray(e.seeds) || !e.seeds.length || e.seeds.some((s) => !Number.isSafeInteger(s) || s < 0 || s > 0xffffffff) || new Set(e.seeds).size !== e.seeds.length) throw new Error('Seeds must be unique unsigned integers');
  if (!(e.confidence > 0 && e.confidence < 1) || !(e.wrong_fix_m > 0)) throw new Error('Invalid confidence or error target');
  if (!Array.isArray(e.realism) || !e.realism.length || e.realism.some((m) => !['off', 'on', 'custom'].includes(m))) throw new Error('Invalid realism modes');
  if (!Array.isArray(e.analysis_modes) || !e.analysis_modes.length || e.analysis_modes.some((m) => !['truth_assisted', 'measured_only'].includes(m))) throw new Error('Invalid analysis modes');
  if (e.mode === 'paired' && (!e.configs || e.configs.length !== 2)) throw new Error('Paired mode needs exactly two configs');
  e.sweeps = e.sweeps.map((v) => ({ ...v, values: sweepValues(v) }));
  if (new Set(e.sweeps.map((s) => s.variable)).size !== e.sweeps.length) throw new Error('Sweep variables must be unique');
  // Keep requested values: a registry default is not necessarily this scene's or realism state's base.
  e.estimated_runs = modeRunCount(e) * e.scenes.length * e.seeds.length * e.realism.length;
  if (!Number.isSafeInteger(e.estimated_runs)) throw new Error('Run count exceeds safe integer range');
  return e;
}

export function estimateExperiment(input, runMs) {
  const e = normaliseExperiment(input);
  return { runs: e.estimated_runs, milliseconds: e.estimated_runs * (runMs ?? e.estimated_run_ms), above_cap: e.estimated_runs > e.max_runs, cap: e.max_runs };
}

export function buildConfigs(e) {
  const base = e.base_values ?? {};
  let values;
  if (e.mode === 'paired') return e.configs.map((c, i) => ({ id: `c${i}`, name: c.name ?? `Config ${i + 1}`, values: c.values ?? base, settings: { ...e.base_settings, ...c.settings }, group: 'A/B' }));
  if (e.mode === 'one-at-a-time') values = [{ values: base, group: 'base' }, ...e.sweeps.flatMap((s) => s.values.map((v) => ({ values: { ...base, [s.variable]: v }, group: s.variable })))];
  else if (e.mode === 'grid') {
    values = [{ values: base, group: 'grid' }];
    for (const s of e.sweeps) values = values.flatMap((c) => s.values.map((v) => ({ values: { ...c.values, [s.variable]: v }, group: 'grid' })));
  } else {
    const rng = mulberry32(e.sample_seed ?? 20261104);
    const permutations = e.sweeps.map(() => {
      const a = Array.from({ length: e.samples }, (_, i) => i);
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    });
    values = Array.from({ length: e.samples }, (_, i) => ({
      group: e.mode, values: { ...base, ...Object.fromEntries(e.sweeps.map((s, j) => {
        const u = e.mode === 'latin-hypercube' ? (permutations[j][i] + rng()) / e.samples : rng();
        return [s.variable, s.values[Math.min(s.values.length - 1, Math.floor(u * s.values.length))]];
      })) }
    }));
  }
  return values.map((c, i) => ({ ...c, id: `c${i}`, name: c.group === 'base' ? 'Base' : Object.entries(c.values).map(([k, v]) => `${k}=${v}`).join(', ') || 'Base', settings: e.base_settings }));
}

export function buildJobs(input, { allowAboveCap = false } = {}) {
  const e = normaliseExperiment(input);
  if (e.estimated_runs > e.max_runs && !allowAboveCap) throw new Error(`${e.estimated_runs} runs exceeds cap ${e.max_runs}; reduce samples or values`);
  const configs = buildConfigs(e);
  const jobs = [];
  for (const config of configs) for (const scene of e.scenes) for (const seed of e.seeds) for (const realism of e.realism) for (const analysis_mode of config.values.analysis_mode || config.settings.analysis_mode ? [config.values.analysis_mode ?? config.settings.analysis_mode] : e.analysis_modes) {
    jobs.push({
      id: `${config.id}:${scene}:${seed}:${realism}:${analysis_mode}`, config, scene, seed, realism,
      analysis_mode: config.values.analysis_mode ?? config.settings.analysis_mode ?? analysis_mode,
      split: e.scene_splits?.[scene] === 'test' ? 'test'
        : e.scene_splits?.[scene] === 'validation' || (e.scene_splits && (e.held_out_seeds ?? HELD_OUT_SEEDS).includes(seed)) ? 'validation'
          : e.scene_splits?.[scene] ?? (SCENES.find((s) => s.id === scene)?.split === 'held-out' || (e.held_out_seeds ?? HELD_OUT_SEEDS).includes(seed) ? 'held-out' : 'train')
    });
  }
  return { experiment: e, configs, jobs };
}

function fewerSeeds(e) {
  if (e.seeds.length < 2) return null;
  const heldIds = new Set(e.held_out_seeds ?? HELD_OUT_SEEDS);
  const held = e.seeds.filter((s) => heldIds.has(s));
  const train = e.seeds.filter((s) => !heldIds.has(s));
  const target = Math.ceil(e.seeds.length / 2);
  if (!held.length || !train.length) return e.seeds.slice(0, target);
  for (let count = Math.max(2, target); count < e.seeds.length; count++) {
    const heldCount = Math.ceil(count * e.held_out_fraction);
    const trainCount = count - heldCount;
    if (trainCount < 1 || heldCount > held.length || trainCount > train.length) continue;
    const keep = new Set([...train.slice(0, trainCount), ...held.slice(0, heldCount)]);
    return e.seeds.filter((s) => keep.has(s));
  }
  return null;
}

export function reduceExperiment(input) {
  const e = normaliseExperiment(input);
  while (e.estimated_runs > e.max_runs) {
    const largest = [...e.sweeps].sort((a, b) => b.values.length - a.values.length)[0];
    const seeds = fewerSeeds(e);
    if (['random', 'latin-hypercube'].includes(e.mode) && e.samples > 1) e.samples = Math.max(1, Math.floor(e.samples / 2));
    else if (seeds) e.seeds = seeds;
    else if (largest?.values.length > 1) {
      largest.values = largest.values.filter((_, i) => i % 2 === 0);
      delete largest.range;
    } else throw new Error('Cannot fit cap while preserving seed partitions; pick fewer scenes/modes or increase cap');
    e.estimated_runs = modeRunCount(e) * e.scenes.length * e.seeds.length * e.realism.length;
  }
  return e;
}

export function scenarioForJob(scene, job, arrays) {
  return applyValues({ ...scene, settings: { ...scene.settings, ...REALISM[job.realism], ...job.config.settings, seed: job.seed, analysis_mode: job.analysis_mode } }, job.config.values, arrays);
}

export const BENCHMARK_THRESHOLDS = Object.fromEntries(Object.entries(BENCHMARK_DEFAULTS).map(([k, value]) => [k, { value, placeholder: true }]));
export { VARIABLES };
