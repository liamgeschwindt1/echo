// Rank of the true source among back-trace candidates, with its distance error, next to the plain intersection error.
import { renderScenario } from '../src/sim/core/render.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { GOLDEN_SCENES } from '../test/golden-scenes.js';
import { cornerScene } from '../test/backtrace-scene.js';

const scenes = { ...GOLDEN_SCENES, corner_b4_b5_b6: cornerScene };
const f = (v) => (v == null ? '-' : v.toFixed(2));
console.log('scene | source | n_cand | true rank | cand error m | intersection error m');
for (const [name, make] of Object.entries(scenes)) {
  const { scenario, clips, lengthS } = make();
  const rendered = renderScenario(scenario, new Map(Object.entries(clips)), { lengthS });
  const durations = new Map(Object.entries(clips).map(([k, v]) => [k, v.length / 48000]));
  for (const r of analyseScenario(scenario, rendered, durations)) {
    const b = r.backtrace;
    console.log(`${name} | ${r.source_id} | ${b.n_candidates} | ${b.true_rank ?? '-'} | ${f(b.true_error_m)} | ${f(b.intersection_error_m)}`);
  }
}
