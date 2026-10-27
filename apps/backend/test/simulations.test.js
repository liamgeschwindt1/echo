import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newBuilding, newNode, newSource } from '@echo/sim-core/scenario.js';
import { createApp } from '../src/app.js';
import { createMemoryStore, createPgStore } from '../src/store.js';
import { createPool, migrate } from '../src/db.js';
import { summarise } from '../src/simulations.js';

function scenario() {
  const s = defaultScenario();
  s.nodes.push(newNode('n1', 0, 0), newNode('n2', 30, 0));
  s.sources.push(newSource('s1', 'dog', 10, 20));
  s.buildings.push(newBuilding('b1', 50, 50));
  return s;
}

const results = [{ source_id: 's1', error_3d_m: 1.5, nodes: [{ node_id: 'n1' }], track: { observations: [], fixes: [] } }];

async function withServer(store, fn) {
  const server = createApp({ store, env: {} }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

const stores = [['memory', async () => ({ store: createMemoryStore(), done: async () => {} })]];
if (process.env.TEST_DATABASE_URL) {
  stores.push([
    'postgres',
    async () => {
      const pool = createPool(process.env.TEST_DATABASE_URL);
      await pool.query('DROP TABLE IF EXISTS simulation_versions, simulations, schema_migrations');
      await migrate(pool, { log: () => {} });
      return { store: createPgStore(pool), done: () => pool.end() };
    }
  ]);
}

for (const [kind, open] of stores) {
  test(`${kind}: create, list, open, version, rename and delete a simulation`, async () => {
    const { store, done } = await open();
    try {
      await withServer(store, async (call) => {
        const created = await call('POST', '/api/simulations', { name: '  Battersea test  ', description: 'two nodes', scenario: scenario(), results, note: 'first' });
        assert.equal(created.status, 201);
        const id = created.body.id;
        assert.match(id, /^[0-9a-f-]{36}$/);
        assert.equal(created.body.name, 'Battersea test');
        assert.equal(created.body.latest_version, 1);
        assert.deepEqual(created.body.summary, { nodes: 2, sources: 1, buildings: 1, environment: null, has_results: true, located: 1 });
        assert.equal(created.body.version.version, 1);
        assert.deepEqual(created.body.version.results, results);

        const list = await call('GET', '/api/simulations');
        assert.equal(list.status, 200);
        assert.deepEqual(list.body.simulations.map((s) => s.id), [id]);
        assert.equal(list.body.simulations[0].scenario, undefined, 'list omits the heavy payload');

        const edited = scenario();
        edited.nodes.push(newNode('n3', -30, 0));
        const v2 = await call('POST', `/api/simulations/${id}/versions`, { scenario: edited, results: null, note: 'added n3', base_version: 1 });
        assert.equal(v2.status, 201);
        assert.equal(v2.body.latest_version, 2);
        assert.equal(v2.body.summary.nodes, 3);
        assert.equal(v2.body.summary.has_results, false);

        const stale = await call('POST', `/api/simulations/${id}/versions`, { scenario: edited, base_version: 1 });
        assert.equal(stale.status, 409);
        assert.equal(stale.body.error, 'version_conflict');
        assert.equal(stale.body.latest_version, 2);

        const latest = await call('GET', `/api/simulations/${id}`);
        assert.equal(latest.body.version.version, 2);
        assert.deepEqual(latest.body.version.scenario.nodes.map((n) => n.id), ['n1', 'n2', 'n3']);
        assert.equal(latest.body.version.results, null);

        const first = await call('GET', `/api/simulations/${id}/versions/1`);
        assert.equal(first.status, 200);
        assert.deepEqual(first.body.version.scenario.nodes.map((n) => n.id), ['n1', 'n2']);
        assert.deepEqual(first.body.version.results, results);
        assert.equal(first.body.version.note, 'first');

        const versions = await call('GET', `/api/simulations/${id}/versions`);
        assert.deepEqual(versions.body.versions.map((v) => [v.version, v.note, v.has_results]), [[2, 'added n3', false], [1, 'first', true]]);
        assert.ok(versions.body.versions.every((v) => v.size_bytes > 0 && v.scenario === undefined));

        const renamed = await call('PATCH', `/api/simulations/${id}`, { name: 'Renamed' });
        assert.equal(renamed.body.name, 'Renamed');
        assert.equal(renamed.body.description, 'two nodes');
        assert.equal((await call('GET', '/api/simulations?q=renam')).body.simulations.length, 1);
        assert.equal((await call('GET', '/api/simulations?q=nothing')).body.simulations.length, 0);

        assert.equal((await call('DELETE', `/api/simulations/${id}`)).status, 204);
        assert.equal((await call('GET', `/api/simulations/${id}`)).status, 404);
        assert.equal((await call('GET', `/api/simulations/${id}/versions`)).status, 404);
        assert.equal((await call('DELETE', `/api/simulations/${id}`)).status, 404);
      });
    } finally {
      await done();
    }
  });

  test(`${kind}: rejects bad input`, async () => {
    const { store, done } = await open();
    try {
      await withServer(store, async (call) => {
        assert.equal((await call('POST', '/api/simulations', { scenario: scenario() })).status, 400, 'name required');
        assert.equal((await call('POST', '/api/simulations', { name: 'x'.repeat(201), scenario: scenario() })).status, 400);
        const badScenario = await call('POST', '/api/simulations', { name: 'bad', scenario: { version: '9.9' } });
        assert.equal(badScenario.status, 400);
        assert.match(badScenario.body.message, /scenario: unsupported scenario version/);
        const inside = scenario();
        inside.nodes.push(newNode('n9', 50, 50));
        assert.equal((await call('POST', '/api/simulations', { name: 'inside', scenario: inside })).status, 400, 'placement errors are rejected');
        assert.equal((await call('POST', '/api/simulations', { name: 'r', scenario: scenario(), results: { nope: 1 } })).status, 400);
        assert.equal((await call('POST', '/api/simulations', '{not json')).status, 400);
        assert.equal((await call('GET', '/api/simulations/not-a-uuid')).status, 400);
        assert.equal((await call('GET', '/api/simulations/00000000-0000-4000-8000-000000000000')).status, 404);
        const created = await call('POST', '/api/simulations', { name: 'ok', scenario: scenario() });
        assert.equal((await call('GET', `/api/simulations/${created.body.id}/versions/0`)).status, 400);
        assert.equal((await call('GET', `/api/simulations/${created.body.id}/versions/7`)).status, 404);
        assert.equal((await call('PATCH', `/api/simulations/${created.body.id}`, { name: '   ' })).status, 400);
      });
    } finally {
      await done();
    }
  });

  test(`${kind}: refuses cross-origin writes`, async () => {
    const { store, done } = await open();
    try {
      await withServer(store, async (call) => {
        const res = await call('POST', '/api/simulations', { name: 'x', scenario: scenario() }, { Origin: 'https://evil.example' });
        assert.equal(res.status, 403);
        assert.equal((await call('GET', '/api/simulations')).body.simulations.length, 0);
      });
    } finally {
      await done();
    }
  });
}

test('summary records the map area', () => {
  const s = { ...scenario(), environment: { kind: 'osm', name: 'Battersea', lat: 51.48, lon: -0.14, features: [] } };
  assert.deepEqual(summarise(s, null).environment, { kind: 'osm', name: 'Battersea', lat: 51.48, lon: -0.14 });
});

test('migrations are forward-only SQL files applied in order', async () => {
  const { migrationFiles } = await import('../src/db.js');
  const files = migrationFiles();
  assert.ok(files.length >= 1);
  assert.equal(files[0].name, '001_simulations.sql');
  assert.match(files[0].sql, /CREATE TABLE simulations/);
  assert.match(files[0].sql, /ON DELETE CASCADE/);
});
