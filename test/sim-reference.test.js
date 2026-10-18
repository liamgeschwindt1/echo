// Item 7: the production (frequency-domain) render against the independent slow reference
// (explicit per-path impulse responses, time-domain convolution) on five scenes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newBuilding, newNode, newSource } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { referenceRender, diffDb } from './reference-render.js';
import { synthesizeClip } from '../src/sim/clips.js';

const FS = 48000;

// Band-limited burst (the built-in noise-burst clip, 50 Hz-12 kHz, shortened): the reference's
// windowed-sinc delay rolls off above ~0.9 Nyquist by design, so the comparison signal must be
// band-limited, exactly like the built-in test clips. 0.2 s is plenty for energy comparisons.
function burst(ms = 200) {
  return synthesizeClip('noise', FS).subarray(0, Math.round((ms / 1000) * FS));
}

function scene(name, over, buildings, nodePos, srcPos) {
  const s = defaultScenario();
  Object.assign(s.settings, { diffraction_order: 0, diffraction_model: 'maekawa', ...over });
  s.buildings = buildings;
  s.nodes = [{ ...newNode('n1', nodePos[0], nodePos[1]), position: nodePos, mic_spacing_m: 0.05 }];
  s.sources = [{ ...newSource('s1', 'b', srcPos[0], srcPos[1], 100), keyframes: [{ t: 0, position: srcPos }], start_s: 0.05 }];
  return { name, s };
}

const SCENES = [
  scene('free field', { ground_reflectivity: 0 }, [], [30, 0, 5], [0, 0, 1.5]),
  scene('ground only', { ground_reflectivity: 0.8, reflection_order: 0 }, [], [30, 0, 5], [0, 0, 1.5]),
  scene('one wall', { ground_reflectivity: 0, reflection_order: 1 }, [newBuilding('b1', -20, 0, 20, 20, 15)], [30, 0, 5], [0, 0, 1.5]),
  scene(
    'blocked direct with reflections',
    { ground_reflectivity: 0.8, reflection_order: 2 },
    [newBuilding('b1', 50, 0, 10, 10, 15), newBuilding('b2', 50, 30, 40, 4, 15)],
    [100, 0, 5],
    [0, 0, 1.5]
  ),
  scene(
    'blocked direct with Maekawa diffraction',
    { ground_reflectivity: 0.8, reflection_order: 1, diffraction_order: 1 },
    [newBuilding('b1', 50, 0, 10, 10, 15), newBuilding('b2', 50, 30, 40, 4, 15)],
    [100, 0, 5],
    [0, 0, 1.5]
  ),
  // Wedge model: the reference builds each diffracted impulse response from the complex coefficient on a dense linear grid.
  scene(
    'wedge: blocked direct, order 2 (round the ends and over the roof)',
    { ground_reflectivity: 0.8, reflection_order: 1, diffraction_order: 2, diffraction_model: 'wedge' },
    [newBuilding('b1', 50, 0, 10, 10, 15), newBuilding('b2', 50, 30, 40, 4, 15)],
    [100, 0, 5],
    [0, 0, 1.5]
  ),
  scene(
    'wedge: lit receiver near a shadow boundary (edge terms on top of the direct path)',
    { ground_reflectivity: 0.8, reflection_order: 1, diffraction_order: 2, diffraction_model: 'wedge' },
    [newBuilding('b1', 50, 12, 10, 10, 15)],
    [100, 0, 5],
    [0, 0, 1.5]
  ),
  scene(
    'wedge: reflection plus diffraction in a two-building canyon',
    { ground_reflectivity: 0.8, reflection_order: 1, diffraction_order: 2, diffraction_model: 'wedge' },
    [newBuilding('b1', 40, 8, 14, 6, 12), newBuilding('b2', 40, -8, 14, 6, 12)],
    [90, 0, 3],
    [0, 0, 1.5]
  )
];

for (const { name, s } of SCENES) {
  test(`reference renderer agrees below -60 dB: ${name}`, () => {
    const clips = new Map([['b', burst(25)]]);
    const lengthS = 0.9;
    const prod = renderScenario(s, clips, { lengthS });
    const ref = referenceRender(s, clips, lengthS);
    let worst = -Infinity;
    for (let mi = 0; mi < 4; mi++) {
      const d = diffDb(ref.nodes[0].mics[mi], prod.nodes[0].mics[mi]);
      worst = Math.max(worst, d);
    }
    console.log(`reference diff ${name}: ${worst.toFixed(1)} dB`);
    assert.ok(worst < -60, `${name}: ${worst.toFixed(1)} dB`);
  });
}
