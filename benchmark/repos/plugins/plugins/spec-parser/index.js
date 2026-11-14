// Parsing of a requirement (structured spec or free text) into a normalized circuit spec, with defaults and open questions.
import { provide, load } from '#runtime'
import * as m0 from './lib/spec.js'

const api = { ...m0 }

export const manifest = {
  "id": "plugin-spec-parser",
  "capability": "circuit.spec.parse",
  "version": "1.0.0",
  "mode": "deterministic-js",
  "dependsOn": [],
  "permissions": [],
  "inputSchema": {
    "defaultSpec": "function",
    "parseRequirement": "function"
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
  const parsed = api.parseRequirement({"schema":"cir/CircuitSpec/v1","id":"ia-gain100","target":"instrumentation_amplifier","gain":{"nominal":100,"tolerancePct":5},"bandwidthHz":10000,"cmrrMinDb":80,"supply":{"positiveV":15,"negativeV":-15},"inputRangeV":{"minV":-0.01,"maxV":0.01},"sourceImpedanceOhm":350,"constraints":{"resistorSeries":"E96","monolithicAllowed":true,"opAmpModel":"generic-10mhz"}})
  check('keeps the nominal gain of a structured spec', parsed.spec.gain.nominal === 100)
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
