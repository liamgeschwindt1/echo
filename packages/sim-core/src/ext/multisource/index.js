import { multisourceConfig } from './options.js'
import { associateAcrossNodes } from './association.js'
import { harmonicCombCandidates, multiPeakCandidates, tfHistogramCandidates } from './candidates.js'

const byConfidence = (a, b) => b.confidence - a.confidence

function candidatesForMode(mode, node, rn, nodeResult, context, config) {
  if (mode === 'multi_peak') return multiPeakCandidates(node, rn, nodeResult, context, config).sort(byConfidence)
  if (mode === 'tf_histogram') return tfHistogramCandidates(node, rn, nodeResult, context, config).sort(byConfidence)
  if (mode === 'harmonic_comb') return harmonicCombCandidates(node, rn, nodeResult, context, config).sort(byConfidence)
  return []
}

export function analyseMultisourceExtensions({ scenario, rendered, nodes, context }) {
  const config = multisourceConfig(scenario.settings)
  if (!config.enabled) return null
  const hypothesesByNode = new Map()
  const summaries = []
  scenario.nodes.forEach((node, ni) => {
    const hypotheses = candidatesForMode(config.candidate_mode, node, rendered.nodes[ni], nodes[ni], context, config)
    hypothesesByNode.set(ni, hypotheses)
    summaries.push({
      node_id: node.id,
      candidate_count: hypotheses.length,
      methods: [...new Set(hypotheses.map((h) => h.method))]
    })
  })
  const associations = config.association_mode === 'spectral'
    ? associateAcrossNodes({ scenario, rendered, context, config, hypothesesByNode })
    : []
  return {
    config,
    node_summaries: summaries,
    candidates: Object.fromEntries([...hypothesesByNode.entries()].map(([ni, list]) => [scenario.nodes[ni].id, list])),
    associations,
    notes: [
      'Experimental multisource candidates and associations. Opt-in only; fusion core remains unchanged.',
      'Label-assisted mode is association-only and uses simulator metadata priors (oracle or injected-error stand-in).'
    ]
  }
}
