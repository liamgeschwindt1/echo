// P9 with the real models: the simulator's Node runners (src/node-models.js) load the same YAMNet and CLAP files as the
// apps and score through @echo/shared/clap.js. The sanity check must agree on clean clips (app path vs sim path).
// Needs the committed model files and the ESC-50 clips (npm run fetch-test-audio -w @echo/assets); skipped without.
// Not an accuracy claim: sim audio is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readWavMono48k } from '../scripts/lib-wav.mjs';
import { defaultScenario, newNode, newSource, renderLengthS } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { labellingSanityCheck } from '../src/labelling.js';
import { loadNodeRunners, closeNodeRunners, nodeModelsAvailable } from '../src/node-models.js';

const FS = 48000;
const audio = JSON.parse(readFileSync(new URL('../../assets/public/test-audio/manifest.json', import.meta.url), 'utf8'));
const fileOf = (id) => new URL(`../../assets/public/test-audio/${audio.clips.find((c) => c.id === id)?.file}`, import.meta.url).pathname;
const CLIPS = ['glass_breaking', 'car_horn', 'dog'];
const skip = !nodeModelsAvailable() ? 'model files missing' : !CLIPS.every((id) => existsSync(fileOf(id))) ? 'ESC-50 clips not fetched' : false;

test('P9 real models: app path and sim path agree on clean clips (glass, horn, dog)', { skip }, async (t) => {
  t.after(closeNodeRunners);
  const { cat, runners } = await loadNodeRunners();
  for (const id of CLIPS) {
    const clip = readWavMono48k(fileOf(id));
    const durations = new Map([[id, clip.length / FS]]);
    const res = await labellingSanityCheck({
      clip,
      clipId: id,
      fs: FS,
      cat,
      runners,
      renderOne: async (cid) => {
        const s = defaultScenario();
        s.settings = { ...s.settings, noise_floor_db_spl: 30 };
        s.nodes = [{ ...newNode('n1', 0, 0), position: [0, 0, 1.5] }];
        s.sources = [{ ...newSource('s1', cid, 2, 0, 100), start_s: 3 }];
        const r = renderScenario(s, new Map([[cid, clip]]), { lengthS: renderLengthS(s, durations) + 3 });
        return { scenario: s, rendered: r, results: analyseScenario(s, r, durations) };
      }
    });
    assert.equal(res.agree, true, `${id}: ${JSON.stringify(res)}`);
    assert.ok(res.app_label, `${id}: app path labelled nothing`);
  }
});
