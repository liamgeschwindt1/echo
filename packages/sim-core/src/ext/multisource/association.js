import { candidateFeatures, similarity } from './candidates.js'

const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180

function intersect2(pa, azA, pb, azB, minCrossDeg) {
  const rad = (d) => (d * Math.PI) / 180
  const da = [Math.cos(rad(azA)), Math.sin(rad(azA))]
  const db = [Math.cos(rad(azB)), Math.sin(rad(azB))]
  const cross = Math.abs(wrapDeg(azA - azB))
  if (Math.min(cross, 180 - cross) < minCrossDeg) return null
  const det = da[0] * -db[1] - da[1] * -db[0]
  if (Math.abs(det) < 1e-9) return null
  const rx = pb[0] - pa[0]
  const ry = pb[1] - pa[1]
  const s = (rx * -db[1] - ry * -db[0]) / det
  const u = (da[0] * ry - da[1] * rx) / det
  if (s <= 0 || u <= 0) return null
  return [pa[0] + s * da[0], pa[1] + s * da[1]]
}

function ghostConsistency(group, scenarioNodes) {
  const intersections = []
  for (let i = 0; i < group.members.length; i++) {
    for (let j = i + 1; j < group.members.length; j++) {
      const a = group.members[i]
      const b = group.members[j]
      const pa = scenarioNodes[a.node_index].position
      const pb = scenarioNodes[b.node_index].position
      const p = intersect2(pa, a.az_deg, pb, b.az_deg, 8)
      if (p) intersections.push(p)
    }
  }
  if (intersections.length < 2) return { accepted: false, ghost_spread_m: null }
  const cx = intersections.reduce((s, p) => s + p[0], 0) / intersections.length
  const cy = intersections.reduce((s, p) => s + p[1], 0) / intersections.length
  const spread = Math.sqrt(intersections.reduce((s, p) => s + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / intersections.length)
  return { accepted: spread <= 25, ghost_spread_m: spread }
}

function labelPriorWeight(a, b, cfg, scenario) {
  if (cfg.label_assist_mode === 'off') return 1
  const labels = scenario.sources.map((s) => (Array.isArray(s.labels) ? s.labels : []))
  if (!labels.length || labels.every((x) => !x.length)) return 1
  if (cfg.label_assist_mode === 'oracle') return 1.08
  if (cfg.label_assist_mode === 'injected') return 0.98
  return 1
}

export function associateAcrossNodes({ scenario, rendered, context, config, hypothesesByNode }) {
  const flat = []
  for (const [ni, list] of hypothesesByNode.entries()) {
    const rn = rendered.nodes[ni]
    for (const h of list) {
      flat.push({ ...h, node_index: ni, features: candidateFeatures(rn, h, context.fs, context.options, config.spectral_bins) })
    }
  }
  flat.sort((a, b) => b.confidence - a.confidence)
  const groups = []
  const used = new Set()
  for (const seed of flat) {
    const key = `${seed.node_index}:${seed.t_s}:${seed.az_deg}:${seed.method}`
    if (used.has(key)) continue
    const members = [seed]
    for (const cand of flat) {
      if (cand.node_index === seed.node_index) continue
      if (members.some((m) => m.node_index === cand.node_index)) continue
      if (Math.abs(cand.t_s - seed.t_s) > config.time_gate_s) continue
      const sim = similarity(seed.features, cand.features) * labelPriorWeight(seed, cand, config, scenario)
      if (sim < 0.4) continue
      if (Math.abs(wrapDeg(cand.az_deg - seed.az_deg)) > 120) continue
      members.push({ ...cand, similarity: sim })
    }
    if (members.length < 3) continue
    const confidence = members.reduce((s, m) => s + m.confidence, 0) / members.length
    const group = { source_time_s: seed.t_s, confidence, members }
    const ghost = ghostConsistency(group, scenario.nodes)
    groups.push({ ...group, ...ghost })
    if (ghost.accepted) for (const m of members) used.add(`${m.node_index}:${m.t_s}:${m.az_deg}:${m.method}`)
  }
  return groups
}
