// Fixed scenes for regression: synthetic clips only, so no audio files are needed.
import { defaultScenario, newNode, newSource } from '../src/sim/core/scenario.js';
import { gaussian, mulberry32 } from '../src/sim/core/rng.js';

export const FS = 48000;

export function click(seed = 7, seconds = 0.3) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.exp(-i / FS / 0.02);
  return out;
}

export function tone(freq, seconds = 0.4) {
  const out = new Float32Array(Math.round(seconds * FS));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / FS) * Math.sin((Math.PI * i) / out.length) ** 2;
  return out;
}

const make = (nodes, sources, settings = {}) => {
  const s = defaultScenario();
  s.settings = { ...s.settings, ...settings };
  s.nodes = nodes;
  s.sources = sources;
  return s;
};

export const GOLDEN_SCENES = {
  one_node_one_source: () => ({
    scenario: make([newNode('n1', 0, 0)], [{ ...newSource('s1', 'click', 25, 15, 120), start_s: 1 }]),
    clips: { click: click(7) },
    lengthS: 3
  }),
  three_nodes_three_sources: () => ({
    scenario: make(
      [newNode('n1', 0, 0), newNode('n2', 60, 0), newNode('n3', 30, 50)],
      [
        { ...newSource('s1', 'click', 25, 20, 120), start_s: 1 },
        { ...newSource('s2', 'tone', 40, 10, 105), start_s: 1.2 },
        { ...newSource('s3', 'click', 10, 30, 110), start_s: 3.5 }
      ]
    ),
    clips: { click: click(7), tone: tone(900) },
    lengthS: 5
  }),
  two_nodes_tetra: () => ({
    scenario: make(
      [newNode('n1', 0, 0), { ...newNode('n2', 50, 20), mic_layout: 'tetrahedron', mic_spacing_m: 0.2, rotation_deg: 30 }],
      [{ ...newSource('s1', 'click', 20, 40, 115), start_s: 0.8 }, { ...newSource('s2', 'tone', 70, 5, 100), start_s: 2 }],
      { temperature_c: 5, humidity_pct: 40, ground_reflectivity: 0.5, seed: 9 }
    ),
    clips: { click: click(11), tone: tone(600) },
    lengthS: 4
  })
};
