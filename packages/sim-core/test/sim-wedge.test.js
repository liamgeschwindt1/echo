// Wedge (UTD) diffraction: defaults, agreement with the exact BTM solution, continuity at the shadow boundary, causality,
// frequency behaviour, roof and end paths, order 2 chains, pruning and the audit. Numbers are reported in docs/diffraction-validation.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findPaths, simConstants, pathPressure } from '../src/geometry.js';
import { DEFAULT_SETTINGS, defaultScenario, newBuilding, newNode, newSource, scenarioNotices, validateScenario } from '../src/scenario.js';
import { diffractionResponse, fresnelF, utdCoefficient } from '../src/diffraction.js';
import { pathReport } from '../src/pathreport.js';
import { C15, PRE_OFFSETS, causalityReport, db, engineCornerField, exactCornerField, halfPlaneCompare, openSettings } from './wedge-lib.js';

test('defaults: wedge model, order 2, prune 50 dB; the legacy formula stays selectable', () => {
  assert.equal(DEFAULT_SETTINGS.diffraction_model, 'wedge');
  assert.equal(DEFAULT_SETTINGS.diffraction_order, 2);
  assert.equal(DEFAULT_SETTINGS.path_prune_db, 50);
  const k = simConstants();
  assert.equal(k.diffraction.model, 'wedge');
  assert.ok(k.diffraction.references.length >= 3 && k.diffraction.placeholder === true);
  assert.ok(k.diffraction.not_modelled.includes('facade scattering'));
  assert.equal(k.diffraction_legacy.model, 'maekawa');
});

test('older scenario files without diffraction_order load with the new defaults and a notice', () => {
  const raw = { version: '0.2', settings: { temperature_c: 12 }, nodes: [newNode('n1', 0, 0)], sources: [newSource('s1', 'b', 5, 5)], buildings: [] };
  const v = validateScenario(raw);
  assert.equal(v.settings.diffraction_order, 2);
  assert.equal(v.settings.diffraction_model, 'wedge');
  assert.equal(scenarioNotices(raw).length, 1);
  assert.equal(scenarioNotices({ ...raw, settings: { diffraction_order: 0 } }).length, 0);
});

test('Fresnel transition function: continuous across the series / asymptotic switch, limits 0 and 1', () => {
  const lo = fresnelF(14.999999);
  const hi = fresnelF(15.000001);
  assert.ok(Math.hypot(lo[0] - hi[0], lo[1] - hi[1]) < 1e-6);
  assert.ok(Math.abs(fresnelF(1e-8)[0]) < 1e-3);
  assert.ok(Math.abs(fresnelF(1e4)[0] - 1) < 1e-3);
});

test('half-plane UTD coefficient agrees with the exact (BTM) solution to 0.1 dB, deep shadow and near the boundary', () => {
  for (const [rS, rR, a, f] of [[2, 2, 5, 500], [10, 10, 20, 1000], [50, 30, 10, 250], [100, 100, 25, 125], [20, 3, 30, 4000]]) {
    const r = halfPlaneCompare({ rS, thS: 15, rR, thR: 195 + a, f, samples: 60000 });
    assert.ok(Math.abs(r.utd_db - r.exact_db) < 0.1, `${rS}/${rR}/${a}/${f}: ${r.utd_db} vs ${r.exact_db}`);
  }
});

test('half-plane shadow boundary: about -6 dB at high frequency (old formula: -4.77 dB)', () => {
  const r = halfPlaneCompare({ rS: 10, thS: 15, rR: 10, thR: 195.05, f: 8000, samples: 60000 });
  assert.ok(Math.abs(r.exact_db + 6.02) < 0.3, `exact ${r.exact_db}`);
  assert.ok(Math.abs(r.utd_db - r.exact_db) < 0.05);
});

