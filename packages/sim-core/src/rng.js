export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Independent stream per (scenario seed, node, mic, kind).
export function streamFor(seed, ...parts) {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (const p of parts) h = Math.imul(h ^ (p >>> 0), 0x85ebca6b) ^ (h >>> 13);
  return mulberry32(h);
}

export function gaussian(rng) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function whiteNoise(rng, n, rms) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = gaussian(rng) * rms;
  return out;
}

// Paul Kellet's pink filter, rescaled to the requested rms.
export function pinkNoise(rng, n, rms) {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const w = gaussian(rng);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    out[i] = v;
    sum += v * v;
  }
  const k = rms / (Math.sqrt(sum / n) || 1);
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}
