// Microphone signal fidelity: exact composition, render audit, test clips, level chain,
// element-by-element checks (noise off, impulse source), numerical hygiene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newBuilding, newNode, newSource } from '../src/scenario.js';
import { findPaths, buildSurfaces, diffractionLossDb } from '../src/geometry.js';
import { airAbsorptionDbPerM, digitalPerPa, dbToPa, speedOfSound, P_REF_PA } from '../src/physics.js';
import { renderScenario, loudestWindowRms } from '../src/render.js';
import { renderComponents } from '../src/components.js';
import { synthesizeClip } from '../src/clips.js';
import { referenceRender } from './reference-render.js';
import { noiseBandPowerPa2 } from '../src/reach.js';
import { bandWeight } from '../src/activity.js';
import { rfft, nextPow2 } from '../src/dsp.js';

const FS = 48000;
const C15 = speedOfSound(15);

function scene(over = {}, buildings = [], nodes = null, sources = null) {
  const s = defaultScenario();
  Object.assign(s.settings, { diffraction_order: 0, diffraction_model: 'maekawa', ...over });
  s.buildings = buildings;
  s.nodes = nodes ?? [{ ...newNode('n1', 30, 0), mic_spacing_m: 0.05 }];
  s.sources = sources ?? [{ ...newSource('s1', 'test_impulse', 0, 0, 94), start_s: 0.1 }];
  return s;
}

const impulse = () => synthesizeClip('impulse', FS);
const IMPULSE_PEAK = Math.round(0.03 * FS); // synthImpulse centres the click (60 ms clip)

// Local maxima above minRel * global max, but the band-limited click rings, so keep only the
// largest peak in each sep-samples neighbourhood (greedy, strongest first).
function peaksOf(sig, minRel = 0.15, sep = 300) {
  let max = 0;
  for (const v of sig) max = Math.max(max, Math.abs(v));
  const cand = [];
  for (let i = 1; i < sig.length - 1; i++) {
    if (Math.abs(sig[i]) >= max * minRel && Math.abs(sig[i]) >= Math.abs(sig[i - 1]) && Math.abs(sig[i]) > Math.abs(sig[i + 1])) cand.push({ i, v: sig[i] });
  }
  cand.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const kept = [];
  for (const c of cand) if (kept.every((k) => Math.abs(k.i - c.i) >= sep)) kept.push(c);
  kept.sort((a, b) => a.i - b.i);
  return { peaks: kept, max };
}

// Item 3: by-source components plus noise sum to the total to floating-point tolerance.
test('composition: by-source components + noise equal the total render (rel err < 1e-6)', () => {
  const s = scene(
    { ground_reflectivity: 0.8, reflection_order: 1 },
    [newBuilding('b1', -20, 0, 20, 20, 15)],
    null,
    [
      { ...newSource('s1', 'test_noise_burst', 0, 0, 90), start_s: 0.2 },
      { ...newSource('s2', 'test_noise_burst', -40, 25, 85), start_s: 0.35 }
    ]
  );
  const clips = new Map([['test_noise_burst', synthesizeClip('noise', FS)]]);
  const total = renderScenario(s, clips, { lengthS: 2 });
  const comp = renderComponents(s, clips, 2, 0, 'by_source');
  for (let mi = 0; mi < 4; mi++) {
    const sum = new Float64Array(total.length);
    for (const series of comp.series) {
      const m = series.mics[mi];
      for (let i = 0; i < total.length; i++) sum[i] += m[i];
    }
    let num = 0;
    let den = 0;
    for (let i = 0; i < total.length; i++) {
      num += (sum[i] - total.nodes[0].mics[mi][i]) ** 2;
      den += total.nodes[0].mics[mi][i] ** 2;
    }
    const rel = Math.sqrt(num / den);
    assert.ok(rel < 1e-6, `mic ${mi}: relative error ${rel.toExponential(2)}`);
  }
});