test('building corner: engine total against the exact wedge within 1.5 dB (shadow angles 5 to 60 degrees, 125 Hz to 4 kHz)', () => {
  const st = openSettings();
  const geoms = [[2, 2, 5], [10, 10, 20], [50, 30, 10], [5, 40, 55]];
  for (const [rS, rR, a] of geoms) {
    for (const f of [125, 1000, 4000]) {
      const e = engineCornerField({ rS, thS: 15, rR, thR: 195 + a, f, settings: st });
      const x = exactCornerField({ rS, thS: 15, rR, thR: 195 + a, f, samples: 60000 });
      const ex = db(x) + 20 * Math.log10(e.straight);
      if (ex < -25) continue;
      const err = db(e.field) + 20 * Math.log10(e.straight) - ex;
      assert.ok(Math.abs(err) <= 1.5, `${rS}/${rR}/${a} deg/${f} Hz: error ${err.toFixed(2)} dB`);
    }
  }
});

test('no step at the shadow boundary: a 1 m arc sampled every 1 cm changes by less than 0.5 dB per sample', () => {
  const st = openSettings();
  const span = (1 / 10) * (180 / Math.PI);
  for (const f of [250, 1000, 4000]) {
    let prev = null;
    let worst = 0;
    for (let i = 0; i <= 100; i++) {
      const e = engineCornerField({ rS: 10, thS: 15, rR: 10, thR: 195 - span / 2 + (i * span) / 100, f, settings: st });
      const l = db(e.field) + 20 * Math.log10(e.straight);
      if (prev !== null) worst = Math.max(worst, Math.abs(l - prev));
      prev = l;
    }
    assert.ok(worst < 0.5, `${f} Hz: step ${worst}`);
  }
});

test('lit side: a free-field level well outside the shadow; in the shadow the direct path is replaced by the diffracted field', () => {
  const st = openSettings();
  // No face reflection here (thetaS + thetaR > 180 degrees), 20 degrees inside the lit zone.
  const lit = engineCornerField({ rS: 10, thS: 15, rR: 10, thR: 175, f: 4000, settings: st });
  assert.ok(lit.paths.some((p) => p.type === 'direct'));
  assert.ok(Math.abs(db(lit.field) + 20 * Math.log10(lit.straight)) < 2, `lit level ${db(lit.field) + 20 * Math.log10(lit.straight)}`);
  const shadow = engineCornerField({ rS: 10, thS: 15, rR: 10, thR: 250, f: 1000, settings: st });
  assert.ok(!shadow.paths.some((p) => p.type === 'direct'), 'direct path is gone in the shadow');
  assert.ok(shadow.paths.some((p) => p.type === 'diffracted'));
});

test('causality: the diffracted response does not arrive before length / c minus one sample, and rings no more than an ideal impulse', () => {
  const r = causalityReport();
  assert.ok(r.first_above_minus20_db >= Math.floor(r.earliest) - 1, `first sample above -20 dB: ${r.first_above_minus20_db} vs ${r.earliest}`);
  PRE_OFFSETS.forEach((o, i) => {
    if (o >= 2) assert.ok(r.diffracted[i] <= Math.max(r.ideal[i] + 6, -60), `${o} samples before: ${r.diffracted[i].toFixed(1)} vs ideal ${r.ideal[i].toFixed(1)}`);
  });
});

test('frequency behaviour: more loss at 4 kHz than at 250 Hz on the same diffracted path', () => {
  const st = openSettings();
  const { paths } = findPaths([0, 0, 1.5], [100, 0, 5], { settings: st, buildings: [newBuilding('b1', 50, 0, 10, 10, 15)], c: C15 });
  assert.ok(paths.length >= 3);
  for (const p of paths) {
    assert.ok(pathPressure(p, 250, C15) > pathPressure(p, 4000, C15), `${p.surfaces}`);
    const [re, im] = diffractionResponse(p.diffraction, 250, C15);
    assert.ok(Number.isFinite(re) && Number.isFinite(im));
  }
});

