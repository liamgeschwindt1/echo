import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export async function engineAssetsPlugin(root = fileURLToPath(new URL('../../../', import.meta.url))) {
  const registryBytes = await readFile(join(root, 'engines/registry.json'));
  const registry = JSON.parse(registryBytes);
  if (!Array.isArray(registry) || registry.some((entry) => !/^LE-\d+$/.test(entry.id)) ||
      new Set(registry.map((entry) => entry.id)).size !== registry.length) {
    throw new Error('Invalid engine registry');
  }
  const assets = new Map([['engines/registry.json', registryBytes]]);
  for (const { id } of registry) for (const file of ['engine', 'kpi', 'refs']) {
    const name = `engines/${id}/${file}.json`;
    const bytes = await readFile(join(root, name));
    const data = JSON.parse(bytes);
    if ((file === 'engine' ? data.id : data.engine_id) !== id) {
      throw new Error(`Engine identity mismatch: ${name}`);
    }
    assets.set(name, bytes);
  }
  return {
    name: 'echo-engine-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path?.startsWith('/engines/')) return next();
        const bytes = assets.get(path.slice(1));
        response.setHeader('Content-Type', 'application/json');
        if (!bytes) {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: 'Engine artifact not found' }));
          return;
        }
        response.end(request.method === 'HEAD' ? undefined : bytes);
      });
    },
    generateBundle() {
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source });
    }
  };
}
