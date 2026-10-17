import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The simulator ships non-commercial clips, so it is built only when SIM_ENABLED=1.
const simEnabled = process.env.SIM_ENABLED === '1';

export default defineConfig({
  build: { rollupOptions: { input: { main: resolve('index.html'), ...(simEnabled ? { sim: resolve('sim.html') } : {}) } } },
  server: {
    host: true,
    headers: { 'Content-Security-Policy': "connect-src 'self' blob:" },
    proxy: { '/api': 'http://localhost:8787' }
  },
  preview: { host: true, allowedHosts: true, headers: { 'Content-Security-Policy': "connect-src 'self' blob:" } },
  worker: { format: 'es' }
});
