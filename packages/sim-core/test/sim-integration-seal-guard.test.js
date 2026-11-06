import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertShardedUnsealed } from '../../../scripts/lib/integration-seal-guard.mjs';

test('sharded entrypoints fail closed for sealed inputs before expansion or inference', async () => {
  assert.doesNotThrow(() => assertShardedUnsealed({ name: 'validation' }));
  assert.throws(() => assertShardedUnsealed({ sealed: true }), /Sealed sharding disabled/);
  assert.throws(() => assertShardedUnsealed({
    preregistration: { input_sha256: 'a2fe9499ec853c2e5a3d6e2ececef9ca30410adb7454ed39a211c2fdf072a78c' }
  }), /Sealed sharding disabled/);
  const directory = await mkdtemp(join(tmpdir(), 'echo-t8-seal-guard-'));
  try {
    const experiment = join(directory, 'fake-sealed.json');
    await writeFile(experiment, JSON.stringify({ sealed: true }));
    const root = new URL('../../../', import.meta.url);
    for (const [script, args] of [
      ['benchmark-shard-plan.mjs', ['--shards', '2']],
      ['benchmark-shard.mjs', ['--shard-index', '0', '--shard-count', '2']],
      ['benchmark-shard-merge.mjs', ['--shard-dir', join(directory, 'absent')]]
    ]) {
      assert.throws(() => execFileSync(process.execPath, [
        new URL(`scripts/${script}`, root).pathname, '--experiment', experiment, ...args
      ], { cwd: root, encoding: 'utf8', stdio: 'pipe' }), (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, /Sealed sharding disabled/);
        return true;
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
