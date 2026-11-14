#!/usr/bin/env node
/**
 * CLI del piloto de circuitos.
 *
 *   node src/cli.js design <spec.json> [--out <dir>]
 *   node src/cli.js solve <netlist.json>
 *   node src/cli.js selftest
 *   node src/cli.js bench [--iterations N]
  mide TS, sidecar, Mojo y WASM vía scripts/bench.js
 *   node src/cli.js --help
 *
 * Códigos de salida: 0 OK, 1 error de ejecución o verificación fallida, 2 error de uso.
 * ESM puro, sin dependencias externas.
 */

import process from 'node:process'
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { CIRCUIT_SPEC_SCHEMA } from './contract/schemas.js'
import { formatErrors, validate } from './contract/validate.js'
import { pickOutNode, renderBodeSvg, renderMarkdown, renderSchematicSvg } from './core/report.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const VERSION = '0.1.0'

/** Barrido AC por defecto: 1 Hz a 10 MHz, 10 puntos por década. */
export const DEFAULT_AC_FREQUENCIES = Array.from({ length: 71 }, (_, index) => 10 ** (index / 10))

const HELP = `circuit-pilot — diseño y verificación de amplificadores de instrumentación

Uso:
  node src/cli.js design <spec.json> [--out <dir>]
  node src/cli.js solve <netlist.json>
  node src/cli.js selftest
  node src/cli.js bench [--iterations N]
  mide TS, sidecar, Mojo y WASM vía scripts/bench.js
  node src/cli.js --help

Comandos:
  design     Corre el pipeline completo (spec → diseño → simulación → verificación) y
             escribe proposal.json, verification.json, report.md, schematic.svg,
             bode.svg, summary.json y netlist.json en el directorio de salida.
             Sale 0 si la verificación pasa y 1 si falla.
  solve      Resuelve un netlist en DC y en AC (1 Hz–10 MHz) e imprime el JSON resultante.
  selftest   Corre todos los specs de examples/specs y sale 0 si todos pasan.
  bench      Mide el solver TS delegando en scripts/bench.js (si existe).

Opciones:
  -o, --out <dir>        Directorio de salida de "design" (default: reports/<spec-id>).
  -n, --iterations <N>   Iteraciones para "bench".
  -h, --help             Muestra esta ayuda.
  -v, --version          Muestra la versión.

Códigos de salida: 0 OK · 1 error de ejecución o verificación fallida · 2 error de uso.
`

/* ------------------------------------------------------------------ */
/* Salida                                                              */
/* ------------------------------------------------------------------ */

function out(line = '') {
  process.stdout.write(`${line}\n`)
}

function err(line = '') {
  process.stderr.write(`${line}\n`)
}

function usageError(message) {
  err(`Error: ${message}`)
  err('Usá "node src/cli.js --help" para ver el uso.')
  return 2
}

function sanitizeId(value) {
  const text = String(value ?? 'spec').trim()
  const safe = text.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe === '' ? 'spec' : safe
}

/* ------------------------------------------------------------------ */
/* Parseo de argumentos                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {string[]} argv
 * @returns {{
 *   command?: string, specPath?: string, netlistPath?: string,
 *   outDir?: string, iterations?: number,
 *   help?: boolean, version?: boolean, error?: string
 * }}
 */
