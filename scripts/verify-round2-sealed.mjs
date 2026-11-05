import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { sealedInputHash } from '../packages/sim-core/src/benchmark/sealed.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const json = async (path) => JSON.parse(await read(path));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const registration = await json('docs/experiments/round2-sealed.json');
const hash = sealedInputHash(registration);
const recovery = await json('baselines/round2-sealed-recovery.json');
const verification = await json('baselines/round2-final-verification.json');
const storage = await json('baselines/round2-sealed-storage.json');
const gzip = await read('baselines/round2-sealed.json.gz'), bytes = gunzipSync(gzip), report = JSON.parse(bytes);
assert.equal(sha(bytes), recovery.output_sha256);
assert.equal(sha(gzip), verification.sealed.gzip_sha256);
assert.equal(report.manifest.sealed.input_sha256, hash);
assert.equal(report.manifest.git_hash, recovery.original_producer.git_hash);
assert.equal(report.manifest.code_version, recovery.original_producer.code_version);
assert.equal(report.manifest.cancelled, false);
assert.equal(report.runs.length, 160);
assert.equal(new Set(report.runs.map((r) => r.job.id)).size, 160);
assert.equal(report.runs.filter((r) => r.cache_hit).length, 80);
const ledger = (await read(`docs/experiments/sealed-runs/${hash}.jsonl`)).toString().trim().split('\n').map(JSON.parse);
assert.deepEqual(ledger.map((e) => e.state), ['started', 'storage-amendment', 'export-failed', 'completed']);
assert.equal(ledger[0].override_reason, null);
assert.equal(ledger.at(-1).rerendered, 0);
assert.equal(ledger.at(-1).inference_reexecuted, 0);
for (const scene of registration.scenes) for (const realism of ['off', 'on']) {
  const pair = report.runs.filter((r) => r.job.scene === scene && r.job.realism === realism);
  assert.equal(pair.length, 2);
  assert.deepEqual(pair.map((r) => r.job.config.id).sort(), ['c0', 'c1']);
  assert.ok(pair.every((r) => r.job.seed === registration.seeds[0] &&
    r.job.split === 'test' && r.job.analysis_mode === 'measured_only'));
  assert.deepEqual(pair[0].inference, pair[1].inference);
  assert.deepEqual(pair[0].scores, pair[1].scores);
}
assert.equal(sha(await read('scripts/recover-round2-sealed.mjs')), recovery.script_sha256);
assert.equal(sha(await read('scripts/prune-sealed-completed-renders.mjs')), storage.script_sha256);
const archive = new URL('baselines/round2-sealed-original.tar.gz', root).pathname;
assert.equal(sha(await readFile(archive)), verification.sealed.original_archive_sha256);
const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
const expected = [...recovery.caches.map((c) => c.file), 'echo-round2-sealed.log'];
assert.deepEqual(names.sort(), expected.sort());
assert.equal(recovery.caches.length, 80);
for (const entry of recovery.caches) {
  assert.match(entry.file, /^run-[a-f0-9]{64}\.bin$/);
  assert.equal(sha(execFileSync('tar', ['-xOzf', archive, entry.file], { maxBuffer: 64 * 1024 * 1024 })), entry.sha256);
}
assert.equal(sha(execFileSync('tar', ['-xOzf', archive, 'echo-round2-sealed.log'])), recovery.original_log_sha256);
for (const entry of storage.planned) {
  const original = recovery.caches.find((c) => c.file === entry.cache_keys.run.replace(':', '-') + '.bin');
  assert.equal(original?.sha256, entry.result_sha256);
}
console.log('Verified complete single-attempt sealed population, paired equality, all80 original cache hashes, storage proof and recovery provenance.');
