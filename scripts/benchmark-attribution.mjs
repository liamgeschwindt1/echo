import { readFile, writeFile, mkdir, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { defaultScenario, newNode, newSource } from '../packages/sim-core/src/scenario.js';
import { BUILTIN_ARRAYS, applyArrayToNode } from '../packages/sim-core/src/arrays.js';
import { REALISM } from '../packages/sim-core/src/benchmark/scenes.js';
import { codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { renderScenario } from '../packages/sim-core/src/render.js';
import { analyseRecording } from '../packages/sim-core/src/recording.js';
import { micPositions } from '../packages/sim-core/src/mics.js';
import { mulberry32 } from '../packages/sim-core/src/rng.js';
import { estimateNoiseShares } from './lib/noise-attribution.mjs';

const root = new URL('../', import.meta.url), cache = new URL('.benchmark-round2-attribution/', root);
const bytes = await readFile(new URL('docs/experiments/round2-attribution.json', root)), spec = JSON.parse(bytes);
const sha = (data) => createHash('sha256').update(data).digest('hex');
const hashAudio = (samples) => sha(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
const meanSquare = (audio, from, to) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += audio[i] ** 2;
  return sum / (to - from);
};
const receptor = [0, 0, 1.5], fs = 48000, references = new Map(), cases = [];
const manifest = { complete: false, registration_sha256: sha(bytes), implementation_sha256: sha(await readFile(new URL('scripts/lib/noise-attribution.mjs', root))),
  producer: await codeManifest(), started_at: new Date().toISOString(), render_count: 0 };
await mkdir(cache, { recursive: true });
const make = (seed, recipe, count, realism) => {
  const s = defaultScenario();
  Object.assign(s.settings, REALISM[realism], { seed, reflection_order: 0, diffraction_order: 0, ground_reflectivity: 0 });
  s.nodes = Array.from({ length: count }, (_, i) => applyArrayToNode({
    ...newNode(`n${i}`), position: [25 * Math.cos(i * 2 * Math.PI / count), 25 * Math.sin(i * 2 * Math.PI / count), 1.5]
  }, BUILTIN_ARRAYS.find((a) => a.id === 'flat4_100')));
  s.buildings = [];
  s.sources = spec.pois.map((poi, i) => ({
    ...newSource(poi.id, poi.id, poi.position[0], poi.position[1], 70 + 10 * Math.log10(recipe[i] * Math.hypot(...poi.position.map((x, j) => x - receptor[j])) ** 2)),
    start_s: 1, keyframes: [{ t: 0, position: poi.position }]
  }));
  return s;
};
for (const seed of spec.seeds) {
  const clips = new Map(spec.pois.map((p, i) => {
    const rng = mulberry32((seed + 10000 + 1000 * i) >>> 0);
    return [p.id, Float32Array.from({ length: fs * 4 }, () => rng() < 0.5 ? -1 : 1)];
  }));
  for (const [recipeIndex, recipe] of spec.recipes.entries()) for (const count of spec.node_counts) for (const realism of spec.realism) {
    const disk = await statfs(root);
    if (1 - disk.bavail / disk.blocks > 0.85) throw new Error('Disk exceeds85%; preserve checkpoint and do not report partial rankings');
    const start = performance.now(), referenceKey = `${seed}:${recipeIndex}`, s = make(seed, recipe, count, realism);
    if (!references.has(referenceKey)) {
      const isolated = s.sources.map((source) => {
        const reference = make(seed, recipe, 1, 'off');
        reference.nodes = [{ ...newNode('reference', 0, 0), position: receptor, mic_layout: 'custom', mic_offsets_m: [[0, 0, 0]] }];
        reference.sources = [source]; reference.settings.noise_enabled = false;
        const rendered = renderScenario(reference, clips, { lengthS: 5.5 });
        manifest.render_count++;
        const audio = rendered.nodes[0].mics[0];
        return { source_id: source.id, power: meanSquare(audio, fs * 2, fs * 4), audio_sha256: hashAudio(audio) };
      });
      references.set(referenceKey, isolated);
    }
    const rendered = renderScenario(s, clips, { lengthS: 5.5 });
    manifest.render_count++;
    let channel = 0;
    const geometry = { sample_rate: fs, settings: s.settings, nodes: s.nodes.map((node) => ({ id: node.id, position: node.position,
      mic_positions: micPositions(node), channels: micPositions(node).map(() => channel++) })) };
    const recording = analyseRecording({ sample_rate: fs, frames: rendered.length, channels: rendered.nodes.flatMap((n) => n.mics) }, geometry);
    const powers = rendered.nodes.map((n) => Math.max(0, meanSquare(n.mics[0], fs * 2, fs * 4) - meanSquare(n.mics[0], 0, fs / 2)));
    const estimated = estimateNoiseShares({ positions: s.nodes.map((n) => micPositions(n)[0]), pois: spec.pois.map((p) => p.position), powers, receptor });
    const components = references.get(referenceKey), total = components.reduce((sum, p) => sum + p.power, 0);
    if (!(total > 0)) throw new Error('Reference source energy is unavailable');
    const truth = components.map((p) => p.power / total);
    const signed = estimated.shares?.map((p, i) => 100 * (p - truth[i])) ?? null;
    const associations = recording.inference.fixes.map((fix, index) => {
      const distances = spec.pois.map((p) => Math.hypot(fix.final_position[0] - p.position[0], fix.final_position[1] - p.position[1]));
      const closest = distances.indexOf(Math.min(...distances));
      return { fix_index: index, poi: distances[closest] <= 10 ? spec.pois[closest].id : null, distance_m: distances[closest],
        suspect: !!(fix.low_confidence || fix.ambiguous || !fix.reliable) };
    });
    cases.push({ seed, recipe_index: recipeIndex, node_count: count, realism, estimated, truth_shares: truth,
      signed_share_error_pp: signed, mean_absolute_share_error_pp: signed ? signed.reduce((sum, x) => sum + Math.abs(x), 0) / signed.length : null,
      observed_excess_powers: powers, source_levels_1m_db: s.sources.map((source) => source.level_1m_db),
      audio_sha256: rendered.nodes.map((n) => n.mics.map(hashAudio)), clip_sha256: [...clips].map(([id, audio]) => ({ id, sha256: hashAudio(audio) })),
      fix_count: recording.inference.fixes.length, associations, elapsed_ms: performance.now() - start });
    await writeFile(new URL('checkpoint.json', cache), JSON.stringify({ manifest, cases }) + '\n');
    console.log(`${cases.length}/24 attribution: ${count}nodes ${realism}, seed${seed}, recipe${recipeIndex}`);
  }
}
if (cases.length !== spec.population.mixture_renders || manifest.render_count !== spec.population.total_renders) throw new Error('Attribution population incomplete');
manifest.complete = true; manifest.finished_at = new Date().toISOString();
const summary = spec.node_counts.flatMap((node_count) => spec.realism.map((realism) => {
  const rows = cases.filter((r) => r.node_count === node_count && r.realism === realism);
  const seedMeans = spec.seeds.map((seed) => {
    const values = rows.filter((r) => r.seed === seed).map((r) => r.mean_absolute_share_error_pp).filter(Number.isFinite);
    return { seed, mean_absolute_share_error_pp: values.length === spec.recipes.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
  });
  return { node_count, realism, n: rows.length, estimated: rows.filter((r) => r.estimated.shares).length,
    seed_means: seedMeans, mean_absolute_share_error_pp: seedMeans.every((r) => r.mean_absolute_share_error_pp !== null)
      ? seedMeans.reduce((sum, r) => sum + r.mean_absolute_share_error_pp, 0) / seedMeans.length : null,
    fix_count: rows.reduce((sum, r) => sum + r.fix_count, 0), associated_fixes: rows.flatMap((r) => r.associations).filter((a) => a.poi).length };
}));
await writeFile(new URL('baselines/round2-attribution.json', root), JSON.stringify({ kind: 'echo-noise-attribution-prototype', schema: 1, manifest, spec,
  references: Object.fromEntries(references), summary, cases }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