export function parseArgs(argv) {
  const parsed = { help: false, version: false }
  const positionals = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      parsed.help = true
    } else if (arg === '--version' || arg === '-v' || arg === '-V') {
      parsed.version = true
    } else if (arg === '--out' || arg === '-o') {
      const value = argv[index + 1]
      if (!value || value.startsWith('-')) return { error: 'falta el valor de --out <dir>' }
      parsed.outDir = value
      index += 1
    } else if (arg === '--iterations' || arg === '-n') {
      const value = argv[index + 1]
      const iterations = Number(value)
      if (!value || !Number.isInteger(iterations) || iterations <= 0) {
        return { error: 'falta un entero positivo para --iterations <N>' }
      }
      parsed.iterations = iterations
      index += 1
    } else if (arg.startsWith('-')) {
      return { error: `opción desconocida "${arg}"` }
    } else {
      positionals.push(arg)
    }
  }

  parsed.command = positionals[0]
  if (parsed.command === 'design') parsed.specPath = positionals[1]
  if (parsed.command === 'solve') parsed.netlistPath = positionals[1]

  const maxPositionals = parsed.command === 'design' || parsed.command === 'solve' ? 2 : 1
  if (positionals.length > maxPositionals) {
    return { error: `argumentos de más: ${positionals.slice(maxPositionals).join(' ')}` }
  }

  return parsed
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeTextFile(path, value) {
  const text = typeof value === 'string' ? value : String(value)
  await writeFile(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
}

async function loadPipeline() {
  try {
    const module = await import('./core/pipeline.js')
    if (typeof module.designPipeline !== 'function') {
      throw new Error('src/core/pipeline.js no exporta designPipeline')
    }
    return module.designPipeline
  } catch (error) {
    const detail = error?.message ?? String(error)
    err(`Error: el pipeline de diseño no está disponible todavía (${detail}).`)
    err('Integración pendiente: src/core/pipeline.js debe exportar designPipeline(input, options).')
    return null
  }
}

async function loadSolver() {
  try {
    const module = await import('./core/mna.js')
    if (typeof module.solveDc !== 'function' || typeof module.solveAc !== 'function') {
      throw new Error('src/core/mna.js no exporta solveDc/solveAc')
    }
    return module
  } catch (error) {
    err(`Error: el solver MNA no está disponible todavía (${error?.message ?? error}).`)
    return null
  }
}

function summarizeMetrics(metrics = {}) {
  const lines = []
  if (Number.isFinite(metrics.gain?.measured)) {
    const errorPct = Number.isFinite(metrics.gain?.errorPct) ? ` (error ${metrics.gain.errorPct.toFixed(2)} %)` : ''
    lines.push(`  Ganancia medida: ${metrics.gain.measured.toFixed(3)} ×${errorPct}`)
  }
  if (Number.isFinite(metrics.gain?.mcP95AbsPct)) {
    lines.push(`  Monte Carlo p95: ±${metrics.gain.mcP95AbsPct.toFixed(2)} %`)
  }
  if (Number.isFinite(metrics.cmrrDb)) {
    const min = Number.isFinite(metrics.cmrrMinDb) ? ` (mínimo ${metrics.cmrrMinDb.toFixed(1)} dB)` : ''
    lines.push(`  CMRR (ideal): ${metrics.cmrrDb.toFixed(1)} dB${min}`)
  }
  if (Number.isFinite(metrics.bandwidthHz)) {
    lines.push(`  Ancho de banda (-3 dB): ${metrics.bandwidthHz.toFixed(1)} Hz`)
  }
  return lines
}

/* ------------------------------------------------------------------ */
/* Comando: design                                                     */
/* ------------------------------------------------------------------ */

async function cmdDesign(parsed) {
  if (!parsed.specPath) return usageError('falta <spec.json> para el comando "design"')

  let spec
  try {
    spec = await readJsonFile(parsed.specPath)
  } catch (error) {
    return usageError(`no se pudo leer el spec "${parsed.specPath}": ${error?.message ?? error}`)
  }

  const validation = validate(CIRCUIT_SPEC_SCHEMA, spec)
  if (!validation.valid) {
    err('Advertencia: el spec no cumple exactamente cir/CircuitSpec/v1; se intentará completar con defaults.')
    for (const line of formatErrors(validation.errors).split('\n')) err(`  - ${line}`)
  }

  const designPipeline = await loadPipeline()
  if (!designPipeline) return 1

  let result
  try {
    result = await designPipeline(spec, {})
  } catch (error) {
    err(`Error: falló el pipeline de diseño: ${error?.message ?? error}`)
    return 1
  }

  const proposal = result?.proposal ?? {}
  const verification = result?.verification ?? {}
  const metrics = result?.metrics ?? {}
  const specId = spec.id ?? proposal.specId ?? basename(parsed.specPath, '.json')
  const outNode = pickOutNode(proposal)

  const outDir = resolve(parsed.outDir ?? join('reports', sanitizeId(specId)))
  const report = result?.report ?? {}
  const markdown = typeof report.markdown === 'string' ? report.markdown : renderMarkdown(result)
  const schematicSvg =
    typeof report.schematicSvg === 'string' ? report.schematicSvg : renderSchematicSvg(proposal)
  const bodeSvg =
    typeof report.bodeSvg === 'string' ? report.bodeSvg : renderBodeSvg(result?.ac ?? {}, { outNode })

  try {
    await mkdir(outDir, { recursive: true })
    await writeJsonFile(join(outDir, 'proposal.json'), proposal)
    await writeJsonFile(join(outDir, 'verification.json'), verification)
    await writeJsonFile(join(outDir, 'netlist.json'), proposal.netlist ?? result?.netlist ?? null)
    await writeTextFile(join(outDir, 'report.md'), markdown)
    await writeTextFile(join(outDir, 'schematic.svg'), schematicSvg)
    await writeTextFile(join(outDir, 'bode.svg'), bodeSvg)

    const checks = Array.isArray(verification.checks) ? verification.checks : []
    const failedChecks = checks.filter((check) => check?.pass !== true).map((check) => check?.id)
    const summary = {
      schema: 'cir/DesignSummary/v1',
      specId,
      topology: proposal.topology ?? null,
      pass: verification.pass === true,
      metrics,
      checks: {
        total: checks.length,
        passed: checks.filter((check) => check?.pass === true).length,
        failed: failedChecks,
      },
      artifacts: {
        proposal: 'proposal.json',
        verification: 'verification.json',
        netlist: 'netlist.json',
        report: 'report.md',
        schematicSvg: 'schematic.svg',
        bodeSvg: 'bode.svg',
        summary: 'summary.json',
      },
      generatedBy: 'circuit-pilot/cli',
    }
    await writeJsonFile(join(outDir, 'summary.json'), summary)
  } catch (error) {
    err(`Error: no se pudieron escribir los artefactos en "${outDir}": ${error?.message ?? error}`)
    return 1
  }

  const passed = verification.pass === true
  out(`${passed ? '✓ PASS' : '✗ FAIL'} ${specId} — ${proposal.topology ?? 'topología desconocida'}`)
  for (const line of summarizeMetrics(metrics)) out(line)
  const checks = Array.isArray(verification.checks) ? verification.checks : []
  const passedChecks = checks.filter((check) => check?.pass === true).length
  out(`  Checks: ${passedChecks}/${checks.length}`)
  if (!passed) {
    for (const check of checks) {
      if (check?.pass !== true) {
        out(`    ✗ ${check?.id ?? '?'}: requerido ${JSON.stringify(check?.required)} — medido ${JSON.stringify(check?.actual)}`)
      }
    }
  }
  out(`  Artefactos: ${outDir}`)
  out('  Archivos: proposal.json, verification.json, netlist.json, report.md, schematic.svg, bode.svg, summary.json')

  return passed ? 0 : 1
}

/* ------------------------------------------------------------------ */
/* Comando: solve                                                      */
/* ------------------------------------------------------------------ */

async function cmdSolve(parsed) {
  if (!parsed.netlistPath) return usageError('falta <netlist.json> para el comando "solve"')

  let netlist
  try {
    netlist = await readJsonFile(parsed.netlistPath)
  } catch (error) {
    return usageError(`no se pudo leer el netlist "${parsed.netlistPath}": ${error?.message ?? error}`)
  }

  const solver = await loadSolver()
  if (!solver) return 1

  if (typeof solver.validateNetlist === 'function') {
    const validation = solver.validateNetlist(netlist)
    if (validation && validation.ok === false) {
      err('Error: netlist inválido:')
      for (const line of validation.errors ?? []) err(`  - ${line}`)
      return 1
    }
  }

  try {
    const dc = solver.solveDc(netlist)
    const ac = solver.solveAc(netlist, { frequencies: DEFAULT_AC_FREQUENCIES })
    out(JSON.stringify({ dc, ac }, null, 2))
    return 0
  } catch (error) {
    err(`Error: el solver falló: ${error?.message ?? error}`)
    return 1
  }
}

/* ------------------------------------------------------------------ */
/* Comando: selftest                                                   */
/* ------------------------------------------------------------------ */

async function cmdSelftest() {
  const specsDir = join(ROOT, 'examples', 'specs')
  let files
  try {
    files = (await readdir(specsDir)).filter((file) => file.endsWith('.json')).sort()
  } catch (error) {
    err(`Error: no se pudo leer ${specsDir}: ${error?.message ?? error}`)
    return 1
  }
  if (files.length === 0) {
    err(`Error: no hay specs de ejemplo en ${specsDir}.`)
    return 1
  }

  const designPipeline = await loadPipeline()
  if (!designPipeline) return 1

  let failures = 0
  for (const file of files) {
    const specPath = join(specsDir, file)
    try {
      const spec = await readJsonFile(specPath)
      const result = await designPipeline(spec, {})
      const proposal = result?.proposal ?? {}
      const report = result?.report ?? {}
      const markdown = typeof report.markdown === 'string' ? report.markdown : renderMarkdown(result)
      const schematicSvg =
        typeof report.schematicSvg === 'string' ? report.schematicSvg : renderSchematicSvg(proposal)
      const bodeSvg =
        typeof report.bodeSvg === 'string'
          ? report.bodeSvg
          : renderBodeSvg(result?.ac ?? {}, { outNode: pickOutNode(proposal) })
      const artifactsOk =
        markdown.includes('# ') && schematicSvg.includes('<svg') && bodeSvg.includes('<svg')
      const pass = result?.verification?.pass === true && artifactsOk

      if (!pass) failures += 1
      const gain = result?.metrics?.gain?.measured
      const bandwidth = result?.metrics?.bandwidthHz
      const gainText = Number.isFinite(gain) ? `G=${gain.toFixed(2)}` : 'G=—'
      const bandwidthText = Number.isFinite(bandwidth) ? `BW=${bandwidth.toFixed(0)} Hz` : 'BW=—'
      out(`${pass ? '✓' : '✗'} ${file} — ${proposal.topology ?? '—'} · ${gainText} · ${bandwidthText}`)

      if (!pass) {
        const checks = result?.verification?.checks ?? []
        for (const check of checks) {
          if (check?.pass !== true) out(`    ✗ ${check?.id ?? '?'}: ${JSON.stringify(check?.actual)}`)
        }
        if (!artifactsOk) out('    ✗ reportes incompletos (se esperaba Markdown y dos SVG)')
      }
    } catch (error) {
      failures += 1
      err(`✗ ${file} — error: ${error?.message ?? error}`)
    }
  }

  out('')
  out(`${files.length - failures}/${files.length} ejemplos OK`)
  return failures === 0 ? 0 : 1
}

/* ------------------------------------------------------------------ */
/* Comando: bench                                                      */
/* ------------------------------------------------------------------ */

async function cmdBench(parsed) {
  const benchPath = join(ROOT, 'scripts', 'bench.js')
  if (!existsSync(benchPath)) {
    err('bench no disponible: falta scripts/bench.js (lo provee el adaptador de solver).')
    err('Cuando exista, este comando lo ejecuta con node y propaga su código de salida.')
    return 1
  }

  const args = [benchPath]
  if (Number.isInteger(parsed.iterations)) args.push('--iterations', String(parsed.iterations))

  // cwd del runner: los backends mojo/wasm resuelven rutas relativas a `src/solver`,
  // por lo tanto el bench debe correr desde la raíz del repo (donde vive `wasm/`).
  const benchCwd = join(ROOT)
  return await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { cwd: benchCwd, stdio: 'inherit' })
    child.on('error', (error) => {
      err(`Error: no se pudo ejecutar scripts/bench.js: ${error?.message ?? error}`)
      resolvePromise(1)
    })
    child.on('close', (code, signal) => {
      if (signal) {
        err(`bench terminó por señal ${signal}.`)
        resolvePromise(1)
      } else {
        resolvePromise(code ?? 1)
      }
    })
  })
}

