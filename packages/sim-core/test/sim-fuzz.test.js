import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newNode, newSource, newBuilding } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseRecording } from '../src/recording.js';
import { mulberry32 } from '../src/rng.js';

test('seeded random scenes export finite measured results and rerun identically', () => {
  let actualFixes = 0;
  for (let seed = 120001; seed < 120013; seed++) {
    const rng = mulberry32(seed), s = defaultScenario();
    const count = 2 + Math.floor(rng() * 3);
    s.nodes = Array.from({ length: count }, (_, i) => newNode(`n${i}`, 12 * Math.cos(i * 2 * Math.PI / count), 12 * Math.sin(i * 2 * Math.PI / count)));
    s.sources = [{ ...newSource('s1', 'noise', 20 + 20 * rng(), 20 + 20 * rng(), 105), start_s: 0.1 }];
    s.buildings = rng() < 0.5 ? [] : [newBuilding('b1', -30, -30, 3, 3)];
    Object.assign(s.settings, {
      seed, ground_reflectivity: 0, reflection_order: 0, diffraction_order: 0,
      heading_error_sigma_deg: rng() * 3, mic_position_sigma_mm: rng() * 5, noise_correlation: rng() * 0.5
    });
    const clip = Float32Array.from({ length: 24000 }, () => rng() * 2 - 1);
    const run = () => {
      const rendered = renderScenario(s, new Map([['noise', clip]]), { lengthS: 0.9 });
      let channel = 0;
      const geometry = { settings: s.settings, nodes: s.nodes.map((n, i) => ({
        id: n.id, position: n.position, mic_positions: rendered.nodes[i].mic_positions,
        channels: rendered.nodes[i].mics.map(() => channel++)
      })) };
      return analyseRecording({ sample_rate: 48000, frames: rendered.length, channels: rendered.nodes.flatMap((n) => n.mics) }, geometry);
    };
    const first = run(), second = run();
    actualFixes += first.inference.fixes.length;
    assert.deepEqual(first, second, `seed ${seed}`);
    assert.doesNotThrow(() => JSON.stringify(first, (_, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Nonfinite output in seed ${seed}`);
      return value;
    }));
  }
  assert.ok(actualFixes > 0, 'Fuzz must include actual fixes, not only deterministic misses');
});
