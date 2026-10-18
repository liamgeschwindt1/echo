import { distance } from './physics.js';

const toDeg = (r) => (r * 180) / Math.PI;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

const direction = (from, to) => {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const n = Math.hypot(...d) || 1;
  return d.map((v) => v / n);
};

// Pressure amplitude at 1/r spreading with the 1 m floor, bounce factors included, air absorption excluded.
const amplitude = (p) => p.gain / Math.max(p.length, 1);

/**
 * Per node and source path diagnostics. centre = { paths, directBlocked } from the array centre.
 * Azimuth comparisons are horizontal, matching the wedge on the map.
 */
export function pathReport({ centre, node, source, bearing, settings }) {
  const origin = node.position;
  const src = source.keyframes[0].position;
  const direct = centre.paths.find((p) => p.type === 'direct');
  const strongest = centre.paths.reduce((a, p) => (!a || amplitude(p) > amplitude(a) ? p : a), null);
  const ref = direct || strongest;
  const refAmp = ref ? amplitude(ref) : 1;
  const paths = centre.paths.map((p) => {
    const d = direction(origin, p.image);
    return {
      type: p.type,
      surfaces: p.surfaces,
      length_m: p.length,
      delay_s: p.delay_s,
      level_db_re_direct: 20 * Math.log10(amplitude(p) / refAmp),
      level_reference: direct ? 'direct' : 'strongest_path',
      arrival_azimuth_deg: toDeg(Math.atan2(d[1], d[0])),
      arrival_elevation_deg: toDeg(Math.asin(Math.max(-1, Math.min(1, d[2]))))
    };
  });
  const trueDir = direction(origin, src);
  const trueAz = toDeg(Math.atan2(trueDir[1], trueDir[0]));
  let picked = null;
  if (bearing) {
    let best = Infinity;
    paths.forEach((p, i) => {
      const e = angDiff(p.arrival_azimuth_deg, bearing.azimuth_deg);
      if (e < best && e <= settings.picked_path_tolerance_deg) {
        best = e;
        picked = i;
      }
    });
  }
  const reflected = centre.paths.filter((p) => p.type !== 'direct');
  const bestReflected = reflected.reduce((a, p) => (!a || amplitude(p) > amplitude(a) ? p : a), null);
  const delays = centre.paths.map((p) => p.delay_s);
  return {
    paths,
    direct_blocked: centre.directBlocked,
    picked_path_index: picked,
    picked_path_type: picked === null ? null : paths[picked].type,
    bearing_error_vs_direct_deg: bearing ? angDiff(bearing.azimuth_deg, trueAz) : null,
    bearing_error_vs_picked_deg: bearing && picked !== null ? angDiff(bearing.azimuth_deg, paths[picked].arrival_azimuth_deg) : null,
    direct_to_reflected_db: direct && bestReflected ? 20 * Math.log10(amplitude(direct) / amplitude(bestReflected)) : null,
    delay_spread_s: delays.length ? Math.max(...delays) - Math.min(...delays) : 0,
    first_path_delay_s: delays.length ? Math.min(...delays) : null,
    direct_distance_m: distance(origin, src)
  };
}