/* ------------------------------------------------------------------ */
/* Punto de entrada                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ejecuta la CLI y devuelve el código de salida (no llama a process.exit).
 * @param {string[]} [argv]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2)) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    return usageError(error?.message ?? error)
  }
  if (parsed.error) return usageError(parsed.error)
  if (parsed.help) {
    out(HELP)
    return 0
  }
  if (parsed.version) {
    out(`circuit-pilot ${VERSION}`)
    return 0
  }

  switch (parsed.command) {
    case undefined:
      out(HELP)
      return 0
    case 'design':
      return cmdDesign(parsed)
    case 'solve':
      return cmdSolve(parsed)
    case 'selftest':
      return cmdSelftest()
    case 'bench':
      return cmdBench(parsed)
    default:
      return usageError(`comando desconocido "${parsed.command}"`)
  }
}

function isMainModule() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    // realpath resuelve symlinks (p. ej. /tmp -> /private/tmp en macOS).
    return pathToFileURL(realpathSync(resolve(entry))).href === import.meta.url
  } catch {
    try {
      return pathToFileURL(resolve(entry)).href === import.meta.url
    } catch {
      return false
    }
  }
}

if (isMainModule()) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      err(`Error inesperado: ${error?.stack ?? error}`)
      process.exitCode = 1
    })
}
