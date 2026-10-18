import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, makeProjector } from '../src/sim/ui/view3d.js';

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
