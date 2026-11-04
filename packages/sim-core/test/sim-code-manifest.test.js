import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { codeManifest } from '../src/benchmark/node.js';

test('code manifest supports source archives and preserves Git checkout provenance', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'echo-code-manifest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = new URL('../../../', import.meta.url);
  await mkdir(join(directory, 'packages/sim-core'), { recursive: true });
  await mkdir(join(directory, 'docs'));
  await cp(new URL('packages/sim-core/src', root), join(directory, 'packages/sim-core/src'), { recursive: true });
  await cp(new URL('docs/targets.json', root), join(directory, 'docs/targets.json'));
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await symlink(new URL('node_modules', root), join(directory, 'node_modules'), 'dir');
  const moduleUrl = pathToFileURL(join(directory, 'packages/sim-core/src/benchmark/node.js')).href;
  const manifest = (env = process.env) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { codeManifest } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await codeManifest()));`
  ], { cwd: directory, encoding: 'utf8', env });
  const archived = manifest({ ...process.env, PATH: '' });
  assert.equal(archived.status, 0, archived.stderr);
  assert.match(archived.stderr, /\.git metadata is absent/);
  assert.doesNotMatch(archived.stderr, /fatal:/);
  const archiveManifest = JSON.parse(archived.stdout);
  assert.equal(archiveManifest.git_hash, null);
  assert.equal(archiveManifest.dirty, null);
  const checkoutManifest = await codeManifest();
  for (const key of ['code_version', 'render_code_version', 'render_source_files', 'schema', 'targets']) {
    assert.deepEqual(archiveManifest[key], checkoutManifest[key]);
  }

  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  await writeFile(join(directory, '.gitignore'), 'node_modules\n');
  git('add', '.');
  git('-c', 'user.name=Manifest Test', '-c', 'user.email=manifest@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Test manifest fixture');
  const clean = manifest();
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.stderr, '');
  assert.equal(JSON.parse(clean.stdout).git_hash, git('rev-parse', 'HEAD'));
  assert.equal(JSON.parse(clean.stdout).dirty, false);
  await writeFile(join(directory, 'untracked.txt'), 'dirty');
  const dirty = manifest();
  assert.equal(dirty.status, 0, dirty.stderr);
  assert.equal(JSON.parse(dirty.stdout).dirty, true);

  await writeFile(join(directory, '.git/HEAD'), 'invalid HEAD\n');
  const broken = manifest();
  assert.notEqual(broken.status, 0);
  assert.doesNotMatch(broken.stderr, /\.git metadata is absent/);
});
