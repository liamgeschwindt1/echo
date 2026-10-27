import test from 'node:test';
import assert from 'node:assert/strict';
import { bindOsmLoader } from '../src/ui/osm.js';

function setup(load, { apply = () => {}, timeoutMs = 1000 } = {}) {
  const button = new EventTarget();
  const cancel = new EventTarget();
  const status = { textContent: '' };
  const run = bindOsmLoader({ button, cancel, status, load, apply, timeoutMs });
  const idle = () => {
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Load map');
    assert.equal(cancel.hidden, true);
  };
  return { button, cancel, status, run, idle };
}

test('OSM loading always leaves busy state on a hard timeout and permits retry', async () => {
  let calls = 0;
  let signal;
  const ui = setup(s => {
    signal = s;
    calls++;
    return new Promise(() => {});
  }, { timeoutMs: 20, apply: () => assert.fail('timeout must not apply a map') });
  const started = Date.now();
  const pending = ui.run();
  assert.equal(ui.button.disabled, true);
  assert.equal(ui.cancel.hidden, false);
  assert.match(ui.button.textContent, /Loading.*left/);
  await pending;
  assert.ok(Date.now() - started < 1000);
  assert.equal(signal.aborted, true);
  assert.match(ui.status.textContent, /timed out/);
  ui.idle();
  await ui.run();
  assert.equal(calls, 2);
  ui.idle();
});

test('cancel restores controls immediately and late results cannot change the scene', async () => {
  let complete;
  let signal;
  const ui = setup(s => {
    signal = s;
    return new Promise(resolve => { complete = resolve; });
  }, { apply: () => assert.fail('cancelled map must not be applied') });
  const pending = ui.run();
  await ui.run();
  ui.cancel.dispatchEvent(new Event('click'));
  await pending;
  ui.idle();
  assert.equal(signal.aborted, true);
  assert.match(ui.status.textContent, /cancelled.*unchanged/);
  complete({ buildings: [] });
  await Promise.resolve();
  assert.match(ui.status.textContent, /cancelled/);
});

test('OSM loader applies successful result once and surfaces async and synchronous errors', async () => {
  let applied = 0;
  const data = { buildings: [] };
  const ui = setup(async () => data, { apply: value => {
    assert.equal(value, data);
    applied++;
  } });
  await ui.run();
  assert.equal(applied, 1);
  assert.equal(ui.status.textContent, 'Map loaded.');
  ui.idle();
  for (const load of [
    () => { throw new Error('Invalid latitude'); },
    async () => { throw new Error('Overpass unavailable'); }
  ]) {
    const failed = setup(load);
    await failed.run();
    assert.match(failed.status.textContent, /OpenStreetMap load failed:/);
    failed.idle();
  }
});
