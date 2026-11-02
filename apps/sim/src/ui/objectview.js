// Small orbit viewer for one library object (a mic array in mm, a sound source in m), drawn with the scene's projector.
import { createCamera, makeProjector } from './view3d.js';

export function createObjectView(canvas, { dist = 400, minDist = 20, maxDist = 20000 } = {}) {
  const ctx = canvas.getContext('2d');
  const cam = { ...createCamera(), dist, pitch: 0.4, yaw: -0.9 };
  let drag = null;
  let range = [minDist, maxDist];

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.yaw -= (e.clientX - drag.x) * 0.008;
    cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + (e.clientY - drag.y) * 0.008));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.max(range[0], Math.min(range[1], cam.dist * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  /**
   * scene: { points: [{ p, label?, color?, size? }], lines: [{ a, b, color?, dash? }],
   *          circles: [{ radius, z?, color?, label? }], grid: { step, extent, z }, axes: length, dpr }
   */
  function draw(scene) {
    const { points = [], lines = [], circles = [], grid, axes = 0, dpr = 1 } = scene;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (!W || !H) return;
    const P = makeProjector(cam, W, H);
    const seg = (a, b, style, width = 1, dash = []) => {
      const pa = P(a);
      const pb = P(b);
      if (!pa || !pb) return;
      ctx.strokeStyle = style;
      ctx.lineWidth = width * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const text = (p, s, color) => {
      const q = P(p);
      if (!q) return;
      ctx.fillStyle = color;
      ctx.font = `${11 * dpr}px ui-monospace, monospace`;
      ctx.fillText(s, q[0] + 8 * dpr, q[1] - 6 * dpr);
    };

    if (grid) {
      const n = Math.round(grid.extent / grid.step);
      for (let i = -n; i <= n; i++) {
        const c = i * grid.step;
        const col = i === 0 ? '#444' : '#1f1f1f';
        seg([c, -grid.extent, grid.z], [c, grid.extent, grid.z], col);
        seg([-grid.extent, c, grid.z], [grid.extent, c, grid.z], col);
      }
    }
    if (axes) {
      seg([0, 0, 0], [axes, 0, 0], '#ff5c5c', 2);
      seg([0, 0, 0], [0, axes, 0], '#5cff7a', 2);
      seg([0, 0, 0], [0, 0, axes], '#5c9bff', 2);
      text([axes, 0, 0], 'x', '#ff5c5c');
      text([0, axes, 0], 'y', '#5cff7a');
      text([0, 0, axes], 'z', '#5c9bff');
    }
    for (const c of circles) {
      const z = c.z ?? 0;
      let prev = null;
      for (let k = 0; k <= 64; k++) {
        const a = (k / 64) * 2 * Math.PI;
        const q = [c.radius * Math.cos(a), c.radius * Math.sin(a), z];
        if (prev) seg(prev, q, c.color || '#555', 1, c.dash || []);
        prev = q;
      }
      if (c.label) text([c.radius, 0, z], c.label, c.color || '#888');
    }
    for (const l of lines) seg(l.a, l.b, l.color || '#555', 1, l.dash || []);

    const order = points.map((pt) => ({ pt, q: P(pt.p) })).filter((x) => x.q).sort((a, b) => b.q[2] - a.q[2]);
    for (const { pt, q } of order) {
      ctx.fillStyle = pt.color || '#ffb000';
      ctx.beginPath();
      ctx.arc(q[0], q[1], (pt.size || 4) * dpr, 0, 2 * Math.PI);
      ctx.fill();
      if (pt.label) text(pt.p, pt.label, '#ddd');
    }
  }

  return {
    cam,
    draw,
    // Frames the object: orbit distance from its radius, and wheel limits around it.
    frame(radius) {
      cam.dist = Math.max(1e-6, radius * 3.2);
      range = [radius * 0.5, radius * 40];
    }
  };
}