// Item 5: the audit reads back what the render applied; it must match an independent geometry
// recomputation, and every dropped path must carry a reason.
test('render audit: applied delays/gains match geometry; dropped paths carry reasons', () => {
  const s = scene(
    { ground_reflectivity: 0.8, reflection_order: 2, diffraction_order: 1 },
    [newBuilding('b1', 15, 0, 10, 10, 15), newBuilding('b2', -25, 40, 30, 4, 15)],
    [{ ...newNode('n1', 30, 0), mic_spacing_m: 0.05 }],
    [{ ...newSource('s1', 'test_noise_burst', 0, 0, 100), start_s: 0.1 }]
  );
  const clips = new Map([['test_noise_burst', synthesizeClip('noise', FS).subarray(0, 4800)]]);
  const out = renderScenario(s, clips, { lengthS: 0.8 });
  const { c } = { c: speedOfSound(s.settings.temperature_c) };
  const surfaces = buildSurfaces(s.buildings);
  const n = nextPow2(out.length);
  const k1k = Math.round((1000 * n) / FS);
  const f1k = (k1k * FS) / n;
  const abs1k = s.settings.air_absorption ? airAbsorptionDbPerM(f1k, s.settings.temperature_c, s.settings.humidity_pct, s.settings.pressure_kpa) : 0;
  for (let mi = 0; mi < 4; mi++) {
    const mp = out.nodes[0].mic_positions_true[mi];
    const { paths, dropped } = findPaths(s.sources[0].keyframes[0].position, mp, { settings: s.settings, buildings: s.buildings, surfaces, c });
    const applied = out.audit[0][mi][0];
    assert.equal(applied.length, paths.length, `mic ${mi}: applied path count`);
    const key = (p) => `${p.type}:${p.surfaces.join('+')}`;
    const expected = new Map(paths.map((p) => [key(p), p]));
    let worstDt = 0;
    let worstDg = 0;
    for (const rec of applied) {
      const p = expected.get(key(rec));
      assert.ok(p, `applied path ${key(rec)} not found in geometry`);
      const dt = Math.abs(rec.delay_samples - (s.sources[0].start_s + p.length / c) * FS);
      const delta = p.type === 'diffracted' ? p.length - p.direct_distance : 0;
      let g = p.gain / Math.max(p.length, 1);
      g *= 10 ** (-(abs1k * p.length) / 20);
      if (delta) g *= 10 ** (-diffractionLossDb(delta, f1k, c) / 20);
      const dg = Math.abs(rec.gain_db_1khz - 20 * Math.log10(g));
      worstDt = Math.max(worstDt, dt);
      worstDg = Math.max(worstDg, dg);
    }
    console.log(`audit mic ${mi}: ${applied.length} paths, worst delay diff ${worstDt.toExponential(1)} samples, worst gain diff ${worstDg.toExponential(1)} dB, ${dropped.length} dropped`);
    assert.ok(worstDt < 0.05, `delay diff ${worstDt} samples`);
    assert.ok(worstDg < 0.05, `gain diff ${worstDg} dB`);
    for (const d of dropped) assert.ok(d.reason, `dropped path without reason: ${d.type}`);
  }
  // This scene blocks the direct path: the drop must be listed, never silent.
  const drops = out.paths[0].perMic.map((pm) => pm[0].dropped.filter((d) => d.type === 'direct'));
  assert.ok(drops.every((d) => d.length === 1 && d[0].reason === 'blocked'), 'direct drop listed with reason');
});

