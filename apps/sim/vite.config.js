import { defineConfig } from 'vite';
import { frontendConfig } from '@echo/web-server/vite.js';
import { codeManifest } from '../../packages/sim-core/src/benchmark/node.js';
import { engineAssetsPlugin } from './scripts/engine-assets.mjs';

export default defineConfig(async () => ({
  ...frontendConfig({ port: 5174 }),
  plugins: [await engineAssetsPlugin()],
  define: { __BENCHMARK_MANIFEST__: JSON.stringify(await codeManifest()) }
}));
