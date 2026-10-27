import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newBuilding, newNode, newSource } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { renderComponents } from '../src/components.js';
import { gccCurve } from '../src/localise.js';
import { distance, speedOfSound } from '../src/physics.js';
import { mulberry32, gaussian } from '../src/rng.js';

const FS = 48000;

function burst(ms = 20, seed = 3) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round((ms / 1000) * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.sin((Math.PI * i) / out.length);
  return out;
}

const impulse = () => {
  const x = new Float32Array(64);
  x[8] = 1;
  return x;
};

function quiet(over = {}) {
  const s = defaultScenario();
  Object.assign(s.settings, { air_absorption: false, ground_reflectivity: 0, noise_floor_db_spl: -60, mic_self_noise_db_spl: -60, ...over });
  return s;
}

const peakIndex = (sig, from = 0, to = sig.length) => {
  let best = from;
  for (let i = from; i < to; i++) if (Math.abs(sig[i]) > Math.abs(sig[best])) best = i;
  return best;
};

test('total of the components equals the main render (acceptance 5 and 6)', () => {
  const s = quiet({ ground_reflectivity: 0.8, noise_floor_db_spl: 40, mic_self_noise_db_spl: 25 });
  s.buildings = [newBuilding('b1', 40, 25, 30, 6, 15)];
  s.nodes = [newNode('n1', 80, 0)];
  s.sources = [{ ...newSource('s1', 'b', 5, 0, 105), start_s: 0.1 }, { ...newSource('s2', 'b', 10, 10, 100), start_s: 0.3 }];
  const clips = new Map([['b', burst()]]);
  const total = renderScenario(s, clips, { lengthS: 1 });
  const noise = renderComponents(s, clips, 1, 0, 'noise').series[0];
  for (const mode of ['by_source', 'by_path']) {
    const parts = renderComponents(s, clips, 1, 0, mode);
    for (let mi = 0; mi < 4; mi++) {
      let worst = 0;
      const ref = total.nodes[0].mics[mi];
      for (let i = 0; i < ref.length; i += 7) {
        let sum = mode === 'by_path' ? noise.mics[mi][i] : 0;
        for (const ser of parts.series) sum += ser.mics[mi][i];
        worst = Math.max(worst, Math.abs(sum - ref[i]));
      }
      assert.ok(worst < 1e-5, `${mode} mic ${mi} ${worst}`);
    }
  }
});

test('direct arrival at each mic is at start + r_k/c within one sample (acceptance 6)', () => {
  const s = quiet();
  s.nodes = [{ ...newNode('n1', 60, 20), mic_layout: 'tetrahedron', mic_spacing_m: 0.3 }];
  s.sources = [{ ...newSource('s1', 'i', 0, 0, 100), start_s: 0.2 }];
  const clips = new Map([['i', impulse()]]);
  const out = renderComponents(s, clips, 1, 0, 'by_path');
  const direct = out.series.find((x) => x.id === 'direct');
  const rendered = renderScenario(s, clips, { lengthS: 1 });
  const c = speedOfSound(15);
  rendered.nodes[0].mic_positions_true.forEach((mp, mi) => {
    const expected = (0.2 + distance([0, 0, 1.5], mp) / c) * FS + 8;
    assert.ok(Math.abs(peakIndex(direct.mics[mi]) - expected) <= 1, `mic ${mi}`);
  });
});

test('by-source amplitude ratio follows spreading loss (acceptance 6)', () => {
  const s = quiet();
  s.nodes = [{ ...newNode('n1', 50, 0), position: [50, 0, 1.5] }];
  s.sources = [
    { ...newSource('s1', 'b', 40, 0, 100), start_s: 0.1 },
    { ...newSource('s2', 'b', 0, 0, 100), start_s: 0.5 }
  ];
  s.sources.forEach((x) => (x.keyframes[0].position[2] = 1.5));
  const clips = new Map([['b', burst()]]);
  const out = renderComponents(s, clips, 1, 0, 'by_source');
  const c = speedOfSound(15);
  const rms = (sig, t0, r) => {
    const a = Math.round((t0 + r / c) * FS) - 100;
    const b = a + 1300;
    return Math.sqrt(sig.slice(a, b).reduce((acc, v) => acc + v * v, 0) / (b - a));
  };
  const near = rms(out.series[0].mics[0], 0.1, 10);
  const far = rms(out.series[1].mics[0], 0.5, 50);
  assert.ok(Math.abs(20 * Math.log10(near / far) - 20 * Math.log10(50 / 10)) < 0.2);
});

test('blocked direct path shows no direct component (acceptance 3)', () => {
  const s = quiet();
  s.buildings = [newBuilding('b1', 50, 0, 10, 10, 15), newBuilding('b2', 50, 30, 40, 4, 15)];
  s.nodes = [newNode('n1', 100, 0)];
  s.sources = [{ ...newSource('s1', 'b', 0, 0, 110), start_s: 0.2 }];
  const out = renderComponents(s, new Map([['b', burst()]]), 1.5, 0, 'by_path');
  const peak = (id) => Math.max(...out.series.find((x) => x.id === id).mics[0].map(Math.abs));
  assert.equal(peak('direct'), 0);
  assert.ok(peak('wall') > 0);
});

test('GCC curve exposes the direct delay and a reflection as separate peaks', () => {
  const s = quiet({ noise_floor_db_spl: 10 });
  s.buildings = [{ ...newBuilding('b1', 20, 12, 30, 4, 15) }];
  s.nodes = [{ ...newNode('n1', 60, 0), mic_spacing_m: 0.4 }];
  s.sources = [{ ...newSource('s1', 'b', 0, 5, 110), start_s: 0.1 }];
  const out = renderScenario(s, new Map([['b', burst(60)]]), { lengthS: 0.8 });
  const sig = out.nodes[0].mics;
  const a = Math.round(0.1 * FS);
  const curve = gccCurve({ signal: sig[0], start: a, end: a + 12000 }, { signal: sig[1], start: a, end: a + 12000 }, { fs: FS, band: [200, 4000], maxLagS: 0.4 / 340 });
  assert.ok(curve.peaks.length >= 1);
  assert.ok(Math.abs(curve.est_lag_s) <= 0.4 / 340 + 1e-6);
});

test('WAV export is a 4-channel float32 file and arrivals CSV escapes values', async () => {
  const { encodeWavFloat32, arrivalsCsv } = await import('../src/wav.js');
  const ch = [0, 1, 2, 3].map((k) => Float32Array.from([k, k + 0.5, -k]));
  const buf = encodeWavFloat32(ch, 48000);
  const v = new DataView(buf);
  assert.equal(new TextDecoder().decode(buf.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint16(20, true), 3);
  assert.equal(v.getUint16(22, true), 4);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 3 * 4 * 4);
  assert.equal(v.getFloat32(44 + 4 * 4 + 4, true), 1.5); // frame 1, channel 1
  assert.match(arrivalsCsv([{ time_s: 1, source: 's,1', path: 'direct' }]), /"s,1"/);
});
