import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { init, parse } from 'es-module-lexer';

export async function renderFingerprint({ sourceRoot = new URL('../', import.meta.url), readSource = (url) => readFile(url, 'utf8') } = {}) {
  await init;
  const sources = new Map();
  async function visit(url) {
    if (url.protocol !== 'file:' || !url.pathname.startsWith(sourceRoot.pathname) || url.search || url.hash) throw new Error(`Unsupported renderer dependency: ${url}`);
    const name = relative(sourceRoot.pathname, url.pathname);
    if (sources.has(name)) return;
    const source = await readSource(url);
    sources.set(name, source);
    const [imports] = parse(source, name);
    for (const entry of imports) {
      if (entry.d === -2) continue;
      if (!entry.n?.startsWith('.')) throw new Error(`Renderer fingerprint requires literal, local module dependencies: ${name}`);
      await visit(new URL(entry.n, url));
    }
  }
  await visit(new URL('render.js', sourceRoot));
  const hash = createHash('sha256');
  const files = [...sources].sort(([a], [b]) => a.localeCompare(b)).map(([name, source]) => {
    hash.update(name); hash.update(source);
    return { name, sha256: createHash('sha256').update(source).digest('hex') };
  });
  return { render_code_version: hash.digest('hex'), render_source_files: files };
}
