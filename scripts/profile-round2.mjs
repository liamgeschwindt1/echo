import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serialize } from 'node:v8';
import { parseArgs } from 'node:util';
import { valueHash } from './lib/value-hash.mjs';

const { values } = parseArgs({ options: { variant: { type: 'string' } } });
if (!['baseline', 'candidate'].includes(values.variant)) throw new Error('--variant baseline|candidate required');
const root = new URL('../', import.meta.url);
const spec = JSON.parse(await readFile(new URL('docs/experiments/round2-performance.json', root)));
const files = ['packages/sim-core/src/render.js', 'packages/sim-core/src/localise.js'];
const sources = Object.fromEntries(await Promise.all(files.map(async (f) => [new URL(f, root).href,
  values.variant === 'baseline' ? execFileSync('git', ['show', `${spec.baseline_revision}:${f}`], { cwd: root, encoding: 'utf8' }) : await readFile(new URL(f, root), 'utf8')])));
const hook = registerHooks({ load(url, context, next) {
  return sources[url] ? { format: 'module', source: sources[url], shortCircuit: true } : next(url, context);
} });
const { renderScenario } = await import('../packages/sim-core/src/render.js');
const { analyseMeasured } = await import('../packages/sim-core/src/measured.js');
const { loadBenchmarkClips } = await import('../packages/sim-core/src/benchmark/node.js');
const { buildScene, REALISM } = await import('../packages/sim-core/src/benchmark/scenes.js');
const { applyValues } = await import('../packages/sim-core/src/benchmark/variables.js');
const { renderLengthS } = await import('../packages/sim-core/src/scenario.js');
const { speedOfSound } = await import('../packages/sim-core/src/physics.js');
const { newProfile } = await import('../packages/sim-core/src/profile.js');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const runs = [];
for (const scene of spec.scenes) for (let repetition = 0; repetition < spec.repetitions; repetition++) {
  const s = applyValues(buildScene(scene.id), scene.array_override ? { mic_array: scene.array_override } : {});
  s.settings = { ...s.settings, ...REALISM.off, seed: spec.seed };
  const clips = await loadBenchmarkClips(new Set(s.sources.map((s) => s.clip)));
  const durations = new Map([...clips].map(([id, pcm]) => [id, pcm.length / s.settings.render_sample_rate]));
  const profile = newProfile();
  const start = performance.now();
  const rendered = renderScenario(s, clips, { lengthS: renderLengthS(s, durations), profile });
  const render_ms = performance.now() - start;
  const analysisStart = performance.now();
  const inference = analyseMeasured({ nodes: s.nodes, settings: s.settings, buildings: s.buildings }, {
    sample_rate: rendered.sample_rate, nodes: rendered.nodes.map(({ id, mics, mic_positions }) => ({ id, mics, mic_positions }))
  }, { c: speedOfSound(s.settings.temperature_c) });
  runs.push({
    scene: scene.id, array_override: scene.array_override, repetition,
    render_ms, analysis_ms: performance.now() - analysisStart, profile,
    audio_sha256: rendered.nodes.map((n) => n.mics.map((pcm) => hash(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)))),
    render_sha256: valueHash(rendered), inference_sha256: valueHash(inference),
    noncanonical_v8_render_sha256: hash(serialize(rendered))
  });
  console.log(`${values.variant} ${scene.id} repetition ${repetition + 1}/${spec.repetitions}: render ${render_ms.toFixed(0)}ms`);
}
hook.deregister();
await writeFile(new URL(`baselines/round2-performance-${values.variant}.json`, root), JSON.stringify({
  variant: values.variant, spec, runtime: process.versions, runs,
  sources: Object.fromEntries(Object.entries(sources).map(([url, source]) => [url, hash(source)]))
}, null, 2) + '\n');