// Items 4 and 6: noise switch, one spike per path.
test('impulse source, noise off: exactly one clean spike per path at the path delays', () => {
  // Geometry chosen so direct / ground / wall spikes are at least 15 ms apart (impulse width ~1 ms).
  const s = scene(
    { ground_reflectivity: 0.8, reflection_order: 1, noise_enabled: false, temperature_c: 15 },
    [newBuilding('b1', -20, 0, 20, 20, 25)],
    [{ ...newNode('n1', 30, 0), position: [30, 0, 10], mic_spacing_m: 0.02 }],
    [{ ...newSource('s1', 'test_impulse', 0, 0, 94), keyframes: [{ t: 0, position: [0, 0, 10] }], start_s: 0.1 }]
  );
  const clips = new Map([['test_impulse', impulse()]]);
  const out = renderScenario(s, clips, { lengthS: 0.6 });
  const sig = out.nodes[0].mics[0];
  const { paths } = out.paths[0].perMic[0][0];
  assert.equal(paths.length, 3, `direct + ground + wall, got ${paths.map((p) => p.type)}`);
  const expected = paths.map((p) => Math.round((s.sources[0].start_s + p.delay_s) * FS) + IMPULSE_PEAK).sort((a, b) => a - b);
  const { peaks, max } = peaksOf(sig);
  assert.equal(peaks.length, 3, `spike count: ${peaks.map((p) => p.i)}`);
  peaks.forEach((pk, i) => {
    assert.ok(Math.abs(pk.i - expected[i]) <= 2, `spike ${i} at ${pk.i}, expected ${expected[i]}`);
  });
  // Nothing before the source starts emitting (no wrap-around, no leakage). The band-limited
  // click legitimately starts at start_s (leading sidelobes), so silence holds only before that.
  let early = 0;
  for (let i = 0; i < s.sources[0].start_s * FS - 1; i++) early = Math.max(early, Math.abs(sig[i]));
  assert.ok(early < max * 1e-4, `energy before source start: ${early}`);
});

test('noise switch: noise_enabled false renders digital silence without sources', () => {
  const s = scene({ noise_enabled: false });
  s.sources = [];
  const out = renderScenario(s, new Map(), { lengthS: 0.2 });
  let max = 0;
  for (const m of out.nodes[0].mics) for (const v of m) max = Math.max(max, Math.abs(v));
  assert.equal(max, 0);
  const onScene = scene({});
  onScene.sources = [];
  const on = renderScenario(onScene, new Map(), { lengthS: 0.2 });
  let maxOn = 0;
  for (const m of on.nodes[0].mics) for (const v of m) maxOn = Math.max(maxOn, Math.abs(v));
  assert.ok(maxOn > 0, 'noise on by default');
});

// Item 9: level chain through spl_ref_db / dbfs_ref_db.
test('level chain: noise-only render RMS matches the configured SPL through the chain, broadband and in-band', () => {
  const s = scene({});
  s.sources = [];
  const out = renderScenario(s, new Map(), { lengthS: 4 });
  const toPa = 1 / digitalPerPa(s.settings.spl_ref_db, s.settings.dbfs_ref_db);
  const sig = out.nodes[0].mics[0];
  let sum = 0;
  for (const v of sig) sum += v * v;
  const rmsDb = 20 * Math.log10((Math.sqrt(sum / sig.length) * toPa) / P_REF_PA);
  const expectedDb = 10 * Math.log10(10 ** (s.settings.noise_floor_db_spl / 10) + 10 ** (s.settings.mic_self_noise_db_spl / 10));
  console.log(`noise-only broadband: ${rmsDb.toFixed(2)} dB vs expected ${expectedDb.toFixed(2)} dB`);
  assert.ok(Math.abs(rmsDb - expectedDb) < 0.2, `broadband ${rmsDb.toFixed(2)} vs ${expectedDb.toFixed(2)}`);
  // In-band (localisation band weighting) vs the reach map's noise reference, same algorithm.
  const n = nextPow2(sig.length);
  const X = rfft(sig, n);
  let acc = 0;
  for (let k = 1; k < n / 2; k++) {
    const w = bandWeight((k * FS) / n, s.settings.localisation_band_hz);
    acc += w * w * (X.re[k] ** 2 + X.im[k] ** 2);
  }
  const inBandPa2 = (2 * acc * toPa * toPa) / (n * sig.length);
  const refPa2 = noiseBandPowerPa2(s.settings, FS, 4);
  const diffDb = Math.abs(10 * Math.log10(inBandPa2 / refPa2));
  console.log(`noise in-band vs reference: ${diffDb.toFixed(2)} dB`);
  assert.ok(diffDb < 0.2, `in-band ${diffDb.toFixed(2)} dB`);
});

