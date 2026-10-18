import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { defaultScenario, newNode, newSource } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';

test('noise-off analysis keeps audible bearings finite and silent sources unheard', () => {
  const scenario = defaultScenario();
  Object.assign(scenario.settings, { noise_off: true, air_absorption: false, ground_reflectivity: 0 });
  scenario.nodes = [newNode('n1', 10, 0), newNode('n2', 0, 10)];
  scenario.sources = [{ ...newSource('s1', 'burst', 0, 0, 90), start_s: 0.1 }];
  const clip = Float32Array.from({ length: 4800 }, (_, i) =>
    (Math.sin(2 * Math.PI * 500 * i / 48000) + Math.sin(2 * Math.PI * 1100 * i / 48000)) * Math.sin(Math.PI * i / 4799) ** 2);
  for (const [samples, heard] of [[clip, true], [new Float32Array(4800), false]]) {
    const rendered = renderScenario(scenario, new Map([['burst', samples]]), { lengthS: 0.5 });
    const [result] = analyseScenario(scenario, rendered, new Map([['burst', 0.1]]));
    for (const node of result.nodes) {
      assert.equal(node.heard, heard);
      assert.equal(node.snr_db, heard ? Infinity : -Infinity);
      if (heard) {
        assert.ok(node.bearing.direction.every(Number.isFinite));
        assert.ok(Number.isFinite(node.bearing.uncertainty_deg));
      }
    }
    if (result.fix?.position) assert.ok(result.fix.position.every(Number.isFinite));
  }
});
