import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFrontendServer } from '../src/server.js';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

test('frontend server serves the build with CSP and forwards /api to the backend', async () => {
  const seen = [];
  const backend = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin, body });
      res.writeHead(201, { 'Content-Type': 'application/json', 'X-Upstream': 'yes' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const backendUrl = await listen(backend);
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>sim</title>');
  const front = createFrontendServer({ distDir: dist, backendUrl }).listen(0, '127.0.0.1');
  await new Promise((r) => front.once('listening', r));
  const base = `http://127.0.0.1:${front.address().port}`;
  try {
    const page = await fetch(`${base}/some/deep/link`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-security-policy'), "connect-src 'self' blob:");
    assert.match(await page.text(), /<title>sim<\/title>/);

    const res = await fetch(`${base}/api/simulations?q=a`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{"name":"x"}' });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('x-upstream'), 'yes');
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(seen[0], { method: 'POST', url: '/api/simulations?q=a', host: new URL(base).host, origin: base, body: '{"name":"x"}' });
  } finally {
    front.close();
    backend.close();
  }
});

test('frontend server answers 502 when the backend is down', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  const front = createFrontendServer({ distDir: dist, backendUrl: 'http://127.0.0.1:1' }).listen(0, '127.0.0.1');
  await new Promise((r) => front.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${front.address().port}/api/simulations`);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'backend_unavailable' });
  } finally {
    front.close();
  }
});
