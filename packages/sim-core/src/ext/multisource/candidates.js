import { windowTdoas } from '../../localise.js'
import { micPairs } from '../../mics.js'
import { distance } from '../../physics.js'
import { rfft } from '../../dsp.js'

const toDeg = (r) => (r * 180) / Math.PI
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180
const EPS = 1e-12

function spacingAndAliasLimit(positions, c) {
  let minD = Infinity
  const pairs = micPairs(positions.length)
  for (const [i, j] of pairs) minD = Math.min(minD, distance(positions[i], positions[j]))
  return { spacing_m: minD, aliasing_limit_hz: c / (2 * Math.max(minD, 1e-3)) }
}

function solveAzimuthFromTdoa(positions, tdoaRows, c) {
  const pairs = micPairs(positions.length)
  let a = 0
  let b = 0
  let d = 0
  let p = 0
  let q = 0
  const rows = pairs.map(([i, j], k) => {
    const dx = positions[j][0] - positions[i][0]
    const dy = positions[j][1] - positions[i][1]
    const r = c * tdoaRows[k].tdoa_s
    a += dx * dx
    b += dx * dy
    d += dy * dy
    p += dx * r
    q += dy * r
    return [dx, dy, r]
  })
  const det = a * d - b * b
  if (Math.abs(det) < EPS) return null
  const hx = (d * p - b * q) / det
  const hy = (a * q - b * p) / det
  let sq = 0
  for (const [dx, dy, r] of rows) sq += ((dx * hx + dy * hy - r) / c) ** 2
  return {
    az_deg: toDeg(Math.atan2(hy, hx)),
    residual_s: Math.sqrt(sq / Math.max(1, rows.length)),
    peak_min: Math.min(...tdoaRows.map((x) => x.peak_normalized)),
    peak_mean: tdoaRows.reduce((s, x) => s + x.peak_normalized, 0) / Math.max(1, tdoaRows.length)
  }
}

function estimateWindowBearing(rn, startSample, endSample, { fs, c, band }) {
  const pairs = micPairs(rn.mic_positions.length)
  const spacing = Math.max(...pairs.map(([i, j]) => distance(rn.mic_positions[i], rn.mic_positions[j])))
  const t = windowTdoas(rn.mics, startSample, endSample, { fs, band, maxLagS: spacing / c })
  return solveAzimuthFromTdoa(rn.mic_positions, t, c)
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let num = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i++) {
    num += a[i] * b[i]
    aa += a[i] * a[i]
    bb += b[i] * b[i]
  }
  return aa > 0 && bb > 0 ? num / Math.sqrt(aa * bb) : 0
}

function spectralEnvelope(signal, bins) {
  const n = 2 ** Math.ceil(Math.log2(Math.max(16, signal.length)))
  const x = new Float64Array(n)
  x.set(signal.slice(0, Math.min(signal.length, n)))
  const { re, im } = rfft(x, n)
  const mags = new Float64Array(re.length)
  for (let i = 0; i < re.length; i++) mags[i] = Math.hypot(re[i], im[i]) + EPS
  const out = new Float64Array(bins)
  for (let b = 0; b < bins; b++) {
    const i0 = Math.floor((b * mags.length) / bins)
    const i1 = Math.max(i0 + 1, Math.floor(((b + 1) * mags.length) / bins))
    let s = 0
    for (let i = i0; i < i1; i++) s += Math.log(mags[i])
    out[b] = s / (i1 - i0)
  }
  return out
}

function energyEnvelope(signal, frame) {
  const out = []
  for (let i = 0; i + frame <= signal.length; i += frame) {
    let s = 0
    for (let j = i; j < i + frame; j++) s += signal[j] * signal[j]
    out.push(Math.log(Math.max(EPS, s / frame)))
  }
  return out
}

function mergeHypotheses(hypotheses, mergeDeg, maxHypotheses) {
  const sorted = [...hypotheses].sort((a, b) => b.confidence - a.confidence)
  const out = []
  for (const h of sorted) {
    const hit = out.find((x) => Math.abs(wrapDeg(x.az_deg - h.az_deg)) <= mergeDeg)
    if (hit) {
      const w = hit.confidence + h.confidence
      hit.az_deg = (hit.az_deg * hit.confidence + h.az_deg * h.confidence) / Math.max(EPS, w)
      hit.confidence = Math.max(hit.confidence, h.confidence)
      hit.members.push(h)
      continue
    }
    out.push({ ...h, members: [h] })
    if (out.length >= maxHypotheses) break
  }
  return out
}

