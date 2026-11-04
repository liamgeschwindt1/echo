// Six fixed scenes for the schema 0.4 localisation upgrade (sim-upgrade brief). The six exported runs the brief was
// written from are not in the repository, so each scene rebuilds one of the conditions it describes.
// SIMULATED results only: unvalidated physics, no housing scattering, wind, rain or facade scattering.
import { validateScenario } from '../scenario.js';

const node = (id, x, y, z = 5, extra = {}) => ({ id, position: [x, y, z], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1, ...extra });
const src = (id, clip, x, y, level, start, extra = {}) => ({ id, clip, keyframes: [{ t: 0, position: [x, y, 1.5] }], level_1m_db: level, start_s: start, ...extra });
const box = (id, x, y, w, d, h = 12) => ({ id, position: [x, y], size: [w, d, h], rotation_deg: 0 });

const BASE = { seed: 3, noise_floor_db_spl: 40 };

export const UPGRADE_SCENES = {
  // Nodes about 3 m from a wall (the reflection arrives ~14-17 ms late and only ~1 dB down).
  near_wall: () => ({
    nodes: [node('n1', 0, 0), node('n2', 60, 0), node('n3', 30, 3)],
    sources: [src('s1', 'glass_breaking', 28, 40, 105, 3)],
    buildings: [box('b1', 30, -9, 30, 18)]
  }),
  // Two sources overlapping in time at every node; the louder one dominates the merged window.
  overlap: () => ({
    nodes: [node('n1', 0, 0), node('n2', 70, 0), node('n3', 35, 60)],
    sources: [src('s1', 'car_horn', 20, 30, 104, 3), src('s2', 'glass_breaking', 52, 22, 104, 3.4)],
    buildings: []
  }),
  // Continuous sources overlapping for seconds: one window over the whole event locks on the nearest source.
  continuous: () => ({
    nodes: [node('n1', 0, 0), node('n2', 80, 0), node('n3', 40, 70)],
    sources: [src('s1', 'engine', 15, 25, 100, 3), src('s2', 'chainsaw', 60, 45, 100, 3.5)],
    buildings: [box('b1', 40, -25, 20, 10)]
  }),
  // A moving source: track fixes need a common emission time across nodes.
  moving: () => ({
    nodes: [node('n1', 0, 0), node('n2', 60, 0), node('n3', 30, 55)],
    sources: [src('s1', 'engine', 5, 25, 104, 3, { keyframes: [{ t: 3, position: [5, 25, 1.5] }, { t: 8, position: [55, 30, 1.5] }] })],
    buildings: []
  }),
  // One node has its direct path blocked by a building: it localises on a diffracted edge.
  blocked: () => ({
    nodes: [node('n1', 0, 0), node('n2', 60, 0), node('n3', 30, -40)],
    sources: [src('s1', 'glass_breaking', 30, 30, 108, 3)],
    buildings: [box('b1', 30, -18, 16, 10, 14)]
  }),
  // Five nodes, two of them close to walls; one source. Bad nodes should be rejected from the fix.
  five_node: () => ({
    nodes: [node('n1', 0, 0), node('n2', 70, 0), node('n3', 70, 70), node('n4', 0, 70), node('n5', 35, -1)],
    sources: [src('s1', 'dog', 40, 40, 100, 3), src('s2', 'footsteps', 15, 55, 80, 3.2)],
    buildings: [box('b1', 35, -10, 24, 12), box('b2', -9, 70, 12, 20)]
  })
};

export const SCENE_IDS = Object.keys(UPGRADE_SCENES);

export function upgradeScenario(id, settings = {}) {
  const s = UPGRADE_SCENES[id]();
  return validateScenario({ version: '0.2', settings: { ...BASE, ...settings }, ...s });
}
