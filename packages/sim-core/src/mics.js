export const MIC_LAYOUTS = ['flat_square', 'tetrahedron'];

// World-space mic positions: layout offsets rotated about z, then translated to the node.
export function micPositions(node) {
  const s = node.mic_spacing_m ?? 0.1;
  let offsets;
  if (node.mic_layout === 'tetrahedron') {
    const a = s / (2 * Math.SQRT2);
    offsets = [[a, a, a], [a, -a, -a], [-a, a, -a], [-a, -a, a]];
  } else {
    const h = s / 2;
    offsets = [[-h, -h, 0], [h, -h, 0], [h, h, 0], [-h, h, 0]];
  }
  const r = ((node.rotation_deg || 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const [nx, ny, nz] = node.position;
  return offsets.map(([x, y, z]) => [nx + x * cos - y * sin, ny + x * sin + y * cos, nz + z]);
}

export const MIC_PAIRS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
