// Stateless server: serves the built app and POST /api/report.
// Request and response bodies are never logged or stored.
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCatalogue } from '../src/core/catalogue.js';
import { fallbackReport, validateReport } from '../src/core/report-core.js';
import { callGemini } from './gemini.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const configDir = existsSync(join(distDir, 'config')) ? join(distDir, 'config') : join(root, 'public', 'config');

const PORT = Number(process.env.PORT) || 8787;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || 'medium';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 2 * 1024 * 1024;
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 10;

const readJson = (name) => JSON.parse(readFileSync(join(configDir, name), 'utf8'));
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

const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    res.status(429).json({ error: 'rate_limited' });
    return;
  }
  recent.push(now);
  hits.set(key, recent);
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
}, 60_000).unref();

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
  if (!process.env.GEMINI_API_KEY) {
    res.json({ ...fallbackReport(request, 'GEMINI_API_KEY is not set on the server'), validation: null });
    return;
  }
  try {
    const { output, usage, model } = await callGemini(request, {
      apiKey: process.env.GEMINI_API_KEY,
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

if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: 'index.html', maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(join(distDir, 'index.html')));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`echo server on :${PORT} (model ${GEMINI_MODEL}, key ${process.env.GEMINI_API_KEY ? 'set' : 'MISSING'})`);
});
