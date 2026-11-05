import { mulberry32 } from '../../packages/sim-core/src/rng.js';

function rSquared(rows, response, factors, selected) {
  const y = rows.map((r) => r[response]), mean = y.reduce((a, b) => a + b, 0) / y.length;
  const centered = y.map((v) => v - mean), total = centered.reduce((s, v) => s + v * v, 0);
  if (!(total > 0)) return null;
  const basis = [];
  for (const [name, levels] of Object.entries(factors)) {
    if (!selected.includes(name)) continue;
    for (const level of levels.slice(1)) {
      const column = rows.map((r) => Number(r[name] === level));
      const average = column.reduce((a, b) => a + b, 0) / column.length;
      const v = column.map((x) => x - average);
      for (let pass = 0; pass < 2; pass++) for (const q of basis) {
        const dot = v.reduce((s, x, i) => s + x * q[i], 0);
        for (let i = 0; i < v.length; i++) v[i] -= dot * q[i];
      }
      const norm = Math.hypot(...v);
      if (norm > 1e-10 * Math.sqrt(rows.length)) basis.push(v.map((x) => x / norm));
    }
  }
  const explained = basis.reduce((sum, q) => sum + centered.reduce((s, v, i) => s + v * q[i], 0) ** 2, 0);
  return Math.max(0, Math.min(1, explained / total));
}

export function decompose(rows, response, factors) {
  const usable = rows.filter((r) => Number.isFinite(r[response]));
  const names = Object.keys(factors);
  const missing = names.flatMap((name) => factors[name].filter((level) => !usable.some((r) => r[name] === level)).map((level) => `${name}=${level}`));
  if (missing.length || usable.length < 2) return { n: usable.length, explained: null, residual: null, shares: null, reason: `Missing support: ${missing.join(', ') || 'fewer than two responses'}` };
  const values = Array.from({ length: 1 << names.length }, (_, mask) =>
    rSquared(usable, response, factors, names.filter((_, i) => mask & (1 << i))));
  if (values.some((v) => v === null)) return { n: usable.length, explained: null, residual: null, shares: null, reason: 'Zero response variance' };
  const factorial = (n) => n < 2 ? 1 : n * factorial(n - 1);
  const shares = Object.fromEntries(names.map((name, i) => {
    let share = 0;
    for (let mask = 0; mask < values.length; mask++) if (!(mask & (1 << i))) {
      const count = names.filter((_, j) => mask & (1 << j)).length;
      const weight = factorial(count) * factorial(names.length - count - 1) / factorial(names.length);
      share += weight * (values[mask | (1 << i)] - values[mask]);
    }
    return [name, share];
  }));
  return { n: usable.length, explained: values.at(-1), residual: 1 - values.at(-1), shares, reason: null };
}

export function varianceIntervals(rows, response, factors, { samples = 500, seed = 781239 } = {}) {
  const result = decompose(rows, response, factors), seeds = [...new Set(rows.map((r) => r.seed))];
  const groups = new Map(seeds.map((s) => [s, rows.filter((r) => r.seed === s)])), rng = mulberry32(seed);
  const draws = Array.from({ length: samples }, () => decompose(
    seeds.flatMap(() => groups.get(seeds[Math.floor(rng() * seeds.length)])), response, factors));
  const interval = (read) => {
    const values = draws.map(read).filter(Number.isFinite).sort((a, b) => a - b);
    return { low: values.length ? values[Math.floor(0.025 * (values.length - 1))] : null,
      high: values.length ? values[Math.ceil(0.975 * (values.length - 1))] : null, available_draws: values.length };
  };
  return { ...result, clusters: seeds.length, bootstrap_samples: samples,
    intervals: { explained: interval((d) => d.explained), residual: interval((d) => d.residual),
      shares: Object.fromEntries(Object.keys(factors).map((name) => [name, interval((d) => d.shares?.[name])])) } };
}