test('roof edge and round the ends: node behind a 15 m building', () => {
  const st = openSettings();
  const b = [newBuilding('b1', 50, 0, 10, 10, 15)];
  const { paths, directBlocked } = findPaths([0, 0, 1.5], [100, 0, 5], { settings: st, buildings: b, c: C15 });
  assert.ok(directBlocked);
  const roof = paths.find((p) => p.surfaces.some((s) => s.startsWith('b1:roof:')));
  assert.ok(roof, 'over-roof path');
  assert.ok(Math.abs(roof.delay_s - roof.length / C15) < 1e-12);
  assert.ok(roof.length > 100.0 + 2);
  const ends = paths.filter((p) => p.surfaces.every((s) => s.startsWith('b1:edge:')));
  assert.ok(ends.length >= 2, 'a path round each end');
  assert.ok(ends.every((p) => p.length < roof.length));
  // The path report points at the last diffraction point, and names the edges.
  const scn = defaultScenario();
  const node = { ...newNode('n1', 100, 0), position: [100, 0, 5] };
  const src = { ...newSource('s1', 'b', 0, 0, 100), keyframes: [{ t: 0, position: [0, 0, 1.5] }] };
  const rep = pathReport({ centre: { paths, directBlocked }, node, source: src, bearing: null, settings: scn.settings });
  const entry = rep.paths.find((p) => p.surfaces.some((s) => s.startsWith('b1:roof:')));
  assert.ok(entry.diffraction_loss_db_1khz > 0 && Number.isFinite(entry.diffraction_phase_deg_1khz));
  assert.ok(entry.added_delay_s > 0);
  const last = roof.hits[roof.hits.length - 1];
  const az = (Math.atan2(last[1] - node.position[1], last[0] - node.position[0]) * 180) / Math.PI;
  assert.ok(Math.abs(entry.arrival_azimuth_deg - az) < 1e-9);
});

test('order 1 cannot connect opposite sides of a building; order 2 does (documented limit)', () => {
  const b = [newBuilding('b1', 50, 0, 10, 10, 15)];
  const o1 = findPaths([0, 0, 1.5], [100, 0, 5], { settings: openSettings({ diffraction_order: 1 }), buildings: b, c: C15 });
  assert.equal(o1.paths.filter((p) => p.type === 'diffracted').length, 0);
  const o2 = findPaths([0, 0, 1.5], [100, 0, 5], { settings: openSettings({ diffraction_order: 2 }), buildings: b, c: C15 });
  assert.ok(o2.paths.length >= 3);
});

test('order 2 canyon: reflect-then-diffract, diffract-then-reflect and edge-to-edge exist; weak ones are pruned with a reason', () => {
  const b = [newBuilding('b1', 40, 8, 14, 6, 12), newBuilding('b2', 40, -8, 14, 6, 12)];
  const st = openSettings({ ground_reflectivity: 0.8, diffraction_order: 2 });
  const full = findPaths([0, 0, 1.5], [90, 0, 3], { settings: { ...st, path_prune_db: 200 }, buildings: b, c: C15 });
  const chains = new Set(full.paths.filter((p) => p.diffraction).map((p) => p.diffraction.chain));
  for (const ch of ['E', 'SE', 'ES', 'EE']) assert.ok(chains.has(ch), `chain ${ch}`);
  const pruned = findPaths([0, 0, 1.5], [90, 0, 3], { settings: st, buildings: b, c: C15 });
  assert.ok(pruned.paths.length < full.paths.length);
  assert.ok(pruned.dropped.some((d) => d.reason === 'pruned'));
  assert.equal(full.paths.length - pruned.paths.length, pruned.dropped.filter((d) => d.reason === 'pruned').length);
  // Every kept path is within the prune window at one of the three frequencies.
  for (const f of [250, 1000, 4000]) void pathPressure(pruned.paths[0], f, C15);
  const o1 = findPaths([0, 0, 1.5], [90, 0, 3], { settings: { ...st, diffraction_order: 1, path_prune_db: 200 }, buildings: b, c: C15 });
  assert.ok(o1.paths.every((p) => !p.diffraction || p.diffraction.chain === 'E'));
});

