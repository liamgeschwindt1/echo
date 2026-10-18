// One-at-a-time sensitivity sweep on three reference scenes. Usage: node scripts/sim-sensitivity.mjs [seeds=20] [out=docs/sensitivity.md]
// Effect = change in mean bearing error (deg), mean fix error (m) and heard fraction between the low and high end of each range.
import { writeFileSync } from 'node:fs';
import { defaultScenario, newBuilding, newNode, newSource, renderLengthS } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { angleBetweenDeg } from '../src/sim/core/localise.js';
import { gaussian, mulberry32 } from '../src/sim/core/rng.js';

const seeds = Number(process.argv[2]) || 20;
const out = process.argv[3] || 'docs/sensitivity.md';
const FS = 48000;
const rng = mulberry32(3);
const burst = (s, amp = 1) => Float32Array.from({ length: Math.round(s * FS) }, (_, i) => amp * gaussian(rng) * Math.sin((Math.PI * i) / (s * FS)));
const clipA = burst(0.4);
const clipB = burst(0.4);

function base(nodes, sources, buildings) {
  const s = defaultScenario();
  Object.assign(s.settings, { reflection_order: 1, ground_reflectivity: 0.8 });
  return { ...s, nodes, sources, buildings };
}
const SCENES = {
  open_street: () => base([newNode('n1', 0, 0), newNode('n2', 80, 30)], [{ ...newSource('s1', 'a', 40, 70, 110), start_s: 1 }], [newBuilding('b1', 20, -25, 30, 10, 12)]),
  canyon_blocked_direct: () => base([newNode('n1', 100, 0), newNode('n2', 60, 40)], [{ ...newSource('s1', 'a', 0, 0, 115), start_s: 1 }], [newBuilding('b1', 50, 0, 10, 10, 15), newBuilding('b2', 50, 30, 40, 4, 15), newBuilding('b3', 50, -30, 40, 4, 15)]),
  overlap: () => base([newNode('n1', 0, 0), newNode('n2', 80, 30)], [{ ...newSource('s1', 'a', 40, 70, 110), start_s: 1 }, { ...newSource('s2', 'b', 60, 60, 108), start_s: 1.1 }], [newBuilding('b1', 20, -25, 30, 10, 12)])
};

const mapB = (s, f) => ({ ...s, buildings: s.buildings.map(f) });
const setS = (k) => (s, v) => ({ ...s, settings: { ...s.settings, [k]: v } });
const PARAMS = [
  ['CONCRETE_ABSORPTION', [0.01, 0.1], setS('concrete_absorption')],
  ['ground_reflectivity', [0.3, 1.0], setS('ground_reflectivity')],
  ['temperature_c', [0, 30], setS('temperature_c')],
  ['humidity_pct', [30, 90], setS('humidity_pct')],
  ['building height x', [0.8, 1.2], (s, v) => mapB(s, (b) => ({ ...b, size: [b.size[0], b.size[1], b.size[2] * v] }))],
  ['building position shift (m, x)', [-1, 1], (s, v) => mapB(s, (b) => ({ ...b, position: [b.position[0] + v, b.position[1]] }))],
  ['source level offset (dB)', [-10, 10], (s, v) => ({ ...s, sources: s.sources.map((x) => ({ ...x, level_1m_db: x.level_1m_db + v })) })],
  ['heading_error_sigma_deg', [0, 5], setS('heading_error_sigma_deg')],
  ['mic_position_sigma_mm', [0, 5], setS('mic_position_sigma_mm')],
  ['mic_gain_sigma_db', [0, 2], setS('mic_gain_sigma_db')],
  ['noise_correlation', [0, 0.9], setS('noise_correlation')],
  ['diffraction_order (wedge)', [0, 2], (s, v) => ({ ...s, settings: { ...s.settings, diffraction_order: v, diffraction_model: 'wedge' } })],
  ['diffraction_model (0 = maekawa order 1, 1 = wedge order 2)', [0, 1], (s, v) => ({ ...s, settings: { ...s.settings, diffraction_model: v ? 'wedge' : 'maekawa', diffraction_order: v ? 2 : 1 } })]
];

const durations = new Map([['a', 0.4], ['b', 0.4]]);
const clips = new Map([['a', clipA], ['b', clipB]]);
function measure(scn) {
  const bearing = [];
  const fix = [];
  let heard = 0;
  let total = 0;
  const lengthS = renderLengthS(scn, durations);
  for (let i = 0; i < seeds; i++) {
    const s = { ...scn, settings: { ...scn.settings, seed: 1 + i } };
    const res = analyseScenario(s, renderScenario(s, clips, { lengthS }), durations);
    for (const r of res) {
      if (r.error_horizontal_m != null) fix.push(r.error_horizontal_m);
      for (const n of r.nodes) {
        total++;
        if (n.heard) heard++;
        if (n.bearing) bearing.push(angleBetweenDeg(n.bearing.direction, [Math.cos((n.true_elevation_deg * Math.PI) / 180) * Math.cos((n.true_azimuth_deg * Math.PI) / 180), Math.cos((n.true_elevation_deg * Math.PI) / 180) * Math.sin((n.true_azimuth_deg * Math.PI) / 180), Math.sin((n.true_elevation_deg * Math.PI) / 180)]));
      }
    }
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  return { bearing: mean(bearing), fix: mean(fix), heard: heard / total };
}

const rows = [];
for (const [sceneName, make] of Object.entries(SCENES)) {
  for (const [name, [lo, hi], apply] of PARAMS) {
    const a = measure(apply(make(), lo));
    const b = measure(apply(make(), hi));
    rows.push({ scene: sceneName, name, lo, hi, a, b, dBearing: b.bearing - a.bearing, dFix: b.fix - a.fix, dHeard: b.heard - a.heard });
    console.log(sceneName, name);
  }
}
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : 'n/a');
const rank = (r) => Math.max(Math.abs(r.dBearing) || 0, 0);
rows.sort((x, y) => rank(y) - rank(x));
const md = [
  '# Sensitivity sweep',
  '',
  `Generated by \`node scripts/sim-sensitivity.mjs ${seeds}\`. ${seeds} seeds per value, one input varied at a time, other settings at the scene's defaults (wedge diffraction, order 2 unless the row varies it). Short synthetic noise bursts, 48 kHz.`,
  'Effect = value at the high end minus value at the low end. Ranked by the absolute change in mean bearing error. Fix error is the mean horizontal error over trials that produced a fix (n/a when none did); heard is the fraction of node-source pairs with snr >= min_snr_db.',
  '',
  'Scene note (not an interpretation of the ranking): in open_street and overlap the large bearing errors come from the wall echo of the building (a strong, late reflection inside the analysis window that the estimator follows); the baseline errors are therefore large before any input is varied.',
  '',
  '| rank | scene | input | low | high | bearing err low (deg) | high | change | fix err low (m) | high | heard low | high |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${r.scene} | ${r.name} | ${r.lo} | ${r.hi} | ${f(r.a.bearing)} | ${f(r.b.bearing)} | ${f(r.dBearing)} | ${f(r.a.fix)} | ${f(r.b.fix)} | ${f(r.a.heard)} | ${f(r.b.heard)} |`),
  ''
].join('\n');
writeFileSync(new URL(`../${out}`, import.meta.url), md);
console.log(`wrote ${out}`);
