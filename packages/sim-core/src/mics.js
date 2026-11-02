export const MIC_LAYOUTS = ['flat_square', 'tetrahedron', 'stagger_8'];

// stagger_8: two rings, lower at z = 0 with azimuths k * 360/n, upper at z = ring height with azimuths offset by half a step.
export const STAGGER_DEFAULTS = Object.freeze({ lower_radius_m: 0.06, upper_radius_m: 0.12, ring_height_m: 0.06, per_ring: 4 });

export function staggerParams(node) {
  const d = STAGGER_DEFAULTS;
  return {
    lower: node.mic_radius_lower_m ?? d.lower_radius_m,
    upper: node.mic_radius_upper_m ?? d.upper_radius_m,
    height: node.mic_ring_height_m ?? d.ring_height_m,
    n: Math.max(2, Math.round(node.mic_per_ring ?? d.per_ring))
  };
}

// Local (node frame, unrotated) mic offsets in metres.
export function micOffsets(node) {
  const s = node.mic_spacing_m ?? 0.1;
  if (node.mic_layout === 'custom' && Array.isArray(node.mic_offsets_m)) return node.mic_offsets_m;
  if (node.mic_layout === 'tetrahedron') {
    const a = s / (2 * Math.SQRT2);
    return [[a, a, a], [a, -a, -a], [-a, a, -a], [-a, -a, a]];
  }
  if (node.mic_layout === 'stagger_8') {
    const { lower, upper, height, n } = staggerParams(node);
    const ring = (radius, z, phase) => Array.from({ length: n }, (_, k) => {
      const az = ((k + phase) * 2 * Math.PI) / n;
      return [radius * Math.cos(az), radius * Math.sin(az), z];
    });
    return [...ring(lower, 0, 0), ...ring(upper, height, 0.5)];
  }
  const h = s / 2;
  return [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]];
}

// World-space mic positions: layout offsets rotated about z, then translated to the node.
export function micPositions(node) {
  const offsets = micOffsets(node);
  const r = ((node.rotation_deg || 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const [nx, ny, nz] = node.position;
  return offsets.map(([x, y, z]) => [nx + x * cos - y * sin, ny + x * sin + y * cos, nz + z]);
}

export function micPairs(n) {
  const out = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

export const MIC_PAIRS = micPairs(4);
