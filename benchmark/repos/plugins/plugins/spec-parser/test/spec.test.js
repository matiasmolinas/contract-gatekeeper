import test from 'node:test'
import assert from 'node:assert/strict'
import { load } from '#runtime'
const { defaultSpec, parseRequirement } = await load('circuit.spec.parse')
const { CIRCUIT_SPEC_SCHEMA } = await load('contract.validate')
const { validate, assertValid } = await load('contract.validate')
const fullSpec = {
  schema: 'cir/CircuitSpec/v1',
  id: 'spec-completo',
  target: 'instrumentation_amplifier',
  gain: { nominal: 100, tolerancePct: 1.5 },
  bandwidthHz: 10000,
  cmrrMinDb: 80,
  supply: { positiveV: 15, negativeV: -15 },
  inputRangeV: { minV: -0.01, maxV: 0.01 },
  sourceImpedanceOhm: 350,
  constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-10mhz' },
}

test('defaultSpec es válido, completo y se devuelve por copia', () => {
  const spec = defaultSpec()
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, spec).valid, true)
  assert.equal(spec.target, 'instrumentation_amplifier')
  assert.equal(spec.gain.nominal, 100)
  assert.ok(spec.bandwidthHz > 0)
  assert.ok(spec.cmrrMinDb > 0)
  assert.equal(spec.supply.positiveV, 15)
  assert.equal(spec.supply.negativeV, -15)

  // Copia independiente: mutar una instancia no contamina la siguiente.
  spec.gain.nominal = 12345
  assert.equal(defaultSpec().gain.nominal, 100)
})

test('parseRequirement acepta un objeto completo y no pregunta nada', () => {
  const parsed = parseRequirement(fullSpec)
  assert.equal(parsed.source, 'json')
  assert.deepEqual(parsed.questions, [])
  assert.equal(parsed.spec.id, 'spec-completo')
  assert.equal(parsed.spec.gain.nominal, 100)
  assert.equal(parsed.spec.gain.tolerancePct, 1.5)
  assert.equal(parsed.spec.bandwidthHz, 10000)
  assert.equal(parsed.spec.cmrrMinDb, 80)
  assert.equal(parsed.spec.sourceImpedanceOhm, 350)
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
})

test('parseRequirement completa un objeto parcial con defaults y preguntas', () => {
  const parsed = parseRequirement({ gain: { nominal: 10 } })
  assert.equal(parsed.source, 'json')
  assert.equal(parsed.spec.gain.nominal, 10)
  assert.equal(parsed.spec.gain.tolerancePct, defaultSpec().gain.tolerancePct)
  assert.ok(parsed.questions.length >= 5, `se esperaban preguntas, recibidas ${parsed.questions.length}`)
  assert.ok(parsed.questions.some((question) => /ancho de banda/i.test(question)))
  assert.ok(parsed.questions.some((question) => /CMRR/i.test(question)))
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
})

test('parseRequirement acepta formatos laxos en el objeto (gain numérico, supply 15)', () => {
  const parsed = parseRequirement({
    gain: 50,
    bandwidth: '5 kHz',
    cmrr: 90,
    supply: 12,
    inputRange: 0.02,
    sourceImpedance: '350 Ω',
  })
  assert.equal(parsed.spec.gain.nominal, 50)
  assert.equal(parsed.spec.bandwidthHz, 5000)
  assert.equal(parsed.spec.cmrrMinDb, 90)
  assert.deepEqual(parsed.spec.supply, { positiveV: 12, negativeV: -12 })
  assert.deepEqual(parsed.spec.inputRangeV, { minV: -0.02, maxV: 0.02 })
  assert.equal(parsed.spec.sourceImpedanceOhm, 350)
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
})

test('parseRequirement descarta claves desconocidas y respeta el esquema', () => {
  const parsed = parseRequirement({ ...fullSpec, campoRaro: 42, constraints: { ...fullSpec.constraints, extra: true } })
  assert.equal(Object.hasOwn(parsed.spec, 'campoRaro'), false)
  assert.equal(Object.hasOwn(parsed.spec.constraints, 'extra'), false)
  assert.doesNotThrow(() => assertValid(CIRCUIT_SPEC_SCHEMA, parsed.spec, 'spec'))
})

test('parseRequirement interpreta texto en español (caso galga del anexo)', () => {
  const texto =
    'necesito amplificar la señal de una galga extensométrica, gain 100, ancho de banda ≥10 kHz, ' +
    'alimentación ±15 V, error de ganancia <1 %'
  const parsed = parseRequirement(texto)
  assert.equal(parsed.source, 'text')
  assert.equal(parsed.spec.gain.nominal, 100)
  assert.equal(parsed.spec.gain.tolerancePct, 1)
  assert.equal(parsed.spec.bandwidthHz, 10000)
  assert.equal(parsed.spec.supply.positiveV, 15)
  assert.equal(parsed.spec.supply.negativeV, -15)
  assert.equal(parsed.spec.sourceImpedanceOhm, 350) // puente de galga típico
  // El texto no dice CMRR ni rango de entrada: se completan y se pregunta.
  assert.ok(parsed.questions.some((question) => /CMRR/i.test(question)))
  assert.ok(parsed.questions.some((question) => /rango/i.test(question)))
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
})

test('parseRequirement interpreta texto en inglés con todos los datos', () => {
  const texto =
    'strain gauge front-end: gain 50, bandwidth 5 kHz, CMRR 90 dB, supply ±12 V, ' +
    'input range ±20 mV, source impedance 350 ohm'
  const parsed = parseRequirement(texto)
  assert.equal(parsed.spec.gain.nominal, 50)
  assert.equal(parsed.spec.bandwidthHz, 5000)
  assert.equal(parsed.spec.cmrrMinDb, 90)
  assert.deepEqual(parsed.spec.supply, { positiveV: 12, negativeV: -12 })
  assert.deepEqual(parsed.spec.inputRangeV, { minV: -0.02, maxV: 0.02 })
  assert.equal(parsed.spec.sourceImpedanceOhm, 350)
  assert.deepEqual(parsed.questions, [])
})

test('parseRequirement con texto sin datos devuelve defaults y preguntas', () => {
  const parsed = parseRequirement('necesito un amplificador de instrumentación para un sensor')
  assert.equal(parsed.source, 'text')
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
  assert.ok(parsed.questions.length >= 5)
  assert.equal(parsed.spec.gain.nominal, defaultSpec().gain.nominal)
})

test('parseRequirement rechaza entradas que no son objeto ni texto', () => {
  for (const invalid of [undefined, null, 42, [], true]) {
    assert.throws(() => parseRequirement(invalid), TypeError)
  }
})
