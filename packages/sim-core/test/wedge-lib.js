// Shared by test/sim-wedge.test.js and scripts/sim-diffraction-validation.mjs: coherent field of a path list, and the exact (BTM) rigid wedge field.
import { findPaths, WALL_PRESSURE_FACTOR } from '../src/geometry.js';
import { defaultScenario, newBuilding } from '../src/scenario.js';
import { diffractionResponse, utdCoefficient } from '../src/diffraction.js';
import { speedOfSound } from '../src/physics.js';
import { btmDiffracted } from './btm-reference.js';

export const D2R = Math.PI / 180;
export const C15 = speedOfSound(15);
export const db = (v) => 20 * Math.log10(Math.hypot(v[0], v[1]));

export function openSettings(over = {}) {
  return { ...defaultScenario().settings, ground_reflectivity: 0, reflection_order: 1, air_absorption: false, ...over };
}

/** Complex pressure (free field = e^{-jkR}/R) summed coherently over a path list, no air absorption. */
export function coherentField(paths, f, c = C15) {
  const k = (2 * Math.PI * f) / c;
  let re = 0;
  let im = 0;
  for (const p of paths) {
    const g0 = p.gain / Math.max(p.length, 1);
    const [dr, di] = p.diffraction ? diffractionResponse(p.diffraction, f, c) : [1, 0];
    const cr = Math.cos(-k * p.length);
    const ci = Math.sin(-k * p.length);
    re += g0 * (dr * cr - di * ci);
    im += g0 * (dr * ci + di * cr);
  }
  return [re, im];
}

/**
 * A single 90 degree building corner seen from the outside: a very large tall building whose SE corner is at (200, -200).
 * Source and receiver are placed in polar coordinates (r, theta from the 0-face) around that edge at the same height, so the
 * problem is two dimensional and the exact BTM wedge solution (exterior angle 3 pi / 2) applies. The other edges are far away.
 */
export function cornerGeometry() {
  const corner = [200, -200];
  return {
    buildings: [newBuilding('b', 0, 0, 400, 400, 400)],
    corner,
    pos: (r, thetaDeg, z = 200) => [corner[0] - r * Math.cos(thetaDeg * D2R), corner[1] - r * Math.sin(thetaDeg * D2R), z]
  };
}

/** Exact field of the rigid wedge: geometrical-optics terms (direct, 0-face reflection) plus the BTM diffraction. */
export function exactCornerField({ rS, thS, rR, thR, f, c = C15, wedge = 1.5, samples = 160000 }) {
  const k = (2 * Math.PI * f) / c;
  let re = 0;
  let im = 0;
  const add = (R, gain) => {
    re += (gain / R) * Math.cos(-k * R);
    im += (gain / R) * Math.sin(-k * R);
  };
  const cyl = (r1, t1, r2, t2) => Math.hypot(r1 * Math.cos(t1 * D2R) - r2 * Math.cos(t2 * D2R), r1 * Math.sin(t1 * D2R) - r2 * Math.sin(t2 * D2R));
  if (Math.abs(thR - thS) < 180) add(cyl(rS, thS, rR, thR), 1);
  if (thR + thS < 180) add(cyl(rS, -thS, rR, thR), WALL_PRESSURE_FACTOR);
  const diff = btmDiffracted({ wedgeAngle: wedge * Math.PI, rS, thS: thS * D2R, rR, thR: thR * D2R, f, c, samples });
  return [re + diff[0], im + diff[1]];
}

/** The engine's field for the same corner geometry. */
export function engineCornerField({ rS, thS, rR, thR, f, settings, c = C15 }) {
  const g = cornerGeometry();
  const src = g.pos(rS, thS);
  const mic = g.pos(rR, thR);
  const { paths } = findPaths(src, mic, { settings, buildings: g.buildings, c });
  return { field: coherentField(paths, f, c), straight: Math.hypot(src[0] - mic[0], src[1] - mic[1]), paths };
}