export function multiPeakCandidates(node, rn, nodeResult, context, config) {
  const winMs = context.options.window_ms
  const radius = Math.max(0.003, (winMs / 1000) / 4)
  const offsets = [-radius, -radius / 2, 0, radius / 2, radius]
  const hyps = []
  for (const w of nodeResult.windows) {
    const perWindow = []
    for (const off of offsets) {
      const start = Math.max(0, w.t_s - winMs / 2000 + off)
      const end = start + winMs / 1000
      const b = estimateWindowBearing(rn, Math.round(start * context.fs), Math.round(end * context.fs), context)
      if (!b) continue
      perWindow.push({
        node_id: node.id,
        method: 'multi_peak',
        t_s: w.t_s,
        az_deg: b.az_deg,
        confidence: Math.max(0, Math.min(1, b.peak_mean / Math.max(EPS, 1 + b.residual_s * 1e5))),
        residual_s: b.residual_s,
        peak_mean: b.peak_mean
      })
    }
    hyps.push(...mergeHypotheses(perWindow, config.azimuth_merge_deg, config.max_hypotheses))
  }
  return hyps
}

export function tfHistogramCandidates(node, rn, nodeResult, context, config) {
  const hyps = []
  const frameS = Math.max(0.004, context.options.hop_ms / 1000)
  for (const tr of nodeResult.tracks) {
    const perTrack = []
    for (const w of tr.windows) {
      const frameHyps = []
      for (let s = w.t_s - frameS; s <= w.t_s + frameS; s += frameS / 2) {
        const start = Math.max(0, s - frameS / 2)
        const end = start + frameS
        const b = estimateWindowBearing(rn, Math.round(start * context.fs), Math.round(end * context.fs), context)
        if (!b) continue
        frameHyps.push({
          node_id: node.id,
          method: 'tf_histogram',
          t_s: w.t_s,
          az_deg: b.az_deg,
          confidence: Math.max(0, Math.min(1, b.peak_min)),
          residual_s: b.residual_s,
          peak_mean: b.peak_mean
        })
      }
      perTrack.push(...mergeHypotheses(frameHyps, config.azimuth_merge_deg, config.max_hypotheses))
    }
    hyps.push(...perTrack)
  }
  return hyps
}

export function harmonicCombCandidates(node, rn, nodeResult, context, config) {
  const out = []
  const { aliasing_limit_hz } = spacingAndAliasLimit(rn.mic_positions, context.c)
  const nyquist = context.fs / 2
  for (const w of nodeResult.windows) {
    const a = Math.max(0, Math.round((w.t_s - context.options.window_ms / 2000) * context.fs))
    const b = Math.min(rn.mics[0].length, a + Math.round((context.options.window_ms / 1000) * context.fs))
    if (b - a < 128) continue
    const segment = rn.mics[0].slice(a, b)
    const n = 2 ** Math.ceil(Math.log2(segment.length))
    const x = new Float64Array(n)
    x.set(segment)
    const { re, im } = rfft(x, n)
    const mag = new Float64Array(re.length)
    for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i], im[i])
    const peak = Math.max(...mag)
    const candidates = []
    for (let f0 = config.harmonic_min_hz; f0 <= config.harmonic_max_hz; f0 += 5) {
      let score = 0
      const lines = []
      for (let h = 1; h <= config.harmonic_lines_max; h++) {
        const f = f0 * h
        if (f >= nyquist) break
        const k = Math.round((f * n) / context.fs)
        const e = mag[k] ?? 0
        if (e < peak * 0.08) continue
        score += e / h
        lines.push(f)
      }
      if (lines.length >= 3) candidates.push({ f0_hz: f0, score, lines_hz: lines })
    }
    candidates.sort((x0, x1) => x1.score - x0.score)
    const combs = candidates.filter((cand) => !candidates.some((other) => other !== cand && other.score > cand.score && Math.abs(other.f0_hz - cand.f0_hz) < 12)).slice(0, config.max_hypotheses)
    for (const comb of combs) {
      const low = Math.max(60, comb.f0_hz * 0.8)
      const high = Math.min(aliasing_limit_hz, comb.lines_hz.at(-1) + comb.f0_hz * 0.5)
      const bearing = estimateWindowBearing(rn, a, b, { ...context, band: [low, Math.max(low + 20, high)] })
      if (!bearing) continue
      const aliasingLines = comb.lines_hz.filter((f) => f > aliasing_limit_hz).length
      out.push({
        node_id: node.id,
        method: 'harmonic_comb',
        t_s: w.t_s,
        az_deg: bearing.az_deg,
        confidence: Math.max(0, Math.min(1, comb.score / Math.max(EPS, peak * 4))),
        residual_s: bearing.residual_s,
        f0_hz: comb.f0_hz,
        lines_hz: comb.lines_hz,
        lines_above_aliasing: aliasingLines,
        aliasing_limit_hz
      })
    }
  }
  return out
}

export function candidateFeatures(rn, h, fs, options, bins) {
  const half = options.window_ms / 2000
  const start = Math.max(0, Math.round((h.t_s - half) * fs))
  const end = Math.min(rn.mics[0].length, Math.round((h.t_s + half) * fs))
  const segment = rn.mics[0].slice(start, end)
  const spectral = spectralEnvelope(segment, bins)
  const temporal = energyEnvelope(segment, Math.max(32, Math.round(fs * 0.01)))
  return { spectral, temporal }
}

export function similarity(a, b) {
  return 0.65 * cosine(a.spectral, b.spectral) + 0.35 * cosine(a.temporal, b.temporal)
}
