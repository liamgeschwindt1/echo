import test from 'node:test';
import assert from 'node:assert/strict';
import { drawLocalisationTrack } from '../src/ui/tracking.js';

const result = {
  source_id: 's1',
  fix: { position: [999, 999, 0], ready_s: 0 },
  track: {
    interval_s: 0.1,
    fixes: [
      { t_s: 1, position: [10, 20, 1.5] },
      { t_s: 1.1, position: [15, 20, 1.5] },
      { t_s: 1.2, position: [20, 20, 1.5] },
      { t_s: 2, position: [30, 20, 1.5] }
    ]
  }
};

function draw(time, options = {}) {
  const arcs = [];
  const labels = [];
  const segments = [];
  const ctx = {
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() {},
    moveTo(x, y) { segments.push(['move', x, y]); },
    lineTo(x, y) { segments.push(['line', x, y]); },
    stroke() {},
    arc(x, y, radius) { arcs.push({ x, y, radius }); },
    fillText(text) { labels.push(text); }
  };
  drawLocalisationTrack(ctx, result, time, { project: (p) => p, ...options });
  return { arcs, labels, segments };
}

test('tracking ring follows latest elapsed fix and keeps earlier circles', () => {
  assert.deepEqual(draw(0.9).arcs, []);
  assert.deepEqual(draw(1).arcs, [{ x: 10, y: 20, radius: 8 }]);
  assert.deepEqual(draw(1.1).arcs, [
    { x: 10, y: 20, radius: 4 },
    { x: 15, y: 20, radius: 8 }
  ]);
  assert.deepEqual(draw(1.2).arcs.at(-1), { x: 20, y: 20, radius: 8 });
  assert.deepEqual(draw(1).arcs, [{ x: 10, y: 20, radius: 8 }]);
  assert.equal(draw(1.2).labels[0], 's1 fix 1.20 s');
});

test('tracking does not extrapolate or connect gaps without valid detections', () => {
  const gap = draw(1.8);
  assert.deepEqual(gap.arcs.at(-1), { x: 20, y: 20, radius: 8 });
  assert.equal(gap.labels[0], 's1 last fix 1.20 s');
  const resumed = draw(2);
  assert.deepEqual(resumed.arcs.at(-1), { x: 30, y: 20, radius: 8 });
  assert.deepEqual(resumed.segments.at(-1), ['move', 30, 20]);
});

test('tracking projects positions and scales ring sizes for both canvas views', () => {
  const { arcs } = draw(1.1, { dpr: 2, project: (p) => [p[0] * 2, p[1] * 3] });
  assert.deepEqual(arcs, [
    { x: 20, y: 60, radius: 8 },
    { x: 30, y: 60, radius: 16 }
  ]);
  assert.deepEqual(draw(1, { project: () => null }).arcs, []);
});
