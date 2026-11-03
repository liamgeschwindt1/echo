// Mic array library: layouts in mm (origin at array centre, z up), figures derived from the layout.
// Seed data and method follow micarrays.md.
import { speedOfSound } from './physics.js';

export const TIMING_SIGMA_S = 10.4e-6; // one sample at 96 kHz
export const MAX_ARRAY_MICS = 64;
export const MAX_COORD_MM = 2000;

const r1 = (v) => Math.round(v * 10) / 10;

const BALL_MICS = {
  A1: [54.6, 0, 71.5], A2: [-27.3, 47.3, 71.5], A3: [-27.3, -47.3, 71.5],
  B1: [44.2, 76.6, 16.9], B2: [-88.4, 0, 16.9], B3: [44.2, -76.6, 16.9],
  C1: [88.4, 0, -16.9], C2: [-44.2, 76.6, -16.9], C3: [-44.2, -76.6, -16.9],
  D1: [27.3, 47.3, -71.5], D2: [-54.6, 0, -71.5], D3: [27.3, -47.3, -71.5]
};

export const BUILTIN_ARRAYS = Object.freeze([
  {
    id: 'flat4_100',
    name: 'Flat 4-mic square, 100 mm',
    status: 'Current simulator array. Layout assumed, confirm',
    source: 'simulator',
    assumed: true,
    notes: 'Gave biased, steep elevations and positions below ground (unvalidated).',
    mics: { M1: [50, 50, 0], M2: [-50, 50, 0], M3: [-50, -50, 0], M4: [50, -50, 0] }
  },
  {
    id: 'ball12_d180',
    name: '12-mic icosahedral ball, D180',
    status: 'Baseline node, draft rev A (30 Oct 2026)',
    source: 'node_design_sheet_d180.pdf rev A',
    assumed: false,
    notes: 'Diffraction around the shell is not modelled; mics act as free-field points.',
    mics: {
      A1: [54.6, 0, 71.5], A2: [-27.3, 47.3, 71.5], A3: [-27.3, -47.3, 71.5],
      B1: [44.2, 76.6, 16.9], B2: [-88.4, 0, 16.9], B3: [44.2, -76.6, 16.9],
      C1: [88.4, 0, -16.9], C2: [-44.2, 76.6, -16.9], C3: [-44.2, -76.6, -16.9],
      D1: [27.3, 47.3, -71.5], D2: [-54.6, 0, -71.5], D3: [27.3, -47.3, -71.5]
    }
  },
  ...[4, 6, 8].map((n) => ({
    id: `ball12_d180_sub${n}`,
    name: `${n}-mic subset of the D180 ball`,
    status: 'Open item 3 test array. Subset chosen by farthest-point spread, not from the design sheet',
    source: 'subset of ball12_d180',
    assumed: true,
    notes: 'Same mic positions as ball12_d180, fewer channels.',
    mics: farthestSubset(BALL_MICS, n)
  })),
  {
    id: 'planar12_d180',
    name: '12-mic planar control array, D180 (two flat rings)',
    status: 'Control for the array experiment: same mic count and aperture as ball12_d180, no vertical baseline',
    source: 'simulator experiment (sim-upgrade brief, experiment 3)',
    assumed: true,
    notes: 'Inner ring of 6 at r 47.3 mm, outer ring of 6 at r 90 mm offset 30 degrees, all at z = 0. Separates mic count and aperture from shape.',
    mics: planarRings(180)
  },
  {
    id: 'dome12_d230',
    name: '12-mic downward dome, D230 (assumed)',
    status: 'Candidate from designs/node_geometry_designs.py. Coordinates assumed, replace with the design file',
    source: 'micarrays.md candidate',
    assumed: true,
    notes: 'Two rings of 6 on a downward-facing dome; ring latitudes -20 and -55 degrees are a guess.',
    mics: dome(230, 6)
  },
  {
    id: 'puck12_d210',
    name: '12-mic squat puck, D210 (assumed)',
    status: 'Candidate from designs/node_geometry_designs.py. Coordinates assumed, replace with the design file',
    source: 'micarrays.md candidate',
    assumed: true,
    notes: 'Three rings of 4; ring gap 40 mm is a guess.',
    mics: puck(210, 4, 40)
  }
]);

// ---------- generators (mm) ----------

export function flatSquare(side = 100) {
  const h = side / 2;
  return { M1: [h, h, 0], M2: [-h, h, 0], M3: [-h, -h, 0], M4: [h, -h, 0] };
}

