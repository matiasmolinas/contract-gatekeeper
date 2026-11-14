// Customer-support core: ticket classification, knowledge-wiki search, reply drafting and wiki article generation.
import { provide, load } from '#runtime'
import * as m0 from './lib/support-core.js'

const api = { ...m0 }

export const manifest = {
  "id": "plugin-support-studio",
  "capability": "support.ticket.triage",
  "version": "1.0.0",
  "mode": "deterministic-js",
  "dependsOn": [],
  "permissions": [],
  "inputSchema": {
    "buildWikiIndex": "function",
    "CATEGORIES": "constant",
    "classifyTicket": "function",
    "draftReply": "function",
    "generateWikiArticle": "function",
    "KNOWLEDGE_BASE": "constant",
    "searchWiki": "function",
    "SENTIMENTS": "constant",
    "URGENCIES": "constant"
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
  check('classifies an API ticket', api.classifyTicket('My API key returns 401').category === 'api')
  check('finds the duplicate-charge article', api.searchWiki('duplicate charge on my invoice').key === 'billing')
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
