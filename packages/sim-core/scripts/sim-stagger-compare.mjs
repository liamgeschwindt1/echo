// Mic layout comparison: flat_square vs stagger_8 (sigma 0 and 1 mm) on a fixed scene with a car horn (s13),
// an engine (s16) and glass. SIMULATED results only; the sim is unvalidated against real measurements.
// Usage: node scripts/sim-stagger-compare.mjs [--seed 1] [--json out.json]
import { writeFileSync } from 'node:fs';
import { validateScenario, renderLengthS } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { loadClips } from '../test/suite-lib.js';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const seed = Number(arg('seed', 1));

const BUILDINGS = [
  { id: 'b1', position: [40, -22], size: [18, 12, 12], rotation_deg: 0 },
  { id: 'b2', position: [-25, 30], size: [14, 20, 15], rotation_deg: 0 },
  { id: 'b3', position: [95, 25], size: [16, 14, 10], rotation_deg: 0 }
];
const NODES = [[0, 0], [80, 0], [40, 70], [85, 65]];
const SOURCES = (overlap) => [
  { id: 's13', clip: 'car_horn', keyframes: [{ t: 0, position: [30, 40, 1.5] }], level_1m_db: 108, start_s: 3 },
  { id: 's16', clip: 'engine', keyframes: [{ t: 0, position: [62, 22, 1.5] }], level_1m_db: 108, start_s: overlap ? 3 : 9 },
  { id: 'glass', clip: 'glass_breaking', keyframes: [{ t: 0, position: [48, 36, 1.5] }], level_1m_db: 110, start_s: overlap ? 3 : 15 }
];
const LAYOUTS = {
  'a flat_square': { layout: { mic_layout: 'flat_square', mic_spacing_m: 0.1 }, sigma: 0 },
  'b stagger_8 sigma 0': { layout: { mic_layout: 'stagger_8' }, sigma: 0 },
  'c stagger_8 sigma 1 mm': { layout: { mic_layout: 'stagger_8' }, sigma: 1 }
};

const { clips, durations } = loadClips();
const f = (v, d = 1) => (v == null ? '  -  ' : v.toFixed(d));
const out = [];
for (const overlap of [false, true]) {
  for (const nodeCount of [3, 4]) {
    for (const [name, cfg] of Object.entries(LAYOUTS)) {
      const nodes = NODES.slice(0, nodeCount).map(([x, y], i) => ({ id: `n${i + 1}`, position: [x, y, 5], rotation_deg: 0, ...cfg.layout }));
      const scn = validateScenario({ version: '0.2', settings: { seed, mic_position_sigma_mm: cfg.sigma }, nodes, sources: SOURCES(overlap), buildings: BUILDINGS });
      const rendered = renderScenario(scn, clips, { lengthS: renderLengthS(scn, durations) });
      const res = analyseScenario(scn, rendered, durations, { progressive: false });
      for (const r of res) {
        out.push({
          scene: overlap ? 'overlapped' : 'separated', nodes: nodeCount, layout: name, source: r.source_id,
          fix_z: r.fix?.position?.[2] ?? null, horizontal_error_m: r.error_horizontal_m, error_3d_m: r.error_3d_m, true_z: r.true_position[2],
          per_node: r.nodes.map((n) => ({
            node: n.node_id, heard: n.heard, status: n.localisation_status, picked_path: n.picked_path_type, direct_blocked: n.direct_blocked,
            az_err: n.bearing ? n.azimuth_error_deg : null, true_el: n.true_elevation_deg, el: n.bearing?.elevation_deg ?? null,
            el_err: n.bearing ? n.bearing.elevation_deg - n.true_elevation_deg : null, sign_assumed: n.bearing?.elevation_sign_assumed ?? null
          }))
        });
      }
    }
  }
}
for (const row of out) {
  console.log(`${row.scene} ${row.nodes}n | ${row.layout.padEnd(22)} | ${row.source.padEnd(5)} | horiz ${f(row.horizontal_error_m)} m  3D ${f(row.error_3d_m)} m  fix z ${f(row.fix_z)} (true ${row.true_z})`);
  for (const n of row.per_node) console.log(`    ${n.node}: az err ${f(n.az_err)}  el ${f(n.el)} true ${f(n.true_el)} err ${f(n.el_err)}  sign_assumed ${n.sign_assumed}  ${n.status} path=${n.picked_path}${n.direct_blocked ? ' direct_blocked' : ''}${n.heard ? '' : ' not_heard'}`);
}
const json = arg('json', null);
if (json) writeFileSync(json, JSON.stringify({ simulated_only: true, unvalidated: true, seed, rows: out }, null, 1));
