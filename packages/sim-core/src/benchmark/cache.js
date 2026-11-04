export function canonical(value) {
  if (ArrayBuffer.isView(value)) return canonical(Array.from(value));
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function contentHash(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function audioHash(clips) {
  const hashes = [];
  for (const [id, samples] of [...clips].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
    hashes.push({ id, samples: samples.length, sha256: hash });
  }
  return hashes;
}

export class MemoryCache {
  constructor() { this.entries = new Map(); }
  async get(key) { const value = this.entries.get(key); return value === undefined ? undefined : structuredClone(value); }
  async set(key, value) { this.entries.set(key, structuredClone(value)); }
}

export async function cacheKeys(scenario, { code_version, runtime, audio, analysis_settings, schema }) {
  const { ANALYSIS_THRESHOLDS } = await import('../scenario.js');
  const { settings, ...geometry } = scenario;
  const renderSettings = Object.fromEntries(Object.entries(settings).filter(([k]) => !(k in ANALYSIS_THRESHOLDS) && k !== 'analysis_mode' && !k.startsWith('measured_')));
  // localisation/detection bands are also consumed by render activity; retain them even though documented as thresholds.
  renderSettings.localisation_band_hz = settings.localisation_band_hz;
  renderSettings.detection_band_hz = settings.detection_band_hz;
  const render = await contentHash({ geometry, settings: renderSettings, code_version, runtime, audio });
  return { render: `render:${render}`, run: `run:${await contentHash({ render, analysis_settings, schema })}` };
}
