import test from 'node:test'
import assert from 'node:assert/strict'
import { designIa, buildIaNetlist, evaluateProposal } from '../src/core/ia.js'
import { nearestE96 } from '../src/core/e96.js'
import { validateNetlist } from '../src/core/mna.js'
import { CIRCUIT_SPEC_SCHEMA, DESIGN_PROPOSAL_SCHEMA, NETLIST_SCHEMA } from '../src/contract/schemas.js'
import { validate } from '../src/contract/validate.js'

/** Spec base para los tests, con overrides de primer nivel. */
function baseSpec(overrides = {}) {
  return {
    schema: 'cir/CircuitSpec/v1',
    id: 'test-ia',
    target: 'instrumentation_amplifier',
    gain: { nominal: 100, tolerancePct: 1 },
    bandwidthHz: 10000,
    cmrrMinDb: 80,
    supply: { positiveV: 15, negativeV: -15 },
    inputRangeV: { minV: -0.01, maxV: 0.01 },
    sourceImpedanceOhm: 350,
    constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-10mhz' },
    ...overrides,
  }
}

/** Verifica que un valor sea exactamente un valor comercial E96. */
function assertE96(valueOhm, label) {
  const nearest = nearestE96(valueOhm)
  assert.equal(nearest.valueOhm, valueOhm, `${label} = ${valueOhm} no es un valor E96`)
}

test('designIa(gain 100) elige 3 op-amps con error de ganancia < 1 %', () => {
  const spec = baseSpec()
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, spec).valid, true)
  const proposal = designIa(spec)
  assert.equal(validate(DESIGN_PROPOSAL_SCHEMA, proposal).valid, true)
  assert.equal(proposal.topology, 'three_op_amp')
  assert.equal(proposal.specId, 'test-ia')
  assert.ok(Math.abs(proposal.expected.gainErrorPct) < 1)
  assert.ok(Math.abs(proposal.expected.gain - 100) < 1)

  const byName = new Map(proposal.resistors.map((resistor) => [resistor.name, resistor]))
  for (const name of ['R1', 'Rg', 'R2', 'R3']) {
    assert.ok(byName.has(name), `falta la resistencia ${name}`)
    assertE96(byName.get(name).valueOhm, name)
    assert.equal(byName.get(name).series, 'E96')
  }
  assert.equal(byName.get('R2').valueOhm, 10000)
  assert.equal(byName.get('R3').valueOhm, 10000)
  assert.equal(proposal.opAmps.length, 3)
  for (const opAmp of proposal.opAmps) {
    assert.ok(opAmp.gain > 1)
    assert.ok(opAmp.poleHz > 0)
  }
})

test('buildIaNetlist(3 op-amps) produce un netlist válido con los nodos del contrato', () => {
  const proposal = designIa(baseSpec())
  const netlist = buildIaNetlist(proposal)
  assert.equal(validate(NETLIST_SCHEMA, netlist).valid, true)
  assert.deepEqual(validateNetlist(netlist), { ok: true, errors: [] })
  assert.deepEqual(netlist.nodes, ['in+', 'in-', 'a_fb', 'b_fb', 'a', 'b', 'n', 'p', 'out', '0'])

  const opAmps = netlist.elements.filter((element) => element.type === 'OPAMP')
  assert.equal(opAmps.length, 3)
  assert.deepEqual(
    opAmps.map((opAmp) => [opAmp.inP, opAmp.inN, opAmp.out]),
    [
      ['in+', 'a_fb', 'a'],
      ['in-', 'b_fb', 'b'],
      ['p', 'n', 'out'],
    ],
  )
  // El netlist no trae fuentes: las agrega measure.js al medir.
  assert.equal(netlist.elements.some((element) => element.type === 'V'), false)
  // Nombres únicos y valores positivos.
  const names = netlist.elements.map((element) => element.name)
  assert.equal(new Set(names).size, names.length)
})

test('evaluateProposal devuelve DC, AC logarítmico 1 Hz–10 MHz y métricas coherentes', () => {
  const spec = baseSpec()
  const proposal = designIa(spec)
  const result = evaluateProposal(spec, proposal, { monteCarloRuns: 20, seed: 7 })

  assert.equal(result.dc.schema, 'cir/DcResult/v1')
  assert.equal(result.ac.schema, 'cir/AcResult/v1')
  assert.ok(result.ac.points.length >= 60, `puntos AC: ${result.ac.points.length}`)
  const first = result.ac.points[0]
  const last = result.ac.points[result.ac.points.length - 1]
  assert.ok(Math.abs(first.fHz - 1) < 1e-9)
  assert.ok(Math.abs(last.fHz - 10e6) < 1e-3)
  for (let index = 1; index < result.ac.points.length; index += 1) {
    assert.ok(result.ac.points[index].fHz > result.ac.points[index - 1].fHz)
  }
  assert.ok(result.ac.points[0].nodeVoltages['in+'])
  assert.ok(result.ac.points[0].nodeVoltages['out'])

  const { metrics } = result
  assert.equal(metrics.gain.nominal, 100)
  assert.ok(Math.abs(metrics.gain.measured - 100) / 100 < 0.01)
  assert.ok(Math.abs(metrics.gain.errorPct) < 1)
  assert.ok(Number.isFinite(metrics.gain.mcP95AbsPct) && metrics.gain.mcP95AbsPct >= 0)
  assert.ok(Number.isFinite(metrics.bandwidthHz) && metrics.bandwidthHz > 0)
  assert.ok(Number.isFinite(metrics.cmrrDb) && metrics.cmrrDb >= 80)
  assert.equal(metrics.cmrrMinDb, 80)

  // La ganancia medida debe coincidir con la esperada analítica (modelo ideal).
  assert.ok(Math.abs(metrics.gain.measured - proposal.expected.gain) / proposal.expected.gain < 0.01)
})

