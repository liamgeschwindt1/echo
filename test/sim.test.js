import test from 'node:test';
import assert from 'node:assert/strict';
import { airAbsorptionDbPerM, speedOfSound, distance } from '../src/sim/core/physics.js';
import { micPositions } from '../src/sim/core/mics.js';
import { mulberry32, gaussian } from '../src/sim/core/rng.js';
import { rfft } from '../src/sim/core/dsp.js';
import { defaultScenario, newNode, newSource as makeSource } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { estimateBearing, intersectRays } from '../src/sim/core/localise.js';
import { analyseClip, sliceRadius } from '../src/sim/core/wavefront.js';

const FS = 48000;

const newSource = (...args) => ({ ...makeSource(...args), start_s: 0 });

function click(seed = 7, seconds = 0.3) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.exp(-i / FS / 0.02);
  return out;
}

function tone(freq, seconds = 0.3) {
  const out = new Float32Array(Math.round(seconds * FS));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / FS) * Math.sin((Math.PI * i) / out.length) ** 2;
  return out;
}

function scenario({ nodes, sources, settings = {} }) {
  const s = defaultScenario();
  Object.assign(s.settings, { noise_floor_db_spl: 0, mic_self_noise_db_spl: -20 }, settings);
  s.nodes = nodes;
  s.sources = sources;
  return s;
}

const rmsOf = (x, a, b) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

function bearingFor(rendered, node, scn, source, clipSeconds = 0.3) {
  const c = speedOfSound(scn.settings.temperature_c);
  const rn = rendered.nodes.find((n) => n.id === node.id);
  const r = distance(source.keyframes[0].position, node.position);
  const start = Math.round((source.start_s + r / c - 0.02) * FS);
  return estimateBearing({ mics: rn.mics, positions: rn.mic_positions, startSample: start, endSample: start + Math.round((clipSeconds + 0.05) * FS), fs: FS, c, band: scn.settings.localisation_band_hz });
}

const angleErr = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const truthAz = (src, node) => (Math.atan2(src[1] - node.position[1], src[0] - node.position[0]) * 180) / Math.PI;
const truthEl = (src, node) => (Math.asin((src[2] - node.position[2]) / distance(src, node.position)) * 180) / Math.PI;

test('speed of sound at 15 C', () => {
  assert.ok(Math.abs(speedOfSound(15) - 340.39) < 1e-9);
});

test('air absorption matches ISO 9613-1 reference (20 C, 70%, 1 kHz ~ 0.0045 dB/m)', () => {
  const a = airAbsorptionDbPerM(1000, 20, 70);
  assert.ok(a > 0.003 && a < 0.006, String(a));
});

test('pressure halves per doubling of distance without absorption or ground', () => {
  const src = newSource('s1', 'c', 0, 0, 100);
  src.keyframes[0].position = [0, 0, 1.5];
  const nodes = [{ ...newNode('a', 10, 0), position: [10, 0, 1.5] }, { ...newNode('b', 20, 0), position: [20, 0, 1.5] }];
  const scn = scenario({ nodes, sources: [src], settings: { air_absorption: false, ground_reflectivity: 0 } });
  const out = renderScenario(scn, new Map([['c', click()]]), { lengthS: 10.3 });
  const ra = rmsOf(out.nodes[0].mics[0], 0, 40000);
  const rb = rmsOf(out.nodes[1].mics[0], 0, 40000);
  assert.ok(Math.abs(20 * Math.log10(ra / rb) - 6.02) < 0.15);
});

test('delay equals r/c and scales ~4.4% from 0 to 25 C', () => {
  const impulse = new Float32Array(100);
  impulse[50] = 1;
  const peakIdx = (tempC) => {
    const src = newSource('s1', 'c', 0, 0, 100);
    src.keyframes[0].position = [0, 0, 1.5];
    const node = { ...newNode('a', 100, 0), position: [100, 0, 1.5] };
    const scn = scenario({ nodes: [node], sources: [src], settings: { air_absorption: false, ground_reflectivity: 0, temperature_c: tempC } });
    const out = renderScenario(scn, new Map([['c', impulse]]), { lengthS: 10 });
    const sig = out.nodes[0].mics[0];
    let best = 0;
    for (let i = 0; i < sig.length; i++) if (Math.abs(sig[i]) > Math.abs(sig[best])) best = i;
    const r = distance(src.keyframes[0].position, out.nodes[0].mic_positions[0]);
    assert.ok(Math.abs(best - (50 + (r / speedOfSound(tempC)) * FS)) < 1);
    return best - 50;
  };
  const ratio = peakIdx(0) / peakIdx(25);
  assert.ok(Math.abs(ratio - speedOfSound(25) / speedOfSound(0)) < 0.001);
  assert.ok(ratio > 1.04 && ratio < 1.05);
});

test('distant source has less energy above 4 kHz', () => {
  const share = (x) => {
    const { re, im } = rfft(x, 2 ** 16);
    let hi = 0;
    let all = 0;
    for (let k = 1; k < re.length; k++) {
      const p = re[k] ** 2 + im[k] ** 2;
      all += p;
      if ((k * FS) / 2 ** 16 > 4000) hi += p;
    }
    return hi / all;
  };
  const shares = [20, 300].map((d) => {
    const src = newSource('s1', 'c', 0, 0, 120);
    src.keyframes[0].position = [0, 0, 1.5];
    const node = { ...newNode('a', d, 0), position: [d, 0, 1.5] };
    const scn = scenario({ nodes: [node], sources: [src], settings: { ground_reflectivity: 0 } });
    const t0 = Math.round((d / 340) * FS);
    const out = renderScenario(scn, new Map([['c', click()]]), { lengthS: 10.3 });
    return share(out.nodes[0].mics[0].slice(t0, t0 + 2 ** 16));
  });
  assert.ok(shares[1] < shares[0] * 0.5, shares.join(' '));
});