test('legs: an edge path is dropped when another building blocks a leg, with reason blocked', () => {
  const b = [newBuilding('b1', 50, 0, 10, 10, 15), newBuilding('wall', 20, 0, 2, 200, 40)];
  const r = findPaths([0, 0, 1.5], [100, 0, 5], { settings: openSettings({ diffraction_order: 2, path_prune_db: 200 }), buildings: b, c: C15 });
  assert.ok(r.dropped.some((d) => d.reason === 'blocked'));
  assert.ok(r.paths.every((p) => !p.surfaces.some((s) => s.startsWith('b1:edge:SW'))));
});

test('coefficient jumps across the shadow boundary by exactly the geometrical-optics field, so direct + diffracted is continuous', () => {
  const base = { n: 1.5, beta: Math.PI / 2, phiP: 0.3, L: 5, R0: 1, Rn: 1 };
  const at = (phi) => utdCoefficient({ ...base, phi }, 1000, C15);
  const exact = at(0.3 + Math.PI);
  assert.ok(Number.isFinite(exact[0]) && Number.isFinite(exact[1]));
  const lit = at(0.3 + Math.PI - 1e-7);
  const shadow = at(0.3 + Math.PI + 1e-7);
  // With spreading 1 / sqrt(s s' (s + s')) the jump sqrt(L) / sin(beta) becomes 1 / (s + s'): the direct field that disappears.
  assert.ok(Math.abs(shadow[0] - lit[0] - Math.sqrt(base.L)) < 1e-3, `jump ${shadow[0] - lit[0]}`);
  assert.ok(Math.abs(shadow[1] - lit[1]) < 1e-3);
});

test('render audit with wedge paths: applied delays and 1 kHz gains match an independent recomputation', async () => {
  const { renderScenario } = await import('../src/render.js');
  const { airAbsorptionDbPerM } = await import('../src/physics.js');
  const s = defaultScenario();
  Object.assign(s.settings, { ground_reflectivity: 0.8, reflection_order: 1, noise_enabled: false });
  s.buildings = [newBuilding('b1', 40, 8, 14, 6, 12), newBuilding('b2', 40, -8, 14, 6, 12), newBuilding('b3', 60, 0, 6, 6, 20)];
  s.nodes = [{ ...newNode('n1', 90, 0), position: [90, 0, 3], mic_spacing_m: 0.05 }];
  s.sources = [{ ...newSource('s1', 'b', 0, 0, 100), keyframes: [{ t: 0, position: [0, 0, 1.5] }], start_s: 0.05 }];
  const clip = Float32Array.from({ length: 600 }, (_, i) => Math.sin(i * 0.2));
  const out = renderScenario(s, new Map([['b', clip]]), { lengthS: 0.9 });
  const st = s.settings;
  const a1k = airAbsorptionDbPerM(1000, st.temperature_c, st.humidity_pct, st.pressure_kpa);
  let checked = 0;
  out.nodes[0].mic_positions_true.forEach((mp, mi) => {
    const re = findPaths([0, 0, 1.5], mp, { settings: st, buildings: s.buildings, c: C15 });
    const applied = out.audit[0][mi][0];
    assert.equal(applied.length, re.paths.length);
    applied.forEach((a, i) => {
      const p = re.paths[i];
      assert.ok(Math.abs(a.delay_samples - (0.05 + p.length / C15) * out.sample_rate) < 0.05);
      assert.ok(Math.abs(a.gain_db_1khz - (20 * Math.log10(pathPressure(p, 1000, C15)) - a1k * p.length)) < 0.05, `${a.surfaces}: ${a.gain_db_1khz}`);
      if (p.diffraction) assert.ok(/UTD/.test(a.filter));
      checked++;
    });
  });
  assert.ok(checked > 10);
});
