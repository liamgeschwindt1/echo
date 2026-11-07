import { analyseScenario } from '../analyse.js';
import { analyseMeasured, measuredOptionsFor } from '../measured.js';
import { renderScenario } from '../render.js';
import { renderLengthS, validateScenario } from '../scenario.js';
import { speedOfSound } from '../physics.js';
import { EXPORT_SCHEMA } from '../export.js';
import { buildScene } from './scenes.js';
import { scenarioForJob, buildJobs, BENCHMARK_DEFAULTS } from './experiment.js';
import { cacheKeys, audioHash, canonical } from './cache.js';
import { scoreAssisted, scoreMeasured, SCORING_VERSION } from './score.js';
import { summariseRuns, failureAtlas, rankingFlips, pairedComparison, detectionByRange } from './metrics.js';

export function measuredOptions(settings) {
  return measuredOptionsFor(settings);
}

async function prepareJob(job, { clips, arrays, custom_scenes = {}, manifest, wrong_fix_m = 10 }) {
  const scenario = validateScenario(scenarioForJob(custom_scenes[job.scene] ?? buildScene(job.scene), job, arrays));
  const usedClips = new Map(scenario.sources.map((s) => {
    const clip = clips.get(s.clip);
    if (!clip) throw new Error(`Missing clip ${s.clip}; no synthetic fallback`);
    return [s.clip, clip];
  }));
  const durations = new Map([...usedClips].map(([k, v]) => [k, v.length / scenario.settings.render_sample_rate]));
  const audio = (manifest.audio ?? await audioHash(usedClips)).filter((a) => usedClips.has(a.id));
  const keys = await cacheKeys(scenario, { code_version: manifest.code_version, render_code_version: manifest.render_code_version, runtime: manifest.runtime, schema: EXPORT_SCHEMA, audio, analysis_settings: { settings: scenario.settings, mode: job.analysis_mode, wrong_fix_m } });
  return { scenario, usedClips, durations, audio, keys };
}

export async function jobRenderKey(job, context) {
  return (await prepareJob(job, context)).keys.render;
}

export async function runJob(job, context) {
  const started = performance.now();
  const { manifest, cache, onRenderReady = () => {} } = context;
  const { scenario, usedClips, durations, audio, keys } = await prepareJob(job, context);
  const cached = await cache?.get(keys.run);
  if (cached) {
    onRenderReady();
    return { ...cached, job, manifest: { ...cached.manifest, seed: job.seed, variable_values: job.config.values }, cache_hit: true };
  }
  let rendered = await cache?.get(keys.render);
  const renderCached = !!rendered;
  const renderStart = performance.now();
  let renderProvenance;
  if (!rendered) {
    rendered = renderScenario(scenario, usedClips, { lengthS: renderLengthS(scenario, durations) });
    renderProvenance = { kind: 'rendered', render_code_version: manifest.render_code_version ?? manifest.code_version, code_version: manifest.code_version, git_hash: manifest.git_hash, dirty: manifest.dirty, runtime: manifest.runtime };
    await cache?.set(keys.origin, renderProvenance);
    await cache?.set(keys.render, rendered);
  } else {
    renderProvenance = await cache.get(keys.origin);
    if (!renderProvenance) throw new Error(`Rendered cache is missing producer provenance: ${keys.render}`);
  }
  const renderMs = renderCached ? 0 : performance.now() - renderStart;
  onRenderReady();
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
    scores = scoreMeasured(scenario, inference, { c, clip_durations: durations });
  } else {
    inference = analyseScenario(scenario, rendered, durations);
    scores = scoreAssisted(inference);
  }
  const result = {
    job, scenario, inference, scores, manifest: { ...manifest, schema: EXPORT_SCHEMA, scoring_version: SCORING_VERSION, audio, seed: job.seed, settings: scenario.settings, variable_values: job.config.values },
    cache_keys: keys, cache_hit: false, render_cache_hit: renderCached, render_provenance: renderProvenance, render_ms: renderMs,
    analysis_ms: performance.now() - analysisStart, runtime_ms: performance.now() - started
  };
  await cache?.set(keys.run, result);
  return result;
}