test('single node bearing within 2 degrees at 20 m', () => {
  const node = newNode('a', 0, 0);
  const src = newSource('s1', 'c', 17, 10.5, 120);
  const scn = scenario({ nodes: [node], sources: [src], settings: { noise_floor_db_spl: 45, mic_self_noise_db_spl: 30 } });
  const out = renderScenario(scn, new Map([['c', click()]]), { lengthS: 10.3 });
  const b = bearingFor(out, node, scn, src);
  const p = src.keyframes[0].position;
  assert.ok(angleErr(b.azimuth_deg, truthAz(p, node)) < 2, `az ${b.azimuth_deg} vs ${truthAz(p, node)}`);
  assert.ok(Math.abs(b.elevation_deg - truthEl(p, node)) < 5, `el ${b.elevation_deg}`);
});

test('three nodes recover position within 1 m', () => {
  const nodes = [newNode('a', 0, 0), newNode('b', 60, 0), newNode('c', 30, 50)];
  const src = newSource('s1', 'c', 25, 20, 120);
  const scn = scenario({ nodes, sources: [src], settings: { noise_floor_db_spl: 45, mic_self_noise_db_spl: 30 } });
  const out = renderScenario(scn, new Map([['c', click()]]), { lengthS: 10.3 });
  const rays = nodes.map((n) => ({ origin: n.position, direction: bearingFor(out, n, scn, src).direction }));
  const fix = intersectRays(rays);
  assert.equal(fix.poorly_conditioned, false);
  const err = distance(fix.position, src.keyframes[0].position);
  assert.ok(err < 1, `error ${err}`);
});

test('3 kHz tone localises worse than a click in the default band', () => {
  const node = newNode('a', 0, 0);
  const src = newSource('s1', 'c', 17, 10.5, 120);
  const scn = scenario({ nodes: [node], sources: [src], settings: { noise_floor_db_spl: 45 } });
  const p = src.keyframes[0].position;
  const errFor = (clip) => {
    const out = renderScenario(scn, new Map([['c', clip]]), { lengthS: 10.3 });
    return angleErr(bearingFor(out, node, scn, src).azimuth_deg, truthAz(p, node));
  };
  assert.ok(errFor(tone(3000)) > errFor(click()));
});

test('tetrahedron resolves above/below, flat square does not', () => {
  const p = [20, 0, 15];
  const src = newSource('s1', 'c', 0, 0, 120);
  src.keyframes[0].position = p;
  const run = (layout) => {
    const node = { ...newNode('a', 0, 0), position: [0, 0, 1.5], mic_layout: layout, mic_spacing_m: 0.2 };
    const scn = scenario({ nodes: [node], sources: [src], settings: { ground_reflectivity: 0 } });
    const out = renderScenario(scn, new Map([['c', click()]]), { lengthS: 10.3 });
    return bearingFor(out, node, scn, src).elevation_deg;
  };
  assert.ok(truthEl(p, { position: [0, 0, 1.5] }) > 30);
  assert.ok(run('tetrahedron') > 30);
  assert.ok(run('flat_square') < 0);
});

test('same scenario and seed render identically', () => {
  const node = newNode('a', 0, 0);
  const src = newSource('s1', 'c', 30, 5, 110);
  const scn = scenario({ nodes: [node], sources: [src], settings: { noise_floor_db_spl: 45 } });
  const a = renderScenario(scn, new Map([['c', click()]]), { lengthS: 10.3 });
  const b = renderScenario(scn, new Map([['c', click()]]), { lengthS: 10.3 });
  assert.deepEqual(a.nodes[0].mics[2], b.nodes[0].mics[2]);
});

test('mic layouts: flat square is coplanar, tetrahedron edges equal spacing', () => {
  const flat = micPositions({ ...newNode('a'), mic_layout: 'flat_square' });
  assert.ok(flat.every((m) => m[2] === 5));
  const tet = micPositions({ ...newNode('a'), mic_layout: 'tetrahedron', rotation_deg: 33 });
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert.ok(Math.abs(distance(tet[i], tet[j]) - 0.1) < 1e-9);
});

test('wavefront radius uses the slice-plane cross-section', () => {
  assert.equal(sliceRadius(340, 0.001, 3.5), null);
  assert.ok(Math.abs(sliceRadius(340, 1, 3.5) - Math.sqrt(340 ** 2 - 3.5 ** 2)) < 1e-9);
  const a = analyseClip(click(), FS);
  assert.ok(a.rms.length === 30 && a.rms[0] > a.rms[20]);
});

test('spectrogram puts a 1 kHz tone in the right bin', async () => {
  const { spectrogram } = await import('../src/sim/core/spectro.js');
  const sp = spectrogram(tone(1000, 0.3), FS, { frames: 5 });
  const col = sp.frames[2];
  let best = 0;
  for (let k = 0; k < col.length; k++) if (col[k] > col[best]) best = k;
  assert.ok(Math.abs((best * FS) / 1024 - 1000) < 100);
});
