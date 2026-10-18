// Reach map checks (brief item 7) plus reach-map-vs-microphone consistency (fidelity item 11).
// The reach field sums paths energetically (incoherent); the render sums them coherently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newBuilding, newNode, newSource } from '../src/sim/core/scenario.js';
import { findPaths, buildSurfaces, WALL_PRESSURE_FACTOR } from '../src/sim/core/geometry.js';
import { speedOfSound, digitalPerPa, P_REF_PA } from '../src/sim/core/physics.js';
import { computeReachField, sourceBandLevels, noiseBandPowerPa2, pathsBandPowers, REACH_BANDS } from '../src/sim/core/reach.js';
import { renderScenario } from '../src/sim/core/render.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { rfft, nextPow2 } from '../src/sim/core/dsp.js';
import { synthesizeClip } from '../src/sim/clips.js';

const FS = 48000;
const C15 = speedOfSound(15);

const openSettings = (over = {}) => ({
  ...defaultScenario().settings,
  air_absorption: false,
  ground_reflectivity: 0,
  reflection_order: 0,
  reach_reflection_order: 0,
  diffraction_order: 0,
  noise_enabled: false,
  ...over
});

const noiseBandPa2 = (level, settings) => sourceBandLevels(synthesizeClip('noise', FS), FS, level, settings.localisation_band_hz);

// Plan grid whose cell centres land on whole metres starting at (x0+1, y0+1).
const planGrid = (x0, y0, n, z, cell = 2) => ({ kind: 'plan', x0, y0, cell, nx: n, ny: n, z });
const cellAt = (g, x, y) => {
  const ix = Math.round((x - g.x0) / g.cell - 0.5);
  const iy = Math.round((y - g.y0) / g.cell - 0.5);
  return iy * g.nx + ix;
};

test('open field, order 0, ground off: 6 dB per 3D doubling at every slice height, contours circular', () => {
  const settings = openSettings();
  const bandPa2 = noiseBandPa2(100, settings);
  for (const z of [1.5, 5, 10]) {
    const grid = planGrid(-71, -71, 71, z); // cell centres on even metres, (0,0) included
    const f = computeReachField({ sources: [{ position: [0, 0, 1.5], bandPa2 }], settings, buildings: [], grid, noisePa2: 0 });
    const levelAt = (x, y) => f.levelDb[cellAt(grid, x, y)];
    // Level difference must equal 20 log10 of the 3D distance ratio (6.02 dB when that doubles).
    let perDoubling = null;
    for (const [r1, r2] of [[12, 24], [22, 44], [14, 28]]) {
      const d1 = Math.hypot(r1, 0, z - 1.5);
      const d2 = Math.hypot(r2, 0, z - 1.5);
      const measured = levelAt(r1, 0) - levelAt(r2, 0);
      const expected = 20 * Math.log10(d2 / d1);
      assert.ok(Math.abs(measured - expected) < 0.15, `z=${z} r ${r1}->${r2}: ${measured.toFixed(2)} dB vs ${expected.toFixed(2)}`);
      if (r1 === 12) perDoubling = (measured / expected) * 6.0206;
    }
    console.log(`slice z=${z}: ${perDoubling.toFixed(2)} dB per 3D doubling`);
    assert.ok(Math.abs(perDoubling - 6.0206) < 0.2);
    // Contours are circles: same plan radius, three directions.
    const a = levelAt(30, 0);
    const b = levelAt(0, 30);
    const cc = levelAt(-30, 0);
    assert.ok(Math.abs(a - b) < 0.1 && Math.abs(a - cc) < 0.1, `circle at z=${z}: ${a} ${b} ${cc}`);
  }
});

