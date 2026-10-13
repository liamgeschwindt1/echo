import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, proxy: { '/api': 'http://localhost:8787' } },
  preview: { host: true, allowedHosts: true },
  worker: { format: 'es' }
});
