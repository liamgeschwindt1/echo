import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint, runScene } from './golden-lib.js';
import { GOLDEN_SCENES } from './golden-scenes.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(readFileSync(new URL('./golden/golden-phase3.json', import.meta.url), 'utf8'));

const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)) + 1e-9, `${what}: ${a} vs ${b}`);

// Rendered signals must stay identical with no buildings, whatever the reflection order.
for (const order of [undefined, 0, 1, 2]) {
  for (const name of Object.keys(GOLDEN_SCENES)) {
    test(`golden signals: ${name}, reflection_order ${order ?? 'default'}`, () => {
      const { rendered } = runScene(name, order === undefined ? {} : { reflection_order: order });
      rendered.nodes.forEach((n, ni) =>
        n.mics.forEach((m, mi) => {
          const g = golden[name].mics[ni][mi];
          const f = fingerprint(m);
          assert.equal(f.n, g.n);
          for (const k of ['sum', 'sum_sq', 'peak']) close(f[k], g[k], `${name} n${ni} m${mi} ${k}`);
          f.picks.forEach((v, i) => close(v, g.picks[i], `${name} n${ni} m${mi} pick ${i}`));
        })
      );
    });
  }
}

// Bearings against the phase 3 baseline. golden-legacy-analysis.json keeps the pre-change values (windows, SNR and uncertainty changed on purpose).
test('golden bearings (phase 3 baseline)', { skip: process.env.GOLDEN_ANALYSIS === 'off' }, () => {
  for (const name of Object.keys(GOLDEN_SCENES)) {
    const { results } = runScene(name);
    results.forEach((r, si) =>
      r.nodes.forEach((n, ni) => {
        const g = legacy[name].analysis[si].nodes[ni];
        close(n.bearing.azimuth_deg, g.azimuth_deg, `${name} s${si} n${ni} azimuth`);
      })
    );
  }
});
