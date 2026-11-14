import test from 'node:test'
import assert from 'node:assert/strict'
import { designPipeline } from '../src/core/pipeline.js'
import { CIRCUIT_SPEC_SCHEMA } from '../src/contract/schemas.js'
import { validate } from '../src/contract/validate.js'

const spec = {
  schema: 'cir/CircuitSpec/v1',
  id: 'pipeline-gain100',
  target: 'instrumentation_amplifier',
  gain: { nominal: 100, tolerancePct: 1 },
  bandwidthHz: 10000,
  cmrrMinDb: 80,
  supply: { positiveV: 15, negativeV: -15 },
  inputRangeV: { minV: -0.01, maxV: 0.01 },
  sourceImpedanceOhm: 350,
  constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-1mhz' },
}

test('pipeline end-to-end con spec estructurado', () => {
  const result = designPipeline(spec, { monteCarloRuns: 40, seed: 7 })
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, result.spec).valid, true)
  assert.ok(['three_op_amp', 'monolithic'].includes(result.proposal.topology))
  assert.equal(result.proposal.netlist.schema, 'cir/Netlist/v1')
  assert.ok(result.metrics.gain.measured > 0)
  assert.ok(Array.isArray(result.verification.checks))
  assert.ok(result.verification.checks.length >= 5)
  assert.match(result.report.markdown, /Amplificador de instrumentación|Amplificador de instrumentacion/i)
  assert.match(result.report.schematicSvg, /<svg/)
  assert.match(result.report.bodeSvg, /<svg/)
})

test('pipeline desde texto libre y determinista', () => {
  const texto = 'necesito amplificar una galga extensometrica, ganancia 100, ancho de banda 10 kHz, alimentacion +-15 V, CMRR 80 dB'
  const a = designPipeline(texto, { monteCarloRuns: 20, seed: 11 })
  const b = designPipeline(texto, { monteCarloRuns: 20, seed: 11 })
  assert.equal(a.spec.gain.nominal, 100)
  assert.equal(a.spec.bandwidthHz, 10000)
  assert.equal(a.spec.supply.positiveV, 15)
  assert.equal(a.spec.supply.negativeV, -15)
  assert.deepEqual(
    a.proposal.resistors.map((r) => r.valueOhm),
    b.proposal.resistors.map((r) => r.valueOhm),
  )
  assert.deepEqual(a.metrics, b.metrics)
})

test('pipeline con gain 10 y gain 1000 genera propuestas distintas', () => {
  const low = designPipeline({ ...spec, id: 'g10', gain: { nominal: 10, tolerancePct: 1 } }, { monteCarloRuns: 10, seed: 1 })
  const high = designPipeline({ ...spec, id: 'g1000', gain: { nominal: 1000, tolerancePct: 1 } }, { monteCarloRuns: 10, seed: 1 })
  assert.notDeepEqual(
    low.proposal.resistors.map((r) => r.valueOhm),
    high.proposal.resistors.map((r) => r.valueOhm),
  )
})