// The same bounded scheduler drives Node workers and browser workers. Pause stops dispatch; in-flight jobs finish.
export async function runExperiment(input, { execute, renderGroup = (job) => job.id, onRenderComplete = async () => {}, completed = [], signal, isPaused = () => false, waitWhilePaused = async () => {}, workers = 2, onProgress = () => {}, onResult = async () => {}, manifest = {} }) {
  if (!Number.isInteger(workers) || workers < 1) throw new Error('Worker count must be a positive integer');
  const { experiment, configs, jobs } = buildJobs(input);
  const resumeIdentity = (job) => canonical({ job, custom_scene: experiment.custom_scenes?.[job.scene], wrong_fix_m: experiment.wrong_fix_m });
  const identities = new Map(jobs.map((j) => [j.id, resumeIdentity(j)]));
  const audioMatches = (audio) => (audio ?? []).every((clip) => canonical(clip) === canonical(manifest.audio?.find((current) => current.id === clip.id)));
  const runs = [...new Map(completed.filter((r) => identities.has(r.job.id) &&
    r.resume_identity === identities.get(r.job.id) && r.manifest.code_version === manifest.code_version &&
    canonical(r.manifest.runtime) === canonical(manifest.runtime) && audioMatches(r.manifest.audio)).map((r) => [r.job.id, r])).values()];
  const done = new Set(runs.map((r) => r.job.id));
  const pending = jobs.filter((j) => !done.has(j.id));
  const groups = new Map(await Promise.all(pending.map(async (job) => [job.id, await renderGroup(job)])));
  const remaining = new Map();
  for (const group of groups.values()) remaining.set(group, (remaining.get(group) ?? 0) + 1);
  const rendering = new Set(), waiting = new Set();
  const wake = () => { for (const resolve of waiting) resolve(); waiting.clear(); };
  let failed = false;
  onProgress({ done: runs.length, total: jobs.length, resumed: true });
  const work = async () => {
    while (pending.length && !signal?.aborted && !failed) {
      while (isPaused() && !signal?.aborted && !failed) await waitWhilePaused();
      if (signal?.aborted || failed) return;
      const at = pending.findIndex((job) => !rendering.has(groups.get(job.id)));
      if (at < 0) { await new Promise((resolve) => waiting.add(resolve)); continue; }
      const [job] = pending.splice(at, 1), group = groups.get(job.id);
      rendering.add(group);
      let released = false;
      const releaseRender = () => {
        if (released) return;
        released = true; rendering.delete(group); wake();
      };
      try {
        onProgress({ done: runs.length, total: jobs.length, job });
        const result = { ...await execute(job, { releaseRender }), resume_identity: identities.get(job.id) };
        await onResult(result);
        runs.push(result);
        const left = remaining.get(group) - 1;
        remaining.set(group, left);
        if (left === 0) await onRenderComplete(group);
        onProgress({ done: runs.length, total: jobs.length, job, result });
      } catch (error) {
        failed = true; throw error;
      } finally { releaseRender(); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, pending.length)) }, work));
  runs.sort((a, b) => jobs.findIndex((j) => j.id === a.job.id) - jobs.findIndex((j) => j.id === b.job.id));
  return finishExperiment(experiment, configs, runs, { ...manifest, cancelled: !!signal?.aborted, expected_runs: jobs.length });
}

