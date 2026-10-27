// Production server for a frontend service: serves the built files and forwards /api/* to the backend.
// The browser only ever talks to its own origin, so the strict connect-src CSP stays in place and the
// backend does not need to be public. Request and response bodies are streamed, never logged.
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CSP } from './vite.js';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self), geolocation=(self)');
  next();
}

export function apiProxy(backendUrl, { timeoutMs = 120_000 } = {}) {
  const target = new URL(backendUrl);
  const client = target.protocol === 'https:' ? https : http;
  const basePath = target.pathname.replace(/\/$/, '');
  return (req, res) => {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    // Keep the browser's Host so the backend's same-origin check compares against the page origin.
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-forwarded-proto'] = req.protocol;
    headers['x-forwarded-for'] = req.ip;
    const upstream = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: basePath + req.originalUrl,
        headers,
        timeout: timeoutMs
      },
      (up) => {
        const out = {};
        for (const [k, v] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(k)) out[k] = v;
        res.writeHead(up.statusCode || 502, out);
        up.pipe(res);
      }
    );
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', (err) => {
      console.error(`backend unavailable: ${err.code || err.message}`);
      if (!res.headersSent) res.status(502).json({ error: 'backend_unavailable' });
      else res.destroy();
    });
    req.pipe(upstream);
  };
}

export function createFrontendServer({ distDir, backendUrl } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api', apiProxy(backendUrl));
  if (existsSync(distDir)) {
    app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(join(distDir, 'index.html')));
  } else {
    app.get('*', (req, res) => res.status(503).send('Frontend is not built. Run the build first.'));
  }
  return app;
}

export function startFrontendServer({ name, distDir }) {
  const port = Number(process.env.PORT) || 8080;
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:8787';
  const app = createFrontendServer({ distDir, backendUrl });
  return app.listen(port, '::', () => console.log(`${name} frontend on :${port}, api -> ${backendUrl}`));
}
