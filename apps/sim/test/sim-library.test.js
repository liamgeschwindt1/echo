import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createSimulationApi, describeResults, describeSummary, formatBytes, relativeTime, simFromUrl, urlForSim } from '../src/ui/library.js';

const id = '0b6f4c9e-6a0f-4f7e-9d7c-2b1f0c3a4d5e';

test('summary and results read like a short sentence', () => {
  assert.equal(describeSummary({ nodes: 1, sources: 2, buildings: 0, environment: { name: 'Battersea' } }), '1 node · 2 sources · 0 buildings · Battersea');
  assert.equal(describeResults({ has_results: false }), 'No results');
  assert.equal(describeResults({ has_results: true, located: 1, sources: 2 }), 'Results: located 1 of 2');
  assert.equal(formatBytes(1500), '2 kB');
  assert.equal(formatBytes(2_500_000), '2.5 MB');
});

test('relative times', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  assert.equal(relativeTime('2026-01-10T11:59:50Z', now), 'just now');
  assert.equal(relativeTime('2026-01-10T11:59:00Z', now), '1 minute ago');
  assert.equal(relativeTime('2026-01-10T11:30:00Z', now), '30 minutes ago');
  assert.equal(relativeTime('2026-01-10T09:00:00Z', now), '3 hours ago');
  assert.equal(relativeTime('2026-01-08T12:00:00Z', now), '2 days ago');
});

test('the URL remembers the open simulation and an older version', () => {
  assert.deepEqual(simFromUrl(`?sim=${id}`), { id, version: undefined });
  assert.deepEqual(simFromUrl(`?osm=1&sim=${id}&v=3`), { id, version: 3 });
  assert.equal(simFromUrl('?sim=../../etc'), null);
  assert.equal(urlForSim(`https://x.test/?osm=1&sim=${id}&v=2`, null), '/?osm=1');
  assert.equal(urlForSim('https://x.test/?osm=1', { id, version: 4, latest_version: 4 }), `/?osm=1&sim=${id}`);
  assert.equal(urlForSim('https://x.test/', { id, version: 2, latest_version: 4 }), `/?sim=${id}&v=2`);
});

test('API client sends JSON and turns errors into readable messages', async () => {
  const calls = [];
  const reply = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const queue = [
    reply(200, { simulations: [{ id }] }),
    reply(201, { id, latest_version: 2 }),
    reply(409, { error: 'version_conflict', message: 'saved elsewhere', latest_version: 3 }),
    reply(502, { error: 'backend_unavailable' }),
    new Response(null, { status: 204 })
  ];
  const api = createSimulationApi(async (url, init) => {
    calls.push([url, init.method, init.body]);
    return queue.shift();
  });
  assert.deepEqual(await api.list('bat tersea'), [{ id }]);
  assert.deepEqual(await api.addVersion(id, { scenario: {}, base_version: 1 }), { id, latest_version: 2 });
  await assert.rejects(api.addVersion(id, {}), (err) => err instanceof ApiError && err.code === 'version_conflict' && err.latest_version === 3);
  await assert.rejects(api.get(id), /backend is unavailable/);
  assert.equal(await api.remove(id), null);
  assert.deepEqual(calls.map(([u, m]) => [u, m]), [
    ['/api/simulations?q=bat%20tersea', 'GET'],
    [`/api/simulations/${id}/versions`, 'POST'],
    [`/api/simulations/${id}/versions`, 'POST'],
    [`/api/simulations/${id}`, 'GET'],
    [`/api/simulations/${id}`, 'DELETE']
  ]);
  assert.equal(calls[1][2], JSON.stringify({ scenario: {}, base_version: 1 }));
  const offline = createSimulationApi(async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(offline.list(), /Cannot reach the server/);
});
