import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newBuilding, newNode, newSource, placementErrors, scenarioLengthS, validateScenario } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { renderComponents } from '../src/sim/core/components.js';
import { analyseScenario } from '../src/sim/core/analyse.js';
import { fieldEnvelopes, fieldSources } from '../src/sim/core/field.js';
import { emittedPosition, hatWeight, keyframesAlong, motionKnots, pathLength, pathSpeed, positionAt, retime, shiftTimes, translatePath } from '../src/sim/core/motion.js';
import { distance, speedOfSound } from '../src/sim/core/physics.js';
import { mulberry32, gaussian } from '../src/sim/core/rng.js';

const FS = 48000;

function noise(seconds, seed = 5) {
  const rng = mulberry32(seed);
  const out = new Float32Array(Math.round(seconds * FS));
  for (let i = 0; i < out.length; i++) out[i] = gaussian(rng);
  return out;
}

function quiet(over = {}) {
  const s = defaultScenario();
  Object.assign(s.settings, { air_absorption: false, ground_reflectivity: 0, noise_enabled: false, ...over });
  return s;
}

const rms = (x, a, b) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return Math.sqrt(e / (b - a));
};

test('positionAt interpolates keyframes and holds the ends', () => {
  const src = newSource('s1', 'c', 0, 0);
  src.keyframes = keyframesAlong([[0, 0, 1], [10, 0, 1], [10, 10, 1]], 2, 4);
  assert.deepEqual(src.keyframes.map((k) => k.t), [2, 3, 4]);
  assert.deepEqual(positionAt(src, 0), [0, 0, 1]);
  assert.deepEqual(positionAt(src, 2.5), [5, 0, 1]);
  assert.deepEqual(positionAt(src, 3.5), [10, 5, 1]);
  assert.deepEqual(positionAt(src, 9), [10, 10, 1]);
  assert.equal(pathLength(src), 20);
  assert.equal(pathSpeed(src), 10);
  retime(src, 1, 5);
  assert.deepEqual(src.keyframes.map((k) => k.t), [1, 3, 5]);
  shiftTimes(src, -3);
  assert.deepEqual(src.keyframes.map((k) => k.t), [0, 2, 4]);
  const first = src.keyframes[0].position;
  translatePath(src, 1, 2);
  assert.equal(src.keyframes[0].position, first);
  assert.deepEqual(positionAt(src, 4), [11, 12, 1]);
});

test('crossfade weights sum to one over the clip', () => {
  const src = newSource('s1', 'c', 0, 0);
  src.keyframes = keyframesAlong([[0, 0, 1], [30, 0, 1]], 1, 3);
  const knots = motionKnots(src, 0.5, 4);
  assert.ok(knots.length > 10 && knots[0] === 0.5 && knots[knots.length - 1] === 4);
  for (let t = 0.5; t <= 4; t += 0.0137) {
    let sum = 0;
    for (let j = 0; j < knots.length; j++) sum += hatWeight(knots, j, t);
    assert.ok(Math.abs(sum - 1) < 1e-9, `t=${t} sum=${sum}`);
  }
});

test('validation accepts paths, rejects bad times and paths through buildings', () => {
  const s = quiet();
  s.nodes = [newNode('n1', 0, 0)];
  s.sources = [newSource('s1', 'c', -40, 20)];
  s.sources[0].keyframes = keyframesAlong([[-40, 20, 1.5], [40, 20, 1.5]], 1, 5);
  validateScenario(s);
  assert.equal(scenarioLengthS(s, new Map([['c', 1]])), 5);
  assert.deepEqual(placementErrors(s), []);
  s.buildings = [newBuilding('b1', 0, 20, 6, 6)];
  assert.match(placementErrors(s).join(), /path of source s1 goes through building b1/);
  s.sources[0].keyframes[1].t = 0.5;
  assert.throws(() => validateScenario(s), /increasing/);
});

test('a moving source that stays put renders like the static source', () => {
  const s = quiet({ ground_reflectivity: 0.7 });
  s.buildings = [newBuilding('b1', 30, 25, 20, 8)];
  s.nodes = [newNode('n1', 0, 0)];
  s.sources = [{ ...newSource('s1', 'c', 20, 5, 90), start_s: 0.1 }];
  const clips = new Map([['c', noise(0.4)]]);
  const still = renderScenario(s, clips, { lengthS: 1 });
  const p = s.sources[0].keyframes[0].position;
  s.sources[0].keyframes = [{ t: 0.15, position: [...p] }, { t: 0.4, position: [...p] }];
  const moving = renderScenario(s, clips, { lengthS: 1 });
  for (let mi = 0; mi < 4; mi++) {
    const a = still.nodes[0].mics[mi];
    const b = moving.nodes[0].mics[mi];
    const diff = a.map((v, i) => v - b[i]);
    const rel = 20 * Math.log10(rms(diff, 0, a.length) / rms(a, 0, a.length));
    // Pieces are delayed in short transforms, so the far tails of the band-limited fractional delays (~1/PAD of the energy) are cut.
    assert.ok(rel < -38, `mic ${mi}: difference ${rel.toFixed(1)} dB`);
  }
  assert.equal(moving.audit[0][0][0].length, 0);
});

