// Verification of a design: checks the measured metrics against the spec and reports pass/fail per check.
import { provide, load } from '#runtime'
import * as m0 from './lib/verify.js'

const api = { ...m0 }

export const manifest = {
  "id": "plugin-design-verify",
  "capability": "circuit.design.verify",
  "version": "1.0.0",
  "mode": "deterministic-js",
  "dependsOn": [],
  "permissions": [],
  "inputSchema": {
    "verifyDesign": "function"
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
  const verification = api.verifyDesign({"schema":"cir/CircuitSpec/v1","id":"ia-gain100","target":"instrumentation_amplifier","gain":{"nominal":100,"tolerancePct":5},"bandwidthHz":10000,"cmrrMinDb":80,"supply":{"positiveV":15,"negativeV":-15},"inputRangeV":{"minV":-0.01,"maxV":0.01},"sourceImpedanceOhm":350,"constraints":{"resistorSeries":"E96","monolithicAllowed":true,"opAmpModel":"generic-10mhz"}}, {"gain":{"nominal":100,"measured":100.9896,"errorPct":0.98959805,"mcP95AbsPct":1.8155471},"bandwidthHz":98407.447,"cmrrDb":200,"cmrrMinDb":80})
  check('a design within tolerance passes', verification.pass === true && verification.checks.length > 0)
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