test('level chain: free-field noise burst at 1 m reads level_1m_db; 6.0 dB per doubling (air and ground off)', () => {
  const settings = { air_absorption: false, ground_reflectivity: 0, reflection_order: 0, noise_enabled: false };
  const levelAt = (r) => {
    const s = scene(settings, [], [{ ...newNode('n1', r, 0), position: [r, 0, 1.5], mic_spacing_m: 0.01 }], [
      { ...newSource('s1', 'test_noise_burst', 0, 0, 96), keyframes: [{ t: 0, position: [0, 0, 1.5] }], start_s: 0.05 }
    ]);
    const clips = new Map([['test_noise_burst', synthesizeClip('noise', FS)]]);
    const out = renderScenario(s, clips, { lengthS: 1.6 });
    const toPa = 1 / digitalPerPa(s.settings.spl_ref_db, s.settings.dbfs_ref_db);
    const rms = loudestWindowRms(out.nodes[0].mics[0], FS) * toPa;
    return 20 * Math.log10(rms / P_REF_PA);
  };
  const l1 = levelAt(1);
  const l2 = levelAt(2);
  const l4 = levelAt(4);
  const l8 = levelAt(8);
  console.log(`free-field burst: 1 m ${l1.toFixed(2)} dB (configured 96); per doubling ${(l1 - l2).toFixed(2)}, ${(l2 - l4).toFixed(2)}, ${(l4 - l8).toFixed(2)} dB`);
  assert.ok(Math.abs(l1 - 96) < 0.2, `at 1 m: ${l1.toFixed(2)} dB`);
  for (const d of [l1 - l2, l2 - l4, l4 - l8]) assert.ok(Math.abs(d - 6.0206) < 0.1, `doubling ${d.toFixed(3)} dB`);
});

// Item 10, spreading and delay with the impulse (amplitude ratio equals distance ratio).
test('element: impulse spreading amplitude ratio equals distance ratio; delay within one sample', () => {
  const settings = { air_absorption: false, ground_reflectivity: 0, reflection_order: 0, noise_enabled: false, temperature_c: 15 };
  const run = (r) => {
    const s = scene(settings, [], [{ ...newNode('n1', r, 0), position: [r, 0, 1.5], mic_spacing_m: 0.01 }], [
      { ...newSource('s1', 'test_impulse', 0, 0, 94), keyframes: [{ t: 0, position: [0, 0, 1.5] }], start_s: 0.05 }
    ]);
    const out = renderScenario(s, new Map([['test_impulse', impulse()]]), { lengthS: 0.5 });
    const { peaks } = peaksOf(out.nodes[0].mics[0]);
    assert.equal(peaks.length, 1);
    return peaks[0];
  };
  const p2 = run(2);
  const p4 = run(4);
  const ratio = Math.abs(p2.v) / Math.abs(p4.v);
  console.log(`impulse spreading: amp(2 m)/amp(4 m) = ${ratio.toFixed(3)} (expect 2)`);
  assert.ok(Math.abs(ratio - 2) / 2 < 0.02, `ratio ${ratio.toFixed(3)}`);
  const expected = Math.round((0.05 + 2 / C15) * FS) + IMPULSE_PEAK;
  console.log(`impulse delay at 2 m: ${p2.i} vs ${expected} (${p2.i - expected} samples)`);
  assert.ok(Math.abs(p2.i - expected) <= 1, `delay off by ${p2.i - expected} samples`);
});

