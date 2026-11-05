import { trackCandidates, solveStatic, MEASURED_DEFAULTS } from '../../packages/sim-core/src/measured.js';
import { micPositions } from '../../packages/sim-core/src/mics.js';
import { weightedConsensus } from './weighted-consensus.mjs';

const rad = (d) => d * Math.PI / 180;
const wrap = (d) => ((d + 540) % 360) - 180;
const keyOf = (f) => `${f.ni}:${f.ti}`;
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor((a.length - 1) / 2)];

export function hardwareSigma(node, settings, floor = MEASURED_DEFAULTS.bearing_sigma_deg) {
  const positions = micPositions(node);
  const baseline = Math.max(...positions.flatMap((p, i) => positions.slice(i + 1).map((q) => Math.hypot(...p.map((x, k) => x - q[k])))));
  if (!(baseline > 0)) throw new Error('Consensus requires a nonzero nominal mic baseline');
  return Math.hypot(floor, settings.heading_error_sigma_deg ?? 0, Math.sqrt(2) * (settings.mic_position_sigma_mm ?? 0) / 1000 / baseline * 180 / Math.PI);
}

export function exactTrackAssignment(candidates) {
  const keys = [...new Set(candidates.flatMap((c) => c.fix.node_tracks))].sort();
  const bits = new Map(keys.map((k, i) => [k, 1n << BigInt(i)]));
  const proposals = candidates.map((c, i) => ({ ...c, index: i, mask: c.fix.node_tracks.reduce((m, k) => m | bits.get(k), 0n) }));
  const memo = new Map();
  const solve = (remaining) => {
    if (!remaining) return { utility: 0, selected: [] };
    if (memo.has(remaining)) return memo.get(remaining);
    if (memo.size > 250000) throw new Error('Exact global assignment exceeded preregistered 250000-state budget');
    let active = [], pivot = 0n;
    for (const bit of bits.values()) if (remaining & bit) {
      const options = proposals.filter((p) => p.mask & bit && (p.mask & remaining) === p.mask);
      if (options.length > active.length) { active = options; pivot = bit; }
    }
    if (!pivot) return { utility: 0, selected: [] };
    let best = solve(remaining & ~pivot);
    for (const proposal of active) {
      const rest = solve(remaining & ~proposal.mask);
      const choice = { utility: rest.utility + proposal.utility, selected: [...rest.selected, proposal.index].sort((a, b) => a - b) };
      if (choice.utility > best.utility + 1e-12 ||
          Math.abs(choice.utility - best.utility) <= 1e-12 && lexical(choice.selected.join(','), best.selected.join(',')) < 0) best = choice;
    }
    memo.set(remaining, best);
    return best;
  };
  const solution = solve(keys.reduce((m, k) => m | bits.get(k), 0n));
  return { fixes: solution.selected.map((i) => proposals[i].fix), states: memo.size, utility: solution.utility };
}

