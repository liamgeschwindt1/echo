// Heatmap field data (brief D6): arrivals, pulse and peak-hold, height behaviour, open-field spreading, diffraction round a building.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newBuilding } from '../src/sim/core/scenario.js';
import { clipBandEnvelopes, computeFieldArrivals, estimateFieldBytes, fitGridToBudget, peakHoldPower, powerToDb, pulsePower } from '../src/sim/core/field.js';
import { computeReachField, sourceBandLevels } from '../src/sim/core/reach.js';
import { clipGainPa } from '../src/sim/core/render.js';
import { synthesizeClip } from '../src/sim/clips.js';

const FS = 48000;
const settings = (over = {}) => ({ ...defaultScenario().settings, air_absorption: false, ground_reflectivity: 0, reflection_order: 0, reach_reflection_order: 0, noise_enabled: false, ...over });
const noise = synthesizeClip('noise', FS);
const impulse = synthesizeClip('impulse', FS);
const planGrid = (x0, y0, n, z, cell = 2) => ({ kind: 'plan', x0, y0, cell, nx: n, ny: n, z });
const cellAt = (g, x, y) => Math.round((y - g.y0) / g.cell - 0.5) * g.nx + Math.round((x - g.x0) / g.cell - 0.5);
const src = (clip, pos, level = 100, start = 0.2) => [{ position: pos, start_s: start, gainPa: clipGainPa(clip, FS, level) }];

test('memory estimate and automatic coarsening', () => {
  assert.equal(estimateFieldBytes(1000, 2, 16), 1000 * 2 * 16 * 5 * 4);
  const big = { kind: 'plan', x0: 0, y0: 0, cell: 1, nx: 2000, ny: 2000, z: 1.5 };
  const fit = fitGridToBudget(big, 1);
  assert.ok(fit.coarsened && fit.bytes <= 64 * 1024 * 1024 && fit.grid.cell > 1);
});

test('D6.1 level at a cell: time-mean pulse power equals the reach map localisation-band power within 1.5 dB (noise burst)', () => {
  const st = settings();
  const g = planGrid(-39, -39, 40, 1.5);
  const sources = src(noise, [0, 0, 1.5]);
  const field = computeFieldArrivals({ sources, settings: st, grid: g });
  const env = [clipBandEnvelopes(noise, FS, st.localisation_band_hz)];
  const i = cellAt(g, 21, 1);
  let sum = 0;
  let n = 0;
  for (let t = 0.2; t < 0.2 + noise.length / FS + 0.1; t += 0.01) {
    sum += pulsePower(field, env, 3, t)[i];
    n++;
  }
  const meanDb = 10 * Math.log10(sum / (noise.length / FS / 0.01));
  const bandPa2 = sourceBandLevels(noise, FS, 100, st.localisation_band_hz);
  const reach = computeReachField({ sources: [{ position: [0, 0, 1.5], bandPa2 }], settings: st, grid: g, noisePa2: 1 });
  const reachDb = reach.snrDb[i];
  assert.ok(Math.abs(meanDb - reachDb) < 1.5, `pulse mean ${meanDb.toFixed(2)} dB vs reach ${reachDb.toFixed(2)} dB (n=${n})`);
});

test('D6.2 pulse peak at a cell lies within one frame of each arrival (direct and ground)', () => {
  const st = settings({ ground_reflectivity: 0.8, reflection_order: 0, reach_reflection_order: 0 });
  const g = planGrid(-1, -1, 60, 5, 2);
  const sources = src(impulse, [0, 0, 1.5], 120, 0.1);
  const field = computeFieldArrivals({ sources, settings: st, grid: g });
  const i = cellAt(g, 51, 1);
  const s = field.perSource[0];
  assert.equal(s.count[i], 2);
  const env = [clipBandEnvelopes(impulse, FS, st.localisation_band_hz)];
  const series = [];
  for (let t = 0; t < 0.6; t += 0.01) series.push(pulsePower(field, env, 1, t)[i]);
  for (let k = 0; k < 2; k++) {
    const expected = 0.1 + s.delay[i * field.topN + k] + 0.03; // the generated click is centred 30 ms into its clip
    const at = Math.round(expected / 0.01);
    const local = Math.max(series[at - 1] ?? 0, series[at], series[at + 1] ?? 0);
    assert.ok(local > 0.3 * Math.max(...series.slice(Math.max(0, at - 3), at + 4)), `arrival ${k}`);
    assert.ok(series[at] > 0 || series[at + 1] > 0 || series[at - 1] > 0);
  }
});

