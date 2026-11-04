import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const root = new URL('../baselines/', import.meta.url);
const before = JSON.parse(await readFile(new URL('round2-performance-baseline.json', root)));
const after = JSON.parse(await readFile(new URL('round2-performance-candidate.json', root)));
if (!isDeepStrictEqual(before.spec, after.spec) || !isDeepStrictEqual(before.runtime, after.runtime)) throw new Error('Unlike profiling populations/runtime');
const expected = before.spec.scenes.flatMap((s) => Array.from({ length: before.spec.repetitions }, (_, repetition) => `${s.id}|${s.array_override}|${repetition}`));
const identity = (r) => `${r.scene}|${r.array_override}|${r.repetition}`;
if (![before, after].every((r) => isDeepStrictEqual(r.runs.map(identity), expected))) throw new Error('Incomplete or unequal profiling population');
const mismatches = [];
for (let i = 0; i < expected.length; i++) for (const field of ['audio_sha256', 'render_sha256', 'inference_sha256']) {
  if (!isDeepStrictEqual(before.runs[i][field], after.runs[i][field])) mismatches.push({ case: expected[i], field });
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const summary = before.spec.scenes.map(({ id, array_override }) => {
  const b = before.runs.filter((r) => r.scene === id), a = after.runs.filter((r) => r.scene === id);
  const render_before_ms = mean(b.map((r) => r.render_ms)), render_after_ms = mean(a.map((r) => r.render_ms));
  const analysis_before_ms = mean(b.map((r) => r.analysis_ms)), analysis_after_ms = mean(a.map((r) => r.analysis_ms));
  return { scene: id, array_override, render_before_ms, render_after_ms, analysis_before_ms, analysis_after_ms,
    render_speedup: mismatches.length ? null : render_before_ms / render_after_ms,
    analysis_speedup: mismatches.length ? null : analysis_before_ms / analysis_after_ms };
});
const report = { byte_identical: !mismatches.length, completed: 2 * expected.length, mismatches, summary,
  note: 'Canonical output values and every typed-array byte checked. Two sequential repetitions per variant/site; arithmetic mean equals sample median for n=2. Sequential timing is not a robust cross-machine speed guarantee.' };
await writeFile(new URL('round2-performance-comparison.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (mismatches.length) process.exitCode = 1;
