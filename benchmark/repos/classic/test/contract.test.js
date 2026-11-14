import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CIRCUIT_SPEC_SCHEMA,
  NETLIST_SCHEMA,
  DESIGN_PROPOSAL_SCHEMA,
  MANIFEST_SCHEMA,
} from '../src/contract/schemas.js'
import { validate, assertValid } from '../src/contract/validate.js'

const validSpec = {
  schema: 'cir/CircuitSpec/v1',
  id: 'test-gain100',
  target: 'instrumentation_amplifier',
  gain: { nominal: 100, tolerancePct: 1 },
  bandwidthHz: 10000,
  cmrrMinDb: 80,
  supply: { positiveV: 15, negativeV: -15 },
  inputRangeV: { minV: -0.01, maxV: 0.01 },
  sourceImpedanceOhm: 350,
  constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-1mhz' },
}

const validNetlist = {
  schema: 'cir/Netlist/v1',
  nodes: ['in', 'out', '0'],
  elements: [
    { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 10 },
    { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
    { type: 'R', name: 'R2', a: 'out', b: '0', valueOhm: 3000 },
  ],
}

test('spec valido pasa el schema', () => {
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, validSpec).valid, true)
})

test('spec sin gain falla con error de campo requerido', () => {
  const invalid = structuredClone(validSpec)
  delete invalid.gain
  const result = validate(CIRCUIT_SPEC_SCHEMA, invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.message.includes('gain')))
})

test('spec con campo no permitido falla por additionalProperties', () => {
  const invalid = { ...validSpec, extra: true }
  const result = validate(CIRCUIT_SPEC_SCHEMA, invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.message.includes('extra')))
})

test('netlist valido pasa el schema', () => {
  assert.equal(validate(NETLIST_SCHEMA, validNetlist).valid, true)
})

test('proposal con netlist embebido usa $ref local', () => {
  const proposal = {
    schema: 'cir/DesignProposal/v1',
    specId: 'test-gain100',
    topology: 'three_op_amp',
    resistors: [{ name: 'R1', valueOhm: 10000, series: 'E96' }],
    opAmps: [{ name: 'U1', gain: 1e6, poleHz: 1 }],
    netlist: validNetlist,
    expected: { gain: 100 },
    assumptions: ['op-amps ideales'],
  }
  assert.equal(validate(DESIGN_PROPOSAL_SCHEMA, proposal).valid, true)
})

test('manifest de plugin valido', () => {
  const manifest = {
    apiVersion: 'dsh.plugin/v0.1',
    id: 'com.acme.cir.solver',
    name: 'Solver MNA',
    version: '0.1.0',
    kind: 'deterministic',
    profile: 'sidecar-native',
    description: 'Resuelve netlists lineales.',
    capabilities: [{}],
    provides: [{}],
    health: {},
    selfTest: {},
    telemetry: {},
    permissions: {},
    lifecycle: {},
    compatibility: {},
    docs: {},
  }
  assert.equal(validate(MANIFEST_SCHEMA, manifest).valid, true)
})

test('assertValid lanza con detalle legible', () => {
  assert.throws(
    () => assertValid(CIRCUIT_SPEC_SCHEMA, { schema: 'cir/CircuitSpec/v1' }, 'spec'),
    /spec inválido/,
  )
})
