// Acceptance 9: empirical azimuth spread against the stated uncertainty, 10 scenes x 50 seeds.
import { defaultScenario, newNode, newSource, renderLengthS } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { gaussian, mulberry32 } from '../src/sim/core/rng.js';

const FS = 48000;
const SEEDS = Number(process.argv[2]) || 50;

function clipOf(kind, seed) {
  const rng = mulberry32(seed);
  const n = Math.round(0.3 * FS);
  const x = new Float32Array(n);
  if (kind === 'click') for (let i = 0; i < n; i++) x[i] = gaussian(rng) * Math.exp(-i / FS / 0.02);
  else if (kind === 'burst') for (let i = 0; i < n; i++) x[i] = gaussian(rng) * Math.sin((Math.PI * i) / n);
  else for (let i = 0; i < n; i++) x[i] = (Math.sin((2 * Math.PI * 500 * i) / FS) + Math.sin((2 * Math.PI * 1100 * i) / FS) + 0.4 * gaussian(rng)) * Math.sin((Math.PI * i) / n);
  return x;
}

const SCENES = [
  { kind: 'click', d: 20, az: 30, level: 115, noise: 45, layout: 'flat_square' },
  { kind: 'click', d: 60, az: -70, level: 120, noise: 45, layout: 'flat_square' },
  { kind: 'burst', d: 40, az: 110, level: 105, noise: 45, layout: 'flat_square' },
  { kind: 'burst', d: 90, az: -20, level: 115, noise: 50, layout: 'flat_square' },
  { kind: 'tones', d: 30, az: 160, level: 105, noise: 45, layout: 'flat_square' },
  { kind: 'click', d: 100, az: 45, level: 125, noise: 55, layout: 'flat_square' },
  { kind: 'burst', d: 25, az: -140, level: 100, noise: 40, layout: 'tetrahedron' },
  { kind: 'click', d: 70, az: 80, level: 115, noise: 50, layout: 'tetrahedron' },
  { kind: 'tones', d: 50, az: -35, level: 110, noise: 45, layout: 'tetrahedron' },
  { kind: 'burst', d: 120, az: 10, level: 125, noise: 55, layout: 'flat_square' }
];

const wrap = (d) => ((d + 540) % 360) - 180;

function runMode(label, settingsOver) {
  console.log(`\n${label}`);
  const ratios = [];
  SCENES.forEach((sc, i) => {
    const clip = clipOf(sc.kind, 100 + i);
    const durations = new Map([['c', clip.length / FS]]);
    const errs = [];
    const stated = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const scn = defaultScenario();
      Object.assign(scn.settings, { seed, noise_floor_db_spl: sc.noise, ...settingsOver });
      scn.nodes = [{ ...newNode('n1', 0, 0), mic_layout: sc.layout, mic_spacing_m: sc.layout === 'flat_square' ? 0.1 : 0.15 }];
      const rad = (sc.az * Math.PI) / 180;
      scn.sources = [{ ...newSource('s1', 'c', sc.d * Math.cos(rad), sc.d * Math.sin(rad), sc.level), start_s: 0.5 }];
      const out = renderScenario(scn, new Map([['c', clip]]), { lengthS: renderLengthS(scn, durations) });
      const n = analyseScenario(scn, out, durations)[0].nodes[0];
      if (!n.heard || !n.bearing) continue;
      errs.push(wrap(n.bearing.azimuth_deg - n.true_azimuth_deg));
      stated.push(n.bearing.uncertainty_deg);
    }
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    const rms = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length);
    const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, errs.length - 1));
    const sMean = stated.reduce((a, b) => a + b, 0) / stated.length;
    ratios.push({ sd: sd / sMean, rms: rms / sMean });
    console.log(`  scene ${i + 1} ${sc.kind} d=${sc.d} ${sc.layout}: n=${errs.length}, bias ${mean.toFixed(2)} deg, sd ${sd.toFixed(3)}, rms ${rms.toFixed(3)}, stated ${sMean.toFixed(3)} -> sd/stated ${(sd / sMean).toFixed(2)}, rms/stated ${(rms / sMean).toFixed(2)}`);
  });
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`  median sd/stated ${med(ratios.map((r) => r.sd)).toFixed(2)}, median rms/stated ${med(ratios.map((r) => r.rms)).toFixed(2)}`);
}

runMode('Noise only (ground reflection off): spread against stated sigma', { ground_reflectivity: 0 });
runMode('Default ground reflectivity 0.8: spread and bias against stated sigma', {});
