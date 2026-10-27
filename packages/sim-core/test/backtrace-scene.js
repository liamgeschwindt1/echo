// Corner scene: the source stands at b4's north-east corner. n1 reaches it by unfolding b5's west face,
// n2 by unfolding b6's north face. Neither has a direct line to the source.
import { defaultScenario, newBuilding, newNode, newSource } from '../src/scenario.js';
import { click } from './golden-scenes.js';

export function cornerScene() {
  const s = defaultScenario();
  Object.assign(s.settings, { air_absorption: false, ground_reflectivity: 0, noise_floor_db_spl: 20, diffraction_order: 0, diffraction_model: 'maekawa' });
  s.buildings = [newBuilding('b4', -20, 14, 10, 10, 15), newBuilding('b5', 9, 16, 8, 12, 15), newBuilding('b6', 0, 0, 40, 10, 15)];
  s.nodes = [newNode('n1', -30, 5), newNode('n2', 15, 8)];
  s.sources = [{ ...newSource('s1', 'click', -15, 19, 120), start_s: 1 }];
  return { scenario: s, clips: { click: click(7) }, lengthS: 2.5 };
}