test('higher slice shrinks the building shadow; direct returns above the roof', () => {
  // A line from the low source to a high receiver still crosses the box: the shadow edge behind
  // it is set by the NEAR top corner (45, 15). At x=70 the ray clears the roof only above
  // z = 1.5 + 13.5 * 70/45 = 22.5. So: deep shadow low, lit high. Diffraction off.
  const settings = openSettings();
  const b = [newBuilding('b1', 50, 0, 10, 10, 15)];
  const bandPa2 = noiseBandPa2(100, settings);
  const shadowDepth = (z, x, y) => {
    const grid = planGrid(x - 21, y - 21, 21, z);
    const src = [{ position: [0, 0, 1.5], bandPa2 }];
    const withB = computeReachField({ sources: src, settings, buildings: b, grid, noisePa2: 0 });
    const free = computeReachField({ sources: src, settings, buildings: [], grid, noisePa2: 0 });
    const i = cellAt(grid, x, y);
    return free.levelDb[i] - withB.levelDb[i];
  };
  const low = shadowDepth(2, 70, 0);
  const high = shadowDepth(20, 70, 0);
  const above = shadowDepth(24, 70, 0);
  console.log(`shadow depth at (70,0): z=2 ${low.toFixed(1)} dB, z=20 ${high.toFixed(1)} dB, z=24 ${above.toFixed(2)} dB (edge z=22.5)`);
  assert.ok(low > 20, `deep shadow at z=2 (no diffraction): ${low.toFixed(1)} dB`);
  assert.ok(high > 20, `still shadowed below the edge line at z=20: ${high.toFixed(1)} dB`);
  assert.ok(above < 0.2, `no shadow once the ray clears the near top corner: ${above.toFixed(2)} dB`);
  // Wall reflections vanish when both endpoints are above the building tops.
  const surfaces = buildSurfaces(b);
  const highUp = findPaths([0, 0, 20], [100, 0, 20], { settings: { ...settings, reflection_order: 1 }, buildings: b, surfaces, c: C15 });
  assert.ok(!highUp.paths.some((p) => p.type === 'wall'), 'no wall paths above the roofline');
  assert.ok(highUp.dropped.filter((d) => d.type === 'wall').every((d) => d.reason === 'off_face'));
});

test('shadow edges are straight lines through the building corners (diffraction off)', () => {
  const settings = openSettings();
  const b = [newBuilding('b1', 50, 0, 10, 10, 15)]; // corners at (55, +/-5) on the far side
  const bandPa2 = noiseBandPa2(100, settings);
  const grid = planGrid(49, -31, 46, 1.5); // x 50..140, y -30..30, centres on whole metres from 50
  const f = computeReachField({ sources: [{ position: [0, 0, 1.5], bandPa2 }], settings, buildings: b, grid, noisePa2: 0 });
  const free = computeReachField({ sources: [{ position: [0, 0, 1.5], bandPa2 }], settings, buildings: [], grid, noisePa2: 0 });
  for (const x of [70, 100, 130]) {
    // Shadow boundary: line from the source through the NEAR corner (45, 5): y_edge = 5x/45.
    // (A ray past that line misses the box footprint entirely.)
    const yEdge = (5 * x) / 45;
    let lastShadow = null;
    let firstLit = null;
    for (let yc = 0; yc <= 30; yc += 2) {
      const i = cellAt(grid, x, yc); // even yc lands exactly on a cell centre row
      const depth = free.levelDb[i] - f.levelDb[i];
      if (depth > 10) lastShadow = yc;
      else if (lastShadow !== null && firstLit === null && depth < 1) firstLit = yc;
    }
    console.log(`x=${x}: shadow edge at |y| in (${lastShadow}, ${firstLit}), line through corner: ${yEdge.toFixed(1)}`);
    assert.ok(lastShadow !== null && firstLit !== null, `no edge found at x=${x}`);
    assert.ok(Math.abs((lastShadow + firstLit) / 2 - yEdge) <= grid.cell, `edge not on the corner line at x=${x}`);
  }
});

test('one-wall mirror: 58.5 ms delay difference, -4.5 dB, absorption and ground off', () => {
  // Same geometry as test/scenarios/one-wall-mirror.json: source (0,0,1.5), receiver (30,0,5),
  // building at (-20,0) size 20x20x15, so the reflecting face is x=-10.
  const settings = openSettings({ reflection_order: 1, temperature_c: 15 });
  const b = [newBuilding('b1', -20, 0, 20, 20, 15)];
  const { paths } = findPaths([0, 0, 1.5], [30, 0, 5], { settings, buildings: b, surfaces: buildSurfaces(b), c: C15 });
  const direct = paths.find((p) => p.type === 'direct');
  const wall = paths.find((p) => p.type === 'wall');
  assert.ok(direct && wall);
  const dtMs = (wall.delay_s - direct.delay_s) * 1000;
  const relDb = 20 * Math.log10((wall.gain / wall.length) / (direct.gain / direct.length));
  console.log(`one-wall mirror: dt=${dtMs.toFixed(1)} ms, reflection ${relDb.toFixed(2)} dB rel direct, wall gain ${WALL_PRESSURE_FACTOR.toFixed(4)}`);
  assert.ok(Math.abs(dtMs - 58.5) < 0.5, `dt ${dtMs.toFixed(2)} ms`);
  assert.ok(Math.abs(relDb - -4.5) < 0.15, `rel ${relDb.toFixed(2)} dB`);
});

