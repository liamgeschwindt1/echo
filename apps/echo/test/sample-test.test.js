import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildCatalogue } from '@echo/shared/catalogue.js';
import { expectedNight, normalizeMono, prepareSamples, scoreSamples } from '../src/sample-test.js';
import viteConfig from '../vite.config.js';

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const manifest = await json('../../../packages/assets/public/test-audio/manifest.json');
const cat = buildCatalogue(await json('../../../packages/assets/public/config/labels.json'), await json('../../../packages/assets/public/config/priorities.json'));

test('15 explicit slots, 13 reproducible five-second fixtures, all accepted YAMNet names exist', async () => {
  assert.equal(manifest.clips.length, 15);
  assert.deepEqual(manifest.clips.filter((c) => !c.file).map((c) => c.id), ['gunshot', 'scream']);
  const classMap = await readFile(new URL('../../../packages/assets/public/model/yamnet_class_map.csv', import.meta.url), 'utf8');
  const names = classMap.trim().split('\n').slice(1).map((line) => line.replace(/^[^,]+,[^,]+,/, '').trim().replace(/^"|"$/g, ''));
  const metadata = await readFile(new URL('../../../packages/assets/public/test-audio/esc50.csv', import.meta.url), 'utf8');
  for (const clip of manifest.clips) {
    for (const name of clip.yamnet) assert.ok(names.includes(name), `${clip.id}: unknown YAMNet label ${name}`);
    for (const label of clip.labels) assert.ok(cat.classById.has(label), `${clip.id}: unknown app label ${label}`);
    const expected = expectedNight(clip, cat);
    if (expected) assert.equal(clip.max_priority, expected, `${clip.id}: manifest priority differs from priorities.json`);
    if (!clip.file) continue;
    const first = metadata.trim().split('\n').slice(1).find((line) => line.split(',')[3] === clip.id);
    assert.equal(first.split(',')[0], clip.file);
    const wav = await readFile(new URL(`../../../packages/assets/public/test-audio/${clip.file}`, import.meta.url));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    let rate, byteRate, dataBytes;
    for (let offset = 12; offset + 8 <= wav.length;) {
      const size = wav.readUInt32LE(offset + 4);
      const type = wav.toString('ascii', offset, offset + 4);
      if (type === 'fmt ') {
        rate = wav.readUInt32LE(offset + 12);
        byteRate = wav.readUInt32LE(offset + 16);
      }
      if (type === 'data') dataBytes = size;
      offset += 8 + size + (size % 2);
    }
    assert.equal(rate, 44100);
    assert.equal(dataBytes / byteRate, 5);
  }
});

test('static, development and server surfaces restrict connections to our host', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const server = await readFile(new URL('../../backend/src/app.js', import.meta.url), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy" content="connect-src 'self' blob:"/);
  assert.match(server, /setHeader\('Content-Security-Policy', "connect-src 'self' blob:"\)/);
  assert.equal(viteConfig.server.headers['Content-Security-Policy'], "connect-src 'self' blob:");
  assert.equal(viteConfig.preview.headers['Content-Security-Policy'], "connect-src 'self' blob:");
});

test('night expectations follow actual priorities; ambiguous classes stay unmapped', () => {
  const expected = (id) => expectedNight(manifest.clips.find((c) => c.id === id), cat);
  assert.equal(expected('chainsaw'), 'alert');
  assert.equal(expected('laughing'), 'flag');
  assert.equal(expected('rain'), 'ignore');
  assert.equal(expected('footsteps'), 'ignore');
  assert.equal(expected('door_wood_knock'), null);
  assert.equal(expected('engine'), null);
  assert.equal(expected('crying_baby'), null);
});

test('mono normalization preserves length and waveform; rejects silent audio', () => {
  const data = Float32Array.from([0, -0.2, 0.4, 0.1]);
  const buffer = { length: 4, numberOfChannels: 2, getChannelData: () => data };
  const { samples, gain } = normalizeMono(buffer);
  assert.equal(samples.length, 4);
  assert.ok(Math.abs(Math.max(...samples) - 10 ** (-6 / 20)) < 1e-6);
  assert.ok(Math.abs(samples[1] / samples[2] + 0.5) < 1e-6);
  assert.ok(Math.abs(gain - 10 ** (-6 / 20) / data[2]) < 1e-6);
  assert.throws(() => normalizeMono({ length: 4, numberOfChannels: 1, getChannelData: () => new Float32Array(4) }), /silent/);
});

