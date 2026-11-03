import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ARRAYS, arrayMetrics, micList, icosaBall, flatSquare, validateArrayModel, applyArrayToNode } from '../src/arrays.js';
import { micOffsets, micPositions } from '../src/mics.js';
import { newNode, validateScenario } from '../src/scenario.js';
import { level1mFromMeasurement, synthTone, validateSoundModel } from '../src/sounds.js';

const byId = (id) => BUILTIN_ARRAYS.find((a) => a.id === id);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('ball12_d180 figures match the design sheet', () => {
  const m = arrayMetrics(micList(byId('ball12_d180')));
  assert.equal(m.count, 12);
  near(m.nearest_mm, 94.6, 0.3);
  near(m.longest_mm, 180, 0.3);
  near(m.vertical_baseline_mm, 143, 0.1);
  near(m.aliasing_hz, 1810, 15);
  near(m.bearing[0].az_deg, 1.14, 0.03);
  near(m.bearing[0].el_deg, 1.14, 0.03);
});

test('flat4_100 figures match the array library (SIM.md §4)', () => {
  const m = arrayMetrics(micList(byId('flat4_100')));
  near(m.nearest_mm, 100, 0.01);
  near(m.longest_mm, 141.4, 0.1);
  assert.equal(m.vertical_baseline_mm, 0);
  near(m.aliasing_hz, 1720, 15);
  near(m.bearing[0].az_deg, 2.0, 0.1);
  assert.equal(m.bearing[0].el_deg, Infinity);
  near(m.bearing[1].el_deg, 6.0, 0.15);
  near(m.bearing[2].el_deg, 3.2, 0.1);
  near(m.bearing[3].el_deg, 2.4, 0.1);
});

test('icosaBall generator reproduces the tabulated ball', () => {
  const gen = icosaBall(180);
  for (const [name, p] of Object.entries(byId('ball12_d180').mics)) p.forEach((v, i) => near(gen[name][i], v, 0.15));
});

test('custom node layout resolves to metres and rotates with the node', () => {
  const node = applyArrayToNode(newNode('n1', 10, 20), { id: 'x', name: 'X', mics: flatSquare(100) });
  assert.equal(micOffsets(node).length, 4);
  node.rotation_deg = 0;
  assert.deepEqual(micPositions(node)[0].map((v) => Math.round(v * 1000) / 1000), [10.05, 20.05, 5]);
  const out = validateScenario({ version: '0.2', nodes: [node], sources: [] });
  assert.equal(out.nodes[0].mic_array, 'x');
  assert.throws(() => validateScenario({ version: '0.2', nodes: [{ ...node, mic_offsets_m: [[0, 0, 0]] }], sources: [] }), /custom mic layout/);
});

test('array validation rejects bad input', () => {
  assert.throws(() => validateArrayModel({ id: 'Bad Id', name: 'x', mics: {} }), /id/);
  assert.throws(() => validateArrayModel({ id: 'a', name: 'x', mics: { M1: [0, 0, 0] } }), /needs 2/);
  assert.throws(() => validateArrayModel({ id: 'a', name: 'x', mics: { M1: [0, 0, 0], M2: [1, 'a', 0] } }), /three numbers/);
  assert.equal(validateArrayModel({ id: 'a', name: ' x ', mics: { M1: [0, 0, 0], M2: [1, 0, 0] } }).name, 'x');
});

test('level calibration is 6 dB per doubling', () => {
  near(level1mFromMeasurement(80, 2), 86.02, 0.01);
  near(level1mFromMeasurement(90, 1), 90, 1e-9);
  assert.throws(() => level1mFromMeasurement(80, 0), /distance/);
});

test('tone synth and sound validation', () => {
  const s = synthTone(48000, 1000, 0.5);
  assert.equal(s.length, 24000);
  const ok = validateSoundModel({ id: 't1', name: 'Tone', kind: 'generated', level_1m_db: 90, synth: { type: 'tone', freq_hz: 1000, duration_s: 1 }, labels: ['a', ' '] });
  assert.deepEqual(ok.labels, ['a']);
  assert.throws(() => validateSoundModel({ id: 't1', name: 'Tone', kind: 'generated', level_1m_db: 90, synth: { type: 'tone', freq_hz: 5, duration_s: 1 } }), /tone needs/);
  assert.throws(() => validateSoundModel({ id: 'u1', name: 'U', kind: 'upload', level_1m_db: 90, audio_b64: '***' }), /audio data/);
});
