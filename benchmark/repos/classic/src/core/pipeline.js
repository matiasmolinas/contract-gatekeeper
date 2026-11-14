/**
 * Pipeline end-to-end del piloto: spec -> sintesis -> simulacion -> verificacion -> reporte.
 */
import { parseRequirement } from './spec.js'
import { designIa, evaluateProposal } from './ia.js'
import { verifyDesign } from './verify.js'
import { renderMarkdown, renderSchematicSvg, renderBodeSvg } from './report.js'

/**
 * @param {object|string} input spec estructurado o texto libre
 * @param {{ frequencies?: number[], monteCarloRuns?: number, seed?: number }} [options]
 */
export function designPipeline(input, options = {}) {
  const parsed = parseRequirement(input)
  const { spec, questions } = parsed
  const proposal = designIa(spec)
  const { dc, ac, metrics } = evaluateProposal(spec, proposal, options)
  const verification = verifyDesign(spec, metrics)
  const result = { spec, proposal, dc, ac, metrics, verification, questions }
  result.report = {
    markdown: renderMarkdown(result),
    schematicSvg: renderSchematicSvg(proposal),
    bodeSvg: renderBodeSvg(ac, { outNode: 'out' }),
  }
  return result
}
