import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseMeasured } from '../src/measured.js';
import { sourceSignalForRender, synthRotorModel } from '../src/ext/multisource/rotor-model.js';

const fs = 48000;
const positions = [[0, 0, 2], [0.1, 0, 2], [0, 0.1, 2], [0.1, 0.1, 2]];

function noise(length) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.sin((2 * Math.PI * 650 * i) / fs) * 0.15 + Math.sin((2 * Math.PI * 900 * i) / fs) * 0.1;
  return out;
}

function scenario(settings = {}) {
  return {
    nodes: [{ id: 'n1', position: [0, 0, 2] }],
    settings: { localisation_band_hz: [200, 1600], ...settings },
    sources: [{ id: 's1', labels: ['drone'] }]
  };
}

function rendered(signal) {
  return {
    sample_rate: fs,
    nodes: [{ id: 'n1', mics: positions.map(() => signal), mic_positions: positions }]
  };
}

test('multisource extension remains absent when ms modes are off', () => {
  const result = analyseMeasured(scenario(), rendered(noise(Math.round(fs * 0.7))), { c: 343 });
  assert.equal(result.extensions, undefined);
});

test('multisource extension emits candidates and associations when enabled', () => {
  const src = noise(Math.round(fs * 0.7));
  const result = analyseMeasured(
    scenario({ ms_candidate_mode: 'multi_peak', ms_association_mode: 'spectral', ms_label_assist_mode: 'oracle' }),
    {
      sample_rate: fs,
      nodes: [
        { id: 'n1', mics: positions.map(() => src), mic_positions: positions },
        { id: 'n2', mics: positions.map(() => src), mic_positions: positions.map(([x, y, z]) => [x + 20, y, z]) },
        { id: 'n3', mics: positions.map(() => src), mic_positions: positions.map(([x, y, z]) => [x, y + 20, z]) }
      ]
    },
    { c: 343 }
  );
  assert.ok(result.extensions?.multisource);
  assert.equal(result.extensions.multisource.config.candidate_mode, 'multi_peak');
  assert.ok(Array.isArray(result.extensions.multisource.node_summaries));
});

test('rotor model synthesis deterministic and gated by opt-in flag', () => {
  const direct = synthRotorModel({ sampleRate: 12000, durationS: 0.5, bladeCount: 2, rpm: 2400, seed: 3 });
  const same = synthRotorModel({ sampleRate: 12000, durationS: 0.5, bladeCount: 2, rpm: 2400, seed: 3 });
  assert.deepEqual([...direct], [...same]);
  const clips = new Map([['engine', Float32Array.from([0, 0.5, -0.5])]]);
  const fallback = sourceSignalForRender({
    source: { clip: 'engine', rotor_model: { blades: 2, rpm: 3000 } },
    clips,
    settings: { ms_rotor_model_enabled: false },
    sampleRate: 48000
  });
  assert.equal(fallback, clips.get('engine'));
  const generated = sourceSignalForRender({
    source: { clip: 'engine', rotor_model: { blades: 2, rpm: 3000, duration_s: 0.2, seed: 11 } },
    clips,
    settings: { ms_rotor_model_enabled: true },
    sampleRate: 8000
  });
  assert.ok(generated.length > 1000);
  assert.notEqual(generated, clips.get('engine'));
});
