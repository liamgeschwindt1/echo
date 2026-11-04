import { readdir, readFile, mkdir, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { serialize, deserialize } from 'node:v8';
import { Worker } from 'node:worker_threads';
import { decodeBenchmarkWav } from './audio.js';
import { audioHash } from './cache.js';
import { EXPORT_SCHEMA } from '../export.js';
import { renderFingerprint } from './render-fingerprint.js';
import { jobRenderKey } from './runner.js';

const root = new URL('../../../../', import.meta.url);
export async function codeManifest() {
  const dir = new URL('../', import.meta.url);
  const files = [];
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), path);
      if (entry.isDirectory()) await visit(url);
      else if (entry.name.endsWith('.js') && entry.name !== 'node.js') files.push(url);
    }
  }
  await visit(dir);
  const hash = createHash('sha256');
  for (const file of files) { hash.update(relative(dir.pathname, file.pathname)); hash.update(await readFile(file)); }
  let hasGit = true;
  try { await stat(new URL('.git', root)); }
  catch (error) { if (error.code === 'ENOENT') hasGit = false; else throw error; }
  let git_hash = null, dirty = null;
  if (hasGit) {
    git_hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  } else {
    console.warn('[benchmark] .git metadata is absent; git_hash and dirty are unknown (null). Source content hashes remain available.');
  }
  return {
    git_hash, dirty,
    code_version: hash.digest('hex'), ...await renderFingerprint(), schema: EXPORT_SCHEMA,
    scoring: 'benchmark score.js; post-inference truth only',
    audio_source: 'repository test-audio recordings, PCM float32 mono at 48000 Hz',
    targets: JSON.parse(await readFile(new URL('docs/targets.json', root), 'utf8'))
  };
}

export async function loadBenchmarkClips(ids) {
  const dir = new URL('../../../assets/public/test-audio/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
  const clips = new Map();
  for (const id of ids) {
    const entry = manifest.clips.find((c) => c.id === id);
    if (!entry?.file) throw new Error(`Missing recorded benchmark asset: ${id}`);
    const bytes = await readFile(new URL(entry.file, dir));
    clips.set(id, decodeBenchmarkWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  }
  return clips;
}

export class DiskCache {
  constructor(directory) { this.directory = resolve(directory); }
  path(key) {
    if (!/^(render|run|render-origin):[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cache key');
    return resolve(this.directory, key.replace(':', '-') + '.bin');
  }
  async get(key) {
    try { return deserialize(await readFile(this.path(key))); }
    catch (err) { if (err.code === 'ENOENT') return undefined; throw err; }
  }
  async set(key, value) {
    await mkdir(this.directory, { recursive: true });
    const file = this.path(key), temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, serialize(value));
    await rename(temp, file);
  }
  async delete(key) {
    try { await unlink(this.path(key)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export async function nodeExecutor({ workers = 2, clips, arrays, manifest, experiment, cacheDirectory, discardRenders = false }) {
  manifest = { ...manifest, cache_policy: discardRenders ? 'discard_render_after_consumers' : 'retain', audio: await audioHash(clips), runtime: { engine: 'node', node: process.versions.node, v8: process.versions.v8, platform: process.platform, arch: process.arch } };
  const context = { clips, arrays, manifest, custom_scenes: experiment.custom_scenes, wrong_fix_m: experiment.wrong_fix_m };
  const pool = Array.from({ length: workers }, () => {
    const worker = new Worker(new URL('./node-worker.js', import.meta.url), { workerData: { ...context, cacheDirectory } });
    return { worker, busy: false, reject: null };
  });
  let counter = 0;
  const execute = (job, { releaseRender = () => {} } = {}) => new Promise((resolve, reject) => {
    const slot = pool.find((s) => !s.busy);
    if (!slot) return reject(new Error('Worker pool exhausted'));
    slot.busy = true;
    slot.reject = reject;
    const id = counter++;
    const cleanup = () => { slot.busy = false; slot.reject = null; slot.worker.off('message', onMessage); slot.worker.off('error', onError); slot.worker.off('exit', onExit); };
    const onMessage = (data) => {
      if (data.id !== id) return;
      if (data.type === 'render-ready') { releaseRender(); return; }
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onExit = (code) => onError(new Error(`Benchmark worker exited (${code})`));
    slot.worker.on('message', onMessage);
    slot.worker.once('error', onError);
    slot.worker.once('exit', onExit);
    slot.worker.postMessage({ id, job });
  });
  const cache = new DiskCache(cacheDirectory);
  return { execute, manifest, renderGroup: (job) => jobRenderKey(job, context),
    onRenderComplete: discardRenders ? async (key) => { await cache.delete(key); await cache.delete(`render-origin:${key.slice('render:'.length)}`); } : undefined,
    close: async () => { await Promise.all(pool.map((s) => s.worker.terminate())); } };
}
