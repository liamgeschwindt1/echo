import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createApp } from '@echo/backend/src/app.js';
import { createMemoryStore } from '@echo/backend/src/store.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function closeNumbers(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') assert.ok(Math.abs(a - b) <= 1e-7, `${path}: ${a} vs ${b}`);
  else if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a), Object.keys(b), path);
    for (const key of Object.keys(a)) closeNumbers(a[key], b[key], `${path}.${key}`);
  } else assert.equal(a, b, path);
}
test('Testing small sweep pauses, survives reload, matches CLI and drills down', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'echo-testing-e2e-'));
  const backend = createApp({ store: createMemoryStore(), env: {} }).listen(0, '127.0.0.1');
  await new Promise((resolve) => backend.once('listening', resolve));
  process.env.BACKEND_URL = `http://127.0.0.1:${backend.address().port}`;
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)), server: { host: '127.0.0.1', port: 0 }, logLevel: 'silent' });
  let browser;
  let success = false;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator('[data-view="testing"]').click();
    await page.locator('#testName').fill('Browser parity');
    await page.locator('#testSeeds').fill('1');
    await page.locator('#testMode').selectOption('grid');
    await page.locator('.testing-group').filter({ has: page.locator('[data-pick="heading_error_sigma_deg"]') }).locator('summary').click();
    await page.locator('[data-pick="heading_error_sigma_deg"]').check();
    await page.locator('[data-values="heading_error_sigma_deg"]').fill('0, 2.5');
    await page.locator('[data-values="heading_error_sigma_deg"]').blur();
    assert.match(await page.locator('#testEstimate').textContent(), /4 runs/);
    const screenshots = join(root, 'docs', 'screenshots');
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: join(screenshots, 'testing-setup.png') });
    await page.locator('#testStart').click();
    await page.waitForFunction(() => document.getElementById('testProgress').value > 0, null, { timeout: 120000 });
    await page.locator('#testPause').click();
    await page.waitForFunction(() => document.getElementById('testPause').textContent === 'Resume');
    await page.reload();
    await page.locator('[data-view="testing"]').click();
    await page.locator('#testSaved .testing-saved').first().getByRole('button', { name: 'Resume unfinished', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('testResults').dataset.runs === '4', null, { timeout: 180000 });
    const saved = await page.evaluate(async () => {
      const { testingStore } = await import('/src/ui/testing-store.js');
      return (await testingStore.all('runs')).find((r) => r.name === 'Browser parity' && r.status === 'complete');
    });
    assert.equal(saved.report.runs.length, 4);
    assert.ok(saved.report.runs.some((r) => r.scores.sources.some((s) => Number.isFinite(s.horizontal_m))), 'At least one actual fix, not just no-fix parity');
    const output = join(directory, 'cli.json');
    await promisify(execFile)(process.execPath, ['scripts/benchmark.mjs', '--experiment', 'docs/experiments/ui-parity.json', '--out', output], { cwd: root, timeout: 150000 });
    const cli = JSON.parse(await readFile(output, 'utf8'));
    await writeFile(join(directory, 'browser.json'), JSON.stringify(saved.report));
    assert.deepEqual(saved.manifest.audio, cli.manifest.audio);
    assert.equal(saved.manifest.code_version, cli.manifest.code_version);
    assert.deepEqual(saved.report.runs.map((r) => r.job.id), cli.runs.map((r) => r.job.id));
    closeNumbers(saved.report.runs.map((r) => r.scores), cli.runs.map((r) => r.scores));
    for (let i = 0; i < cli.summary.length; i++) {
      const { runtime_ms: _a, ...a } = saved.report.summary[i].metrics;
      const { runtime_ms: _b, ...b } = cli.summary[i].metrics;
      closeNumbers(a, b, cli.summary[i].key);
    }
    for (const [id, ext] of [['testJson', 'json'], ['testCsv', 'csv'], ['testHtml', 'html']]) {
      const download = page.waitForEvent('download');
      await page.locator(`#${id}`).click();
      const file = await download;
      assert.equal(file.suggestedFilename(), `benchmark.${ext}`);
      await file.saveAs(join(directory, `browser.${ext}`));
    }
    const json = JSON.parse(await readFile(join(directory, 'browser.json'), 'utf8'));
    assert.equal(json.runs.length, 4);
    assert.match(await readFile(join(directory, 'browser.html'), 'utf8'), /<svg/);
    assert.ok(await page.locator('#panelTesting').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'Wide metrics scroll inside their table, not across the whole workspace');
    await page.locator('#testResults').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshots, 'testing-results.png') });
    await page.locator('#testMetricTable td[data-config]').first().click();
    await page.locator('#testDrilldown button').first().click();
    assert.match(await page.locator('#loadNotice').textContent(), /Testing snapshot: sparse_20, seed 1/);
    assert.deepEqual(errors, []);
    success = true;
  } finally {
    await browser?.close();
    server.httpServer.closeAllConnections();
    await server.close();
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
    delete process.env.BACKEND_URL;
    if (success) await rm(directory, { recursive: true });
    else console.error(`Failure artifacts: ${directory}`);
  }
});