// Item 10, air absorption per band: matches ISO 9613-1 (the model's own formula) per band.
test('element: air absorption band loss between 20 m and 100 m matches the formula within 0.5 dB', () => {
  const mk = (f) => {
    const tone = new Float32Array(Math.round(0.4 * FS));
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * f * i) / FS) * Math.sin((Math.PI * i) / tone.length) ** 2;
    return tone;
  };
  const settings = { air_absorption: true, ground_reflectivity: 0, reflection_order: 0, noise_enabled: false, temperature_c: 15 };
  const levelAtF = (f, r) => {
    const s = scene(settings, [], [{ ...newNode('n1', r, 0), position: [r, 0, 1.5], mic_spacing_m: 0.01 }], [
      { ...newSource('s1', 't', 0, 0, 120), keyframes: [{ t: 0, position: [0, 0, 1.5] }], start_s: 0.02 }
    ]);
    const out = renderScenario(s, new Map([['t', mk(f)]]), { lengthS: 1 });
    return loudestWindowRms(out.nodes[0].mics[0], FS);
  };
  for (const f of [250, 1000, 4000]) {
    const a = levelAtF(f, 20);
    const b = levelAtF(f, 100);
    const measured = 20 * Math.log10(a / b) - 20 * Math.log10(100 / 20);
    const expected = airAbsorptionDbPerM(f, 15, 70, 101.325) * 80;
    console.log(`air absorption ${f} Hz over 80 m: ${measured.toFixed(2)} dB vs ISO 9613-1 ${expected.toFixed(2)} dB`);
    assert.ok(Math.abs(measured - expected) < 0.5, `${f} Hz: ${measured.toFixed(2)} vs ${expected.toFixed(2)}`);
  }
});

// Item 10, ground: reflected delay and gain equal the mirrored-source values.
test('element: ground path delay and gain match the mirrored source', () => {
  const s = scene({ ground_reflectivity: 0.8, reflection_order: 0, temperature_c: 15 });
  const src = [0, 0, 1.5];
  const mic = [30, 0, 5];
  const { paths } = findPaths(src, mic, { settings: s.settings, buildings: [], surfaces: buildSurfaces([]), c: C15 });
  const ground = paths.find((p) => p.type === 'ground');
  const mirrorLen = Math.hypot(30, 0, 5 - -1.5);
  assert.ok(Math.abs(ground.length - mirrorLen) < 1e-9, `length ${ground.length} vs mirror ${mirrorLen}`);
  assert.equal(ground.gain, 0.8);
  assert.ok(Math.abs(ground.delay_s - mirrorLen / C15) < 1e-12);
});

// Item 10, blocked: the direct spike is absent and the first spike is the earliest valid path.
test('element: blocked direct leaves no spike at the direct time; first spike is the earliest path', () => {
  // Diffraction on so valid paths past the screen exist; every wall reflection here is blocked too.
  const s = scene(
    { ground_reflectivity: 0, reflection_order: 1, diffraction_order: 1, noise_enabled: false, temperature_c: 15, air_absorption: false },
    [newBuilding('b1', 15, 0, 10, 10, 15)],
    [{ ...newNode('n1', 30, 0), position: [30, 0, 1.5], mic_spacing_m: 0.02 }],
    [{ ...newSource('s1', 'test_impulse', 0, 0, 94), keyframes: [{ t: 0, position: [0, 0, 1.5] }], start_s: 0.1 }]
  );
  const out = renderScenario(s, new Map([['test_impulse', impulse()]]), { lengthS: 0.8 });
  const sig = out.nodes[0].mics[0];
  const { paths, dropped } = out.paths[0].perMic[0][0];
  assert.ok(dropped.some((d) => d.type === 'direct' && d.reason === 'blocked'), 'direct listed as blocked');
  assert.ok(paths.length > 0 && paths.every((p) => p.type === 'diffracted'), 'only diffracted paths survive');
  const directSample = Math.round((0.1 + Math.hypot(30, 0, 0) / C15) * FS) + IMPULSE_PEAK;
  const { peaks, max } = peaksOf(sig);
  let atDirect = 0;
  for (let i = directSample - 40; i < directSample + 40; i++) atDirect = Math.max(atDirect, Math.abs(sig[i]));
  assert.ok(atDirect < max * 0.05, `spike at the direct time: ${atDirect} vs max ${max}`);
  const earliest = Math.min(...paths.map((p) => (0.1 + p.delay_s) * FS)) + IMPULSE_PEAK;
  assert.ok(Math.abs(peaks[0].i - earliest) <= 2, `first spike ${peaks[0].i} vs earliest path ${earliest.toFixed(0)}`);
  console.log(`blocked scene: first spike ${peaks[0].i}, earliest valid path ${earliest.toFixed(0)}, path types ${paths.map((p) => p.type)}`);
});

