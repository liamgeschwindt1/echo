import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createApp } from '@echo/backend/src/app.js';
import { createMemoryStore } from '@echo/backend/src/store.js';
import { defaultScenario, newNode } from '@echo/sim-core/scenario.js';

test('Vite dev server serves the sim with same-origin CSP and forwards /api to the backend', async () => {
  const backend = createApp({ store: createMemoryStore(), env: {} }).listen(0, '127.0.0.1');
  await new Promise((r) => backend.once('listening', r));
  process.env.BACKEND_URL = `http://127.0.0.1:${backend.address().port}`;
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, open: false },
    logLevel: 'silent'
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    const base = `http://127.0.0.1:${address.port}`;
    for (const path of ['/', '/index.html', '/?osm=1']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('content-security-policy'), "connect-src 'self' blob:", path);
      const html = await response.text();
      assert.match(html, /id="environmentMenu"/);
      assert.match(html, /<summary>Environment<\/summary>/);
      assert.match(html, /id="osmLoad">Load map<\/button>/);
      assert.match(html, /id="osmCancel" hidden>Cancel loading<\/button>/);
      assert.match(html, /id="osmStatus" role="status"/);
      assert.match(html, /id="osmClear">Remove map<\/button>/);
      assert.match(html, /id="osmLat"/);
      assert.match(html, /id="osmLon"/);
      for (const id of ['simNew', 'simOpen', 'simSave', 'simSaveAs', 'simSaveDlg', 'simOpenDlg', 'simTitle']) assert.match(html, new RegExp(`id="${id}"`), id);
    }
    const invalid = await fetch(`${base}/api/osm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 100, lon: 0, size: 600 })
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /latitude/);

    const scenario = defaultScenario();
    scenario.nodes.push(newNode('n1', 0, 0));
    const saved = await fetch(`${base}/api/simulations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ name: 'via vite', scenario })
    });
    assert.equal(saved.status, 201, 'same-origin save through the dev proxy is accepted');
    const list = await (await fetch(`${base}/api/simulations`)).json();
    assert.deepEqual(list.simulations.map((s) => s.name), ['via vite']);
  } finally {
    // Keep-alive sockets on either side of the Vite proxy would otherwise keep the process alive.
    server.httpServer.closeAllConnections();
    await server.close();
    backend.closeAllConnections();
    await new Promise((r) => backend.close(r));
    delete process.env.BACKEND_URL;
  }
});
