// Synthesis of instrumentation amplifiers: topology and resistor selection, netlist construction, evaluation of a proposal by simulation.
import { provide, load } from '#runtime'
import * as m0 from './lib/ia.js'

const api = { ...m0 }

export const manifest = {
  "id": "plugin-ia-synth",
  "capability": "circuit.ia.synthesize",
  "version": "1.0.0",
  "mode": "deterministic-js",
  "dependsOn": [
    "circuit.simulate",
    "resistor.series"
  ],
  "permissions": [],
  "inputSchema": {
    "buildIaNetlist": "function",
    "designIa": "function",
    "evaluateProposal": "function"
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
  const spec = {"schema":"cir/CircuitSpec/v1","id":"ia-gain100","target":"instrumentation_amplifier","gain":{"nominal":100,"tolerancePct":5},"bandwidthHz":10000,"cmrrMinDb":80,"supply":{"positiveV":15,"negativeV":-15},"inputRangeV":{"minV":-0.01,"maxV":0.01},"sourceImpedanceOhm":350,"constraints":{"resistorSeries":"E96","monolithicAllowed":true,"opAmpModel":"generic-10mhz"}}
  const proposal = api.designIa(spec)
  check('proposes a topology with resistors', typeof proposal.topology === 'string' && proposal.resistors.length > 0)
  const { metrics } = api.evaluateProposal(spec, proposal)
  check('simulated gain within 5 % of 100', Math.abs(metrics.gain.measured - 100) < 5)
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
