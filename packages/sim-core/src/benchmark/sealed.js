import { open, mkdir, readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from './cache.js';

export function sealedInputHash(experiment) {
  const registration = experiment.preregistration;
  if (!registration?.input_sha256 || !Array.isArray(registration.site_seeds)) throw new Error('Missing sealed input registration');
  const sites = registration.site_seeds.map(({ id, site_seed }) => {
    const scene = experiment.custom_scenes?.[id];
    if (!scene) throw new Error(`Missing sealed site ${id}`);
    const render_seed = experiment.scene_seeds?.[id]?.[0] ?? experiment.seeds[0];
    if (experiment.scene_seeds && render_seed !== site_seed) throw new Error(`Sealed render seed changed for ${id}`);
    return { id, site_seed, scene };
  });
  if (new Set(sites.map((s) => s.id)).size !== sites.length ||
      canonical(sites.map((s) => s.id)) !== canonical(experiment.scenes) || experiment.seeds.length !== 1 ||
      (experiment.scene_seeds && Object.keys(experiment.scene_seeds).length !== experiment.scenes.length)) throw new Error('Sealed population changed');
  const hash = createHash('sha256').update(canonical({ sites, renderSeed: experiment.scene_seeds ? null : experiment.seeds[0] })).digest('hex');
  if (hash !== registration.input_sha256) throw new Error('Sealed input hash mismatch');
  return hash;
}

export async function beginSealedRun(experiment, { directory, override, manifest = {} }) {
  const hash = sealedInputHash(experiment);
  if (override !== undefined && !override.trim()) throw new Error('Sealed override requires a nonempty reason');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${hash}.jsonl`);
  const entry = {
    state: 'started', at: new Date().toISOString(), input_sha256: hash,
    experiment_sha256: createHash('sha256').update(canonical(experiment)).digest('hex'),
    override_reason: override ?? null, producer: structuredClone(manifest)
  };
  try {
    const handle = await open(file, 'wx');
    try { await handle.writeFile(JSON.stringify(entry) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!override) throw new Error(`Sealed test already attempted; explicit --sealed-override <reason> required. Ledger: ${file}`);
    await readFile(file, 'utf8');
    await appendFile(file, JSON.stringify(entry) + '\n', { flush: true });
  }
  return {
    manifest: { ...entry, ledger: file },
    finish: async (state, details = {}) => appendFile(file, JSON.stringify({ state, at: new Date().toISOString(), ...details }) + '\n', { flush: true })
  };
}
