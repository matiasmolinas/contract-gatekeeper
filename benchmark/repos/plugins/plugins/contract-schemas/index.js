// JSON schemas of the data that crosses module boundaries (spec, netlist, proposal, verification) and their validator.
import { provide, load } from '#runtime'
import * as m0 from './lib/schemas.js'
import * as m1 from './lib/validate.js'

const api = { ...m0, ...m1 }

export const manifest = {
  "id": "plugin-contract-schemas",
  "capability": "contract.validate",
  "version": "1.0.0",
  "mode": "deterministic-js",
  "dependsOn": [],
  "permissions": [],
  "inputSchema": {
    "assertValid": "function",
    "CIRCUIT_SPEC_SCHEMA": "constant",
    "DESIGN_PROPOSAL_SCHEMA": "constant",
    "formatErrors": "function",
    "MANIFEST_SCHEMA": "constant",
    "NETLIST_SCHEMA": "constant",
    "OMIT": "constant",
    "SIM_RESULT_SCHEMA": "constant",
    "validate": "function",
    "VERIFICATION_SCHEMA": "constant"
  },
  "outputSchema": {},
  "budget": {
    "maxLatencyMs": 2000,
    "maxTokensPerCall": 0
  }
}

provide(manifest.capability, api)
await load(...manifest.dependsOn)

export async function selfTest() {
  const t0 = performance.now()
  const details = []
  const check = (name, ok) => details.push(`${ok ? 'ok' : 'FAILED'}: ${name}`)
  // El manifest es el contrato: lo exportado tiene que coincidir con lo declarado.
  check(
    'exports match manifest.inputSchema',
    JSON.stringify(Object.keys(api).sort()) === JSON.stringify(Object.keys(manifest.inputSchema).sort())
  )
  check('the example spec is valid', api.validate(api.CIRCUIT_SPEC_SCHEMA, {"schema":"cir/CircuitSpec/v1","id":"ia-gain100","target":"instrumentation_amplifier","gain":{"nominal":100,"tolerancePct":5},"bandwidthHz":10000,"cmrrMinDb":80,"supply":{"positiveV":15,"negativeV":-15},"inputRangeV":{"minV":-0.01,"maxV":0.01},"sourceImpedanceOhm":350,"constraints":{"resistorSeries":"E96","monolithicAllowed":true,"opAmpModel":"generic-10mhz"}}).valid === true)
  check('an empty object is not a valid spec', api.validate(api.CIRCUIT_SPEC_SCHEMA, {}).valid === false)
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
