import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFingerprint } from '../src/benchmark/render-fingerprint.js';
import { cacheKeys, MemoryCache } from '../src/benchmark/cache.js';
import { runJob } from '../src/benchmark/runner.js';
import { buildJobs } from '../src/benchmark/experiment.js';
import { buildScene } from '../src/benchmark/scenes.js';
import { click } from './golden-scenes.js';
import { nodeExecutor } from '../src/benchmark/node.js';
import { runExperiment } from '../src/benchmark/runner.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('renderer fingerprint follows static/dynamic imports, cycles and re-exports; not unrelated analysis', async () => {
  const sourceRoot = new URL('file:///virtual/');
  const sources = new Map([
    ['render.js', 'import "./physics.js"; export { x } from "./dsp.js"; export const later = () => import("./physics.js");'],
    ['physics.js', 'import "./render.js"; export const c = 343;'],
    ['dsp.js', 'export const x = 1;'],
    ['analyse.js', 'export const gate = 3;']
  ]);
  const readSource = async (url) => {
    const source = sources.get(url.pathname.slice(sourceRoot.pathname.length));
    if (source === undefined) throw new Error(`Missing test dependency ${url}`);
    return source;
  };
  const first = await renderFingerprint({ sourceRoot, readSource });
  sources.set('analyse.js', 'export const gate = 4;');
  assert.deepEqual(await renderFingerprint({ sourceRoot, readSource }), first);
  sources.set('dsp.js', 'export const x = 2;');
  assert.notEqual((await renderFingerprint({ sourceRoot, readSource })).render_code_version, first.render_code_version);
  sources.set('render.js', 'export const later = (path) => import(path);');
  await assert.rejects(renderFingerprint({ sourceRoot, readSource }), /literal, local/);
  sources.set('render.js', 'import "untracked-package";');
  await assert.rejects(renderFingerprint({ sourceRoot, readSource }), /literal, local/);
  sources.set('render.js', 'import "../outside.js";');
  await assert.rejects(renderFingerprint({ sourceRoot, readSource }), /Unsupported/);
});

test('actual renderer graph is complete and excludes localisation, scoring and benchmark settings', async () => {
  const fingerprint = await renderFingerprint();
  const names = fingerprint.render_source_files.map((f) => f.name);
  assert.ok(names.includes('render.js'));
  assert.ok(names.includes('activity.js'));
  assert.ok(names.includes('geometry.js'));
  assert.ok(!names.includes('localise.js'));
  assert.ok(!names.includes('measured.js'));
  assert.ok(!names.some((name) => name.startsWith('benchmark/')));
  assert.deepEqual(await renderFingerprint(), fingerprint);
});

test('analysis source changes share only audio, renderer/runtime changes invalidate it', async () => {
  const scenario = buildScene('sparse_20');
  const context = { code_version: 'a', render_code_version: 'renderer', runtime: { node: 'test' }, audio: [], schema: '0.9', analysis_settings: {} };
  const first = await cacheKeys(scenario, context);
  const next = await cacheKeys(scenario, { ...context, code_version: 'b' });
  assert.equal(first.render, next.render);
  assert.equal(first.origin, next.origin);
  assert.notEqual(first.run, next.run);
  assert.notEqual(first.render, (await cacheKeys(scenario, { ...context, render_code_version: 'changed' })).render);
  assert.notEqual(first.render, (await cacheKeys(scenario, { ...context, runtime: { node: 'other' } })).render);
});

test('cross-revision audio reuse retains actual producer provenance, not current analysis producer', async () => {
  const scenario = buildScene('sparse_20');
  scenario.sources[0].clip = 'click'; scenario.sources[0].start_s = 0.2;
  scenario.settings.reflection_order = 0; scenario.settings.diffraction_order = 0;
  const experiment = { name: 'reuse', scenes: ['custom'], custom_scenes: { custom: scenario }, seeds: [1], mode: 'grid', sweeps: [], realism: ['off'], analysis_modes: ['measured_only'] };
  const job = buildJobs(experiment).jobs[0], cache = new MemoryCache();
  const context = { clips: new Map([['click', click()]]), custom_scenes: experiment.custom_scenes, cache };
  const first = await runJob(job, { ...context, manifest: { code_version: 'a', render_code_version: 'renderer', git_hash: 'old', runtime: { node: 'test' } } });
  const next = await runJob(job, { ...context, manifest: { code_version: 'b', render_code_version: 'renderer', git_hash: 'new', runtime: { node: 'test' } } });
  assert.equal(next.render_cache_hit, true);
  assert.equal(next.cache_hit, false);
  assert.equal(next.manifest.code_version, 'b');
  assert.equal(next.render_provenance.code_version, 'a');
  assert.equal(next.render_provenance.git_hash, 'old');
  assert.deepEqual(next.scores, first.scores);
  cache.entries.delete(first.cache_keys.origin);
  await assert.rejects(runJob(job, { ...context, manifest: { code_version: 'c', render_code_version: 'renderer', runtime: { node: 'test' } } }), /missing producer provenance/);
});

test('actual Node workers render one cold shared input once for both analysis pipelines', async () => {
  const scenario = buildScene('sparse_20');
  scenario.sources[0].clip = 'click'; scenario.sources[0].start_s = 0.2;
  scenario.settings.reflection_order = 0; scenario.settings.diffraction_order = 0;
  const { experiment } = buildJobs({ name: 'workers', scenes: ['custom'], custom_scenes: { custom: scenario }, seeds: [1], mode: 'grid', sweeps: [], realism: ['off'], analysis_modes: ['measured_only', 'truth_assisted'] });
  const directory = await mkdtemp(join(tmpdir(), 'echo-render-singleflight-'));
  let executor;
  try {
    executor = await nodeExecutor({ workers: 2, clips: new Map([['click', click()]]), manifest: { code_version: 'worker-test', render_code_version: 'renderer-test' }, experiment, cacheDirectory: directory });
    const report = await runExperiment(experiment, { ...executor, workers: 2 });
    assert.equal(report.runs.length, 2);
    assert.equal(report.runs.filter((r) => !r.render_cache_hit && !r.cache_hit).length, 1);
    assert.equal(report.runs.filter((r) => r.render_cache_hit).length, 1);
    assert.equal(report.runs[0].cache_keys.render, report.runs[1].cache_keys.render);
    assert.deepEqual(report.runs[0].render_provenance, report.runs[1].render_provenance);
  } finally {
    await executor?.close();
    await rm(directory, { recursive: true });
  }
});
