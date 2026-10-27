import { buildingBox } from '@echo/sim-core/geometry.js';
import { buildingFootprint } from '@echo/sim-core/osm.js';
import { isMoving, positionAt } from '@echo/sim-core/motion.js';
import { drawLocalisationTrack } from './tracking.js';
import { drawParticles, sourceColor } from './particles.js';

// Orbit camera around a target. World is x east, y north, z up (metres).
export function createCamera() {
  return { target: [0, 0, 0], yaw: -0.8, pitch: 0.6, dist: 120, fov: 0.9 };
}

export function cameraPosition(cam) {
  const cp = Math.cos(cam.pitch);
  return [
    cam.target[0] + cam.dist * cp * Math.cos(cam.yaw),
    cam.target[1] + cam.dist * cp * Math.sin(cam.yaw),
    cam.target[2] + cam.dist * Math.sin(cam.pitch)
  ];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Returns project(p) -> [sx, sy, depth] or null when behind the camera. */
export function makeProjector(cam, w, h) {
  const eye = cameraPosition(cam);
  const f = norm(sub(cam.target, eye));
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  const k = h / 2 / Math.tan(cam.fov / 2);
  return (p) => {
    const d = sub(p, eye);
    const z = dot(d, f);
    if (z < 0.1) return null;
    return [w / 2 + (dot(d, r) / z) * k, h / 2 - (dot(d, u) / z) * k, z];
  };
}


export function createView3d(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = createCamera();
  let fitted = false;
  let drag = null;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) {
      const s = cam.dist * 0.0015;
      cam.target[0] += (Math.sin(cam.yaw) * dx - Math.cos(cam.yaw) * dy) * s;
      cam.target[1] += (-Math.cos(cam.yaw) * dx - Math.sin(cam.yaw) * dy) * s;
    } else {
      cam.yaw -= dx * 0.008;
      cam.pitch = Math.max(0.05, Math.min(1.5, cam.pitch + dy * 0.008));
    }
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.max(5, Math.min(5000, cam.dist * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  function fitScene(scenario) {
    const pts = [...scenario.nodes.map((n) => n.position), ...scenario.sources.flatMap((s) => s.keyframes.map((k) => k.position))];
    for (const b of scenario.buildings || []) pts.push([b.position[0], b.position[1], 0]);
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    cam.target = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 0];
    cam.dist = Math.max(40, 1.6 * Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
    fitted = true;
  }

  /** opts: { scenario, results, selectedNodes:Set, hiddenNodes:Set, showBacktrace, showRays, dpr, time (s, places moving sources) } */
  function draw({ scenario, results, selectedNodes = new Set(), hiddenNodes = new Set(), showBacktrace = true, showRays = true, rings = [], particles = [], particleMode = false, slice = 1.5, dpr = 1, time = 0 }) {
    const W = canvas.width;
    const H = canvas.height;
    if (!fitted) fitScene(scenario);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const P = makeProjector(cam, W, H);
    const line = (a, b, style, width = 1, dash = []) => {
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
    const label = (p, text, color) => {
      const s = P(p);
      if (!s) return;
      ctx.fillStyle = color;
      ctx.font = `${11 * dpr}px sans-serif`;
      ctx.fillText(text, s[0] + 8 * dpr, s[1] - 6 * dpr);
    };

    // Ground grid
    const step = cam.dist > 400 ? 50 : cam.dist > 120 ? 10 : 5;
    const span = Math.ceil((cam.dist * 1.2) / step) * step;
    const gx = Math.round(cam.target[0] / step) * step;
    const gy = Math.round(cam.target[1] / step) * step;
    for (let i = -span; i <= span; i += step) {
      line([gx + i, gy - span, 0], [gx + i, gy + span, 0], '#1c1c1c');
      line([gx - span, gy + i, 0], [gx + span, gy + i, 0], '#1c1c1c');
    }
    line([0, 0, 0], [10, 0, 0], '#f55', 2);
    line([0, 0, 0], [0, 10, 0], '#5f5', 2);
    line([0, 0, 0], [0, 0, 10], '#58f', 2);

    // OpenStreetMap ground layer: land and water fills, then roads, rail and trees
    const env = scenario.environment;
    if (env?.features) {
      const FILL = { land: 'rgba(40,90,45,0.35)', water: 'rgba(40,90,160,0.5)' };
      const STROKE = { road: '#777', rail: '#a86', water: '#48c' };
      const path = (pts) => {
        const sp = pts.map((q) => P([q[0], q[1], 0]));
        if (sp.some((q) => !q)) return false;
        sp.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        return true;
      };
      ctx.setLineDash([]);
      for (const f of env.features) {
        if (f.type !== 'polygon' || !FILL[f.kind]) continue;
        ctx.fillStyle = FILL[f.kind];
        ctx.beginPath();
        let ok = true;
        for (const ring of f.points) {
          ok = path(ring) && ok;
          ctx.closePath();
        }
        if (ok) ctx.fill('evenodd');
      }
      for (const f of env.features) {
        if (f.type === 'line') {
          ctx.strokeStyle = STROKE[f.kind] || '#666';
          ctx.lineWidth = Math.max(1, Math.min(f.width * 600 / cam.dist, 6)) * dpr;
          ctx.beginPath();
          if (path(f.points)) ctx.stroke();
        } else if (f.type === 'point') {
          const q = P([f.points[0], f.points[1], 0]);
          if (!q) continue;
          ctx.fillStyle = '#3a7a3a';
          ctx.beginPath();
          ctx.arc(q[0], q[1], 2 * dpr, 0, 7);
          ctx.fill();
        }
      }
    }

    if (env?.attribution) {
      ctx.fillStyle = '#888';
      ctx.font = `${10 * dpr}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(env.attribution, W - 6 * dpr, H - 6 * dpr);
      ctx.textAlign = 'left';
    }

    // Buildings, far to near, translucent walls plus edges. Imported OSM buildings keep their real footprint.
    const boxes = (scenario.buildings || []).map((b) => ({ b, box: buildingBox(b), outline: buildingFootprint(b)[0] }));
    const eye = cameraPosition(cam);
    boxes.sort((a, c) => Math.hypot(c.b.position[0] - eye[0], c.b.position[1] - eye[1]) - Math.hypot(a.b.position[0] - eye[0], a.b.position[1] - eye[1]));
    for (const { b, box, outline } of boxes) {
      const n = outline.length;
      const lo = outline.map(([x, y]) => [x, y, 0]);
      const hi = outline.map(([x, y]) => [x, y, box.max[2]]);
      const faces = [hi, ...lo.map((_, i) => [lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]])];
      for (const f of faces) {
        const pts = f.map(P);
        if (pts.some((p) => !p)) continue;
        ctx.fillStyle = f === hi ? 'rgba(120,120,120,0.35)' : 'rgba(90,90,90,0.25)';
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fill();
      }
      for (let i = 0; i < n; i++) {
        line(lo[i], lo[(i + 1) % n], '#aaa');
        line(hi[i], hi[(i + 1) % n], '#aaa');
        line(lo[i], hi[i], '#aaa');
      }
      label([b.position[0], b.position[1], box.max[2]], b.name || b.id, '#aaa');
    }

    // Nodes: pole to the mic array
    for (const n of scenario.nodes) {
      if (hiddenNodes.has(n.id)) continue;
      const sel = selectedNodes.has(n.id);
      const [x, y, z] = n.position;
      line([x, y, 0], [x, y, z], sel ? '#ffb000' : '#fff');
      const s = P([x, y, z]);
      if (s) {
        ctx.strokeStyle = sel ? '#ffb000' : '#fff';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(s[0], s[1], 5 * dpr, 0, 7);
        ctx.stroke();
      }
      label(n.position, n.id, '#fff');
    }

    // Sources
    for (const src of scenario.sources) {
      const p = positionAt(src, time);
      if (isMoving(src)) for (let i = 1; i < src.keyframes.length; i++) line(src.keyframes[i - 1].position, src.keyframes[i].position, '#aaa', 1, [6, 4]);
      line([p[0], p[1], 0], p, '#666', 1, [3, 3]);
      const s = P(p);
      if (s) {
        ctx.fillStyle = particleMode ? sourceColor(scenario.sources.indexOf(src)) : '#fff';
        ctx.beginPath();
        ctx.arc(s[0], s[1], 5 * dpr, 0, 7);
        ctx.fill();
      }
      label(p, src.id, particleMode ? sourceColor(scenario.sources.indexOf(src)) : '#fff');
    }

    // Waves are spheres about the source (or its mirror image): latitude rings and meridians, clipped at the ground,
    // hidden where buildings block them (direct) or where no valid reflection point exists (reflected).
    const poly = (pts, rgba, width) => {
      ctx.strokeStyle = rgba;
      ctx.lineWidth = width * dpr;
      ctx.beginPath();
      let run = false;
      for (const q of pts) {
        const s = q && P(q);
        if (!s) {
          run = false;
          continue;
        }
        if (run) ctx.lineTo(s[0], s[1]);
        else ctx.moveTo(s[0], s[1]);
        run = true;
      }
      ctx.stroke();
    };
    const live = rings.filter((r) => r.alpha > 0.02);
    const stride = Math.max(1, Math.ceil(live.length / 60));
    const N = 48;
    live.forEach((ring, k) => {
      if (k % stride) return;
      const [cx, cy, cz] = ring.center;
      const R = Math.hypot(ring.rho, cz - slice);
      const at = (lat, lon) => {
        const q = [cx + R * Math.cos(lat) * Math.cos(lon), cy + R * Math.cos(lat) * Math.sin(lon), cz + R * Math.sin(lat)];
        return q[2] < 0 || (ring.valid && !ring.valid(q)) ? null : q;
      };
      const tint = (a) => `rgba(${ring.tint},${(ring.alpha * a).toFixed(3)})`;
      for (const lat of [-0.6, 0, 0.6, 1.1]) {
        poly(Array.from({ length: N + 1 }, (_, i) => at(lat, (2 * Math.PI * i) / N)), tint(0.45), 1);
      }
      for (let m = 0; m < 6; m++) {
        const lon = (Math.PI * m) / 3;
        poly(Array.from({ length: N + 1 }, (_, i) => at(-Math.PI / 2 + (Math.PI * i) / N, lon)), tint(0.3), 1);
      }
      // The slice plane cut, as in the 2D map
      poly(
        Array.from({ length: N * 2 + 1 }, (_, i) => {
          const th = (2 * Math.PI * i) / (N * 2);
          const q = [cx + ring.rho * Math.cos(th), cy + ring.rho * Math.sin(th), slice];
          return !ring.valid || ring.valid(q) ? q : null;
        }),
        tint(1),
        1.5
      );
    });

    drawParticles(ctx, particles, P, dpr);

    for (const r of results || []) {
      // Bearing rays in 3D (elevation below the horizon is assumed for flat arrays)
      if (showRays) {
        for (const n of r.nodes) {
          const bearing = r.track
            ? r.track.observations.filter((o) => o.node_id === n.node_id && o.t_s <= time).at(-1)
            : n.bearing;
          if (!bearing || hiddenNodes.has(n.node_id)) continue;
          const node = scenario.nodes.find((x) => x.id === n.node_id);
          const len = Math.max(20, Math.hypot(node.position[0] - r.true_position[0], node.position[1] - r.true_position[1], node.position[2] - r.true_position[2]) * 1.2);
          const d = bearing.direction;
          let end = [node.position[0] + d[0] * len, node.position[1] + d[1] * len, node.position[2] + d[2] * len];
          if (end[2] < 0 && d[2] < 0) {
            const t = node.position[2] / -d[2];
            end = [node.position[0] + d[0] * t, node.position[1] + d[1] * t, 0];
          }
          line(node.position, end, 'rgba(255,176,0,0.6)');
        }
      }
      drawLocalisationTrack(ctx, r, time, { project: P, dpr });
      if (!r.track && r.fix?.position && time >= r.fix.ready_s) {
        const s = P(r.fix.position);
        if (s) {
          ctx.strokeStyle = '#ffb000';
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.arc(s[0], s[1], 7 * dpr, 0, 7);
          ctx.stroke();
          line(r.fix.position, r.true_position, '#ffb000', 1, [2, 3]);
        }
      }
      const source = scenario.sources.find((s) => s.id === r.source_id);
      if (showBacktrace && r.backtrace && !(source && isMoving(source))) {
        for (const id of selectedNodes) {
          const node = scenario.nodes.find((x) => x.id === id);
          for (const leg of r.backtrace.traces[id] || []) {
            line([leg.from[0], leg.from[1], node.position[2]], [leg.to[0], leg.to[1], node.position[2]], '#7fd4ff', 1, leg.kind === 'dashed' ? [6, 4] : []);
          }
        }
        for (const c of r.backtrace.top) {
          const s = P(c.position);
          if (!s) continue;
          ctx.strokeStyle = '#ffd166';
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.arc(s[0], s[1], 9 * dpr, 0, 7);
          ctx.stroke();
          label(c.position, `${c.rank}: ${c.score.toFixed(2)}`, '#ffd166');
        }
      }
    }
    ctx.fillStyle = '#888';
    ctx.font = `${11 * dpr}px sans-serif`;
    ctx.fillText('drag: orbit   shift/right-drag: pan   wheel: zoom   double-click: refit', 12 * dpr, H - 12 * dpr);
  }

  return { draw, camera: cam, refit: () => (fitted = false), onRefit: (fn) => canvas.addEventListener('dblclick', () => ((fitted = false), fn?.())) };
}