// Item 8: a path delayed near the end of the buffer must not wrap to the start.
test('padding: path delayed near the end of the buffer does not wrap around', () => {
  const s = scene(
    { air_absorption: false, ground_reflectivity: 0, reflection_order: 0, noise_enabled: false, temperature_c: 15 },
    [],
    [{ ...newNode('n1', 10, 0), position: [10, 0, 1.5], mic_spacing_m: 0.01 }],
    [{ ...newSource('s1', 'test_impulse', 0, 0, 94), keyframes: [{ t: 0, position: [0, 0, 1.5] }], start_s: 0.27 }]
  );
  const out = renderScenario(s, new Map([['test_impulse', impulse()]]), { lengthS: 0.35 });
  const sig = out.nodes[0].mics[0];
  const expected = Math.round((0.27 + 10 / C15) * FS) + IMPULSE_PEAK; // 94% into the buffer
  const { peaks } = peaksOf(sig);
  assert.equal(peaks.length, 1, `peaks: ${peaks.map((p) => p.i)}`);
  assert.ok(Math.abs(peaks[0].i - expected) <= 1, `spike at ${peaks[0].i}, expected ${expected}`);
  let head = 0;
  for (let i = 0; i < 0.02 * FS; i++) head = Math.max(head, Math.abs(sig[i]));
  assert.ok(head < 1e-6, `wrap-around energy at the buffer start: ${head}`);
});

// Item 8: fractional-delay accuracy, impulse and 500 Hz tone, production vs reference.
// Both must place energy at the same delay to within 0.05 sample (the production delay is an
// exact phase ramp; the reference is a windowed sinc — this measures the interpolator).
function xcorrDelay(a, b, maxLag = 200) {
  const vs = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = maxLag; i < a.length - maxLag; i++) s += a[i] * (b[i + lag] || 0);
    vs.push(s);
  }
  let bi = 0;
  for (let i = 1; i < vs.length - 1; i++) if (vs[i] > vs[bi]) bi = i;
  const [y0, y1, y2] = [vs[bi - 1], vs[bi], vs[bi + 1]];
  const frac = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
  return bi - maxLag + frac;
}

function delayMismatch(label, clip) {
  const s = scene(
    { air_absorption: false, ground_reflectivity: 0, reflection_order: 0, noise_enabled: false },
    [],
    [{ ...newNode('n1', 30.37, 0), position: [30.37, 0, 1.5], mic_spacing_m: 0.05 }], // fractional delays
    [{ ...newSource('s1', 'c', 0, 0, 100), keyframes: [{ t: 0, position: [0, 0, 1.5] }], start_s: 0.05 }]
  );
  const clips = new Map([['c', clip]]);
  const prod = renderScenario(s, clips, { lengthS: 0.5 });
  const ref = referenceRender(s, clips, 0.5);
  const d = xcorrDelay(ref.nodes[0].mics[0], prod.nodes[0].mics[0]);
  console.log(`${label}: reference-vs-production delay ${d.toFixed(4)} samples`);
  assert.ok(Math.abs(d) < 0.05, `${label}: ${d.toFixed(4)} samples`);
}

test('interpolator: impulse delay agrees with the reference within 0.05 sample', () => {
  delayMismatch('impulse', impulse());
});

test('interpolator: 500 Hz tone delay agrees with the reference within 0.05 sample', () => {
  const tone = new Float32Array(Math.round(0.2 * FS));
  for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * 500 * i) / FS) * Math.sin((Math.PI * i) / tone.length) ** 2;
  delayMismatch('500 Hz tone', tone);
});
