// Regression suite on the six upgrade scenes (stand-ins for the six exported runs the brief was written from).
// Pinned values: test/fixtures/upgrade-0.4.json. A change may improve them freely; it fails when any gets worse beyond
// the tolerance. Needs the ESC-50 clips (npm run fetch-test-audio -w @echo/assets); skipped without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { SCENE_IDS, upgradeScenario } from './upgrade-scenes.js';
import { readWavMono48k } from '../scripts/lib-wav.mjs';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { renderLengthS } from '../src/scenario.js';

const pinned = JSON.parse(readFileSync(new URL('./fixtures/upgrade-0.4.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../../assets/public/test-audio/manifest.json', import.meta.url), 'utf8'));
const fileOf = (id) => new URL(`../../assets/public/test-audio/${manifest.clips.find((c) => c.id === id)?.file}`, import.meta.url).pathname;
const needed = [...new Set(SCENE_IDS.flatMap((id) => upgradeScenario(id).sources.map((s) => s.clip)))];
const have = needed.every((id) => existsSync(fileOf(id)));

const worse = (now, then, rel, abs) => then !== null && (now === null || now > then * rel + abs);

for (const id of SCENE_IDS) {
  test(`upgrade regression: ${id}`, { skip: !have && 'ESC-50 clips not fetched' }, () => {
    const scn = upgradeScenario(id);
    const clips = new Map(scn.sources.map((s) => [s.clip, readWavMono48k(fileOf(s.clip))]));
    const durations = new Map([...clips].map(([k, v]) => [k, v.length / 48000]));
    const results = analyseScenario(scn, renderScenario(scn, clips, { lengthS: renderLengthS(scn, durations) }), durations);
    for (const r of results) {
      const p = pinned.rows.find((x) => x.scene === id && x.source_id === r.source_id);
      const what = `${id}/${r.source_id}`;
      assert.ok(!worse(r.error_horizontal_m, p.error_horizontal_m, 1.5, 0.5), `${what} fix error ${r.error_horizontal_m} vs ${p.error_horizontal_m}`);
      assert.ok(r.usable_nodes >= p.usable_nodes, `${what} usable ${r.usable_nodes} vs ${p.usable_nodes}`);
      assert.ok(r.heard_nodes >= p.heard_nodes, `${what} heard ${r.heard_nodes} vs ${p.heard_nodes}`);
      assert.ok(r.track.fixes.length >= Math.floor(0.8 * p.track_fixes), `${what} track fixes ${r.track.fixes.length} vs ${p.track_fixes}`);
      const errs = r.track.fixes.map((x) => x.error_m).sort((a, b) => a - b);
      const med = errs.length ? errs[Math.floor(errs.length / 2)] : null;
      assert.ok(!worse(med, p.track_median_error_m, 1.5, 1), `${what} track median ${med} vs ${p.track_median_error_m}`);
      for (const n of r.nodes) {
        const then = p.node_azimuth_error_deg[n.node_id];
        assert.ok(!worse(n.azimuth_error_deg, then, 1.5, 1), `${what}@${n.node_id} azimuth error ${n.azimuth_error_deg} vs ${then}`);
      }
    }
  });
}
