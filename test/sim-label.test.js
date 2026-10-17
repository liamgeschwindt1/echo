import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue } from '../src/core/catalogue.js';
import { classify, windowEnds } from '../src/sim/core/label.js';
import { attachDetections, matchEvents } from '../src/sim/core/match.js';
import { defaultScenario, newNode, newSource } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { mulberry32, gaussian } from '../src/sim/core/rng.js';

const FS = 48000;
const read = (n) => JSON.parse(readFileSync(new URL(`../public/config/${n}`, import.meta.url), 'utf8'));
const cat = buildCatalogue(read('labels.json'), read('priorities.json'));

function click() {
  const rng = mulberry32(3);
  const out = new Float32Array(Math.round(0.4 * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng) * Math.exp(-i / FS / 0.02);
  return out;
}

const gunRunners = {
  yamnet: async () => ({ 'Gunshot, gunfire': 0.8 }),
  clap: async () => ({ gunshot: { softmax: 0.9, cosine: 0.3 } })
};

test('window schedule starts when a full window exists', () => {
  assert.deepEqual(windowEnds(8, 5, 1.25), [5, 6.25, 7.5]);
});

test('match: nearest overlap wins, others are false alerts or missed', () => {
  const r = matchEvents(
    [{ id: 'a', start_s: 5, end_s: 6 }, { id: 'b', start_s: 20, end_s: 21 }],
    [{ start_s: 5.1, end_s: 5.8 }, { start_s: 12, end_s: 13 }]
  );
  assert.equal(r.matches.get('a').start_s, 5.1);
  assert.equal(r.false_alerts.length, 1);
  assert.deepEqual(r.missed, ['b']);
});

test('pipeline detects, labels and attaches a gunshot at one node', async () => {
  const node = newNode('a', 0, 0);
  const src = newSource('s1', 'c', 20, 5, 130);
  src.start_s = 6;
  const scn = defaultScenario();
  scn.nodes = [node];
  scn.sources = [src];
  const rendered = renderScenario(scn, new Map([['c', click()]]), { lengthS: 17 });
  const durations = new Map([['c', 0.4]]);
  const results = analyseScenario(scn, rendered, durations);
  const out = await classify(rendered.nodes[0].mics[0], FS, 'clap5', { cat, runners: gunRunners });
  assert.ok(out.periods.length >= 1);
  const summary = attachDetections(scn, results, new Map([['a', out.periods]]), durations);
  assert.equal(summary.missed.length, 0);
  assert.equal(results[0].nodes[0].detected, true);
  assert.equal(results[0].final.label, 'gunshot');
  assert.ok(results[0].nodes[0].lag_s < 1.5, String(results[0].nodes[0].lag_s));
});