/** UTD half-plane (n = 2) coefficient against the exact half-plane (BTM) at the same angles, both relative to the free field. */
export function halfPlaneCompare({ rS, thS, rR, thR, f, c = C15, samples = 160000 }) {
  const s1 = rS;
  const s2 = rR;
  const L = (s1 * s2) / (s1 + s2);
  const D = utdCoefficient({ n: 2, beta: Math.PI / 2, phi: thR * D2R, phiP: thS * D2R, L, R0: 1, Rn: 1 }, f, c);
  const A = 1 / Math.sqrt(s1 * s2 * (s1 + s2));
  const k = (2 * Math.PI * f) / c;
  const ph = -k * (s1 + s2);
  const utd = [A * (D[0] * Math.cos(ph) - D[1] * Math.sin(ph)), A * (D[0] * Math.sin(ph) + D[1] * Math.cos(ph))];
  const exact = btmDiffracted({ wedgeAngle: 2 * Math.PI, rS, thS: thS * D2R, rR, thR: thR * D2R, f, c, samples });
  const cyl = Math.hypot(rS * Math.cos(thS * D2R) - rR * Math.cos(thR * D2R), rS * Math.sin(thS * D2R) - rR * Math.sin(thR * D2R));
  const rel = (v) => db(v) + 20 * Math.log10(cyl);
  return { utd_db: rel(utd), exact_db: rel(exact) };
}

// ---- causality -------------------------------------------------------------------------------------------------------------
import { renderScenario } from '../src/render.js';
import { newNode, newSource } from '../src/scenario.js';

export const PRE_OFFSETS = [1, 2, 5, 10, 30, 100, 1000];

function impulseRender(buildings, nodePos, srcPos, start = 0.1) {
  const s = defaultScenario();
  Object.assign(s.settings, { ground_reflectivity: 0, reflection_order: 0, air_absorption: false, noise_enabled: false, diffraction_order: 2, diffraction_model: 'wedge' });
  s.buildings = buildings;
  s.nodes = [{ ...newNode('n1', nodePos[0], nodePos[1]), position: nodePos, mic_spacing_m: 0.02 }];
  s.sources = [{ ...newSource('s1', 'imp', srcPos[0], srcPos[1], 94), keyframes: [{ t: 0, position: srcPos }], start_s: start }];
  const imp = new Float32Array(32);
  imp[0] = 1;
  const r = renderScenario(s, new Map([['imp', imp]]), { lengthS: 0.9 });
  return { sig: r.nodes[0].mics[0], paths: r.paths[0].perMic[0][0].paths, fs: r.sample_rate };
}

const peakOf = (sig) => {
  let pk = 0;
  let pi = 0;
  for (let i = 0; i < sig.length; i++) if (Math.abs(sig[i]) > pk) [pk, pi] = [Math.abs(sig[i]), i];
  return { pk, pi };
};

/** Pre-arrival level (dB re the peak) at the given offsets (samples before the peak): worst sample in a small window. */
export function preArrival(sig, offsets = PRE_OFFSETS) {
  const { pk, pi } = peakOf(sig);
  return offsets.map((o) => {
    let m = 0;
    for (let i = pi - o - Math.max(1, Math.floor(o / 5)); i <= pi - o; i++) m = Math.max(m, Math.abs(sig[i]));
    return 20 * Math.log10(Math.max(m, 1e-30) / pk);
  });
}

/**
 * Impulse source behind a 10 x 10 x 15 m building (diffracted only) against an ideal delayed impulse in free field with the same
 * fractional delay. Both are band limited, so both ring before the arrival; the diffracted response must not ring more.
 */
export function causalityReport() {
  const behind = impulseRender([newBuilding('b1', 50, 0, 10, 10, 15)], [100, 0, 5], [0, 0, 1.5]);
  const earliest = Math.min(...behind.paths.map((p) => (0.1 + p.delay_s) * behind.fs));
  const frac = earliest - Math.floor(earliest);
  // Free-field distance whose arrival has the same fractional sample.
  const N = Math.floor(earliest);
  const d = ((N + frac) / behind.fs - 0.1) * C15;
  const ref = impulseRender([], [d, 0, 1.5], [0, 0, 1.5]);
  const bp = peakOf(behind.sig);
  const first = (thr) => {
    for (let i = 0; i < behind.sig.length; i++) if (Math.abs(behind.sig[i]) > thr * bp.pk) return i;
    return -1;
  };
  return { earliest, peak_index: bp.pi, first_above_minus20_db: first(0.1), first_above_minus40_db: first(0.01), diffracted: preArrival(behind.sig), ideal: preArrival(ref.sig) };
}
