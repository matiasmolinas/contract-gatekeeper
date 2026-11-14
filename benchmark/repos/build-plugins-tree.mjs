#!/usr/bin/env node
// benchmark/repos/build-plugins-tree.mjs
//
// Deriva el árbol de plugins (`plugins/`) del árbol clásico (`classic/`) de
// forma mecánica: MISMO código y MISMOS tests, reagrupados en cápsulas. Lo
// único que se agrega es lo que la arquitectura exige: un manifest y un
// selfTest por cápsula, y un registro para que las cápsulas se llamen entre sí
// sin importarse. Así nadie tiene que creer que los dos brazos son equivalentes:
// puede leer esta transformación.
//
// Uso: node benchmark/repos/build-plugins-tree.mjs [--check]
//   --check  no escribe: falla si `plugins/` no coincide con lo que se generaría.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLASSIC = path.join(HERE, 'classic')
const CHECK = process.argv.includes('--check')
const OUT = CHECK ? fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-tree-')) : path.join(HERE, 'plugins')

const SPEC = JSON.parse(fs.readFileSync(path.join(CLASSIC, 'examples/specs/ia-gain100.json'), 'utf8'))
const DIVIDER = JSON.parse(fs.readFileSync(path.join(CLASSIC, 'examples/netlists/divider.json'), 'utf8'))
const METRICS = {
  gain: { nominal: 100, measured: 100.9896, errorPct: 0.98959805, mcP95AbsPct: 1.8155471 },
  bandwidthHz: 98407.447,
  cmrrDb: 200,
  cmrrMinDb: 80,
}

/**
 * Las cápsulas siguen el grafo de imports real del piloto. `source` es la
 * carpeta del árbol clásico; `modules`, los archivos que se llevan.
 */
