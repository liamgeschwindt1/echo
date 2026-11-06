import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixtureEngines, fixtureRegistry } from './fixtures/engines-fixtures.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function jsonRoute(page, fixtures) {
  return page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/engines/registry.json') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtureRegistry) });
    const match = url.pathname.match(/^\/engines\/(LE-[0-9]+)\/(engine|kpi|refs)\.json$/);
    if (match) {
      const [, id, file] = match;
      const payload = fixtures[id]?.[file];
      if (payload) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
      return route.fulfill({ status: 404, body: 'missing fixture' });
    }
    return route.continue();
  });
}

test('dashboard engines page navigates fixture history and static export opens offline', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'silent'
  });
  let browser;
  const temp = await mkdtemp(join(tmpdir(), 'echo-dashboards-e2e-'));
  const screenshotDir = join(root, 'docs', 'tracks', 'dashboards');
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await jsonRoute(page, fixtureEngines);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator('[data-view="dashboards"]').click();
    await page.locator('#dashEngineSelect').waitFor();
    await assert.doesNotReject(async () => page.locator('text=Headline KPIs').waitFor());
    await assert.doesNotReject(async () => page.locator('text=24-cell matrix heatmap').waitFor());
    await assert.doesNotReject(async () => page.locator('text=Source-count split').waitFor());
    await assert.doesNotReject(async () => page.locator('text=Node-count curve').waitFor());
    await assert.doesNotReject(async () => page.locator('text=Install-profile comparison').waitFor());
    await assert.doesNotReject(async () => page.locator('text=Detectable subsets').waitFor());
    await assert.doesNotReject(async () => page.locator('text=Building cells vs open cells').waitFor());
    await assert.doesNotReject(async () => page.locator('text=Tracking KPIs').waitFor());
    assert.equal(await page.locator('#dashEngineSelect').inputValue(), 'LE-0');
    await page.locator('[data-engine-nav="next"]').click();
    assert.equal(await page.locator('#dashEngineSelect').inputValue(), 'LE-1');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#dashEngineSelect').inputValue(), 'LE-2');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#dashEngineSelect').inputValue(), 'LE-1');
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, 'engines-page.png'), fullPage: true });
    assert.deepEqual(errors, []);

    const exportPath = join(temp, 'engines-dashboard.html');
    await promisify(execFile)(process.execPath, ['apps/sim/scripts/export-engines-dashboard.mjs', '--out', exportPath], { cwd: root });
    await access(exportPath);
    const offline = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const offlineErrors = [];
    offline.on('pageerror', (error) => offlineErrors.push(error.message));
    await offline.goto(`file://${exportPath}`);
    await offline.locator('text=Synthetic simulator outputs only').waitFor();
    await offline.locator('text=Headline KPIs').waitFor();
    assert.deepEqual(offlineErrors, []);
    await offline.close();
  } finally {
    await browser?.close();
    await server.close();
    await rm(temp, { recursive: true, force: true });
  }
});