export function ring(n = 6, radius = 60, z = 0) {
  const count = Math.max(2, Math.round(n));
  const out = {};
  for (let k = 0; k < count; k++) {
    const az = (2 * Math.PI * k) / count;
    out[`M${k + 1}`] = [r1(radius * Math.cos(az)), r1(radius * Math.sin(az)), z];
  }
  return out;
}

export function staggerRings(n = 4, lower = 60, upper = 120, height = 60) {
  const count = Math.max(2, Math.round(n));
  const out = {};
  for (let k = 0; k < count; k++) {
    const a = (2 * Math.PI * k) / count;
    const b = (2 * Math.PI * (k + 0.5)) / count;
    out[`L${k + 1}`] = [r1(lower * Math.cos(a)), r1(lower * Math.sin(a)), 0];
    out[`U${k + 1}`] = [r1(upper * Math.cos(b)), r1(upper * Math.sin(b)), height];
  }
  return out;
}

// Four layers A..D from the top; A, D at +-0.7946545 R and B, C at +-0.1875925 R (see micarrays.md).
export function icosaBall(diameter = 180) {
  const R = diameter / 2;
  const layers = [['A', 0.7946545, 0], ['B', 0.1875925, 60], ['C', -0.1875925, 0], ['D', -0.7946545, 60]];
  const out = {};
  for (const [name, f, phase] of layers) {
    const z = f * R;
    const rr = Math.sqrt(R * R - z * z);
    for (let k = 0; k < 3; k++) {
      const az = ((phase + 120 * k) * Math.PI) / 180;
      out[`${name}${k + 1}`] = [r1(rr * Math.cos(az)), r1(rr * Math.sin(az)), r1(z)];
    }
  }
  return out;
}

// Flat control array: inner ring of 6 at 0.2628 D (47.3 mm at D180) and outer ring of 6 at D/2, offset 30 degrees, z = 0.
export function planarRings(diameter = 180) {
  const out = {};
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 * Math.PI) / 180;
    const b = ((k * 60 + 30) * Math.PI) / 180;
    out[`I${k + 1}`] = [r1(0.2628 * diameter * Math.cos(a)), r1(0.2628 * diameter * Math.sin(a)), 0];
    out[`O${k + 1}`] = [r1((diameter / 2) * Math.cos(b)), r1((diameter / 2) * Math.sin(b)), 0];
  }
  return out;
}

// Downward-facing dome: two rings of n mics on a sphere at -20 and -55 degrees latitude, half a step apart.
export function dome(diameter = 230, perRing = 6) {
  const R = diameter / 2;
  const out = {};
  [['U', -20, 0], ['L', -55, 0.5]].forEach(([name, lat, phase]) => {
    const la = (lat * Math.PI) / 180;
    for (let k = 0; k < perRing; k++) {
      const az = (2 * Math.PI * (k + phase)) / perRing;
      out[`${name}${k + 1}`] = [r1(R * Math.cos(la) * Math.cos(az)), r1(R * Math.cos(la) * Math.sin(az)), r1(R * Math.sin(la))];
    }
  });
  return out;
}

// Squat cylinder: three rings of n mics, the middle ring offset by half a step.
export function puck(diameter = 210, perRing = 4, ringGap = 40) {
  const out = {};
  ['T', 'M', 'B'].forEach((name, i) => {
    for (let k = 0; k < perRing; k++) {
      const az = (2 * Math.PI * (k + (i === 1 ? 0.5 : 0))) / perRing;
      out[`${name}${k + 1}`] = [r1((diameter / 2) * Math.cos(az)), r1((diameter / 2) * Math.sin(az)), (1 - i) * ringGap];
    }
  });
  return out;
}

// Deterministic spread-out subset: keep the first mic, then repeatedly add the mic farthest from those chosen.
export function farthestSubset(mics, count) {
  const names = Object.keys(mics);
  const chosen = [names[0]];
  while (chosen.length < Math.min(count, names.length)) {
    let best = null;
    let bestD = -1;
    for (const n of names) {
      if (chosen.includes(n)) continue;
      const d = Math.min(...chosen.map((c) => Math.hypot(...mics[n].map((v, i) => v - mics[c][i]))));
      if (d > bestD + 1e-9) [best, bestD] = [n, d];
    }
    chosen.push(best);
  }
  return Object.fromEntries(names.filter((n) => chosen.includes(n)).map((n) => [n, [...mics[n]]]));
}

