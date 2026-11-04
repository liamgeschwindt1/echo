import { analyseScenario } from '../analyse.js';
import { analyseMeasured, MEASURED_DEFAULTS } from '../measured.js';
import { renderScenario } from '../render.js';
import { renderLengthS, validateScenario } from '../scenario.js';
import { speedOfSound } from '../physics.js';
import { EXPORT_SCHEMA } from '../export.js';
import { buildScene } from './scenes.js';
import { scenarioForJob, buildJobs, BENCHMARK_DEFAULTS } from './experiment.js';
import { cacheKeys, audioHash } from './cache.js';
import { scoreAssisted, scoreMeasured } from './score.js';
import { summariseRuns, failureAtlas, rankingFlips, pairedComparison, detectionByRange } from './metrics.js';

export function measuredOptions(settings) {
  return Object.fromEntries(Object.entries(MEASURED_DEFAULTS).map(([k, value]) => [k, settings[`measured_${k}`] ?? value]));
}

export async function runJob(job, { clips, arrays, custom_scenes = {}, manifest, cache, wrong_fix_m = 10 }) {
  const started = performance.now();
  const scenario = validateScenario(scenarioForJob(custom_scenes[job.scene] ?? buildScene(job.scene), job, arrays));
  const usedClips = new Map(scenario.sources.map((s) => {
    const clip = clips.get(s.clip);
    if (!clip) throw new Error(`Missing clip ${s.clip}; no synthetic fallback`);
    return [s.clip, clip];
  }));
  const durations = new Map([...usedClips].map(([k, v]) => [k, v.length / scenario.settings.render_sample_rate]));
  const audio = (manifest.audio ?? await audioHash(usedClips)).filter((a) => usedClips.has(a.id));
  const keys = await cacheKeys(scenario, { code_version: manifest.code_version, schema: EXPORT_SCHEMA, audio, analysis_settings: { settings: scenario.settings, mode: job.analysis_mode, wrong_fix_m } });
  const cached = await cache?.get(keys.run);
  if (cached) return { ...cached, job, cache_hit: true };
  let rendered = await cache?.get(keys.render);
  const renderCached = !!rendered;
  const renderStart = performance.now();
  if (!rendered) {
    rendered = renderScenario(scenario, usedClips, { lengthS: renderLengthS(scenario, durations) });
    await cache?.set(keys.render, rendered);
  }
  const renderMs = renderCached ? 0 : performance.now() - renderStart;
  // analyseScenario overwrites moving-source path diagnostics; never mutate reusable audio cache.
  rendered = structuredClone(rendered);
  const analysisStart = performance.now();
  const c = speedOfSound(scenario.settings.temperature_c);
  let inference, scores;
  if (job.analysis_mode === 'measured_only') {
    const options = measuredOptions(scenario.settings);
    // Restrict inference inputs at the boundary; cannot see sources, paths, activity, or render truth.
    const sensorScenario = { nodes: scenario.nodes, settings: scenario.settings, buildings: scenario.buildings };
    const sensorData = { sample_rate: rendered.sample_rate, nodes: rendered.nodes.map((n) => ({ id: n.id, mics: n.mics, mic_positions: n.mic_positions })) };
    inference = { ...analyseMeasured(sensorScenario, sensorData, { c, options }), options };
    scores = scoreMeasured(scenario, inference, { c });
  } else {
    inference = analyseScenario(scenario, rendered, durations);
    scores = scoreAssisted(inference);
  }
  const result = {
    job, scenario, inference, scores, manifest: { ...manifest, schema: EXPORT_SCHEMA, audio, seed: job.seed, settings: scenario.settings, variable_values: job.config.values },
    cache_keys: keys, cache_hit: false, render_cache_hit: renderCached, render_ms: renderMs,
    analysis_ms: performance.now() - analysisStart, runtime_ms: performance.now() - started
  };
  await cache?.set(keys.run, result);
  return result;
}

