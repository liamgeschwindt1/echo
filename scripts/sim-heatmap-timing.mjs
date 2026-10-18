// Time to the coarse preview (4 m cells) and to full resolution (2 m) of the heatmap field, scenes 2 and 3, diffraction order 2.
import { PROFILE_SCENES } from '../test/profile-scenes.js';
import { clipBandEnvelopes, computeFieldArrivals, fieldSources } from '../src/sim/core/field.js';

const rows = [];
for (const name of ['scene2_three_buildings', 'scene3_four_nodes_six_buildings']) {
  const { scenario, clips } = PROFILE_SCENES[name]();
  const clipMap = new Map(Object.entries(clips));
  const s = scenario.settings;
  const sources = fieldSources(scenario, clipMap);
  const ext = { x0: -15, y0: -15, x1: 135, y1: 115 };
  for (const [label, cell] of [['coarse preview (4 m)', 4], ['full resolution (2 m)', 2]]) {
    const grid = { kind: 'plan', x0: ext.x0, y0: ext.y0, cell, nx: Math.ceil((ext.x1 - ext.x0) / cell), ny: Math.ceil((ext.y1 - ext.y0) / cell), z: s.slice_height_m };
    const t0 = performance.now();
    computeFieldArrivals({ sources, settings: s, buildings: scenario.buildings, grid });
    sources.forEach((x) => clipBandEnvelopes(clipMap.get(x.clip), 48000, s.localisation_band_hz));
    rows.push(`| ${name} | ${scenario.sources.length} | ${label} | ${grid.nx * grid.ny} | ${((performance.now() - t0) / 1000).toFixed(2)} s |`);
    console.log(rows.at(-1));
  }
}
console.log('\n| scene | sources | stage | cells | time |\n|---|---|---|---|---|\n' + rows.join('\n'));