test('diffraction on the reach map: ~5 dB at the shadow edge, rising with depth, less at 250 Hz than 4 kHz', () => {
  const settings = openSettings({ diffraction_order: 1 });
  const b = [newBuilding('b1', 50, 0, 10, 20, 15)]; // footprint x 45..55, y -10..10
  const bandPa2 = noiseBandPa2(100, settings);
  // Shadow boundary at x=100: |y| = 10*100/45 = 22.2. Sample just inside it and deeper.
  const grid = planGrid(79, -41, 41, 1.5); // even-metre centres, x 80..120, y -40..40
  const src = [{ position: [0, 0, 1.5], bandPa2 }];
  const f = computeReachField({ sources: src, settings, buildings: b, grid, noisePa2: 0 });
  const free = computeReachField({ sources: src, settings, buildings: [], grid, noisePa2: 0 });
  const drop = (y) => free.levelDb[cellAt(grid, 100, y)] - f.levelDb[cellAt(grid, 100, y)];
  const edge = drop(22); // just inside the geometric shadow: delta ~ 0, ~5 dB
  const mid = drop(10);
  const deep = drop(0);
  console.log(`diffraction drop into shadow: edge ${edge.toFixed(1)} dB, mid ${mid.toFixed(1)} dB, deep ${deep.toFixed(1)} dB`);
  assert.ok(edge > 3 && edge < 8, `edge ~5 dB: ${edge.toFixed(1)}`);
  assert.ok(mid > edge && deep >= mid - 0.5, 'rises with depth');
  assert.ok(deep <= 20 + 1, 'capped');
  // Band dependence on a real diffracted path at mid shadow depth (loss not yet capped):
  // 250 Hz loses clearly less than 4 kHz. Energetic sum with a flat source (unit power per band).
  const { paths } = findPaths([0, 0, 1.5], [100, 10, 1.5], { settings, buildings: b, surfaces: buildSurfaces(b), c: C15 });
  const diffr = paths.filter((p) => p.type === 'diffracted');
  assert.ok(diffr.length > 0);
  const e = pathsBandPowers(diffr, [1, 1, 1, 1], settings, C15);
  const loss250 = -10 * Math.log10(e[0] / diffr.reduce((a, p) => a + (p.gain / p.length) ** 2, 0));
  const loss4k = -10 * Math.log10(e[2] / diffr.reduce((a, p) => a + (p.gain / p.length) ** 2, 0));
  console.log(`diffracted path band loss: 250 Hz ${loss250.toFixed(1)} dB, 4 kHz ${loss4k.toFixed(1)} dB`);
  assert.ok(loss250 < loss4k - 2, `250 Hz ${loss250.toFixed(1)} vs 4 kHz ${loss4k.toFixed(1)}`);
});

test('reach-map SNR at the node position matches the node snr_db within 1 dB', () => {
  const s = defaultScenario();
  Object.assign(s.settings, { ground_reflectivity: 0, reflection_order: 0, reach_reflection_order: 0, diffraction_order: 0, air_absorption: true });
  s.nodes = [{ ...newNode('n1', 20, 0), mic_spacing_m: 0.05 }];
  s.sources = [{ ...newSource('s1', 'test_noise_burst', 0, 0, 85), start_s: 0.3 }];
  const clips = new Map([['test_noise_burst', synthesizeClip('noise', FS)]]);
  const out = renderScenario(s, clips, { lengthS: 4.5 });
  const [r] = analyseScenario(s, out, new Map([['test_noise_burst', 1]]));
  const snrNode = r.nodes[0].snr_db;
  const bandPa2 = sourceBandLevels(clips.get('test_noise_burst'), FS, 85, s.settings.localisation_band_hz);
  const noisePa2 = noiseBandPowerPa2(s.settings, FS, 4);
  const grid = planGrid(19, -1, 21, 5); // cell centre at the node position (20,0), slice at node height 5 m
  const f = computeReachField({ sources: [{ position: [0, 0, 1.5], bandPa2 }], settings: s.settings, buildings: [], grid, noisePa2 });
  const snrMap = f.snrDb[cellAt(grid, 20, 0)];
  console.log(`SNR consistency: node ${snrNode.toFixed(2)} dB, reach map ${snrMap.toFixed(2)} dB, diff ${(snrNode - snrMap).toFixed(2)} dB`);
  assert.ok(Math.abs(snrNode - snrMap) < 1, `snr_db ${snrNode.toFixed(2)} vs map ${snrMap.toFixed(2)}`);
});