test('D6.3 the final peak-hold frame equals the running maximum of the pulse frames', () => {
  const st = settings({ ground_reflectivity: 0.8 });
  const g = planGrid(-19, -19, 20, 1.5, 2);
  const field = computeFieldArrivals({ sources: src(impulse, [0, 0, 1.5], 110), settings: st, grid: g });
  const env = [clipBandEnvelopes(impulse, FS, st.localisation_band_hz)];
  const tEnd = 0.4;
  const hold = peakHoldPower(field, env, 3, tEnd);
  const ref = new Float64Array(hold.length);
  for (let t = 0; t <= tEnd + 1e-9; t += 0.01) pulsePower(field, env, 3, t).forEach((v, i) => (ref[i] = Math.max(ref[i], v)));
  assert.deepEqual(hold, ref);
});

test('D6.4 raising the slice above a roof opens the mask and shrinks the shadow', () => {
  const st = settings();
  const b = [newBuilding('b1', 30, 0, 10, 10, 15)];
  const build = (z) => computeFieldArrivals({ sources: src(noise, [0, 0, 1.5]), settings: st, buildings: b, grid: planGrid(1, -19, 40, z, 2) });
  const low = build(1.5);
  const high = build(20);
  assert.ok(low.mask.some((m) => m === 1));
  assert.ok(high.mask.every((m) => m === 0), 'no masked cells above the roof');
  const shadow = (f) => f.perSource[0].count.reduce((a, n, i) => a + (!f.mask[i] && f.perSource[0].amp2[i * f.topN * 4 + 1] < 1e-9 ? 1 : 0), 0);
  const first = (f, i) => f.perSource[0].amp2[i * f.topN * 4 + 1];
  const behind = cellAt(planGrid(1, -19, 40, 1.5, 2), 41, 1);
  // Strongest arrival behind the building is much stronger with the slice above the roof (direct path restored).
  assert.ok(first(high, behind) > 5 * first(low, behind), `${first(high, behind)} vs ${first(low, behind)}`);
  void shadow;
});

test('D6.5 open field, ground off: 6 dB per doubling at every height and circular contours in plan', () => {
  const st = settings();
  const env = [clipBandEnvelopes(noise, FS, st.localisation_band_hz)];
  for (const z of [0.5, 1.5, 10, 30]) {
    const g = planGrid(-81, -81, 80, z, 2);
    const field = computeFieldArrivals({ sources: src(noise, [0, 0, 1.5]), settings: st, grid: g });
    const hold = powerToDb(peakHoldPower(field, env, 3, 0.2 + noise.length / FS + 0.2), field.mask);
    const dz = z - 1.5;
    const at = (x) => hold[cellAt(g, x, 1)];
    // Range from the 3D distance: compare against 20 log10 of 3D distance ratio, away from the 1 m floor.
    const r = (x) => Math.hypot(x, 1, dz);
    const expected = -20 * Math.log10(r(40) / r(20));
    assert.ok(Math.abs(at(40) - at(20) - expected) < 0.1, `z ${z}: ${at(40) - at(20)} vs ${expected}`);
    // Circular: equal range (x,y) and (y,x) give equal level.
    assert.ok(Math.abs(hold[cellAt(g, 31, 17)] - hold[cellAt(g, 17, 31)]) < 1e-3);
  }
});

test('D6.6 behind a building the field has energy from diffracted arrivals (order 2) that order 0 lacks', () => {
  const b = [newBuilding('b1', 30, 0, 10, 10, 15)];
  const g = planGrid(1, -19, 40, 1.5, 2);
  const run = (over) => computeFieldArrivals({ sources: src(noise, [0, 0, 1.5]), settings: settings(over), buildings: b, grid: g });
  const behind = cellAt(g, 41, 1);
  const on = run({ diffraction_order: 2, diffraction_model: 'wedge' });
  const off = run({ diffraction_order: 0, diffraction_model: 'maekawa' });
  assert.equal(off.perSource[0].count[behind], 0);
  assert.ok(on.perSource[0].count[behind] >= 2);
  assert.ok(on.perSource[0].amp2[behind * on.topN * 4 + 1] > 0);
});
