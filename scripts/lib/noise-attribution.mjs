const squaredDistance = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);

function solve(matrix, rhs) {
  const a = matrix.map((row, i) => [...row, rhs[i]]), n = a.length;
  for (let j = 0; j < n; j++) {
    let pivot = j;
    for (let i = j + 1; i < n; i++) if (Math.abs(a[i][j]) > Math.abs(a[pivot][j])) pivot = i;
    if (Math.abs(a[pivot][j]) < 1e-8) return null;
    [a[j], a[pivot]] = [a[pivot], a[j]];
    const scale = a[j][j];
    for (let k = j; k <= n; k++) a[j][k] /= scale;
    for (let i = 0; i < n; i++) if (i !== j) {
      const factor = a[i][j];
      for (let k = j; k <= n; k++) a[i][k] -= factor * a[j][k];
    }
  }
  return a.map((row) => row[n]);
}

export function estimateNoiseShares({ positions, pois, powers, receptor }) {
  const point = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  if (!Array.isArray(positions) || !positions.length || !positions.every(point) || !Array.isArray(pois) ||
      pois.length !== 3 || !pois.every(point) || !point(receptor) || !Array.isArray(powers) ||
      powers.length !== positions.length || powers.some((p) => !Number.isFinite(p) || p < 0)) throw new Error('Invalid attribution geometry or observed powers');
  if (positions.some((p) => pois.some((q) => !squaredDistance(p, q))) || pois.some((p) => !squaredDistance(p, receptor))) throw new Error('Point-source transfer is undefined at zero distance');
  const unavailable = (reason) => ({ status: 'unavailable', reason, shares: null, powers_at_1m: null, residual_squared: null });
  if (positions.length < pois.length) return unavailable('Fewer independent node levels than unknown POI powers');
  const transfer = positions.map((p) => pois.map((q) => 1 / squaredDistance(p, q)));
  const norms = pois.map((_, j) => Math.hypot(...transfer.map((row) => row[j])));
  const a = transfer.map((row) => row.map((x, j) => x / norms[j]));
  const gram = pois.map((_, j) => pois.map((__, k) => a.reduce((s, row) => s + row[j] * row[k], 0)));
  if (!solve(gram, [0, 0, 0])) return unavailable('Rank-deficient or numerically weak transfer geometry');
  const rhs = pois.map((_, j) => a.reduce((s, row, i) => s + row[j] * powers[i], 0));
  let best = { values: [0, 0, 0], loss: powers.reduce((s, x) => s + x * x, 0) };
  for (let mask = 1; mask < 8; mask++) {
    const active = [0, 1, 2].filter((j) => mask & (1 << j));
    const values = solve(active.map((j) => active.map((k) => gram[j][k])), active.map((j) => rhs[j]));
    if (!values || values.some((v) => v < -1e-12 * Math.max(...rhs.map(Math.abs), 1e-12))) continue;
    const full = [0, 0, 0];
    active.forEach((j, k) => full[j] = Math.max(0, values[k]));
    const loss = a.reduce((s, row, i) => s + (row.reduce((t, v, j) => t + v * full[j], 0) - powers[i]) ** 2, 0);
    if (loss < best.loss) best = { values: full, loss };
  }
  const fitted = best.values.map((v, j) => v / norms[j]);
  const receptorPowers = fitted.map((v, j) => v / squaredDistance(receptor, pois[j]));
  const total = receptorPowers.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !Number.isFinite(total)) return unavailable('No finite positive attributed signal');
  return { status: 'estimated', reason: null, shares: receptorPowers.map((v) => v / total),
    powers_at_1m: fitted, residual_squared: best.loss };
}