test('track preparation preserves clips, clears rolling windows and omits audio from metadata', async () => {
  const ctx = {
    sampleRate: 10,
    decodeAudioData: async () => ({ duration: 5, length: 50, numberOfChannels: 1, getChannelData: () => new Float32Array(50).fill(0.25) }),
    createBuffer: (_, length, rate) => {
      const data = new Float32Array(length);
      return { duration: length / rate, data, copyToChannel: (samples, _, offset) => data.set(samples, offset) };
    }
  };
  const clip = manifest.clips[0];
  const prepared = await prepareSamples(ctx, { ...manifest, clips: [clip, manifest.clips[2]] },
    new Map([[clip.id, { name: 'licensed.wav', arrayBuffer: async () => new ArrayBuffer(0) }]]), 10, () => {});
  assert.equal(prepared.test.gap_s, 13);
  assert.equal(prepared.test.clips[0].start_s, 13);
  assert.equal(prepared.test.clips[0].end_s, 18);
  assert.equal(prepared.buffer.duration, 31);
  assert.ok(prepared.buffer.data.slice(0, 130).every((v) => v === 0));
  assert.ok(prepared.buffer.data.slice(180).every((v) => v === 0));
  assert.deepEqual(prepared.test.missing, ['scream']);
  assert.ok(!('samples' in prepared.test.clips[0]));
});

test('scoring counts overlapping trailing windows and separates recognition, missed alerts and false alerts', () => {
  const clip = { ...manifest.clips.find((c) => c.id === 'fireworks'), start_s: 13, end_s: 18 };
  const run = { clips: [clip], started_ms: 0, finished_ms: 31_000 };
  const rows = [
    { model: 'yamnet', timestamp: new Date(19_000).toISOString(), window_s: 0.975, top1_label: 'Fireworks', top1_score: 0.9 },
    { model: 'clap', timestamp: new Date(20_000).toISOString(), window_s: 5, top1_label: 'gunshot', top1_score: 0.5, top2_label: 'fireworks_bang', top2_score: 0.3 }
  ];
  const periods = [{ id: 'p1', start: new Date(13_000).toISOString(), end: new Date(18_000).toISOString(), label: 'gunshot', default_priority: 'alert' }];
  const [result] = scoreSamples(run, rows, periods, cat);
  assert.equal(result.models.yamnet.windows, 0);
  assert.equal(result.models.yamnet.recognition, 'no readings');
  assert.equal(result.models.clap.recognition, 'top 5');
  assert.equal(result.excessive_priority, true);
  assert.equal(result.priority_match, false);
  assert.equal(scoreSamples({ ...run, finished_ms: null }, rows, periods, cat)[0].excessive_priority, null);
  assert.equal(scoreSamples({ ...run, finished_ms: 14_000 }, rows, periods, cat)[0].priority_match, null);
});

test('ignored clips can pass without a period; missing target readings cannot become an alert pass', () => {
  const clip = { ...manifest.clips.find((c) => c.id === 'rain'), start_s: 13, end_s: 18 };
  const run = { clips: [clip], started_ms: 0, finished_ms: 31_000 };
  const rows = [{ model: 'yamnet', timestamp: new Date(15_000).toISOString(), window_s: 0.975, top1_label: 'Rain', top1_score: 0.9 }];
  assert.equal(scoreSamples(run, rows, [], cat)[0].priority_match, true);
  assert.equal(scoreSamples(run, [], [], cat)[0].priority_match, null);
  const target = { ...manifest.clips[1], start_s: 13, end_s: 18 };
  const [result] = scoreSamples({ ...run, clips: [target] }, [], [], cat);
  assert.equal(result.priority_match, null);
  assert.equal(result.models.yamnet.recognition, 'no readings');
});

test('real worklet emits 15600-sample YAMNet windows, native CLAP windows and level blocks', async () => {
  let Processor;
  const messages = [];
  const context = vm.createContext({
    Float32Array, Math,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (msg) => messages.push(msg) }; } },
    registerProcessor: (_, implementation) => { Processor = implementation; }
  });
  vm.runInContext(await readFile(new URL('../../../packages/assets/public/worklet/capture-processor.js', import.meta.url), 'utf8'), context);
  const processor = new Processor({ processorOptions: {
    nativeRate: 48000, yamnetWindowSamples: 46800, yamnetHopSamples: 24000,
    yamnetTargetRate: 16000, yamnetTargetLength: 15600,
    clapWindowSamples: 240000, clapHopSamples: 60000, levelBlockSamples: 4800
  } });
  for (let i = 0; i < 48000 * 6 / 128; i++) processor.process([[new Float32Array(128).fill(0.25)]]);
  const y = messages.filter((m) => m.type === 'yamnet');
  const c = messages.filter((m) => m.type === 'clap');
  assert.equal(y.length, 11);
  assert.ok(y.every((m) => m.samples.length === 15600));
  assert.equal(c.length, 1);
  assert.equal(c[0].samples.length, 240000);
  assert.equal(c[0].nativeRate, 48000);
  assert.equal(messages.filter((m) => m.type === 'level').length, 60);
});
