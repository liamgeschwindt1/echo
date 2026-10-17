import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    headers: { 'Content-Security-Policy': "connect-src 'self' blob:" },
    proxy: { '/api': 'http://localhost:8787' }
  },
  preview: { host: true, allowedHosts: true, headers: { 'Content-Security-Policy': "connect-src 'self' blob:" } },
  worker: { format: 'es' }
});