export function finishExperiment(experiment, configs, runs, manifest) {
  const summary = summariseRuns(runs, experiment);
  const complete = !manifest.cancelled && runs.length === (manifest.expected_runs ?? runs.length);
  const paired = experiment.mode === 'paired' ? [...new Set(runs.map((r) => `${r.job.split}|${r.job.realism}|${r.job.analysis_mode}`))].flatMap((key) => {
    const subset = runs.filter((r) => `${r.job.split}|${r.job.realism}|${r.job.analysis_mode}` === key);
    return ['horizontal_median_m', 'scene_fix_rate', 'within_target_rate', 'wrong_fix_rate', 'track_median_error_m'].map((metric) => ({ key, ...pairedComparison(subset, metric, experiment) }));
  }) : [];
  return {
    schema: EXPORT_SCHEMA, kind: 'echo-sim-benchmark', experiment, configs, manifest: { ...manifest, scoring_version: SCORING_VERSION },
    thresholds: Object.fromEntries(Object.keys(BENCHMARK_DEFAULTS).map((k) => [k, { value: experiment[k], placeholder: true }])),
    runs, summary, paired, ranking: complete ? rankingFlips(summary) : { metric: 'useful_fix_rate', rank_variable: 'mic_array', rankings: [], flips: [], note: 'Incomplete population; rankings suppressed' },
    failure_atlas: ['train', 'held-out', 'validation', 'test'].flatMap((split) => ['off', 'on', 'surveyed', 'custom'].flatMap((realism) => ['truth_assisted', 'measured_only'].flatMap((analysis_mode) => {
      const subset = runs.filter((r) => r.job.split === split && r.job.realism === realism && r.job.analysis_mode === analysis_mode);
      return subset.length ? [{ split, realism, analysis_mode, categories: failureAtlas(subset, experiment.wrong_fix_m), detection_by_range: detectionByRange(subset) }] : [];
    }))),
    notes: [
      'SIMULATED, not real-world validation. Held-out scenes/seeds are reporting-only.',
      'Bootstrap unit is a complete scene/seed run. CI is unavailable for fewer than two runs. Repeated seeds within sites are correlated; these are not independent-site population confidence intervals.',
      'Truth-assisted source windows, SNR, overlap, picked paths, multipath and track gates use simulator truth.',
      'Measured-only reuses measured.js: horizontal only, pairwise greedy association; 3D error and labelling are unavailable (null), not zero.',
      'Measured scoring assigns overlapping fix episodes one-to-one to source paths after inference, without an error gate. Disjoint episodes may share a source; every matched episode enters error/track/calibration metrics. Unassigned simultaneous hypotheses count wrong. Scoring does not check clip-active intervals. Calibration uses median accepted track bearing error, not individual windows.',
      'Measured detectability is scoring-only: a node has a source-aligned track when a bearing during the known source clip is within 10 degrees of truth. This is not an independent classifier or field detection probability. No model labelling was run.',
      'Runtime on cache hits records original execution time; render_ms is zero when audio was cached. It is not a fair cold-render speed comparison.'
    ]
  };
}

export function rescoreReport(report, manifest) {
  if (report.kind !== 'echo-sim-benchmark' || !Array.isArray(report.runs)) throw new Error('Expected benchmark report with stored inference');
  if (!manifest?.code_version) throw new Error('Re-scoring requires current code provenance');
  const provenance = { code_version: manifest.code_version, git_hash: manifest.git_hash, dirty: manifest.dirty, schema: EXPORT_SCHEMA };
  const runs = report.runs.map((run) => {
    if (!run.inference || !run.scenario) throw new Error(`Missing stored inference/scenario: ${run.job.id}`);
    const start = performance.now();
    const clipDurations = new Map((run.manifest.audio ?? []).map((clip) =>
      [clip.id, clip.samples / run.scenario.settings.render_sample_rate]));
    const scores = run.job.analysis_mode === 'measured_only'
      ? scoreMeasured(run.scenario, run.inference, {
        c: speedOfSound(run.scenario.settings.temperature_c),
        clip_durations: clipDurations
      })
      : scoreAssisted(run.inference);
    return { ...run, scores, cache_keys: { ...run.cache_keys, run: null }, rescoring_ms: performance.now() - start,
      manifest: { ...run.manifest, scoring_version: SCORING_VERSION, scoring_provenance: provenance,
        rescored_from: { scoring_version: run.manifest.scoring_version ?? 'source-one-to-one-v1', run_cache_key: run.cache_keys.run } } };
  });
  return finishExperiment(report.experiment, report.configs, runs, { ...report.manifest, targets: manifest.targets, scoring_provenance: provenance, rescored_from: { schema: report.schema, scoring_version: report.manifest.scoring_version ?? 'source-one-to-one-v1' } });
}
