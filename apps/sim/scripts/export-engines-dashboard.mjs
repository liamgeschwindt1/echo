import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { buildStandaloneEnginesHtml, mapBaselineToKpi, normaliseEngineRecord } from '../src/ui/dashboards.js';

const repoRoot = resolve(new URL('../../../', import.meta.url).pathname);
const outArg = process.argv.indexOf('--out');
const output = outArg >= 0 ? process.argv[outArg + 1] : 'docs/tracks/dashboards/engines-dashboard.html';
if (!output) throw new Error('Missing value for --out');
const readJson = async (path) => JSON.parse(await readFile(join(repoRoot, path), 'utf8'));
let registry = null;
try {
  registry = await readJson('engines/registry.json');
} catch {}
const ids = Array.isArray(registry?.engines) ? registry.engines.map((entry) => entry.id).filter(Boolean) : [];
const engines = [];
for (const id of ids) {
  try {
    const [engine, kpi, refs] = await Promise.all([
      readJson(`engines/${id}/engine.json`),
      readJson(`engines/${id}/kpi.json`),
      readJson(`engines/${id}/refs.json`)
    ]);
    engines.push(normaliseEngineRecord(engine, kpi, refs));
  } catch {}
}
if (!engines.length) {
  const baseline = await readJson('baselines/matrix-baseline-r3.json');
  engines.push({
    id: 'LE-0',
    parent: null,
    date: null,
    status: 'baseline',
    source_hash: baseline?.producer?.code_version ?? null,
    options: {},
    refs: { baseline: 'baselines/matrix-baseline-r3.json' },
    refs_path: 'engines/LE-0/refs.json',
    kpi: mapBaselineToKpi(baseline)
  });
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
