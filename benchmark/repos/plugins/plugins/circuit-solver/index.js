// Complex arithmetic, linear solvers, the MNA circuit solver (DC and AC), gain/CMRR/bandwidth measurements and Monte Carlo runs.
import { provide, load } from '#runtime'
import * as m0 from './lib/complex.js'
import * as m1 from './lib/linalg.js'
import * as m2 from './lib/mna.js'
import * as m3 from './lib/measure.js'
import * as m4 from './lib/montecarlo.js'

const api = { ...m0, ...m1, ...m2, ...m3, ...m4 }

export const manifest = {
  "id": "plugin-circuit-solver",
  "capability": "circuit.simulate",
  "version": "1.0.0",
  "mode": "deterministic-js",
  "dependsOn": [],
  "permissions": [],
  "inputSchema": {
    "abs": "function",
    "add": "function",
    "arg": "function",
    "bandwidthHz": "function",
    "complex": "function",
    "DEFAULT_AC_FREQUENCIES": "constant",
    "div": "function",
    "fmt": "function",
    "isZero": "function",
    "measureCmrr": "function",
    "measureDifferentialGain": "function",
    "mul": "function",
    "mulberry32": "function",
    "neg": "function",
    "NetlistError": "class",
    "opAmpGain": "function",
    "PIVOT_EPS": "constant",
    "runMonteCarlo": "function",
    "scale": "function",
    "SingularMatrixError": "class",
    "solveAc": "function",
    "solveComplex": "function",
    "solveDc": "function",
    "solveReal": "function",
    "sub": "function",
    "validateNetlist": "function",
    "ZERO_EPS": "constant"
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
  const dc = api.solveDc({"schema":"cir/Netlist/v1","nodes":["in","out","0"],"elements":[{"type":"V","name":"V1","a":"in","b":"0","valueV":10},{"type":"R","name":"R1","a":"in","b":"out","valueOhm":1000},{"type":"R","name":"R2","a":"out","b":"0","valueOhm":3000}]})
  check('resistive divider V(out) = 7.5 V', Math.abs(dc.nodeVoltages.out - 7.5) < 1e-9)
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