// The same bounded scheduler drives Node workers and browser workers. Pause stops dispatch; in-flight jobs finish.
export async function runExperiment(input, { execute, completed = [], signal, isPaused = () => false, waitWhilePaused = async () => {}, workers = 2, onProgress = () => {}, manifest = {} }) {
  const { experiment, configs, jobs } = buildJobs(input);
  const validIds = new Set(jobs.map((j) => j.id));
  const runs = completed.filter((r) => validIds.has(r.job.id) && r.manifest.code_version === manifest.code_version);
  const done = new Set(runs.map((r) => r.job.id));
  const pending = jobs.filter((j) => !done.has(j.id));
  let cursor = 0;
  onProgress({ done: runs.length, total: jobs.length, resumed: true });
  const work = async () => {
    while (cursor < pending.length && !signal?.aborted) {
      while (isPaused() && !signal?.aborted) await waitWhilePaused();
      if (signal?.aborted) return;
      const job = pending[cursor++];
      onProgress({ done: runs.length, total: jobs.length, job });
      const result = await execute(job);
      runs.push(result);
      onProgress({ done: runs.length, total: jobs.length, job, result });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, pending.length)) }, work));
  runs.sort((a, b) => jobs.findIndex((j) => j.id === a.job.id) - jobs.findIndex((j) => j.id === b.job.id));
  return finishExperiment(experiment, configs, runs, { ...manifest, cancelled: !!signal?.aborted, expected_runs: jobs.length });
}

export function finishExperiment(experiment, configs, runs, manifest) {
  const summary = summariseRuns(runs, experiment);
  const paired = experiment.mode === 'paired' ? [...new Set(runs.map((r) => `${r.job.split}|${r.job.realism}|${r.job.analysis_mode}`))].flatMap((key) => {
    const subset = runs.filter((r) => `${r.job.split}|${r.job.realism}|${r.job.analysis_mode}` === key);
    return ['horizontal_median_m', 'scene_fix_rate', 'within_target_rate', 'wrong_fix_rate', 'track_median_error_m'].map((metric) => ({ key, ...pairedComparison(subset, metric, experiment) }));
  }) : [];
  return {
    schema: EXPORT_SCHEMA, kind: 'echo-sim-benchmark', experiment, configs, manifest,
    thresholds: Object.fromEntries(Object.keys(BENCHMARK_DEFAULTS).map((k) => [k, { value: experiment[k], placeholder: true }])),
    runs, summary, paired, ranking: rankingFlips(summary),
    failure_atlas: ['train', 'held-out'].flatMap((split) => ['off', 'on', 'custom'].flatMap((realism) => ['truth_assisted', 'measured_only'].flatMap((analysis_mode) => {
      const subset = runs.filter((r) => r.job.split === split && r.job.realism === realism && r.job.analysis_mode === analysis_mode);
      return subset.length ? [{ split, realism, analysis_mode, categories: failureAtlas(subset, experiment.wrong_fix_m), detection_by_range: detectionByRange(subset) }] : [];
    }))),
    notes: [
      'SIMULATED, not real-world validation. Held-out scenes/seeds are reporting-only.',
      'Bootstrap unit is a complete scene/seed run. CI is unavailable for fewer than two runs. Repeated seeds within sites are correlated; these are not independent-site population confidence intervals.',
      'Truth-assisted source windows, SNR, overlap, picked paths, multipath and track gates use simulator truth.',
      'Measured-only reuses measured.js: horizontal only, pairwise greedy association; 3D error and labelling are unavailable (null), not zero.',
      'Measured scoring greedily assigns fixes one-to-one to source paths after inference, with no error gate. Unassigned fixes count wrong; track calibration uses median accepted track bearing error, not individual windows.',
      'Measured detection rate means source-associated fused node tracks, not an independent classifier detection rate. No model labelling was run.',
      'Runtime on cache hits records original execution time; render_ms is zero when audio was cached. It is not a fair cold-render speed comparison.'
    ]
  };
}
