import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, createView3d, makeProjector } from '../src/ui/view3d.js';
import { defaultScenario, newSource } from '@echo/sim-core/scenario.js';
import { drawParticles, sourceColor, waveParticles } from '../src/ui/particles.js';

test('particles move outwards, keep source colours, and replay deterministically', () => {
  const ring = { center: [0, 0, 2], rho: 4, radius: 4, alpha: 0.8, color: sourceColor(0) };
  const first = waveParticles([ring]);
  const later = waveParticles([{ ...ring, rho: 8, radius: 8 }]);
  assert.deepEqual(waveParticles([ring]), first);
  assert.equal(first.length, 64);
  assert.ok(first.every((particle) => particle.position[2] === 1.5 && particle.color === sourceColor(0)));
  assert.ok(later.every((particle, index) => Math.abs(particle.position[0] - 2 * first[index].position[0]) < 1e-9));
  assert.equal(new Set(Array.from({ length: 100 }, (_, index) => sourceColor(index))).size, 100);
  const shifted = waveParticles([{ ...ring, center: [10, 20, 2], color: sourceColor(1) }]);
  assert.ok(shifted.every((particle, index) => particle.color === sourceColor(1)
    && Math.abs(particle.position[0] - first[index].position[0] - 10) < 1e-9
    && Math.abs(particle.position[1] - first[index].position[1] - 20) < 1e-9));
});

test('3D particles occupy spheres, respect walls and ground, and stay bounded', () => {
  const ring = { center: [0, 0, 2], rho: 0, radius: 10, alpha: 1, color: sourceColor(1), valid: (point) => point[0] > 0 };
  const particles = waveParticles([ring], { spatial: true });
  assert.ok(particles.length > 0);
  assert.ok(new Set(particles.map((particle) => particle.position[2])).size > 5);
  for (const { position, color } of particles) {
    assert.ok(position[0] > 0 && position[2] >= 0);
    assert.ok(Math.abs(Math.hypot(position[0], position[1], position[2] - 2) - 10) < 1e-9);
    assert.equal(color, sourceColor(1));
  }
  assert.ok(waveParticles(Array(200).fill(ring), { spatial: true, maxParticles: 500 }).length <= 500);
  assert.deepEqual(waveParticles([{ ...ring, alpha: 0 }]), []);
});

test('particle drawing projects both source colours and skips points behind camera', () => {
  const drawn = [];
  let saved = false;
  let restored = false;
  const ctx = {
    save() { saved = true; },
    restore() { restored = true; },
    beginPath() {},
    arc(x, y, radius) { drawn.push({ x, y, radius, color: this.fillStyle, alpha: this.globalAlpha }); },
    fill() {}
  };
  const particles = [
    { position: [1, 2, 3], color: sourceColor(0), alpha: 0.4 },
    { position: [4, 5, 6], color: sourceColor(1), alpha: 0.8 },
    { position: [-1, 0, 0], color: sourceColor(2), alpha: 1 }
  ];
  drawParticles(ctx, particles, (point) => point[0] < 0 ? null : [point[0] * 10, point[1] * 10], 2);
  assert.deepEqual(drawn, [
    { x: 10, y: 20, radius: 3.6, color: sourceColor(0), alpha: 0.4 },
    { x: 40, y: 50, radius: 3.6, color: sourceColor(1), alpha: 0.8 }
  ]);
  assert.ok(saved && restored);
});

test('3D projector: target at centre, up is up, behind camera is null', () => {
  const cam = createCamera();
  const P = makeProjector(cam, 800, 600);
  const [cx, cy] = P(cam.target);
  assert.ok(Math.abs(cx - 400) < 1e-6 && Math.abs(cy - 300) < 1e-6);
  assert.ok(P([0, 0, 10])[1] < cy);
  cam.dist = 50;
  const Q = makeProjector(cam, 800, 600);
  assert.equal(Q([cam.target[0] * 3 + 1000 * Math.cos(cam.yaw), cam.target[1] + 1000 * Math.sin(cam.yaw), 500]), null);
});

test('3D playback draws rolling fixes, not a moving source whole-event candidate', () => {
  const arcs = [];
  const ctx = {
    save() {},
    restore() {},
    fillRect() {},
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    fillText() {},
    arc(x, y, radius) { arcs.push({ x, y, radius }); }
  };
  const canvas = { width: 800, height: 600, getContext: () => ctx, addEventListener() {} };
  const view = createView3d(canvas);
  const scenario = defaultScenario();
  const source = newSource('s1', 'c', 0, 0);
  source.keyframes = [{ t: 0, position: [0, 0, 1.5] }, { t: 3, position: [20, 0, 1.5] }];
  scenario.sources = [source];
  const result = {
    source_id: 's1',
    nodes: [],
    fix: { position: [10, 0, 1.5], ready_s: 0 },
    backtrace: { traces: {}, top: [{ position: [10, 0, 1.5], rank: 1, score: 1 }] },
    track: {
      interval_s: 0.1,
      fixes: [{ t_s: 1, position: [1, 0, 1.5] }, { t_s: 1.1, position: [2, 0, 1.5] }]
    }
  };
  view.draw({ scenario, results: [result], time: 0.9 });
  assert.ok(arcs.every((a) => a.radius === 5));
  arcs.length = 0;
  view.draw({ scenario, results: [result], time: 1.1 });
  const project = makeProjector(view.camera, canvas.width, canvas.height);
  const point = project([2, 0, 1.5]);
  assert.deepEqual(arcs.filter((a) => a.radius !== 5), [
    { x: project([1, 0, 1.5])[0], y: project([1, 0, 1.5])[1], radius: 4 },
    { x: point[0], y: point[1], radius: 8 }
  ]);
});
