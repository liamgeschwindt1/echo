import { emittedPosition, isMoving, positionAt } from '../motion.js';
import { sourcePosition } from '../scenario.js';
import { distance } from '../physics.js';

const angleError = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const deg = (r) => r * 180 / Math.PI;
const median = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
export const SCORING_VERSION = 'episode-one-to-one-v2';

export function scoreAssisted(results) {
  return {
    fix_count: results.filter((r) => r.fix?.position).length, unmatched_fixes: 0, unmatched_suspect: 0,
    sources: results.map((r) => ({
      source_id: r.source_id, horizontal_m: r.error_horizontal_m, error_3d_m: r.error_3d_m,
      suspect: !!r.fix?.fix_suspect,
      track_errors_m: (r.track?.fixes ?? []).map((f) => f.error_m).filter(Number.isFinite),
      nodes: r.nodes.map((n) => ({
        node_id: n.node_id, range_m: n.range_m, az_error_deg: n.azimuth_error_deg,
        el_error_deg: n.bearing ? angleError(n.bearing.elevation_deg, n.true_elevation_deg) : null,
        sigma_deg: n.bearing?.uncertainty_deg ?? null, detected: !!n.heard
      }))
    }))
  };
}

// This module is scoring ONLY. Truth never enters measured inference or track association.
// One-to-one among overlapping episodes; separate bursts may belong to the same source.
// Spatial assignment is ungated: poor estimates remain poor, not silently discarded.
export function scoreMeasured(scenario, measured, { c }) {
  const intervals = measured.fixes.map((fix) => {
    const times = fix.positions.map((p) => p.t_e).filter(Number.isFinite);
    if (!times.length) throw new Error('Cannot score measured fix without emission times');
    return [Math.min(...times), Math.max(...times)];
  });
  const pairs = measured.fixes.flatMap((fix, fi) => scenario.sources.map((src, si) => {
    const t = fix.positions.at(-1)?.t_e ?? 0;
    const truth = isMoving(src) ? positionAt(src, t) : sourcePosition(src);
    return { fi, si, error: Math.hypot(fix.final_position[0] - truth[0], fix.final_position[1] - truth[1]), truth };
  })).sort((a, b) => a.error - b.error || a.fi - b.fi || a.si - b.si);
  const assigned = new Map(), used = new Set();
  for (const p of pairs) {
    if (used.has(p.fi)) continue;
    const previous = assigned.get(p.si) ?? [];
    if (previous.some((q) => intervals[q.fi][0] <= intervals[p.fi][1] && intervals[p.fi][0] <= intervals[q.fi][1])) continue;
    assigned.set(p.si, [...previous, p]);
    used.add(p.fi);
  }
  const scoreMatch = (src, matches) => {
    const match = matches[0], fix = match ? measured.fixes[match.fi] : null;
    const tracks = new Map();
    for (const p of matches) for (const key of measured.fixes[p.fi].node_tracks) {
      const [ni, ti] = key.split(':').map(Number), list = tracks.get(ni) ?? [];
      list.push(measured.nodes[ni].tracks[ti]); tracks.set(ni, list);
    }
    const nodes = scenario.nodes.map((node, ni) => {
      const errors = (tracks.get(ni) ?? []).flatMap((tr) => tr.windows).map((w) => {
        const truth = isMoving(src) ? emittedPosition(src, node.position, w.t_s, c) : sourcePosition(src);
        return angleError(w.az_deg, deg(Math.atan2(truth[1] - node.position[1], truth[0] - node.position[0])));
      });
      return {
        node_id: node.id, range_m: distance(sourcePosition(src), node.position),
        az_error_deg: median(errors), el_error_deg: null,
        sigma_deg: fix ? measured.options.bearing_sigma_deg : null,
        detected: tracks.has(ni), calibration_unit: 'median accepted track bearing error'
      };
    });
    return {
      source_id: src.id, horizontal_m: match?.error ?? null, error_3d_m: null,
      suspect: fix ? fix.confidence?.suspect ?? (fix.low_confidence || fix.ambiguous || !fix.reliable) : false,
      ...(fix?.confidence ? { p_wrong: fix.confidence.p_wrong, radius_90_m: fix.confidence.radius_90_m,
        radius_90_covered: match && Number.isFinite(fix.confidence.radius_90_m) ? match.error <= fix.confidence.radius_90_m : null } : {}),
      track_errors_m: matches.flatMap((p) => measured.fixes[p.fi].positions).map((f) => {
        const truth = isMoving(src) ? positionAt(src, f.t_e) : sourcePosition(src);
        return Math.hypot(f.position[0] - truth[0], f.position[1] - truth[1]);
      }), nodes, measured_fix_index: match?.fi ?? null
    };
  };
  const sources = scenario.sources.map((src, si) => scoreMatch(src, assigned.get(si) ?? []));
  const fixes = [...assigned].flatMap(([si, matches]) => matches.map((p) => scoreMatch(scenario.sources[si], [p])));
  const unmatched = measured.fixes.filter((_, fi) => !used.has(fi));
  return { sources, fixes, fix_count: measured.fixes.length, unmatched_fixes: unmatched.length,
    unmatched_suspect: unmatched.filter((f) => f.confidence?.suspect ?? (f.low_confidence || f.ambiguous || !f.reliable)).length,
    ...(measured.fixes.some((f) => f.confidence) ? { unmatched_predictions: unmatched.map((f) => ({ p_wrong: f.confidence?.p_wrong ?? null, suspect: f.confidence?.suspect ?? (f.low_confidence || f.ambiguous || !f.reliable) })) } : {}) };
}
