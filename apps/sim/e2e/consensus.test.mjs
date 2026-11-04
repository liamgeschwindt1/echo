import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { consensusCandidateWins, robustFix } from '@echo/sim-core/fix.js';
import { DEFAULT_SETTINGS } from '@echo/sim-core/scenario.js';

test('browser and CLI share deterministic legacy consensus ties and actual fixes', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)), configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent'
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    const fixtures = Array.from({ length: 20 }, (_, i) => {
      const source = [10 + i * 0.13, 30 - i * 0.17, 1.5];
      return [[0, 0, 1.5], [20, 0, 1.5], [10, -15, 1.5]].map((origin, j) => ({
        node_id: `n${j + 1}`, origin, azimuth_deg: Math.atan2(source[1] - origin[1], source[0] - origin[0]) * 180 / Math.PI,
        elevation_deg: 0, elevation_trusted: false, sigma_deg: 2.5
      }));
    });
    const settings = { ...DEFAULT_SETTINGS };
    const nodePairs = [];
    const nodeFixes = fixtures.map((rays) => robustFix(rays, { settings, onConsensus: (entry) => nodePairs.push(entry.pair), scenario: { nodes: rays.map((r) => ({ id: r.node_id, position: r.origin })), sources: [], buildings: [] } }));
    assert.ok(nodeFixes.every((f) => f?.position));
    const observed = await page.evaluate(async ({ fixtures, settings, modulePath }) => {
      const { robustFix, consensusCandidateWins } = await import(modulePath);
      const pairs = [];
      const fixes = fixtures.map((rays) => robustFix(rays, { settings, onConsensus: (entry) => pairs.push(entry.pair), scenario: { nodes: rays.map((r) => ({ id: r.node_id, position: r.origin })), sources: [], buildings: [] } }));
      return {
        tie: consensusCandidateWins([1, 2], 1e-28, ['n2', 'n1'], { set: [1, 2], cost: 1e-30, pair_key: 'n2\0n3' }),
        fixes, pairs
      };
    }, { fixtures, settings, modulePath: '/@fs' + fileURLToPath(new URL('../../../packages/sim-core/src/fix.js', import.meta.url)) });
    assert.equal(observed.tie, consensusCandidateWins([1, 2], 1e-28, ['n2', 'n1'], { set: [1, 2], cost: 1e-30, pair_key: 'n2\0n3' }));
    assert.deepEqual(observed.pairs, nodePairs);
    assert.equal(nodePairs.length, fixtures.length);
    for (let i = 0; i < nodeFixes.length; i++) {
      assert.deepEqual(observed.fixes[i].inlier_nodes, nodeFixes[i].inlier_nodes);
      assert.ok(observed.fixes[i].position.every((v, k) => Math.abs(v - nodeFixes[i].position[k]) < 1e-10));
    }
  } finally { await browser?.close(); await server.close(); }
});