const CAPSULES = [
  {
    dir: 'circuit-solver',
    capability: 'circuit.simulate',
    summary: 'Complex arithmetic, linear solvers, the MNA circuit solver (DC and AC), gain/CMRR/bandwidth measurements and Monte Carlo runs.',
    source: 'src/core',
    modules: ['complex', 'linalg', 'mna', 'measure', 'montecarlo'],
    dependsOn: [],
    selfTest: `const dc = api.solveDc(${JSON.stringify(DIVIDER)})
  check('resistive divider V(out) = 7.5 V', Math.abs(dc.nodeVoltages.out - 7.5) < 1e-9)`,
  },
  {
    dir: 'resistor-series',
    capability: 'resistor.series',
    summary: 'Standard resistor value series: nearest commercial value, values in a range, ohm formatting.',
    source: 'src/core',
    modules: ['e96'],
    dependsOn: [],
    selfTest: `check('E96 has 96 values', api.E96.length === 96)
  check('nearest E96 of 1000 Ω is 1000 Ω', api.nearestE96(1000).valueOhm === 1000)`,
  },
  {
    dir: 'ia-synth',
    capability: 'circuit.ia.synthesize',
    summary: 'Synthesis of instrumentation amplifiers: topology and resistor selection, netlist construction, evaluation of a proposal by simulation.',
    source: 'src/core',
    modules: ['ia'],
    dependsOn: ['circuit.simulate', 'resistor.series'],
    selfTest: `const spec = ${JSON.stringify(SPEC)}
  const proposal = api.designIa(spec)
  check('proposes a topology with resistors', typeof proposal.topology === 'string' && proposal.resistors.length > 0)
  const { metrics } = api.evaluateProposal(spec, proposal)
  check('simulated gain within 5 % of 100', Math.abs(metrics.gain.measured - 100) < 5)`,
  },
  {
    dir: 'spec-parser',
    capability: 'circuit.spec.parse',
    summary: 'Parsing of a requirement (structured spec or free text) into a normalized circuit spec, with defaults and open questions.',
    source: 'src/core',
    modules: ['spec'],
    dependsOn: [],
    selfTest: `const parsed = api.parseRequirement(${JSON.stringify(SPEC)})
  check('keeps the nominal gain of a structured spec', parsed.spec.gain.nominal === 100)`,
  },
  {
    dir: 'design-verify',
    capability: 'circuit.design.verify',
    summary: 'Verification of a design: checks the measured metrics against the spec and reports pass/fail per check.',
    source: 'src/core',
    modules: ['verify'],
    dependsOn: [],
    selfTest: `const verification = api.verifyDesign(${JSON.stringify(SPEC)}, ${JSON.stringify(METRICS)})
  check('a design within tolerance passes', verification.pass === true && verification.checks.length > 0)`,
  },
  {
    dir: 'report-render',
    capability: 'circuit.report.render',
    summary: 'Rendering of the design report: Markdown, schematic SVG, Bode plot SVG and number formatting.',
    source: 'src/core',
    modules: ['report'],
    dependsOn: [],
    selfTest: `check('escapes XML', api.escapeXml('<a&b>') === '&lt;a&amp;b&gt;')
  check('formats ohms', typeof api.fmtOhm(4990) === 'string' && api.fmtOhm(4990).length > 0)`,
  },
  {
    dir: 'contract-schemas',
    capability: 'contract.validate',
    summary: 'JSON schemas of the data that crosses module boundaries (spec, netlist, proposal, verification) and their validator.',
    source: 'src/contract',
    modules: ['schemas', 'validate'],
    dependsOn: [],
    selfTest: `check('the example spec is valid', api.validate(api.CIRCUIT_SPEC_SCHEMA, ${JSON.stringify(SPEC)}).valid === true)
  check('an empty object is not a valid spec', api.validate(api.CIRCUIT_SPEC_SCHEMA, {}).valid === false)`,
  },
  {
    dir: 'design-pipeline',
    capability: 'circuit.design.pipeline',
    summary: 'End-to-end design pipeline: requirement, synthesis, simulation, verification, report.',
    source: 'src/core',
    modules: ['pipeline'],
    dependsOn: ['circuit.spec.parse', 'circuit.ia.synthesize', 'circuit.design.verify', 'circuit.report.render'],
    selfTest: `const result = api.designPipeline(${JSON.stringify(SPEC)})
  check('the example spec yields a verified design', result.verification.pass === true)
  check('the report has Markdown', typeof result.report.markdown === 'string' && result.report.markdown.length > 0)`,
  },
  {
    dir: 'support-studio',
    capability: 'support.ticket.triage',
    summary: 'Customer-support core: ticket classification, knowledge-wiki search, reply drafting and wiki article generation.',
    source: 'src/support',
    modules: ['support-core'],
    dependsOn: [],
    selfTest: `check('classifies an API ticket', api.classifyTicket('My API key returns 401').category === 'api')
  check('finds the duplicate-charge article', api.searchWiki('duplicate charge on my invoice').key === 'billing')`,
  },
]

const KEY_FLOWS = {
  'design-instrumentation-amplifier': ['circuit.design.pipeline'],
  'simulate-netlist': ['circuit.simulate'],
  'validate-spec': ['contract.validate'],
  'support-ticket-triage': ['support.ticket.triage'],
}

// módulo del árbol clásico ("src/core/mna") -> cápsula
const OWNER = new Map()
for (const capsule of CAPSULES) for (const mod of capsule.modules) OWNER.set(`${capsule.source}/${mod}`, capsule)

const write = (rel, content) => {
  const file = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}
const read = rel => fs.readFileSync(path.join(CLASSIC, rel), 'utf8')

const IMPORT_RE = /^import\s+\{([^}]*)\}\s+from\s+'([^']+)'\s*;?[ \t]*$/gm
const names = list => list.split(',').map(s => s.trim()).filter(Boolean)

/** Código de librería: los imports a OTRA cápsula pasan a ser llamadas por el registro. */
function rewriteLib(capsule, mod) {
  const fromDir = capsule.source
  let needsRuntime = false
  const source = read(`${fromDir}/${mod}.js`).replace(IMPORT_RE, (statement, list, spec) => {
    if (!spec.startsWith('.')) return statement
    const target = path.posix.join(fromDir, spec).replace(/\.js$/, '')
    const owner = OWNER.get(target)
    if (!owner) throw new Error(`${fromDir}/${mod}.js importa ${spec}, que no pertenece a ninguna cápsula`)
    if (owner === capsule) return statement
    if (!capsule.dependsOn.includes(owner.capability)) {
      throw new Error(`${capsule.dir} usa ${owner.capability} pero no lo declara en dependsOn`)
    }
    const lines = names(list).map(name => `const ${name} = lazy('${owner.capability}', '${name}')`)
    if (!needsRuntime) lines.unshift(`import { lazy } from '#runtime'`)
    needsRuntime = true
    return lines.join('\n')
  })
  return source
}