export const GENERATORS = Object.freeze({
  flat_square: { label: 'Flat square', params: [['side_mm', 'Side (mm)', 100]], build: (p) => flatSquare(p.side_mm) },
  dome: { label: 'Downward dome (2 rings)', params: [['diameter_mm', 'Diameter (mm)', 230], ['per_ring', 'Mics per ring', 6]], build: (p) => dome(p.diameter_mm, p.per_ring) },
  puck: { label: 'Squat puck (3 rings)', params: [['diameter_mm', 'Diameter (mm)', 210], ['per_ring', 'Mics per ring', 4], ['gap_mm', 'Ring gap (mm)', 40]], build: (p) => puck(p.diameter_mm, p.per_ring, p.gap_mm) },
  ring: { label: 'Ring', params: [['count', 'Mics', 6], ['radius_mm', 'Radius (mm)', 60]], build: (p) => ring(p.count, p.radius_mm) },
  stagger: {
    label: 'Two staggered rings',
    params: [['per_ring', 'Mics per ring', 4], ['lower_mm', 'Lower radius (mm)', 60], ['upper_mm', 'Upper radius (mm)', 120], ['height_mm', 'Upper height (mm)', 60]],
    build: (p) => staggerRings(p.per_ring, p.lower_mm, p.upper_mm, p.height_mm)
  },
  icosa_ball: { label: 'Icosahedral ball (12)', params: [['diameter_mm', 'Diameter (mm)', 180]], build: (p) => icosaBall(p.diameter_mm) }
});

// ---------- validation ----------

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MIC_NAME_RE = /^[A-Za-z0-9_-]{1,12}$/;

export function validateArrayModel(m) {
  if (!m || typeof m !== 'object') throw new Error('array: not an object');
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) throw new Error('array: id must be lowercase letters, digits, - or _ (max 64)');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120) throw new Error('array: name is required (max 120 characters)');
  const entries = Object.entries(m.mics && typeof m.mics === 'object' ? m.mics : {});
  if (entries.length < 2 || entries.length > MAX_ARRAY_MICS) throw new Error(`array: needs 2 to ${MAX_ARRAY_MICS} mics`);
  const mics = {};
  for (const [name, p] of entries) {
    if (!MIC_NAME_RE.test(name)) throw new Error(`array: bad mic name "${name}"`);
    if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_COORD_MM)) throw new Error(`array: mic ${name} needs three numbers within +-${MAX_COORD_MM} mm`);
    mics[name] = [p[0], p[1], p[2]];
  }
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  return { id: m.id, name: m.name.trim(), status: text(m.status, 200), source: text(m.source, 200), notes: text(m.notes, 2000), assumed: m.assumed !== false, mics };
}

export const micList = (model) => Object.values(model.mics);

export const offsetsM = (model) => micList(model).map(([x, y, z]) => [x / 1000, y / 1000, z / 1000]);

// Copies the layout into the node, so a saved scenario renders without the library.
export function applyArrayToNode(node, model) {
  node.mic_layout = 'custom';
  node.mic_array = model.id;
  node.mic_array_name = model.name;
  node.mic_offsets_m = offsetsM(model);
  return node;
}

// ---------- derived figures ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a, b) => Math.hypot(...sub(a, b));

function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

/**
 * 1-sigma bearing error (deg) from timing noise alone: least-squares fit of arrival time against position
 * with independent noise per mic. Azimuth is reported at elevation `elDeg`; a layout with no vertical
 * extent cannot observe elevation, so its error comes from the horizontal fit and the unit-length constraint.
 */
export function bearingError(mics, elDeg = 0, { sigmaS = TIMING_SIGMA_S, c = speedOfSound(20) } = {}) {
  const n = mics.length;
  const mean = [0, 1, 2].map((k) => mics.reduce((s, p) => s + p[k], 0) / n);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of mics) {
    const d = sub(p, mean);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += d[i] * d[j];
  }
  const k = (sigmaS * c * 1000) ** 2; // sigma in mm, covariance of the unit direction = k * S^-1
  const el = (elDeg * Math.PI) / 180;
  const az = [0, 1, 0]; // azimuth axis for a source on +x
  const eEl = [-Math.sin(el), 0, Math.cos(el)];
  const rad = (v) => (v * 180) / Math.PI;
  const flat = S[2][2] < 1e-9 * Math.max(S[0][0], S[1][1], 1);
  if (flat) {
    const Sxy = [[S[0][0], S[0][1]], [S[1][0], S[1][1]]];
    const det = Sxy[0][0] * Sxy[1][1] - Sxy[0][1] * Sxy[1][0];
    if (Math.abs(det) < 1e-9) return { az_deg: Infinity, el_deg: Infinity };
    const I = [[Sxy[1][1] / det, -Sxy[0][1] / det], [-Sxy[1][0] / det, Sxy[0][0] / det]];
    const sTan = Math.sqrt(k * I[1][1]);
    const sRad = Math.sqrt(k * I[0][0]);
    return { az_deg: rad(sTan / Math.max(Math.cos(el), 1e-6)), el_deg: Math.abs(Math.sin(el)) < 1e-6 ? Infinity : rad(sRad / Math.abs(Math.sin(el))) };
  }
  const Si = inv3(S);
  if (!Si) return { az_deg: Infinity, el_deg: Infinity };
  const quad = (e) => Math.sqrt(k * e.reduce((s, ei, i) => s + ei * e.reduce((t, ej, j) => t + Si[i][j] * ej, 0), 0));
  return { az_deg: rad(quad(az) / Math.max(Math.cos(el), 1e-6)), el_deg: rad(quad(eEl)) };
}

