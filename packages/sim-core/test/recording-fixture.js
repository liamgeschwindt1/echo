import { encodeFloat32Wav } from '../src/recording.js';
import { buildScene } from '../src/benchmark/scenes.js';
import { renderScenario } from '../src/render.js';
import { mulberry32 } from '../src/rng.js';

export function recordingFixture() {
  const scenario = buildScene('sparse_20');
  scenario.buildings = [];
  scenario.settings.ground_reflectivity = 0;
  scenario.sources[0].start_s = 0.2;
  const rng = mulberry32(123), clip = Float32Array.from({ length: 48000 * 0.8 }, () => rng() * 2 - 1);
  const rendered = renderScenario(scenario, new Map([['glass_breaking', clip]]), { lengthS: 1.5 });
  let channel = 0;
  const geometry = {
    sample_rate: 48000, settings: { ...scenario.settings }, nodes: rendered.nodes.map((n, i) => ({
      id: n.id, position: scenario.nodes[i].position, mic_positions: n.mic_positions, channels: n.mics.map(() => channel++)
    }))
  };
  const channels = rendered.nodes.flatMap((n) => n.mics);
  return { geometry, channels, wav: encodeFloat32Wav(channels, 48000) };
}
