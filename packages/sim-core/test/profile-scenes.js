// Three scenes for the stage profile (docs/profile-before.md, docs/profile-after.md) and the decimation / sensitivity checks.
import { defaultScenario, newBuilding, newNode, newSource } from '../src/scenario.js';
import { gaussian, mulberry32 } from '../src/rng.js';

export const FS = 48000;

// Band-limited noise with a slow amplitude modulation, so every window of the clip has energy in the localisation band.
export function modulatedNoise(seconds, seed = 5) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * FS));
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    lp += 0.25 * (gaussian(rng) - lp);
    out[i] = (lp + 0.3 * gaussian(rng)) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / FS));
  }
  return out;
}

const make = (nodes, sources, buildings, settings = {}) => {
  const s = defaultScenario();
  s.settings = { ...s.settings, ...settings };
  Object.assign(s, { nodes, sources, buildings });
  return s;
};

export const PROFILE_SCENES = {
  scene1_open_field: (settings = {}) => ({
    scenario: make([newNode('n1', 0, 0), newNode('n2', 120, 40)], [{ ...newSource('s1', 'a', 70, 90, 110), start_s: 2 }], [], settings),
    clips: { a: modulatedNoise(7) },
    lengthS: 10
  }),
  scene2_three_buildings: (settings = {}) => ({
    scenario: make(
      [newNode('n1', 0, 0), newNode('n2', 120, 40)],
      [{ ...newSource('s1', 'a', 70, 90, 110), start_s: 2 }],
      [newBuilding('b1', 30, 40, 20, 12, 15), newBuilding('b2', 75, 55, 14, 14, 12), newBuilding('b3', 90, 20, 18, 10, 18)],
      settings
    ),
    clips: { a: modulatedNoise(7) },
    lengthS: 10
  }),
  scene3_four_nodes_six_buildings: (settings = {}) => ({
    scenario: make(
      [newNode('n1', 0, 0), newNode('n2', 120, 0), newNode('n3', 120, 100), newNode('n4', 0, 100)],
      [
        { ...newSource('s1', 'a', 40, 50, 110), start_s: 2 },
        { ...newSource('s2', 'b', 90, 60, 105), start_s: 9 },
        { ...newSource('s3', 'a', 60, 20, 108), start_s: 16 },
        { ...newSource('s4', 'b', 30, 85, 106), start_s: 22 }
      ],
      [
        newBuilding('b1', 25, 30, 18, 12, 15),
        newBuilding('b2', 60, 45, 12, 20, 14),
        newBuilding('b3', 95, 30, 16, 12, 18),
        newBuilding('b4', 35, 75, 20, 10, 12),
        newBuilding('b5', 80, 80, 14, 14, 16),
        newBuilding('b6', 60, 85, 10, 10, 10)
      ],
      settings
    ),
    clips: { a: modulatedNoise(5, 5), b: modulatedNoise(5, 8) },
    lengthS: 30
  })
};
