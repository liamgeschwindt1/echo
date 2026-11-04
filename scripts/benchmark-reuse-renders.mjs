import { readFile, link, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { codeManifest, DiskCache, loadBenchmarkClips } from '../packages/sim-core/src/benchmark/node.js';
import { renderFingerprint } from '../packages/sim-core/src/benchmark/render-fingerprint.js';
import { audioHash, cacheKeys, canonical } from '../packages/sim-core/src/benchmark/cache.js';
import { validateScenario } from '../packages/sim-core/src/scenario.js';
import { renderScenario } from '../packages/sim-core/src/render.js';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  if (at < 0 || !args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`Required: ${name} VALUE`);
  return args[at + 1];
};
const report = JSON.parse(await readFile(resolve(option('--from')), 'utf8'));
if (report.kind !== 'echo-sim-benchmark' || !Array.isArray(report.runs)) throw new Error('Expected benchmark JSON');
const revision = execFileSync('git', ['rev-parse', '--verify', `${option('--source-revision')}^{commit}`], { encoding: 'utf8' }).trim();
const sourceRoot = new URL('../packages/sim-core/src/', import.meta.url);
const sourceFingerprint = await renderFingerprint({
  sourceRoot,
  readSource: (url) => execFileSync('git', ['show', `${revision}:packages/sim-core/src/${relative(sourceRoot.pathname, url.pathname)}`], { encoding: 'utf8' })
});
const current = await codeManifest();
if (sourceFingerprint.render_code_version !== current.render_code_version) throw new Error('Renderer dependency graph changed; cannot reuse historical audio');
if (report.runs.some((r) => r.manifest.dirty) && !args.includes('--acknowledge-dirty-audit')) throw new Error('Dirty historical snapshots require an explicit audited-renderer acknowledgement; git revision alone cannot prove their source');
const legacyRuntime = args.includes('--legacy-runtime') ? JSON.parse(await readFile(resolve(option('--legacy-runtime')), 'utf8')) : null;
const runtime = { engine: 'node', node: process.versions.node, v8: process.versions.v8, platform: process.platform, arch: process.arch };
const cache = new DiskCache(args.includes('--cache') ? option('--cache') : '.benchmark-cache');
const ids = new Set(report.runs.flatMap((r) => r.scenario.sources.map((s) => s.clip)));
const clipsById = await loadBenchmarkClips(ids);
const audio = await audioHash(clipsById);
const seen = new Set();
let control;
let reused = 0, already = 0;
for (const run of report.runs) {
  const recordedRuntime = run.manifest.runtime;
  const observedRuntime = legacyRuntime?.runtime;
  if (observedRuntime && recordedRuntime && Object.entries(recordedRuntime).some(([key, value]) => canonical(value) !== canonical(observedRuntime[key]))) throw new Error('Historical runtime record contradicts supplied observation');
  if (canonical(recordedRuntime) !== canonical(runtime) && canonical(observedRuntime) !== canonical(runtime)) throw new Error('Historical Node/V8/OS/architecture does not match; explicit runtime observation required for incomplete old records');
  if (run.manifest.render_code_version && run.manifest.render_code_version !== sourceFingerprint.render_code_version) throw new Error('Historical renderer fingerprint does not match source revision');
  const clips = run.manifest.audio;
  if (!clips?.length || clips.some((clip) => canonical(clip) !== canonical(audio.find((c) => c.id === clip.id)))) throw new Error('Recorded PCM hash differs from current clip; cannot reuse');
  const old = await cacheKeys(run.scenario, { code_version: run.manifest.code_version, render_code_version: run.manifest.render_code_version, runtime: run.manifest.runtime, audio: clips });
  if (old.render !== run.cache_keys.render) throw new Error('Historical render inputs/key cannot be reconstructed');
  const scenario = validateScenario(run.scenario);
  const check = { code_version: 'inputs-only', runtime, audio: clips };
  if ((await cacheKeys(scenario, check)).render !== (await cacheKeys(run.scenario, check)).render) throw new Error('Validation changes historical render inputs; cannot reuse');
  const keys = await cacheKeys(scenario, { ...current, runtime, audio: clips });
  if (seen.has(keys.render)) continue;
  seen.add(keys.render);
  await stat(cache.path(old.render));
  let present = false;
  try { await stat(cache.path(keys.render)); present = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (present) {
    if (!await cache.get(keys.origin)) throw new Error(`Existing render cache lacks provenance: ${keys.render}`);
    already++;
    continue;
  }
  if (!args.includes('--dry-run') && !control) {
    const stored = await cache.get(old.render);
    const cold = renderScenario(scenario, clipsById, { lengthS: stored.length / stored.sample_rate });
    assert.equal(cold.sample_rate, stored.sample_rate);
    assert.equal(cold.length, stored.length);
    assert.equal(cold.nodes.length, stored.nodes.length);
    cold.nodes.forEach((node, i) => {
      assert.equal(node.mics.length, stored.nodes[i].mics.length);
      node.mics.forEach((mic, j) => assert.equal(Buffer.compare(
        Buffer.from(mic.buffer, mic.byteOffset, mic.byteLength),
        Buffer.from(stored.nodes[i].mics[j].buffer, stored.nodes[i].mics[j].byteOffset, stored.nodes[i].mics[j].byteLength)), 0, 'Cold control PCM differs'));
    });
    assert.deepEqual(cold.paths, stored.paths);
    assert.deepEqual(cold.activity, stored.activity);
    control = { source_render_key: old.render, scene: run.job.scene, seed: run.job.seed, verification: 'Independent cold control: every microphone PCM byte and propagation/activity diagnostics identical. This is one control, not a byte comparison of every migrated scene.' };
    console.log(`Cold control ${run.job.scene}/${run.job.seed}: all microphone PCM bytes and path/activity diagnostics identical.`);
  }
  const provenance = {
    ...(run.render_provenance ?? { code_version: run.manifest.code_version, git_hash: run.manifest.git_hash, dirty: run.manifest.dirty, runtime }),
    kind: 'verified-historical-audio', render_code_version: current.render_code_version,
    migration: { source_revision: revision, source_render_key: old.render, historical_dirty: !!run.manifest.dirty,
      dirty_renderer_audit_acknowledged: args.includes('--acknowledge-dirty-audit'), legacy_runtime_observation: run.manifest.runtime ? null : legacyRuntime,
      control,
      verification: 'Equal complete renderer dependency graph, nominal inputs, PCM hashes and Node/V8 runtime. Dirty historical renderer source is an explicitly acknowledged audit assumption, not cryptographic proof.' }
  };
  if (!args.includes('--dry-run')) {
    await cache.set(keys.origin, provenance);
    await link(cache.path(old.render), cache.path(keys.render));
  }
  reused++;
}
console.log(`${args.includes('--dry-run') ? 'Verified' : 'Reused'} ${reused} rendered inputs; ${already} already present. No audio or whole-run results were rewritten. Dirty-source audit assumptions are retained in provenance.`);
