import { toDeg, wrapDeg, percentile } from './utils.js';

function solveSymmetric(normal, rhs) {
  const n = rhs.length;
  const a = normal.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const d = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const k = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= k * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

function invertSymmetric(normal) {
  const n = normal.length;
  const inv = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Number(i === j)));
  const a = normal.map((row) => [...row]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [inv[col], inv[pivot]] = [inv[pivot], inv[col]];
    const d = a[col][col];
    for (let j = 0; j < n; j++) {
      a[col][j] /= d;
      inv[col][j] /= d;
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const k = a[row][col];
      for (let j = 0; j < n; j++) {
        a[row][j] -= k * a[col][j];
        inv[row][j] -= k * inv[col][j];
      }
    }
  }
  return inv;
}

function residualFor(track, position) {
  const az = toDeg(Math.atan2(position[1] - track.node_position[1], position[0] - track.node_position[0]));
  return wrapDeg(track.az_deg - az);
}

function makeRows(nodeResults, fixes) {
  const byKey = new Map();
  nodeResults.forEach((node, ni) => {
    node.tracks.forEach((track, ti) => {
      byKey.set(`${ni}:${ti}`, { ni, node, track });
    });
  });
  const rows = [];
  for (const fix of fixes) {
    if (!Array.isArray(fix.node_tracks) || !fix.final_position) continue;
    for (const key of fix.node_tracks) {
      const info = byKey.get(key);
      if (!info) continue;
      rows.push({
        key,
        ni: info.ni,
        node_id: info.node.node_id,
        az_deg: info.track.windows.reduce((sum, window) => sum + window.az_deg, 0) / Math.max(1, info.track.windows.length),
        node_position: info.node.node_position,
        position: fix.final_position
      });
    }
  }
  return rows;
}

export function headingCalibration(nodeResults, fixes, options) {
  const minFixes = Math.max(1, Math.round(options.heading_self_calibration_min_fixes ?? 4));
  const minNodes = Math.max(2, Math.round(options.heading_self_calibration_min_nodes ?? 3));
  const rows = makeRows(nodeResults, fixes);
  const byNode = new Map();
  for (const row of rows) {
    const list = byNode.get(row.ni) ?? [];
    list.push(row);
    byNode.set(row.ni, list);
  }
  const active = [...byNode.entries()].filter(([, list]) => list.length >= minFixes).map(([ni]) => ni).sort((a, b) => a - b);
  if (active.length < minNodes) {
    return {
      applied: false,
      install_profile: 'surveyed',
      reason: 'insufficient_observability',
      events_used: rows.length,
      nodes_observable: active.length
    };
  }
  const anchors = active[0];
  const unknown = active.slice(1);
  const index = new Map(unknown.map((ni, i) => [ni, i]));
  const normal = Array.from({ length: unknown.length }, () => Array.from({ length: unknown.length }, () => 0));
  const rhs = Array.from({ length: unknown.length }, () => 0);
  for (const ni of active) {
    for (const row of byNode.get(ni) ?? []) {
      const residual = residualFor(row, row.position);
      if (ni === anchors) continue;
      const i = index.get(ni);
      normal[i][i] += 1;
      rhs[i] -= residual;
    }
  }
  const solution = solveSymmetric(normal, rhs);
  const inverse = invertSymmetric(normal);
  if (!solution || !inverse) {
    return {
      applied: false,
      install_profile: 'surveyed',
      reason: 'singular_system',
      events_used: rows.length,
      nodes_observable: active.length
    };
  }
  const sigmaFloor = Math.max(0.1, options.heading_self_calibration_sigma_floor_deg ?? 0.5);
  const sigmaCap = Math.max(sigmaFloor, options.heading_self_calibration_sigma_cap_deg ?? 15);
  const offsetCap = Math.max(1, options.heading_self_calibration_max_offset_deg ?? 30);
  const offsets = new Map([[anchors, 0]]);
  const sigmas = new Map([[anchors, sigmaFloor]]);
  unknown.forEach((ni, i) => {
    offsets.set(ni, Math.max(-offsetCap, Math.min(offsetCap, solution[i])));
    sigmas.set(ni, Math.max(sigmaFloor, Math.min(sigmaCap, Math.sqrt(Math.max(0, inverse[i][i])))));
  });
  const residuals = [];
  for (const row of rows) {
    const corrected = wrapDeg(residualFor(row, row.position) + (offsets.get(row.ni) ?? 0));
    residuals.push(Math.abs(corrected));
  }
  return {
    applied: true,
    install_profile: 'self_calibrated',
    events_used: rows.length,
    nodes_observable: active.length,
    residual_abs_deg: {
      p50: percentile(residuals, 0.5),
      p90: percentile(residuals, 0.9)
    },
    node_offsets: nodeResults.map((_, ni) => ({
      node_index: ni,
      offset_deg: offsets.get(ni) ?? 0,
      sigma_deg: sigmas.get(ni) ?? sigmaCap,
      events: (byNode.get(ni) ?? []).length,
      observable: offsets.has(ni)
    }))
  };
}

export function calibrationMaps(calibration, nodeCount, options) {
  const sigmaFloor = Math.max(0.1, options.heading_self_calibration_sigma_floor_deg ?? 0.5);
  const sigmaCap = Math.max(sigmaFloor, options.heading_self_calibration_sigma_cap_deg ?? 15);
  const offsets = Array.from({ length: nodeCount }, () => 0);
  const sigmas = Array.from({ length: nodeCount }, () => sigmaCap);
  if (!calibration?.applied) return { offsets, sigmas };
  for (const entry of calibration.node_offsets ?? []) {
    offsets[entry.node_index] = entry.offset_deg;
    sigmas[entry.node_index] = Math.max(sigmaFloor, Math.min(sigmaCap, entry.sigma_deg));
  }
  return { offsets, sigmas };
}
