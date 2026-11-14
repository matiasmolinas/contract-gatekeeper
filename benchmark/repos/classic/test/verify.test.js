import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyDesign } from '../src/core/verify.js'
import { VERIFICATION_SCHEMA } from '../src/contract/schemas.js'
import { validate } from '../src/contract/validate.js'

const spec = {
  schema: 'cir/CircuitSpec/v1',
  id: 'verify-test',
  target: 'instrumentation_amplifier',
  gain: { nominal: 100, tolerancePct: 1 },
  bandwidthHz: 10000,
  cmrrMinDb: 80,
  supply: { positiveV: 15, negativeV: -15 },
  inputRangeV: { minV: -0.01, maxV: 0.01 },
  sourceImpedanceOhm: 350,
  constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-10mhz' },
}

/** @param {Partial<Record<string, number>>} overrides */
function makeMetrics(overrides = {}) {
  const gain = {
    nominal: 100,
    measured: 100.2,
    errorPct: 0.2,
    mcP95AbsPct: 0.3,
    ...overrides.gain,
  }
  return {
    gain,
    bandwidthHz: overrides.bandwidthHz ?? 20000,
    cmrrDb: overrides.cmrrDb ?? 90,
    cmrrMinDb: overrides.cmrrMinDb ?? 80,
  }
}

function checkById(report, id) {
  return report.checks.find((item) => item.id === id)
}

test('verifyDesign aprueba un diseño que cumple todos los requisitos', () => {
  const report = verifyDesign(spec, makeMetrics())
  assert.equal(validate(VERIFICATION_SCHEMA, report).valid, true)
  assert.equal(report.pass, true)
  assert.deepEqual(
    report.checks.map((item) => item.id),
    ['GAIN_NOMINAL', 'MONTE_CARLO_GAIN', 'GAIN_TOLERANCE', 'BANDWIDTH', 'CMRR', 'SIMULATION_SANE'],
  )
  for (const item of report.checks) {
    assert.equal(item.pass, true, `el check ${item.id} debería pasar`)
    assert.ok(typeof item.description === 'string' && item.description.length > 0)
    assert.ok(item.required !== undefined)
    assert.ok(item.actual !== undefined)
    assert.ok(item.margin !== undefined)
  }
})

test('verifyDesign falla GAIN_NOMINAL y GAIN_TOLERANCE si la ganancia se sale de tolerancia', () => {
  const report = verifyDesign(spec, makeMetrics({ gain: { measured: 102, errorPct: 2 } }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'GAIN_NOMINAL').pass, false)
  assert.equal(checkById(report, 'GAIN_TOLERANCE').pass, false)
  assert.equal(checkById(report, 'SIMULATION_SANE').pass, true)
})

test('verifyDesign falla MONTE_CARLO_GAIN si la dispersión p95 supera la tolerancia', () => {
  const report = verifyDesign(spec, makeMetrics({ gain: { mcP95AbsPct: 2 } }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'MONTE_CARLO_GAIN').pass, false)
  assert.equal(checkById(report, 'GAIN_NOMINAL').pass, true)
  assert.equal(checkById(report, 'GAIN_TOLERANCE').pass, false)
})

test('verifyDesign falla BANDWIDTH si el ancho de banda simulado es menor al requerido', () => {
  const report = verifyDesign(spec, makeMetrics({ bandwidthHz: 5000 }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'BANDWIDTH').pass, false)
  assert.equal(report.warnings.some((warning) => /Ancho de banda/i.test(warning)), true)
})

test('verifyDesign falla CMRR si no alcanza el mínimo requerido', () => {
  const report = verifyDesign(spec, makeMetrics({ cmrrDb: 70 }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'CMRR').pass, false)
})

test('verifyDesign falla SIMULATION_SANE con métricas no finitas', () => {
  const report = verifyDesign(spec, makeMetrics({ gain: { measured: Number.NaN, errorPct: Number.NaN } }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'SIMULATION_SANE').pass, false)
  assert.equal(validate(VERIFICATION_SCHEMA, report).valid, true)
})

test('verifyDesign reporta pass global solo si todos los checks pasan', () => {
  const report = verifyDesign(spec, makeMetrics())
  assert.equal(report.pass, report.checks.every((item) => item.pass === true))
  const failed = verifyDesign(spec, makeMetrics({ gain: { measured: 120, errorPct: 20 } }))
  assert.equal(failed.pass, false)
  assert.ok(failed.warnings.length > 0)
  assert.equal(validate(VERIFICATION_SCHEMA, failed).valid, true)
})

test('verifyDesign advierte cuando el CMRR es el del modelo ideal', () => {
  const report = verifyDesign(spec, makeMetrics({ cmrrDb: 200 }))
  assert.equal(report.pass, true)
  assert.equal(report.warnings.some((warning) => /CMRR/i.test(warning)), true)
})
