import test from 'node:test';
import assert from 'node:assert/strict';
import { windowTdoas, gccPhat } from '../src/localise.js';
import { windowBearing, analyseMeasured, MEASURED_DEFAULTS } from '../src/measured.js';
import { mulberry32 } from '../src/rng.js';

const fs = 48000;
const positions = [[0, 0, 2], [0.1, 0, 2], [0, 0.1, 2], [0.1, 0.1, 2]];
const noise = (length) => {
  const rng = mulberry32(8127);
  return Float32Array.from({ length }, () => rng() * 2 - 1);
};

test('PHAT quality is unit coherence across bandwidths and window sizes, without changing raw TDOA or peak', () => {
  for (const ms of [20, 50, 100]) for (const band of [[200, 1600], [300, 3000]]) {
    const signal = noise(Math.round(fs * ms / 1000));
    const options = { fs, band, maxLagS: 0.001 };
    const pairs = windowTdoas([signal, signal], 0, signal.length, options);
    const original = gccPhat({ signal, start: 0, end: signal.length }, { signal, start: 0, end: signal.length }, options);
    assert.ok(Math.abs(pairs[0].peak_normalized - 1) < 1e-10);
    assert.ok(Math.abs(pairs[0].peak - original.peak) < 1e-10);
    assert.ok(Math.abs(pairs[0].tdoa_s - original.tdoa_s) < 1e-10);
    assert.ok(pairs[0].peak < MEASURED_DEFAULTS.min_peak, 'The former raw-peak gate rejected even perfectly coherent input');
  }
});

test('measured bearing quality accepts coherent mixture windows and rejects silence', () => {
  const signal = noise(2400);
  const options = { fs, c: 343, band: [200, 1600] };
  const bearing = windowBearing(positions.map(() => signal), positions, 0, signal.length, options);
  assert.ok(bearing.peak_min >= MEASURED_DEFAULTS.min_peak);
  assert.ok(Number.isFinite(bearing.fit_sigma_deg));
  assert.ok(bearing.fit_sigma_deg >= 0);
  const quiet = new Float32Array(signal.length);
  const silent = windowBearing(positions.map(() => quiet), positions, 0, quiet.length, options);
  assert.equal(silent.peak_min, 0);
  assert.equal(silent.peak_mean, 0);
  assert.throws(() => windowTdoas([signal, signal], 0, signal.length, { ...options, band: [30000, 31000], maxLagS: 0.001 }), /no usable FFT bins/);
});

test('measured fit uncertainty rises when pair delays disagree with a plane wave', () => {
  const signal = noise(2400);
  const shifted = new Float32Array(signal.length);
  shifted.set(signal.subarray(0, signal.length - 8), 8);
  const options = { fs, c: 343, band: [200, 1600] };
  const coherent = windowBearing(positions.map(() => signal), positions, 0, signal.length, options);
  const inconsistent = windowBearing([signal, signal, shifted, signal], positions, 0, signal.length, options);
  assert.ok(inconsistent.fit_sigma_deg > coherent.fit_sigma_deg);
});

test('positive scalar microphone gains cancel in PHAT, not microphone phase or frequency errors', () => {
  const signal = noise(2500);
  const mics = [0, 4, 8, 12].map((delay) => signal.slice(delay, delay + 2400));
  const gains = [0.5, 2, 0.25, 4];
  const scaled = mics.map((mic, i) => Float32Array.from(mic, (v) => v * gains[i]));
  const options = { fs, band: [200, 1600], maxLagS: 0.001 };
  const before = windowTdoas(mics, 0, 2400, options);
  const after = windowTdoas(scaled, 0, 2400, options);
  assert.ok(before.some((pair) => Math.abs(pair.tdoa_s) > 1 / fs));
  for (let i = 0; i < before.length; i++) {
    assert.ok(Math.abs(before[i].tdoa_s - after[i].tdoa_s) < 1e-10);
    assert.ok(Math.abs(before[i].peak_normalized - after[i].peak_normalized) < 1e-8);
  }
});

test('nonempty measured inference forms tracks without accessing simulator truth', () => {
  const signal = new Float32Array(fs * 0.8);
  signal.set(noise(fs * 0.4), fs * 0.2);
  const scenario = { nodes: [{ id: 'n1', position: [0, 0, 2] }], settings: { localisation_band_hz: [200, 1600] } };
  const rendered = { sample_rate: fs, nodes: [{ id: 'n1', mics: positions.map(() => signal), mic_positions: positions }] };
  const forbidden = () => { throw new Error('simulator truth accessed'); };
  for (const key of ['sources', 'start_s', 'true_position']) Object.defineProperty(scenario, key, { get: forbidden });
  for (const key of ['paths', 'activity', 'source_positions']) Object.defineProperty(rendered, key, { get: forbidden });
  const result = analyseMeasured(scenario, rendered, { c: 343 });
  assert.ok(result.nodes[0].tracks.length > 0);
  assert.ok(result.nodes[0].windows.length > 0);
  const joint = analyseMeasured(scenario, rendered, { c: 343, options: { fusion_mode: 'joint' } });
  assert.ok(joint.nodes[0].tracks.length > 0);
  assert.deepEqual(joint.fixes, []);
  assert.throws(() => analyseMeasured(scenario, rendered, { c: 343, options: { fusion_mode: 'unknown' } }), /Unknown measured fusion mode/);
});
