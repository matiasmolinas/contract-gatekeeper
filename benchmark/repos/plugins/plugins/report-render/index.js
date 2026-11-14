// Rendering of the design report: Markdown, schematic SVG, Bode plot SVG and number formatting.
import { provide, load } from '#runtime'
import * as m0 from './lib/report.js'

const api = { ...m0 }

export const manifest = {
  "id": "plugin-report-render",
  "capability": "circuit.report.render",
  "version": "1.0.0",
  "mode": "deterministic-js",
  "dependsOn": [],
  "permissions": [],
  "inputSchema": {
    "escapeXml": "function",
    "fmtHz": "function",
    "fmtNum": "function",
    "fmtOhm": "function",
    "pickOutNode": "function",
    "renderBodeSvg": "function",
    "renderMarkdown": "function",
    "renderSchematicSvg": "function"
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
  check('escapes XML', api.escapeXml('<a&b>') === '&lt;a&amp;b&gt;')
  check('formats ohms', typeof api.fmtOhm(4990) === 'string' && api.fmtOhm(4990).length > 0)
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
