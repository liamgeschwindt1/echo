// Share of the sound at one node that each source contributes, measured (from SNR) and true (free-field from ground truth).
import { distance } from './physics.js';

const toShares = (levels) => {
  const power = levels.map((l) => (l === null ? 0 : 10 ** (l / 10)));
  const total = power.reduce((a, b) => a + b, 0);
  return power.map((p) => (total > 0 ? (100 * p) / total : null));
};

/**
 * Free field and direct path only: no reflections, diffraction or air absorption in the "true" column.
 * Sources the node did not hear get no measured level and are excluded from the measured shares.
 */
export function nodeShares(scenario, results, nodeId) {
  const node = scenario.nodes.find((n) => n.id === nodeId);
  if (!node || !results) return null;
  const floor = scenario.settings.noise_floor_db_spl;
  const rows = results.map((r) => {
    const src = scenario.sources.find((s) => s.id === r.source_id);
    const nr = r.nodes.find((n) => n.node_id === nodeId);
    const heard = !!nr?.heard;
    return {
      source_id: r.source_id,
      clip: src?.clip,
      heard,
      measured_db: heard ? floor + nr.snr_db : null,
      true_db: src ? src.level_1m_db - 20 * Math.log10(Math.max(1, distance(r.true_position, node.position))) : null
    };
  });
  const measured = toShares(rows.map((r) => r.measured_db));
  const truth = toShares(rows.map((r) => r.true_db));
  return rows.map((r, i) => ({ ...r, measured_share_pct: r.heard ? measured[i] : null, true_share_pct: truth[i], error_pct_points: r.heard && measured[i] !== null && truth[i] !== null ? measured[i] - truth[i] : null }));
}
