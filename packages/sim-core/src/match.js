import { intersectRays } from './localise.js';

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * windows: [{id, start_s, end_s}] true audible windows at one node; periods: labelled detections.
 * Each period goes to the source it overlaps most; periods with no overlap are false alerts.
 */
export function matchEvents(windows, periods) {
  const matches = new Map();
  const falseAlerts = [];
  for (const p of periods) {
    let best = null;
    let bestOv = 0;
    for (const w of windows) {
      const ov = overlap(p.start_s, p.end_s, w.start_s, w.end_s);
      if (ov > bestOv) {
        best = w;
        bestOv = ov;
      }
    }
    if (!best) falseAlerts.push(p);
    else if (!matches.has(best.id) || p.start_s < matches.get(best.id).start_s) matches.set(best.id, p);
  }
  return { matches, false_alerts: falseAlerts, missed: windows.filter((w) => !matches.has(w.id)).map((w) => w.id) };
}

const pick = (p, windowStart) => ({
  detected: true,
  first_detection_s: p.start_s,
  lag_s: p.start_s - windowStart,
  label: p.label,
  label_text: p.label_text,
  family: p.family,
  confidence: p.confidence,
  agreement: p.agreement,
  yamnet_top: p.yamnet.top[0]?.raw_label ?? null,
  clap_top: p.clap.top[0]?.class ?? null,
  target_share: p.target_share,
  rule_flags: p.rule_flags,
  priority_ignored: true
});

/**
 * Adds per-node detections to analyseScenario results, then recomputes each position fix
 * from the nodes that actually detected the source.
 * detections: Map nodeId -> periods (labelled, with start_s/end_s).
 */
export function attachDetections(scenario, results, detections, durations) {
  const falseAlerts = {};
  const missed = new Set();
  const nodeWindows = (node) =>
    results.map((r) => {
      const n = r.nodes.find((x) => x.node_id === node.id);
      const dur = durations.get(scenario.sources.find((s) => s.id === r.source_id).clip) || 0;
      return { id: r.source_id, start_s: n.first_arrival_s, end_s: n.first_arrival_s + dur };
    });
  for (const node of scenario.nodes) {
    const m = matchEvents(nodeWindows(node), detections.get(node.id) || []);
    falseAlerts[node.id] = m.false_alerts.length;
    for (const r of results) {
      const n = r.nodes.find((x) => x.node_id === node.id);
      const p = m.matches.get(r.source_id);
      Object.assign(n, p ? pick(p, n.first_arrival_s) : { detected: false });
    }
  }
  for (const r of results) {
    const hit = r.nodes.filter((n) => n.detected);
    if (!hit.length) missed.add(r.source_id);
    const best = hit.reduce((a, n) => (!a || n.confidence > a.confidence ? n : a), null);
    r.final = best && { label: best.label, label_text: best.label_text, confidence: best.confidence, node_id: best.node_id };
    const rays = hit
      .filter((n) => n.bearing)
      .map((n) => ({ origin: scenario.nodes.find((x) => x.id === n.node_id).position, direction: n.bearing.direction, weight: 10 ** (n.snr_db / 10) }));
    const fix = intersectRays(rays);
    const est = fix && !fix.poorly_conditioned ? fix.position : null;
    r.fix = fix && { ...fix, position: est };
    r.error_horizontal_m = est ? Math.hypot(est[0] - r.true_position[0], est[1] - r.true_position[1]) : null;
    r.error_3d_m = est ? Math.hypot(est[0] - r.true_position[0], est[1] - r.true_position[1], est[2] - r.true_position[2]) : null;
  }
  return { missed: [...missed], false_alerts: falseAlerts };
}