test('evaluateProposal es reproducible con la misma semilla y determinista', () => {
  const spec = baseSpec()
  const proposal = designIa(spec)
  const first = evaluateProposal(spec, proposal, { monteCarloRuns: 15, seed: 123 })
  const second = evaluateProposal(spec, proposal, { monteCarloRuns: 15, seed: 123 })
  assert.deepEqual(first.metrics, second.metrics)
  // Y designIa también es determinista.
  assert.deepEqual(designIa(spec), designIa(spec))
})

test('designIa elige la topología monolítica cuando es más precisa (INA128-like)', () => {
  const spec = baseSpec({
    id: 'mono-50',
    gain: { nominal: 50, tolerancePct: 5 },
    constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'ina128-like' },
  })
  const proposal = designIa(spec)
  assert.equal(proposal.topology, 'monolithic')
  assert.equal(proposal.resistors.length, 1)
  assert.equal(proposal.resistors[0].name, 'Rg')
  assertE96(proposal.resistors[0].valueOhm, 'Rg')
  assert.equal(validate(DESIGN_PROPOSAL_SCHEMA, proposal).valid, true)

  const netlist = buildIaNetlist(proposal)
  assert.deepEqual(validateNetlist(netlist), { ok: true, errors: [] })
  const opAmps = netlist.elements.filter((element) => element.type === 'OPAMP')
  assert.equal(opAmps.length, 1)
  assert.deepEqual([opAmps[0].inP, opAmps[0].inN, opAmps[0].out], ['p', 'n', 'out'])
  // La red de resistencias que realiza G = 1 + 50 kΩ/Rg está en el netlist.
  const resistorNames = netlist.elements
    .filter((element) => element.type === 'R')
    .map((element) => element.name)
  assert.deepEqual(resistorNames, ['Rg1', 'Rf1', 'Rf2', 'Rg2', 'Rf3', 'Rf4'])

  const { metrics } = evaluateProposal(spec, proposal, { monteCarloRuns: 20, seed: 5 })
  assert.ok(Math.abs(metrics.gain.measured - 50) / 50 < 0.01)
  // El Monte Carlo debe mover la ganancia: Rg entra en la red del netlist.
  assert.ok(metrics.gain.mcP95AbsPct > 0.05, `MC p95 = ${metrics.gain.mcP95AbsPct}`)
})

test('designIa respeta monolithicAllowed=false', () => {
  const spec = baseSpec({
    gain: { nominal: 50, tolerancePct: 5 },
    constraints: { resistorSeries: 'E96', monolithicAllowed: false, opAmpModel: 'generic-10mhz' },
  })
  const proposal = designIa(spec)
  assert.equal(proposal.topology, 'three_op_amp')
})

test('designIa considera el ancho de banda requerido al elegir valores E96', () => {
  const spec = baseSpec({
    id: 'bw-100k',
    gain: { nominal: 100, tolerancePct: 5 },
    bandwidthHz: 100000,
  })
  const proposal = designIa(spec)
  const { metrics } = evaluateProposal(spec, proposal, { monteCarloRuns: 15, seed: 9 })
  assert.ok(
    metrics.bandwidthHz >= spec.bandwidthHz,
    `ancho de banda ${metrics.bandwidthHz} Hz < requerido ${spec.bandwidthHz} Hz`,
  )
  // El error de ganancia sigue dentro de la tolerancia pedida.
  assert.ok(Math.abs(metrics.gain.errorPct) < spec.gain.tolerancePct)
})

test('designIa devuelve el mejor intento y preguntas si no alcanza la tolerancia', () => {
  const spec = baseSpec({ id: 'imposible', gain: { nominal: 100, tolerancePct: 0.05 } })
  const proposal = designIa(spec)
  assert.equal(proposal.topology, 'three_op_amp')
  assert.ok(Math.abs(proposal.expected.gainErrorPct) > 0.05)
  assert.ok(proposal.clarifyingQuestions.length >= 1)
  assert.ok(proposal.clarifyingQuestions.some((question) => /No se alcanzó/.test(question)))
  assert.equal(validate(DESIGN_PROPOSAL_SCHEMA, proposal).valid, true)
})

test('un op-amp de mayor GBW da más ancho de banda a igual ganancia', () => {
  const slowSpec = baseSpec({
    id: 'slow',
    constraints: { resistorSeries: 'E96', monolithicAllowed: false, opAmpModel: 'generic-1mhz' },
  })
  const fastSpec = baseSpec({
    id: 'fast',
    constraints: { resistorSeries: 'E96', monolithicAllowed: false, opAmpModel: 'generic-10mhz' },
  })
  const slow = evaluateProposal(slowSpec, designIa(slowSpec), { monteCarloRuns: 5, seed: 1 })
  const fast = evaluateProposal(fastSpec, designIa(fastSpec), { monteCarloRuns: 5, seed: 1 })
  assert.ok(fast.metrics.bandwidthHz > slow.metrics.bandwidthHz * 5)
})

test('el máximo de resistencias del spec fuerza la topología monolítica', () => {
  const spec = baseSpec({
    gain: { nominal: 100, tolerancePct: 5 },
    constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'ina128-like', maxResistors: 1 },
  })
  const proposal = designIa(spec)
  assert.equal(proposal.topology, 'monolithic')
  assert.ok(proposal.resistors.length <= 1)
})
