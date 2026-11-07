import { mulberry32 } from '../../rng.js'

const TWO_PI = 2 * Math.PI

function tapered(value, i, n, edge) {
  const inEdge = Math.min(1, i / edge, (n - 1 - i) / edge)
  return value * inEdge
}

export function synthRotorModel({ sampleRate, durationS, bladeCount, rpm, harmonicCount = 8, amDepth = 0.2, jitterPct = 0.03, seed = 1 }) {
  const n = Math.max(1, Math.round(sampleRate * durationS))
  const out = new Float32Array(n)
  const rng = mulberry32(seed)
  const bpf = Math.max(20, (bladeCount * rpm) / 60)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const am = 1 + amDepth * Math.sin(TWO_PI * 0.7 * t)
    let v = 0
    for (let h = 1; h <= harmonicCount; h++) {
      const jitter = 1 + (rng() * 2 - 1) * jitterPct
      const f = bpf * h * jitter
      v += (Math.sin(TWO_PI * f * t) / h) * am
    }
    out[i] = tapered(v, i, n, Math.max(1, Math.round(0.02 * sampleRate)))
  }
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak
  return out
}

export function sourceSignalForRender({ source, clips, settings, sampleRate }) {
  const clip = clips.get(source.clip)
  if (!settings.ms_rotor_model_enabled || !source.rotor_model) return clip
  const model = source.rotor_model
  const durationS = Number.isFinite(model.duration_s) ? model.duration_s : (clip?.length ?? sampleRate) / sampleRate
  return synthRotorModel({
    sampleRate,
    durationS,
    bladeCount: Number.isFinite(model.blades) ? model.blades : 2,
    rpm: Number.isFinite(model.rpm) ? model.rpm : 3600,
    harmonicCount: Number.isFinite(model.harmonics) ? model.harmonics : 8,
    amDepth: Number.isFinite(model.am_depth) ? model.am_depth : 0.2,
    jitterPct: Number.isFinite(model.jitter_pct) ? model.jitter_pct : 0.03,
    seed: Number.isFinite(model.seed) ? model.seed : 1
  })
}