export function arrayMetrics(mics, { tempC = 20 } = {}) {
  const spacings = [];
  for (let i = 0; i < mics.length; i++) for (let j = i + 1; j < mics.length; j++) spacings.push(dist(mics[i], mics[j]));
  const nearest = Math.min(...spacings);
  const longest = Math.max(...spacings);
  const zs = mics.map((p) => p[2]);
  const c = speedOfSound(tempC);
  const groups = new Map();
  for (const s of spacings) {
    const key = r1(s);
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return {
    count: mics.length,
    nearest_mm: nearest,
    longest_mm: longest,
    spacing_groups: [...groups].sort((a, b) => a[0] - b[0]).map(([mm, pairs]) => ({ mm, pairs })),
    vertical_baseline_mm: Math.max(...zs) - Math.min(...zs),
    aliasing_hz: nearest > 0 ? c / (2 * (nearest / 1000)) : Infinity,
    bearing: [0, 20, 40, 60].map((el) => ({ at_el_deg: el, ...bearingError(mics, el, { c }) }))
  };
}

// ---------- import file ----------

const UNIT_TO_MM = { mm: 1, cm: 10, m: 1000 };
const slugId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'array';

// The file the Import button reads: one entry per array, keyed by id. Keys starting with "_" are ignored.
export function arrayImportTemplate() {
  return {
    _readme: 'Fill in one entry per array and import this file in Mic arrays. Keep the keys. The key (here "my_array") becomes the array id: lowercase letters, digits, - or _. Use a different id for each array. You can add several entries.',
    _fields: 'name: required. units: mm (default), cm or m, applies to every coordinate. assumed: true if the layout is not confirmed. status, source, notes: free text. mics: mic name -> [x, y, z]. Names are up to 12 letters, digits, - or _. 2 to 64 mics, within 2 m of the centre.',
    _conventions: 'Origin at the array centre, z up. x east, y north when the node is not rotated. Give the port mouth on the outer surface.',
    my_array: {
      name: 'My 4-mic square, 100 mm',
      units: 'mm',
      assumed: true,
      status: 'Draft',
      source: 'design sheet or file name',
      notes: 'Anything worth remembering about this array.',
      mics: {
        M1: [50, 50, 0],
        M2: [-50, 50, 0],
        M3: [-50, -50, 0],
        M4: [50, -50, 0]
      }
    }
  };
}

/** Turns an imported JSON file into validated models. A file holding a single array (with "mics") is accepted too. */
export function parseArrayImport(data, fileName = 'array') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('the file must hold a JSON object');
  const entries = data.mics ? [[data.id || slugId(data.name || fileName), data]] : Object.entries(data).filter(([k]) => !k.startsWith('_'));
  if (!entries.length) throw new Error('the file has no arrays in it');
  return entries.map(([key, body]) => {
    const units = body?.units ?? 'mm';
    if (!Object.hasOwn(UNIT_TO_MM, units)) throw new Error(`${key}: units must be mm, cm or m`);
    const k = UNIT_TO_MM[units];
    const mics = Object.fromEntries(Object.entries(body?.mics && typeof body.mics === 'object' ? body.mics : {}).map(([name, p]) => [name, Array.isArray(p) ? p.map((v) => (typeof v === 'number' ? v * k : v)) : p]));
    try {
      return validateArrayModel({ ...body, mics, id: ID_RE.test(key) ? key : slugId(key) });
    } catch (err) {
      throw new Error(`${key}: ${err.message}`);
    }
  });
}
