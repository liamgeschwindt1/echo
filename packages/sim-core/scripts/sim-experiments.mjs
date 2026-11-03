// Experiments from the sim-upgrade brief (not part of the core build). SIMULATED results; any rule found here is a
// hypothesis until it holds across scenes.
//   node scripts/sim-experiments.mjs overlap       time gap x level difference between two sources -> direction error
//   node scripts/sim-experiments.mjs standoff      node distance to the nearest wall (0.5-15 m) -> azimuth error
//   node scripts/sim-experiments.mjs arrays        flat4_100 vs planar12_d180 vs ball12_d180 (count/aperture vs shape)
//   node scripts/sim-experiments.mjs range-angle   hold range, vary crossing angle, and the reverse -> fix error
//   node scripts/sim-experiments.mjs realism       the upgrade scenes with heading, gain, position and noise errors on
import { defaultScenario, newBuilding, newNode, newSource } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { applyArrayToNode, BUILTIN_ARRAYS } from '../src/arrays.js';
import { gaussian, mulberry32 } from '../src/rng.js';

const FS = 48000;
const what = process.argv[2] || 'overlap';
const f = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d));
const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

function clip(kind, seed, lenS) {
  const rng = mulberry32(seed);
  const x = new Float32Array(Math.round(lenS * FS));
  for (let i = 0; i < x.length; i++) {
    const t = i / FS;
    const env = kind === 'impulse' ? Math.exp(-t / 0.05) : Math.sin((Math.PI * i) / x.length);
    x[i] = gaussian(rng) * env;
  }
  return x;
}

function run(s, clips, lengthS) {
  const durations = new Map([...clips].map(([k, v]) => [k, v.length / FS]));
  return analyseScenario(s, renderScenario(s, clips, { lengthS }), durations);
}

function base(settings = {}) {
  const s = defaultScenario();
  s.settings = { ...s.settings, noise_floor_db_spl: 40, ...settings };
  return s;
}

if (what === 'overlap') {
  // Two sustained sources; s2 starts dt after s1 at level difference dL. Direction error of s1 at each node.
  console.log('| gap s | s2 - s1 dB | s1 median az err deg | s1 fix err m | s1 overlapped nodes |');
  console.log('|---|---|---|---|---|');
  for (const dt of [0, 0.25, 0.5, 1, 2]) {
    for (const dL of [-10, 0, 10]) {
      const s = base();
      s.nodes = [newNode('n1', 0, 0), newNode('n2', 70, 0), newNode('n3', 35, 60)];
      s.sources = [{ ...newSource('s1', 'a', 20, 30, 100), start_s: 3 }, { ...newSource('s2', 'b', 52, 22, 100 + dL), start_s: 3 + dt }];
      const [r] = run(s, new Map([['a', clip('noise', 1, 1.5)], ['b', clip('noise', 2, 1.5)]]), 6.5);
      console.log(`| ${dt} | ${dL} | ${f(median(r.nodes.map((n) => n.azimuth_error_deg)))} | ${f(r.error_horizontal_m)} | ${r.nodes.filter((n) => n.overlapped_with.length).length} |`);
    }
  }
} else if (what === 'standoff') {
  // One node d metres in front of a long wall, source 40 m away on the open side; impulsive and sustained.
  console.log('| wall distance m | impulse az err deg (policy) | sustained az err deg (policy) |');
  console.log('|---|---|---|');
  for (const d of [0.5, 1, 2, 3, 5, 8, 15]) {
    const row = [];
    for (const kind of ['impulse', 'noise']) {
      const errs = [];
      let pol = '';
      for (const az of [30, 60, 90, 120, 150]) {
        const s = base({ seed: az });
        s.buildings = [newBuilding('w', 0, -d - 1, 200, 2, 12)];
        s.nodes = [newNode('n1', 0, 0)];
        const a = (az * Math.PI) / 180;
        s.sources = [{ ...newSource('s1', 'c', 40 * Math.cos(a), 40 * Math.sin(a), 100), start_s: 3 }];
        const [r] = run(s, new Map([['c', clip(kind, az, kind === 'impulse' ? 0.4 : 1.5)]]), 6);
        errs.push(r.nodes[0].azimuth_error_deg);
        pol = r.nodes[0].window_policy;
      }
      row.push(`${f(median(errs))} (${pol})`);
    }
    console.log(`| ${d} | ${row.join(' | ')} |`);
  }
} else if (what === 'arrays') {
  console.log('| array | mics | median az err deg | median sigma deg | median fix err m |');
  console.log('|---|---|---|---|---|');
  for (const id of ['flat4_100', 'planar12_d180', 'ball12_d180']) {
    const model = BUILTIN_ARRAYS.find((a) => a.id === id);
    const az = [];
    const sig = [];
    const fx = [];
    for (let k = 0; k < 6; k++) {
      const s = base({ seed: 10 + k });
      s.nodes = [newNode('n1', 0, 0), newNode('n2', 60, 0), newNode('n3', 30, 55)].map((n) => applyArrayToNode(n, model));
      const rng = mulberry32(50 + k);
      s.sources = [{ ...newSource('s1', 'c', 10 + 40 * rng(), 10 + 35 * rng(), 100), start_s: 3 }];
      const [r] = run(s, new Map([['c', clip('impulse', k, 0.4)]]), 5);
      az.push(...r.nodes.map((n) => n.azimuth_error_deg));
      sig.push(...r.nodes.map((n) => n.bearing?.uncertainty_deg));
      fx.push(r.error_horizontal_m);
    }
    console.log(`| ${id} | ${Object.keys(model.mics).length} | ${f(median(az), 2)} | ${f(median(sig), 2)} | ${f(median(fx), 2)} |`);
  }
} else if (what === 'range-angle') {
  // Two nodes on a baseline; the source on the bisector. Fixed range R, crossing angle varied; then fixed angle, R varied.
  const one = (R, angleDeg, seed) => {
    const half = (angleDeg * Math.PI) / 360;
    const b = R * Math.sin(half);
    const y = R * Math.cos(half);
    const s = base({ seed });
    s.nodes = [newNode('n1', -b, 0), newNode('n2', b, 0)];
    s.sources = [{ ...newSource('s1', 'c', 0, y, 105), start_s: 3 }];
    const [r] = run(s, new Map([['c', clip('impulse', seed, 0.4)]]), 3.8 + R / 340);
    return r.error_horizontal_m;
  };
  console.log('| range m | crossing deg | median fix err m (3 seeds) |');
  console.log('|---|---|---|');
  for (const a of [15, 30, 60, 90, 120]) console.log(`| 40 | ${a} | ${f(median([1, 2, 3].map((k) => one(40, a, k))), 2)} |`);
  for (const R of [15, 30, 60, 100]) console.log(`| ${R} | 60 | ${f(median([1, 2, 3].map((k) => one(R, 60, k))), 2)} |`);
} else if (what === 'realism') {
  console.log('Run the upgrade report with the realism toggles on, e.g.:');
  console.log('  node scripts/sim-upgrade-report.mjs --set heading_error_sigma_deg=2.5 --set mic_gain_sigma_db=1 --set mic_position_sigma_mm=5 --set noise_correlation=0.3');
} else throw new Error(`unknown experiment ${what}`);
