// Backend API: saved simulations, Gemini reports and the OpenStreetMap proxy. It serves no pages;
// the echo and sim frontends forward /api/* here over the private network.
// Report and map request/response bodies are never logged or stored.
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCatalogue } from '@echo/shared/catalogue.js';
import { fallbackReport, validateReport } from '@echo/shared/report-core.js';
import { callGemini } from './gemini.js';
import { createOsmApp } from './osm.js';
import { simulationsRouter } from './simulations.js';

const configDir = fileURLToPath(new URL('../../../packages/assets/public/config/', import.meta.url));
const readJson = (name) => JSON.parse(readFileSync(configDir + name, 'utf8'));

export function createApp({ store, env = process.env, osmOptions } = {}) {
  const GEMINI_MODEL = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const THINKING_LEVEL = env.GEMINI_THINKING_LEVEL || 'medium';
  const MAX_BODY_BYTES = Number(env.MAX_BODY_BYTES) || 2 * 1024 * 1024;
  const RATE_LIMIT_PER_MIN = Number(env.RATE_LIMIT_PER_MIN) || 10;
  const SIM_RATE_LIMIT_PER_MIN = Number(env.SIM_RATE_LIMIT_PER_MIN) || 240;
  const SIM_MAX_BODY_BYTES = Number(env.SIM_MAX_BODY_BYTES) || 25 * 1024 * 1024;
  const cat = buildCatalogue(readJson('labels.json'), readJson('priorities.json'));

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "connect-src 'self' blob:");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self), geolocation=(self)');
    next();
  });

  function rateLimiter(perMinute) {
    const hits = new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
    }, 60_000).unref();
    return (req, res, next) => {
      const now = Date.now();
      const key = req.ip || 'unknown';
      const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
      if (recent.length >= perMinute) {
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
      recent.push(now);
      hits.set(key, recent);
      next();
    };
  }
  const rateLimit = rateLimiter(RATE_LIMIT_PER_MIN);

  // Same-origin only: no CORS headers are ever sent, and cross-site Origins are refused.
  function sameOrigin(req, res, next) {
    const origin = req.get('origin');
    if (origin) {
      let host;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (host !== req.get('host')) {
        res.status(403).json({ error: 'cross_origin' });
        return;
      }
    }
    next();
  }

  function isValidRequest(body) {
    return body && typeof body === 'object' && Array.isArray(body.periods) && body.periods.every((p) => p && typeof p.id === 'string');
  }

  app.post('/api/report', sameOrigin, rateLimit, express.json({ limit: MAX_BODY_BYTES }), async (req, res) => {
    const request = req.body;
    if (!isValidRequest(request)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    if (!env.GEMINI_API_KEY) {
      res.json({ ...fallbackReport(request, 'GEMINI_API_KEY is not set on the server'), validation: null });
      return;
    }
    try {
      const { output, usage, model } = await callGemini(request, {
        apiKey: env.GEMINI_API_KEY,
        model: GEMINI_MODEL,
        thinkingLevel: THINKING_LEVEL
      });
      const result = validateReport(output, request, cat);
      if (!result.ok) {
        res.json({ ...fallbackReport(request, 'validation removed every event'), validation: result.validation, model, usage });
        return;
      }
      res.json({ ...result.report, validation: result.validation, model, generated_at: new Date().toISOString(), usage });
    } catch (err) {
      // Status only; never the body.
      console.error(`report failed: ${err.code || err.name || 'error'} ${err.status || ''}`);
      res.status(502).json({ error: 'gemini_unavailable', reason: err.publicMessage || 'Gemini request failed' });
    }
  });

  app.get('/healthz', async (req, res) => {
    try {
      await store.ping();
      res.json({ ok: true, store: store.kind });
    } catch {
      res.status(503).json({ ok: false, store: store.kind });
    }
  });

  app.use('/api/osm', sameOrigin, rateLimit, createOsmApp(osmOptions));
  app.use('/api/simulations', sameOrigin, rateLimiter(SIM_RATE_LIMIT_PER_MIN), simulationsRouter(store, { maxBodyBytes: SIM_MAX_BODY_BYTES }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'body_too_large' });
      return;
    }
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }
    next(err);
  });

  app.use((err, req, res, next) => {
    console.error(`request failed: ${req.method} ${req.path} ${err.code || err.name || 'error'}`);
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
