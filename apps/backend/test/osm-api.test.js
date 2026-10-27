import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createOsmApp } from '../src/osm.js';
import { BATTERSEA, importOsm, mapBounds } from '@echo/sim-core/osm.js';

async function withApi(fetchImpl, run, options = {}) {
  const server = createOsmApp({ fetchImpl, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const post = (body, headers = {}) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  try {
    await run(post);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

test('map API deadlines cover stalled headers and bodies even when upstream ignores abort', async () => {
  for (const stallBody of [false, true]) {
    const signals = [];
    await withApi(async (url, { signal }) => {
      signals.push(signal);
      if (stallBody) return new Response(new ReadableStream());
      return new Promise(() => {});
    }, async post => {
      const started = Date.now();
      const response = await post(BATTERSEA);
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /api.openstreetmap.org: timed out.*overpass-api.de: timed out/);
      assert.ok(Date.now() - started < 1500, 'stalled request must finish within its deadline');
      assert.equal(signals.length, 2);
      assert.ok(signals.every(signal => signal.aborted));
    }, { timeoutMs: 25 });
  }
});

test('map API requests a bounded tile from official OSM API and returns importable data', async () => {
  const data = { elements: [{
    type: 'way', id: 1, tags: { building: 'yes', height: '20' },
    nodes: [1, 2, 3, 4, 1],
    geometry: [
      { lat: BATTERSEA.lat, lon: BATTERSEA.lon },
      { lat: BATTERSEA.lat, lon: BATTERSEA.lon + 0.0001 },
      { lat: BATTERSEA.lat + 0.0001, lon: BATTERSEA.lon + 0.0001 },
      { lat: BATTERSEA.lat + 0.0001, lon: BATTERSEA.lon },
      { lat: BATTERSEA.lat, lon: BATTERSEA.lon }
    ]
  }] };
  await withApi(async (url, options) => {
    assert.equal(url.origin, 'https://api.openstreetmap.org');
    assert.equal(url.pathname, '/api/0.6/map.json');
    const [south, west, north, east] = mapBounds(BATTERSEA);
    assert.equal(url.searchParams.get('bbox'), [west, south, east, north].join(','));
    assert.equal(options.headers.Accept, 'application/json');
    assert.ok(options.signal);
    return Response.json(data);
  }, async post => {
    const response = await post(BATTERSEA);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const received = await response.json();
    assert.deepEqual(received, data);
    const imported = importOsm(received);
    assert.equal(imported.buildings.length, 1);
    assert.equal(imported.buildings[0].size[2], 20);
    assert.equal(imported.environment.kind, 'osm');
  });
});

test('map API retries upstream errors and reports failure instead of fake map data', async () => {
  const calls = [];
  await withApi(async url => {
    calls.push(url.hostname);
    return new Response('unavailable', { status: 503 });
  }, async post => {
    const response = await post(BATTERSEA);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /api.openstreetmap.org: HTTP 503.*overpass-api.de: HTTP 503/);
    assert.equal(calls.length, 2);
  });
});

test('map API accepts a valid mirror response after invalid or incomplete upstream data', async () => {
  for (const first of [{ remark: 'timeout', elements: [] }, { invalid: true }]) {
    let calls = 0;
    await withApi(async url => {
      calls++;
      if (calls === 2) {
        assert.equal(url.hostname, 'overpass-api.de');
        assert.match(url.searchParams.get('data'), /way\[building\]/);
      }
      return Response.json(calls === 1 ? first : { elements: [] });
    }, async post => {
      const response = await post(BATTERSEA);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { elements: [] });
      assert.equal(calls, 2);
    });
  }
});

test('map API rejects invalid, oversized and cross-origin requests before fetching', async () => {
  await withApi(() => assert.fail('invalid request must not reach Overpass'), async post => {
    for (const input of [{ ...BATTERSEA, size: 10000 }, {}, { ...BATTERSEA, lat: '51' }, '{']) {
      const response = await post(input);
      assert.equal(response.status, 400);
      assert.ok((await response.json()).error);
    }
    const large = await post({ ...BATTERSEA, name: 'x'.repeat(3000) });
    assert.equal(large.status, 413);
    await large.json();
    const crossOrigin = await post(BATTERSEA, { Origin: 'https://other.example' });
    assert.equal(crossOrigin.status, 403);
    await crossOrigin.json();
  });
});
