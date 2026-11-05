import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { renderScenario } from '../src/render.js';
import { buildScene } from '../src/benchmark/scenes.js';
import { mulberry32 } from '../src/rng.js';
import { nodeClock } from '../src/realism.js';

export const realismSpec = JSON.parse(readFileSync(new URL('../../../docs/experiments/round2-realism.json', import.meta.url))).unit_population;
export function realismScene(settings = {}) {
  const scenario = buildScene('sparse_20');
  scenario.nodes = scenario.nodes.slice(0, 2); scenario.buildings = [];
  scenario.sources[0].start_s = 0.2;
  Object.assign(scenario.settings, { ground_reflectivity: 0, seed: realismSpec.seed }, settings);
  const rng = mulberry32(realismSpec.seed);
  const clip = Float32Array.from({ length: 0.6 * realismSpec.sample_rate }, () => 2 * rng() - 1);
  return { scenario, clips: new Map([['glass_breaking', clip]]) };
}
export function realismGolden() {
  return realismSpec.goldens.map((settings) => {
    const { scenario, clips } = realismScene(settings);
    const rendered = renderScenario(scenario, clips, { lengthS: 1 });
    return { settings, clocks: scenario.nodes.map((_, ni) => nodeClock(scenario.settings, ni)),
      microphones: rendered.nodes.map((node) => node.mics.map((pcm) => createHash('sha256').update(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)).digest('hex'))) };
  });
}