export function fuseGlobalTracks(nodes, { c, options, consensus, scenario }) {
  const { pairs, options: o } = trackCandidates(nodes, { c, options });
  const eligible = pairs.filter((p) => p.score <= 25 && (p.skew === null || p.skew <= o.max_onset_skew_s));
  const proposals = new Map();
  const add = (fix, score) => {
    if (!fix.final_position.every(Number.isFinite)) throw new Error('Nonfinite global proposal');
    const key = [...fix.node_tracks].sort().join('|');
    const proposal = { fix, utility: fix.n_nodes - 1 + 0.01 / (1 + score) };
    if (!proposals.has(key) || proposal.utility > proposals.get(key).utility) proposals.set(key, proposal);
  };
  for (const p of eligible) {
    const ka = keyOf(p.A), kb = keyOf(p.B);
    const rivals = eligible.filter((q) => q !== p &&
      [keyOf(q.A), keyOf(q.B)].some((k) => k === ka || k === kb) && q.score < Math.max(2 * p.score, p.score + 3));
    add({
      node_tracks: [ka, kb], static: p.static, final_position: p.static ? p.st.position : p.est.at(-1).position,
      positions: p.est.map((e) => ({ t_e: e.t_e, position: p.static ? p.st.position : e.position, sigma_m: e.sigma_m, ...(!p.static ? { velocity: e.velocity } : {}) })),
      chi2_mean: p.st.chi2_mean, nis_mean: p.nisMean, onset_skew_s: p.skew, n_windows: p.obs.length,
      n_nodes: 2, low_confidence: true, ambiguous: rivals.length > 0,
      reliable: !rivals.length && p.score <= 6 && p.est.length >= o.min_track_windows,
      algorithm: 'global-proposal-assignment'
    }, p.score);
    if (!p.static) continue;
    let selected = [p.A, p.B];
    const ranges = (nr, position) => Math.hypot(position[0] - nr.node_position[0], position[1] - nr.node_position[1]);
    const span = (F) => [F.tr.windows[0].t_s, F.tr.windows.at(-1).t_s].map((t) => t - ranges(F.nr, p.st.position) / c);
    let common = [Math.max(...selected.map((F) => span(F)[0])), Math.min(...selected.map((F) => span(F)[1]))];
    if (common[0] > common[1]) continue;
    for (let ni = 0; ni < nodes.length; ni++) {
      if (selected.some((F) => F.ni === ni)) continue;
      const nr = nodes[ni];
      const predicted = Math.atan2(p.st.position[1] - nr.node_position[1], p.st.position[0] - nr.node_position[0]) * 180 / Math.PI;
      const compatible = nr.tracks.map((tr, ti) => ({ nr, ni, ti, tr, residual: rms(tr.windows.map((w) => wrap(w.az_deg - predicted))) }))
        .filter((F) => F.residual <= 3 * o.bearing_sigma_deg && span(F)[0] <= common[1] && span(F)[1] >= common[0])
        .sort((a, b) => a.residual - b.residual || a.ti - b.ti);
      if (!compatible.length) continue;
      selected.push(compatible[0]);
      common = [Math.max(common[0], span(compatible[0])[0]), Math.min(common[1], span(compatible[0])[1])];
    }
    if (selected.length < 3) continue;
    let obs = selected.flatMap((F) => F.tr.windows.map((w) => ({
      pos: F.nr.node_position, az_deg: w.az_deg, t_a: w.t_s, w: 1 / F.tr.windows.length
    })));
    let refit = solveStatic(obs, p.st.position, rad(o.bearing_sigma_deg));
    let robust = null, raySigmas = null;
    if (consensus) {
      if (!scenario) throw new Error('Experimental consensus requires nominal scenario geometry/settings');
      const rays = selected.map((F) => {
        const anchor = F.tr.windows[0].az_deg;
        const az = wrap(anchor + median(F.tr.windows.map((w) => wrap(w.az_deg - anchor))));
        const spread = rms(F.tr.windows.map((w) => wrap(w.az_deg - az)));
        const residual = median(F.tr.windows.map((w) => w.residual_s));
        const coherence = F.tr.windows.reduce((s, w) => s + w.peak_mean, 0) / F.tr.windows.length;
        const positions = micPositions(scenario.nodes[F.ni]);
        const baseline = Math.max(...positions.flatMap((p, i) => positions.slice(i + 1).map((q) => Math.hypot(...p.map((x, k) => x - q[k])))));
        return { node_id: keyOf(F), origin: F.nr.node_position, azimuth_deg: az,
          sigma_deg: Math.hypot(hardwareSigma(scenario.nodes[F.ni], scenario.settings, o.bearing_sigma_deg), spread, Math.atan2(c * residual, baseline) * 180 / Math.PI),
          reliable: coherence >= 0.5 && residual * 1e6 <= o.max_residual_us / 2 };
      });
      robust = weightedConsensus(rays, { mode: consensus, min_cross_deg: o.min_cross_deg });
      if (!robust || robust.inlier_nodes.length < 3) continue;
      selected = selected.filter((F) => robust.inlier_nodes.includes(keyOf(F)));
      obs = obs.filter((m) => selected.some((F) => F.nr.node_position === m.pos));
      raySigmas = selected.map((F) => rays.find((r) => r.node_id === keyOf(F)).sigma_deg);
      refit = { position: robust.position };
    }
    const residuals = selected.map((F) => {
      const predicted = Math.atan2(refit.position[1] - F.nr.node_position[1], refit.position[0] - F.nr.node_position[0]) * 180 / Math.PI;
      return rms(F.tr.windows.map((w) => wrap(w.az_deg - predicted)));
    });
    const chi2 = residuals.reduce((s, v, i) => s + (v / (raySigmas?.[i] ?? o.bearing_sigma_deg)) ** 2, 0) / selected.length;
    if (chi2 > o.static_chi2 || residuals.some((v, i) => v > 3 * (raySigmas?.[i] ?? o.bearing_sigma_deg))) continue;
    const positions = obs.map((m) => ({
      t_e: m.t_a - Math.hypot(refit.position[0] - m.pos[0], refit.position[1] - m.pos[1]) / c,
      position: refit.position, sigma_m: p.est.at(-1).sigma_m
    })).sort((a, b) => a.t_e - b.t_e);
    add({
      node_tracks: selected.map(keyOf), static: true, final_position: refit.position, positions,
      chi2_mean: chi2, nis_mean: chi2, onset_skew_s: p.skew, n_windows: obs.length, n_nodes: selected.length,
      low_confidence: false, ambiguous: false, reliable: true, algorithm: consensus ? `global-${consensus}-static` : 'global-multinode-static',
      ...(robust ? { consensus: robust } : {})
    }, chi2);
  }
  const candidates = [...proposals].sort(([a], [b]) => lexical(a, b)).map(([, p]) => p);
  return exactTrackAssignment(candidates);
}
