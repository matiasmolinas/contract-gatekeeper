// Standard resistor value series: nearest commercial value, values in a range, ohm formatting.
import { provide, load } from '#runtime'
import * as m0 from './lib/e96.js'

const api = { ...m0 }

export const manifest = {
  "id": "plugin-resistor-series",
  "capability": "resistor.series",
  "version": "1.0.0",
  "mode": "deterministic-js",
  "dependsOn": [],
  "permissions": [],
  "inputSchema": {
    "E96": "constant",
    "e96Values": "function",
    "formatOhm": "function",
    "nearestE96": "function"
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
  check('E96 has 96 values', api.E96.length === 96)
  check('nearest E96 of 1000 Ω is 1000 Ω', api.nearestE96(1000).valueOhm === 1000)
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
