import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildStandaloneEnginesHtml, normaliseEngineRecord } from '../src/ui/dashboards.js';

const repoRoot = resolve(new URL('../../../', import.meta.url).pathname);
const outArg = process.argv.indexOf('--out');
const output = outArg >= 0 ? process.argv[outArg + 1] : 'docs/tracks/dashboards/engines-dashboard.html';
if (!output) throw new Error('Missing value for --out');
const readJson = async (path) => JSON.parse(await readFile(join(repoRoot, path), 'utf8'));
const registry = await readJson('engines/registry.json');
if (!Array.isArray(registry)) throw new Error('Engine registry must be an array');
const ids = registry.map((entry) => entry.id);
if (!ids.length || ids.some((id) => !/^LE-\d+$/.test(id)) || new Set(ids).size !== ids.length) {
  throw new Error('Engine registry is empty or invalid');
}
const engines = [];
for (const id of ids) {
  const [engine, kpi, refs] = await Promise.all([
    readJson(`engines/${id}/engine.json`),
    readJson(`engines/${id}/kpi.json`),
    readJson(`engines/${id}/refs.json`)
  ]);
  if (engine.id !== id || kpi.engine_id !== id || refs.engine_id !== id) {
    throw new Error(`Engine identity mismatch: ${id}`);
  }
  engines.push(normaliseEngineRecord(engine, kpi, refs));
}
const data = {
  pageId: 'engines',
  profile: engines[0]?.kpi?.headline?.on ? 'on' : 'off',
  compareMode: 'none',
  selectedEngineId: engines[0]?.id ?? null,
  engines,
  le0Id: engines.find((item) => item.id === 'LE-0')?.id ?? engines[0]?.id ?? null
};
const html = buildStandaloneEnginesHtml(data);
const outPath = resolve(repoRoot, output);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, html, 'utf8');
console.log(`Wrote ${outPath}`);
