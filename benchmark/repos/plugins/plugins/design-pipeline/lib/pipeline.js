/**
 * Pipeline end-to-end del piloto: spec -> sintesis -> simulacion -> verificacion -> reporte.
 */
import { lazy } from '#runtime'
const parseRequirement = lazy('circuit.spec.parse', 'parseRequirement')
const designIa = lazy('circuit.ia.synthesize', 'designIa')
const evaluateProposal = lazy('circuit.ia.synthesize', 'evaluateProposal')
const verifyDesign = lazy('circuit.design.verify', 'verifyDesign')
const renderMarkdown = lazy('circuit.report.render', 'renderMarkdown')
const renderSchematicSvg = lazy('circuit.report.render', 'renderSchematicSvg')
const renderBodeSvg = lazy('circuit.report.render', 'renderBodeSvg')
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