// Item 11: band energy of the mic total vs the reach level at the node position.
const bandPowerOfSignal = (sig, fs) => {
  const n = nextPow2(sig.length);
  const X = rfft(sig, n);
  const perBand = REACH_BANDS.map(() => 0);
  for (let k = 1; k < n / 2; k++) {
    const f = (k * fs) / n;
    const p = X.re[k] * X.re[k] + X.im[k] * X.im[k];
    REACH_BANDS.forEach((b, bi) => {
      if (f >= b.lo && f < b.hi) perBand[bi] += p;
    });
  }
  return { perBand, n };
};

function reachVsMic(clipId, clip, level, label, tolerance) {
  const s = defaultScenario();
  Object.assign(s.settings, { ground_reflectivity: 0.8, reflection_order: 1, reach_reflection_order: 2, noise_enabled: false });
  s.buildings = [newBuilding('b1', -20, 30, 20, 20, 15)]; // wall bounce joins direct + ground
  s.nodes = [{ ...newNode('n1', 30, 0), mic_spacing_m: 0.05 }];
  s.sources = [{ ...newSource('s1', clipId, 0, 0, level), start_s: 0.2 }];
  const clips = new Map([[clipId, clip]]);
  const out = renderScenario(s, clips, { lengthS: 2 });
  const toPa = 1 / digitalPerPa(s.settings.spl_ref_db, s.settings.dbfs_ref_db);
  const mic = out.nodes[0].mics[0];
  const { perBand, n } = bandPowerOfSignal(mic, FS);
  // Mean band power during the burst: total in-band energy (Parseval over the whole render, tails
  // included) divided by the burst length. Matches the map's whole-clip mean power normalization.
  const burstN = clip.length;
  const micPa2 = perBand.map((p) => (2 * p * toPa * toPa) / (n * burstN));
  const micDb = 10 * Math.log10(micPa2.reduce((a, v) => a + v, 0) / (P_REF_PA * P_REF_PA));
  const bandPa2 = sourceBandLevels(clip, FS, level, s.settings.localisation_band_hz);
  const grid = planGrid(29, -1, 11, 5);
  const f = computeReachField({ sources: [{ position: [0, 0, 1.5], bandPa2 }], settings: s.settings, buildings: s.buildings, grid, noisePa2: 0 });
  const mapDb = f.levelDb[cellAt(grid, 30, 0)];
  console.log(`reach vs mic (${label}): mic ${micDb.toFixed(2)} dB, map ${mapDb.toFixed(2)} dB, diff ${(micDb - mapDb).toFixed(2)} dB`);
  assert.ok(Math.abs(micDb - mapDb) < tolerance, `${label}: mic ${micDb.toFixed(1)} vs map ${mapDb.toFixed(1)} dB`);
}

test('reach map vs microphone: broadband noise burst agrees within 1.5 dB', () => {
  reachVsMic('test_noise_burst', synthesizeClip('noise', FS), 90, 'broadband', 1.5);
});

test('reach map vs microphone: tonal source, difference reported (map ignores interference)', () => {
  const tone = new Float32Array(FS);
  for (let i = 0; i < tone.length; i++) {
    const edge = Math.min(1, i / 480, (tone.length - 1 - i) / 480);
    tone[i] = Math.sin((2 * Math.PI * 300 * i) / FS) * edge;
  }
  // A 300 Hz tone sits in the 250 Hz band; ground bounce interference can add or cancel, so the
  // coherent mic energy can differ from the incoherent map by several dB. Reported, loose bound.
  reachVsMic('tone300', tone, 90, '300 Hz tone', 12);
});
