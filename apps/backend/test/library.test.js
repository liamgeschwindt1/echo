import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';

async function withServer(fn) {
  const server = createApp({ store: createMemoryStore(), env: {} }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  try {
    await fn(call);
  } finally {
    server.close();
  }
}

const array = { name: 'Pair', mics: { M1: [0, 0, 0], M2: [100, 0, 0] } };

test('library: store, list, replace and delete an array model', async () => {
  await withServer(async (call) => {
    assert.deepEqual((await call('GET', '/api/library/arrays')).body, { models: [] });
    const put = await call('PUT', '/api/library/arrays/pair', array);
    assert.equal(put.status, 200);
    assert.equal(put.body.id, 'pair');
    await call('PUT', '/api/library/arrays/pair', { ...array, name: 'Pair v2' });
    const list = (await call('GET', '/api/library/arrays')).body.models;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Pair v2');
    assert.equal((await call('DELETE', '/api/library/arrays/pair')).status, 204);
    assert.equal((await call('DELETE', '/api/library/arrays/pair')).status, 404);
  });
});

test('library: rejects bad models, ids and kinds', async () => {
  await withServer(async (call) => {
    assert.equal((await call('PUT', '/api/library/arrays/Bad_Id', array)).status, 400);
    assert.equal((await call('PUT', '/api/library/arrays/one', { name: 'One', mics: { M1: [0, 0, 0] } })).status, 400);
    assert.equal((await call('PUT', '/api/library/sounds/s1', { name: 'S', kind: 'upload', level_1m_db: 90, audio_b64: '***' })).status, 400);
    assert.equal((await call('GET', '/api/library/widgets')).status, 404);
  });
});

test('library: stores a calibrated generated sound', async () => {
  await withServer(async (call) => {
    const sound = { name: 'Tone', kind: 'generated', level_1m_db: 86, confirmed: true, synth: { type: 'tone', freq_hz: 1000, duration_s: 1 }, calibration: { measured_db: 80, distance_m: 2, method: 'reference meter', date: '2026-11-02' } };
    const put = await call('PUT', '/api/library/sounds/tone1', sound);
    assert.equal(put.status, 200);
    assert.equal((await call('GET', '/api/library/sounds')).body.models[0].calibration.distance_m, 2);
  });
});
