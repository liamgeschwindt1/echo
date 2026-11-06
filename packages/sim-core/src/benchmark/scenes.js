import { upgradeScenario, SCENE_IDS } from './upgrade-scenes.js';
import { exportScenario } from './export-scenes.js';
import { defaultScenario, newNode, newSource, newBuilding, validateScenario } from '../scenario.js';
import { applyArrayToNode, BUILTIN_ARRAYS } from '../arrays.js';
import { mulberry32 } from '../rng.js';

export const REALISM = Object.freeze({
  off: { heading_error_sigma_deg: 0, mic_gain_sigma_db: 0, mic_position_sigma_mm: 0, noise_correlation: 0 },
  on: { heading_error_sigma_deg: 2.5, mic_gain_sigma_db: 1, mic_position_sigma_mm: 5, noise_correlation: 0.3 },
  surveyed: { heading_error_sigma_deg: 1, mic_gain_sigma_db: 1, mic_position_sigma_mm: 2, noise_correlation: 0.3 }
});

export const SCENES = Object.freeze([
  ...SCENE_IDS.map((id) => ({ id, name: id.replaceAll('_', ' '), category: ({ continuous: 'overlap', five_node: 'near-wall', moving: 'moving' })[id] ?? id.replaceAll('_', '-'), split: 'train' })),
  { id: 'seven_source', name: 'Seven sources (original export)', category: 'overlap', split: 'train' },
  ...[2, 3].map((n) => ({ id: `drone_${n}`, name: `Drone, ${n} nodes`, category: 'aerial', split: 'train' })),
  ...[20, 50, 100].map((r) => ({ id: `sparse_${r}`, name: `Single source, ${r} m`, category: 'low-SNR', split: 'train' })),
  ...[0, 6, 10].map((d) => ({ id: `simultaneous_${d}`, name: `Two simultaneous, +${d} dB`, category: 'overlap', split: 'train' })),
  { id: 'corner', name: 'Source at building corner', category: 'near-wall', split: 'train' },
  { id: 'bad_geometry', name: 'Nearly parallel bearings', category: 'bad-geometry', split: 'train' },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `random_${i + 1}`, name: `Held-out random site ${i + 1}`, category: 'random', split: 'held-out' }))
]);
export const DEFAULT_SEEDS = [1, 2, 101];
export const HELD_OUT_SEEDS = [101];
const RANDOM_ARRAY_IDS = Object.freeze(['flat4_100', 'ball12_d180', 'ball12_d180_sub4', 'ball12_d180_sub6', 'ball12_d180_sub8', 'planar12_d180', 'dome12_d230', 'puck12_d210']);

export function randomScene(siteSeed) {
  const rng = mulberry32(siteSeed);
  const s = defaultScenario();
  const count = 2 + Math.floor(rng() * 5);
  const radius = 15 + rng() * 65;
  s.nodes = Array.from({ length: count }, (_, i) => {
    const az = 2 * Math.PI * i / count;
    const n = newNode(`n${i + 1}`, radius * Math.cos(az), radius * Math.sin(az));
    const id = RANDOM_ARRAY_IDS[Math.floor(rng() * RANDOM_ARRAY_IDS.length)];
    const model = BUILTIN_ARRAYS.find((a) => a.id === id);
    if (!model) throw new Error(`Frozen random-scene array is unavailable: ${id}`);
    return applyArrayToNode(n, model);
  });
  const az = rng() * Math.PI * 2;
  const range = 20 + rng() * 180;
  s.sources = [newSource('s1', ['glass_breaking', 'car_horn', 'engine'][Math.floor(rng() * 3)], range * Math.cos(az), range * Math.sin(az), 95 + rng() * 15)];
  s.buildings = Array.from({ length: Math.floor(rng() * 4) }, (_, i) => newBuilding(`b${i + 1}`, (rng() - 0.5) * 180, (rng() - 0.5) * 180, 8 + rng() * 12, 8 + rng() * 12));
  s.buildings = s.buildings.filter((b) => [...s.nodes.map((n) => n.position), ...s.sources.map((x) => x.keyframes[0].position)]
    .every((p) => Math.abs(p[0] - b.position[0]) > b.size[0] / 2 + 3 || Math.abs(p[1] - b.position[1]) > b.size[1] / 2 + 3));
  return validateScenario(s);
}

export function buildScene(id) {
  if (SCENE_IDS.includes(id)) return upgradeScenario(id);
  if (id === 'seven_source') return exportScenario(id);
  if (/^random_[1-8]$/.test(id)) return randomScene(7919 * Number(id.slice(7)));
  const s = defaultScenario();
  s.nodes = [newNode('n1', -15, 0), newNode('n2', 15, 0), newNode('n3', 0, 30)];
  s.sources = [newSource('s1', 'glass_breaking', 5, 50, 105)];
  if (/^sparse_(20|50|100)$/.test(id)) s.sources[0].keyframes[0].position = [0, Number(id.slice(7)), 1.5];
  else if (/^simultaneous_(0|6|10)$/.test(id)) {
    s.sources = [newSource('s1', 'car_horn', -10, 40, 104), newSource('s2', 'engine', 20, 45, 104 + Number(id.slice(13)))];
  } else if (/^drone_[23]$/.test(id)) {
    s.nodes = s.nodes.slice(0, Number(id.at(-1))).map((n) => applyArrayToNode(n, BUILTIN_ARRAYS.find((a) => a.id === 'ball12_d180')));
    // Engine clip is an explicit acoustic surrogate, not a drone recording or labelling target.
    s.sources = [{ ...newSource('s1', 'engine', -25, 35, 110), keyframes: [{ t: 3, position: [-25, 35, 50] }, { t: 8, position: [35, 35, 60] }] }];
  } else if (id === 'corner') {
    s.sources[0].keyframes[0].position = [9, 19, 1.5];
    s.buildings = [newBuilding('b1', 0, 10, 16, 16)];
    s.nodes = [newNode('n1', -30, -15), newNode('n2', 30, -15), newNode('n3', 25, 40)];
  } else if (id === 'bad_geometry') {
    s.nodes = [newNode('n1', -5, 0), newNode('n2', 5, 0)];
    s.sources[0].keyframes[0].position = [0, 150, 1.5];
  } else throw new Error(`Unknown benchmark scene: ${id}`);
  return validateScenario(s);
}