/** Tests: todo módulo del proyecto se obtiene por su capability. */
function rewriteTest(rel, prefix) {
  let used = false
  const source = read(rel).replace(IMPORT_RE, (statement, list, spec) => {
    if (!spec.startsWith(prefix)) return statement
    const target = path.posix.join('test', spec).replace(/\.js$/, '')
    const owner = OWNER.get(target)
    if (!owner) throw new Error(`${rel} importa ${spec}, que no pertenece a ninguna cápsula`)
    used = true
    return `const { ${names(list).join(', ')} } = await load('${owner.capability}')`
  })
  if (!used) return source
  // el import del runtime va después del último import de node:
  const lastNodeImport = [...source.matchAll(/^import[^\n]*from\s+'node:[^']+'\s*;?[ \t]*$/gm)].pop()
  const at = lastNodeImport ? lastNodeImport.index + lastNodeImport[0].length : 0
  return `${source.slice(0, at)}\nimport { load } from '#runtime'${source.slice(at)}`
}

async function exportsOf(capsule) {
  const out = {}
  for (const mod of capsule.modules) {
    const loaded = await import(pathToFileURL(path.join(CLASSIC, capsule.source, `${mod}.js`)).href)
    for (const [name, value] of Object.entries(loaded)) {
      out[name] = typeof value === 'function' ? (/^class\s/.test(String(value)) ? 'class' : 'function') : 'constant'
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

fs.rmSync(OUT, { recursive: true, force: true })

// --- runtime compartido ------------------------------------------------------
write(
  'runtime/registry.js',
  `// Registro de capacidades: lo único que las cápsulas comparten.
// Una cápsula publica su API con provide() y usa las de otras con lazy()/load(),
// nunca con un import relativo hacia fuera de su carpeta.
import { readFileSync } from 'node:fs'

const MAP = JSON.parse(readFileSync(new URL('./capabilities.json', import.meta.url), 'utf8'))
const providers = new Map()

/** Publica la API de una capacidad. La primera publicación gana. */
export function provide(capability, api) {
  if (!providers.has(capability)) providers.set(capability, api)
}

/** API de una capacidad ya cargada. */
export function use(capability) {
  const api = providers.get(capability)
  if (!api) throw new Error(\`capability not loaded: \${capability}\`)
  return api
}

/** Carga las cápsulas que proveen estas capacidades y devuelve su API. */
export async function load(...capabilities) {
  for (const capability of capabilities) {
    if (providers.has(capability)) continue
    const entry = MAP[capability]
    if (!entry) throw new Error(\`unknown capability: \${capability}\`)
    await import(new URL(\`../\${entry}\`, import.meta.url).href)
  }
  return capabilities.length === 1 ? use(capabilities[0]) : capabilities.map(use)
}

/** Función de otra capacidad, resuelta en el momento de la llamada. */
export const lazy = (capability, name) => (...args) => use(capability)[name](...args)
`
)
write(
  'runtime/capabilities.json',
  `${JSON.stringify(Object.fromEntries(CAPSULES.map(c => [c.capability, `plugins/${c.dir}/index.js`])), null, 2)}\n`
)

// --- cápsulas ----------------------------------------------------------------
const cards = []
for (const capsule of CAPSULES) {
  const base = `plugins/${capsule.dir}`
  for (const mod of capsule.modules) write(`${base}/lib/${mod}.js`, rewriteLib(capsule, mod))

  const exported = await exportsOf(capsule)
  const manifest = {
    id: `plugin-${capsule.dir}`,
    capability: capsule.capability,
    version: '1.0.0',
    mode: 'deterministic-js',
    dependsOn: capsule.dependsOn,
    permissions: [],
    // El contrato público de la cápsula: los nombres que exporta y su tipo.
    inputSchema: exported,
    outputSchema: {},
    budget: { maxLatencyMs: 2000, maxTokensPerCall: 0 },
  }
  write(
    `${base}/index.js`,
    `// ${capsule.summary}
import { provide, load } from '#runtime'
${capsule.modules.map((mod, i) => `import * as m${i} from './lib/${mod}.js'`).join('\n')}

const api = { ${capsule.modules.map((_, i) => `...m${i}`).join(', ')} }

export const manifest = ${JSON.stringify(manifest, null, 2)}

provide(manifest.capability, api)
await load(...manifest.dependsOn)

export async function selfTest() {
  const t0 = performance.now()
  const details = []
  const check = (name, ok) => details.push(\`\${ok ? 'ok' : 'FAILED'}: \${name}\`)
  // El manifest es el contrato: lo exportado tiene que coincidir con lo declarado.
  check(
    'exports match manifest.inputSchema',
    JSON.stringify(Object.keys(api).sort()) === JSON.stringify(Object.keys(manifest.inputSchema).sort())
  )
  ${capsule.selfTest}
  return {
    passed: details.every(line => line.startsWith('ok')),
    assertionsRun: details.length,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    details,
  }
}

export const plugin = { manifest, selfTest }
`
  )

  for (const mod of capsule.modules) {
    const testRel = `test/${mod === 'support-core' ? 'support' : mod === 'schemas' ? 'contract' : mod}.test.js`
    if (mod === 'validate') continue // lo cubre contract.test.js
    write(`${base}/test/${path.basename(testRel)}`, rewriteTest(testRel, '../src/'))
  }

  cards.push(
    `### ${capsule.dir}\n\n- capability: \`${capsule.capability}\`\n- ${capsule.summary}\n- depends on: ${
      capsule.dependsOn.length ? capsule.dependsOn.map(d => `\`${d}\``).join(', ') : 'nothing'
    }\n- exports: ${Object.keys(exported).map(n => `\`${n}\``).join(', ')}\n`
  )
}

// --- shell de la aplicación (fuera de las cápsulas) -----------------------------
let cli = read('src/cli.js')
const cliBefore = cli
cli = cli
  .replace(
    /^import \{ CIRCUIT_SPEC_SCHEMA \} from '\.\/contract\/schemas\.js'\nimport \{ formatErrors, validate \} from '\.\/contract\/validate\.js'\nimport \{([^}]*)\} from '\.\/core\/report\.js'$/m,
    (_all, reportNames) =>
      `import { load } from '#runtime'\n\nconst { CIRCUIT_SPEC_SCHEMA, formatErrors, validate } = await load('contract.validate')\nconst { ${names(reportNames).join(', ')} } = await load('circuit.report.render')`
  )
  .replace(`await import('./core/pipeline.js')`, `await load('circuit.design.pipeline')`)
  .replace(`await import('./core/mna.js')`, `await load('circuit.simulate')`)
if (cli === cliBefore || /from '\.\/(core|contract)\//.test(cli) || /import\('\.\/core\//.test(cli)) {
  throw new Error('src/cli.js: no se pudieron reescribir todos los imports')
}
write('src/cli.js', cli)
// El test del shell localiza módulos por ruta: se le dan las rutas del árbol de plugins
let cliTest = read('test/cli.test.js')
const cliTestBefore = cliTest
cliTest = cliTest
  .replace(`canImport('src/core/pipeline.js')`, `canImport('plugins/design-pipeline/index.js')`)
  .replace(`canImport('src/core/mna.js')`, `canImport('plugins/circuit-solver/index.js')`)
  .replace(
    `const { CIRCUIT_SPEC_SCHEMA } = await import('../src/contract/schemas.js')\n  const { validate } = await import('../src/contract/validate.js')`,
    `const { load } = await import('#runtime')\n  const { CIRCUIT_SPEC_SCHEMA, validate } = await load('contract.validate')`
  )
if (cliTest === cliTestBefore || /src\/(core|contract)\//.test(cliTest.replace(/^\s*\*.*$|skip: .*$/gm, ''))) {
  throw new Error('test/cli.test.js: no se pudieron reescribir todas las rutas')
}
write('test/cli.test.js', cliTest)
fs.cpSync(path.join(CLASSIC, 'examples'), path.join(OUT, 'examples'), { recursive: true })

write(
  'package.json',
  `${JSON.stringify(
    {
      name: 'circuit-pilot-plugins',
      private: true,
      type: 'module',
      imports: { '#runtime': './runtime/registry.js' },
      scripts: { test: 'node --test "plugins/*/test/*.test.js" "test/*.test.js"' },
    },
    null,
    2
  )}\n`
)
write(
  'gatekeeper.config.json',
  `${JSON.stringify(
    { pluginsDir: 'plugins', entryFileName: 'index.js', allowedExternalPackages: ['#runtime'], keyFlows: KEY_FLOWS },
    null,
    2
  )}\n`
)

// --- documento de orientación de cada árbol (misma información, misma fuente) ----
write(
  'ARCHITECTURE.md',
  `# Architecture

The application is a set of isolated capsules under \`plugins/\`, plus a thin shell.

- \`plugins/<capsule>/index.js\` — the capsule's contract (\`manifest\`), its registration and its \`selfTest()\`.
- \`plugins/<capsule>/lib/\` — the implementation. \`plugins/<capsule>/test/\` — its tests.
- \`runtime/registry.js\` — the capability registry, imported as \`#runtime\`.
- \`src/cli.js\` — command-line shell. \`test/\` — tests of the shell. \`examples/\` — sample specs and netlists.

Rules:

- Code inside a capsule never imports files outside its own folder. To call another capsule it uses the registry: \`lazy('<capability>', '<name>')\` in library code, \`await load('<capability>')\` in tests. The capability must be listed in the capsule's \`dependsOn\`.
- \`manifest.inputSchema\` lists every name the capsule exports. Adding or removing an export means updating it.
- Run the tests with \`npm test\`.

## Capsules

${cards.join('\n')}`
)

if (!CHECK) {
  fs.writeFileSync(
    path.join(HERE, 'module-map.json'),
    `${JSON.stringify(
      Object.fromEntries([...OWNER].map(([mod, c]) => [mod, { capability: c.capability, dir: c.dir }])),
      null,
      2
    )}\n`,
    'utf8'
  )
  const moduleLines = CAPSULES.map(
    c => `- ${c.modules.map(m => `\`${c.source}/${m}.js\``).join(', ')} — ${c.summary}`
  ).join('\n')
  fs.writeFileSync(
    path.join(CLASSIC, 'ARCHITECTURE.md'),
    `# Architecture

The application is a layered library under \`src/\`, plus a command-line shell.

- \`src/core/\` — circuit domain: solver, synthesis, spec parsing, verification, reporting, pipeline.
- \`src/contract/\` — JSON schemas of the data that crosses module boundaries, and their validator.
- \`src/support/\` — customer-support domain.
- \`src/cli.js\` — command-line shell. \`test/\` — all the tests. \`examples/\` — sample specs and netlists.

Modules import each other directly with relative imports. Run the tests with \`npm test\`.

## Modules

${moduleLines}
`,
    'utf8'
  )
}

// --- modo --check --------------------------------------------------------------
if (CHECK) {
  const list = root => {
    const out = []
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.gatekeeper')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else out.push(path.relative(root, full))
      }
    }
    walk(root)
    return out.sort()
  }
  const committed = path.join(HERE, 'plugins')
  const expected = list(OUT)
  const actual = fs.existsSync(committed) ? list(committed) : []
  const differing = [...new Set([...expected, ...actual])].filter(
    rel =>
      !fs.existsSync(path.join(OUT, rel)) ||
      !fs.existsSync(path.join(committed, rel)) ||
      !fs.readFileSync(path.join(OUT, rel)).equals(fs.readFileSync(path.join(committed, rel)))
  )
  fs.rmSync(OUT, { recursive: true, force: true })
  if (differing.length) {
    console.error(`plugins/ no coincide con lo generado desde classic/:\n  ${differing.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`plugins/ coincide con lo generado desde classic/ (${expected.length} archivos).`)
} else {
  console.log(`Árbol de plugins generado en ${path.relative(process.cwd(), OUT)} (${CAPSULES.length} cápsulas).`)
}
