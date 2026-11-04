import { buildingBox, insideBuilding, segmentBlocked } from '@echo/sim-core/geometry.js';
import { crossingDeg } from '@echo/sim-core/fix.js';
import { escapeHtml as esc } from '@echo/sim-core/benchmark/report.js';

const defaults = { sigma_deg: 2.5, max_range_m: 100, source_height_m: 1.5, node_height_m: 5, min_crossing_deg: 10 };
function options(input) {
  const o = { ...defaults, ...input };
  if (!Number.isFinite(o.sigma_deg) || o.sigma_deg < .1 || o.sigma_deg > 30 ||
      !Number.isFinite(o.max_range_m) || o.max_range_m <= 0 ||
      !Number.isFinite(o.source_height_m) || !Number.isFinite(o.node_height_m) ||
      !Number.isFinite(o.min_crossing_deg) || o.min_crossing_deg < 0 || o.min_crossing_deg >= 90) throw new Error('Invalid placement assumptions');
  return o;
}
function scaleAt(point, nodes, boxes, o) {
  let a = 0, b = 0, d = 0, crossing = 0;
  const azimuths = [];
  for (const node of nodes) {
    const dx = point[0] - node[0], dy = point[1] - node[1], r2 = dx * dx + dy * dy;
    if (r2 < 1 || Math.hypot(dx, dy, o.source_height_m - node[2]) > o.max_range_m ||
        segmentBlocked(node, [...point, o.source_height_m], boxes)) continue;
    const az = Math.atan2(dy, dx) * 180 / Math.PI;
    for (const previous of azimuths) crossing = Math.max(crossing, crossingDeg(az, previous));
    azimuths.push(az);
    const w = 1 / ((o.sigma_deg * Math.PI / 180) ** 2 * r2 * r2);
    a += w * dy * dy; b -= w * dx * dy; d += w * dx * dx;
  }
  const det = a * d - b * b;
  const result = { visible_nodes: azimuths.length, crossing_deg: crossing, rms_m: null, major_m: null };
  if (azimuths.length < 2 || crossing < o.min_crossing_deg || !(det > 1e-10 * a * d)) return result;
  return { ...result, rms_m: Math.sqrt((a + d) / det),
    major_m: Math.sqrt((a + d + Math.hypot(a - d, 2 * b)) / (2 * det)) };
}
export function placementScale(point, nodes, input = {}, buildings = []) {
  if (point.length !== 2 || !point.every(Number.isFinite) || nodes.some((n) => n.length !== 3 || !n.every(Number.isFinite))) throw new Error('Placement needs finite XY points and XYZ nodes');
  return scaleAt(point, nodes, buildings.map(buildingBox), options(input));
}
export function placementBounds(scene) {
  const points = scene.nodes.map((n) => n.position);
  for (const box of scene.buildings.map(buildingBox)) points.push(box.min, box.max);
  if (!points.length) throw new Error('Add nodes or buildings to define a placement site');
  return { min_x: Math.min(...points.map((p) => p[0])) - 20, max_x: Math.max(...points.map((p) => p[0])) + 20,
    min_y: Math.min(...points.map((p) => p[1])) - 20, max_y: Math.max(...points.map((p) => p[1])) + 20 };
}
export function placementGrid(bounds, nodes, input = {}, buildings = [], cells = 21) {
  const o = options(input), boxes = buildings.map(buildingBox);
  if (![bounds.min_x, bounds.max_x, bounds.min_y, bounds.max_y].every(Number.isFinite) ||
      bounds.max_x <= bounds.min_x || bounds.max_y <= bounds.min_y ||
      !Number.isFinite((bounds.max_x - bounds.min_x) * 420) || !Number.isFinite((bounds.max_y - bounds.min_y) * 420) ||
      !Number.isInteger(cells) || cells < 1 || cells > 101 ||
      nodes.some((n) => n.length !== 3 || !n.every(Number.isFinite))) throw new Error('Invalid placement grid');
  const points = [];
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const position = [bounds.min_x + (x + .5) * (bounds.max_x - bounds.min_x) / cells,
      bounds.min_y + (y + .5) * (bounds.max_y - bounds.min_y) / cells];
    const excluded = !!insideBuilding([...position, o.source_height_m], buildings);
    points.push({ position, excluded, ...scaleAt(position, nodes, boxes, o) });
  }
  return points;
}
export function suggestPlacement(bounds, count, input = {}, buildings = []) {
  if (!Number.isInteger(count) || count < 2 || count > 6) throw new Error('Choose 2..6 nodes');
  const o = options(input), candidates = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) {
    if (x === 1 && y === 1) continue;
    const p = [bounds.min_x + (x + 1) * (bounds.max_x - bounds.min_x) / 4,
      bounds.min_y + (y + 1) * (bounds.max_y - bounds.min_y) / 4, o.node_height_m];
    if (!insideBuilding(p, buildings)) candidates.push(p);
  }
  if (candidates.length < count) throw new Error('Not enough unblocked candidate mounts; edit the site');
  const score = (nodes) => {
    const points = placementGrid(bounds, nodes, o, buildings, 9).filter((p) => !p.excluded);
    if (!points.length) throw new Error('No exterior evaluation cells');
    return points.reduce((sum, p) => sum + (p.major_m === null ? 1 : Math.min(p.major_m / 10, 1)), 0) / points.length;
  };
  let chosen = null, best = Infinity;
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const cost = score([candidates[i], candidates[j]]);
    if (Math.round(cost * 1e12) < Math.round(best * 1e12)) { chosen = [i, j]; best = cost; }
  }
  while (chosen.length < count) {
    let next = null, cost = Infinity;
    for (let i = 0; i < candidates.length; i++) if (!chosen.includes(i)) {
      const value = score([...chosen.map((j) => candidates[j]), candidates[i]]);
      if (Math.round(value * 1e12) < Math.round(cost * 1e12)) { next = i; cost = value; }
    }
    chosen.push(next); best = cost;
  }
  return { nodes: chosen.map((i) => candidates[i]), objective: best, assumptions: o };
}
export function placementSvg(bounds, nodes, input = {}, buildings = []) {
  const cells = 21, grid = placementGrid(bounds, nodes, input, buildings, cells);
  const x = (p) => 420 * (p[0] - bounds.min_x) / (bounds.max_x - bounds.min_x);
  const y = (p) => 420 * (bounds.max_y - p[1]) / (bounds.max_y - bounds.min_y);
  return `<svg viewBox="0 0 420 420" width="420" style="max-width:100%" role="img" aria-label="Assumed geometry error scale and blind spots">${grid.map((p) =>
    `<rect x="${x(p.position) - 10}" y="${y(p.position) - 10}" width="20" height="20" fill="${p.excluded ? '#777' : p.major_m === null ? '#c95050' : p.major_m <= 10 ? '#44896a' : '#b68c37'}"><title>${esc(p.excluded ? 'Building footprint' : `${p.position.map((v) => v.toFixed(1))}: ${p.major_m === null ? 'blind under assumptions' : p.major_m.toFixed(2) + ' m major scale'}, ${p.visible_nodes} usable nodes, crossing ${p.crossing_deg.toFixed(1)} deg`)}</title></rect>`).join('')}${nodes.flatMap((p, i) => p[0] < bounds.min_x || p[0] > bounds.max_x || p[1] < bounds.min_y || p[1] > bounds.max_y ? [] : [`<circle cx="${x(p)}" cy="${y(p)}" r="5" fill="#fff" stroke="#111"/><text x="${x(p) + 6}" y="${y(p) - 6}" fill="#111" font-size="12">${i + 1}</text>`]).join('')}</svg>`;
}
