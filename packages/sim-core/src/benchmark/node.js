import { readdir, readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { serialize, deserialize } from 'node:v8';
import { Worker } from 'node:worker_threads';
import { decodeBenchmarkWav } from './audio.js';
import { audioHash } from './cache.js';
import { EXPORT_SCHEMA } from '../export.js';

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
  return {
    git_hash: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    code_version: hash.digest('hex'), schema: EXPORT_SCHEMA,
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    scoring: 'benchmark score.js; post-inference truth only',
    audio_source: 'repository test-audio recordings, PCM float32 mono at 48000 Hz'
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
    if (!/^(render|run):[a-f0-9]{64}$/.test(key)) throw new Error('Invalid cache key');
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
}

export async function nodeExecutor({ workers = 2, clips, arrays, manifest, experiment, cacheDirectory }) {
  manifest = { ...manifest, audio: await audioHash(clips) };
  const pool = Array.from({ length: workers }, () => {
    const worker = new Worker(new URL('./node-worker.js', import.meta.url), { workerData: { clips, arrays, manifest, custom_scenes: experiment.custom_scenes, wrong_fix_m: experiment.wrong_fix_m, cacheDirectory } });
    return { worker, busy: false, reject: null };
  });
  let counter = 0;
  const execute = (job) => new Promise((resolve, reject) => {
    const slot = pool.find((s) => !s.busy);
    if (!slot) return reject(new Error('Worker pool exhausted'));
    slot.busy = true;
    slot.reject = reject;
    const id = counter++;
    const cleanup = () => { slot.busy = false; slot.reject = null; slot.worker.off('message', onMessage); slot.worker.off('error', onError); slot.worker.off('exit', onExit); };
    const onMessage = (data) => {
      if (data.id !== id) return;
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
  return { execute, manifest, close: async () => { await Promise.all(pool.map((s) => s.worker.terminate())); } };
}
