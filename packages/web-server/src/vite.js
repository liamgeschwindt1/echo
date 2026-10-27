// Vite settings shared by the echo and sim frontends.
import { fileURLToPath } from 'node:url';

export const CSP = "connect-src 'self' blob:";
export const assetsDir = fileURLToPath(new URL('../../assets/public', import.meta.url));
export const backendUrl = () => process.env.BACKEND_URL || 'http://localhost:8787';

export function frontendConfig({ port }) {
  const proxy = { '/api': { target: backendUrl(), changeOrigin: false } };
  return {
    publicDir: assetsDir,
    server: { host: true, port, headers: { 'Content-Security-Policy': CSP }, proxy },
    preview: { host: true, allowedHosts: true, headers: { 'Content-Security-Policy': CSP }, proxy },
    worker: { format: 'es' }
  };
}