test('an approaching source gets louder and arrives on time', () => {
  const s = quiet();
  s.nodes = [newNode('n1', 0, 0)];
  s.sources = [{ ...newSource('s1', 'c', 100, 0, 90), start_s: 0 }];
  s.sources[0].keyframes = keyframesAlong([[100, 0, 1.5], [5, 0, 1.5]], 0, 2);
  const clips = new Map([['c', noise(2)]]);
  const r = renderScenario(s, clips, { lengthS: 2.5 });
  const x = r.nodes[0].mics[0];
  const early = rms(x, Math.round(0.4 * FS), Math.round(0.6 * FS));
  const late = rms(x, Math.round(1.8 * FS), Math.round(1.95 * FS));
  assert.ok(20 * Math.log10(late / early) > 10, `level rise ${(20 * Math.log10(late / early)).toFixed(1)} dB`);
  // Nothing arrives before the sound from the start position could have.
  const c = speedOfSound(s.settings.temperature_c);
  const first = Math.floor((distance([100, 0, 1.5], s.nodes[0].position) / c) * FS) - 200;
  assert.ok(rms(x, 0, first) < 1e-3 * early);
  assert.deepEqual(r.source_positions[0], positionAt(s.sources[0], 1));
  const em = emittedPosition(s.sources[0], s.nodes[0].position, 1.5, c);
  assert.ok(Math.abs(1.5 - distance(em, s.nodes[0].position) / c - (100 - em[0]) / 47.5) < 1e-6);
});

test('components of a moving source still add up to the render', () => {
  const s = quiet({ ground_reflectivity: 0.8 });
  s.nodes = [newNode('n1', 0, 0)];
  s.sources = [{ ...newSource('s1', 'c', 30, 10, 90), start_s: 0.1 }, { ...newSource('s2', 'c', -20, 5, 85), start_s: 0.2 }];
  s.sources[0].keyframes = keyframesAlong([[30, 10, 1.5], [10, -10, 1.5]], 0.1, 0.5);
  const clips = new Map([['c', noise(0.4)]]);
  const total = renderScenario(s, clips, { lengthS: 1 });
  for (const mode of ['by_source', 'by_path']) {
    const parts = renderComponents(s, clips, 1, 0, mode);
    let worst = 0;
    const ref = total.nodes[0].mics[2];
    for (let i = 0; i < ref.length; i += 5) {
      let sum = 0;
      for (const ser of parts.series) sum += ser.mics[2][i];
      worst = Math.max(worst, Math.abs(sum - ref[i]));
    }
    assert.ok(worst < 1e-5, `${mode} ${worst}`);
  }
});

test('analysis of a moving source is judged against the emitting position', () => {
  const s = quiet({ noise_enabled: true, noise_floor_db_spl: 20, mic_self_noise_db_spl: 10 });
  s.nodes = [newNode('n1', 0, 0), newNode('n2', 60, 0)];
  s.sources = [{ ...newSource('s1', 'c', 10, 40, 100), start_s: 0.2 }];
  s.sources[0].keyframes = keyframesAlong([[10, 40, 1.5], [50, 40, 1.5]], 0.2, 1.2);
  const clips = new Map([['c', noise(1)]]);
  const r = renderScenario(s, clips, { lengthS: 1.6 });
  const [res] = analyseScenario(s, r, new Map([['c', 1]]));
  const c = speedOfSound(s.settings.temperature_c);
  for (const n of res.nodes) {
    assert.ok(n.bearing, `${n.node_id} has a bearing`);
    const node = s.nodes.find((x) => x.id === n.node_id);
    assert.deepEqual(n.true_position, emittedPosition(s.sources[0], node.position, (n.window_s[0] + n.window_s[1]) / 2, c));
    assert.ok(Math.abs(n.azimuth_error_deg) < 10, `${n.node_id} error ${n.azimuth_error_deg}`);
    assert.equal(n.picked_path_type, 'direct');
    assert.equal(r.paths[s.nodes.indexOf(node)].centre[0].paths[n.picked_path_index].type, 'direct');
  }
  assert.ok(res.true_position[0] > 10 && res.true_position[0] < 50 && res.true_position[1] === 40);
});

test('the heatmap splits a moving source into crossfaded parts along its route', () => {
  const s = quiet();
  s.sources = [{ ...newSource('s1', 'c', 0, 0, 90), start_s: 0 }, { ...newSource('s2', 'c', 5, 5, 90), start_s: 0 }];
  s.sources[0].keyframes = keyframesAlong([[0, 0, 1.5], [60, 0, 1.5]], 0.5, 1.5);
  const clips = new Map([['c', noise(2)]]);
  const fsrc = fieldSources(s, clips);
  const parts = fsrc.filter((x) => x.id === 's1');
  assert.equal(parts.length, 6);
  assert.deepEqual(parts[0].position, [0, 0, 1.5]);
  assert.deepEqual(parts[parts.length - 1].position, [60, 0, 1.5]);
  assert.equal(fsrc.filter((x) => x.id === 's2').length, 1);
  const env = fieldEnvelopes(fsrc, clips, FS, s.settings.localisation_band_hz);
  const whole = env[fsrc.length - 1].bands[3];
  for (let f = 0; f < whole.length; f += 17) {
    const sum = parts.reduce((a, _, j) => a + env[j].bands[3][f], 0);
    assert.ok(Math.abs(sum - whole[f]) <= 1e-6 * whole[f], `frame ${f}`);
  }
});
