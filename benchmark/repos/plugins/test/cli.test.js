/**
 * Tests de la CLI: --help, errores de uso y flujo end-to-end de "design".
 *
 * Los tests de integración se marcan como skip mientras los módulos que proveen
 * otros teammates (pipeline.js, mna.js) todavía no están integrados; al integrarse
 * corren automáticamente sin cambiar el test.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(ROOT, 'src', 'cli.js')
const SPEC_GAIN100 = join(ROOT, 'examples', 'specs', 'ia-gain100.json')

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })
}

async function canImport(relativePath) {
  try {
    await import(pathToFileURL(join(ROOT, relativePath)).href)
    return true
  } catch {
    return false
  }
}

const pipelineReady = await canImport('plugins/design-pipeline/index.js')
const mnaReady = await canImport('plugins/circuit-solver/index.js')

/* ------------------------------------------------------------------ */
/* Ayuda y errores de uso                                              */
/* ------------------------------------------------------------------ */

test('--help sale 0 y documenta los comandos', () => {
  const result = runCli(['--help'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  assert.match(result.stdout, /circuit-pilot/)
  for (const command of ['design', 'solve', 'selftest', 'bench', '--out', '--help']) {
    assert.ok(result.stdout.includes(command), `la ayuda debe mencionar ${command}`)
  }
})

test('sin argumentos muestra la ayuda y sale 0', () => {
  const result = runCli([])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  assert.match(result.stdout, /Uso:/)
})

test('comando desconocido sale 2 con mensaje claro', () => {
  const result = runCli(['frobnicate'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /desconocido/)
})

test('design sin spec sale 2', () => {
  const result = runCli(['design'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /falta <spec\.json>/)
})

test('opción desconocida sale 2', () => {
  const result = runCli(['design', SPEC_GAIN100, '--nope'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /opción desconocida/)
})

test('design con un spec inexistente sale 2', () => {
  const result = runCli(['design', join(ROOT, 'examples', 'specs', 'no-existe.json')])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /no se pudo leer el spec/)
})

test('--iterations inválido sale 2', () => {
  const result = runCli(['bench', '--iterations', 'abc'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--iterations/)
})

/* ------------------------------------------------------------------ */
/* End-to-end: design                                                  */
/* ------------------------------------------------------------------ */

test(
  'design crea todos los artefactos y el código de salida sigue a la verificación',
  { skip: pipelineReady ? false : 'src/core/pipeline.js todavía no está integrado' },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'circuit-pilot-'))
    const outDir = join(workDir, 'out')
    try {
      const result = runCli(['design', SPEC_GAIN100, '--out', outDir])
      assert.ok(
        result.status === 0 || result.status === 1,
        `código inesperado ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      )

      const files = await readdir(outDir)
      for (const expected of [
        'proposal.json',
        'verification.json',
        'report.md',
        'schematic.svg',
        'bode.svg',
        'summary.json',
        'netlist.json',
      ]) {
        assert.ok(files.includes(expected), `falta el artefacto ${expected}`)
      }

      const proposal = JSON.parse(await readFile(join(outDir, 'proposal.json'), 'utf8'))
      assert.ok(['three_op_amp', 'monolithic'].includes(proposal.topology))
      assert.ok(Array.isArray(proposal.resistors) && proposal.resistors.length > 0)

      const netlist = JSON.parse(await readFile(join(outDir, 'netlist.json'), 'utf8'))
      assert.equal(netlist.schema, 'cir/Netlist/v1')
      assert.ok(Array.isArray(netlist.elements) && netlist.elements.length > 0)

      const verification = JSON.parse(await readFile(join(outDir, 'verification.json'), 'utf8'))
      assert.equal(verification.schema, 'cir/Verification/v1')
      assert.equal(typeof verification.pass, 'boolean')

      const summary = JSON.parse(await readFile(join(outDir, 'summary.json'), 'utf8'))
      assert.equal(summary.schema, 'cir/DesignSummary/v1')
      assert.equal(summary.specId, 'ia-gain100')
      assert.equal(summary.pass, verification.pass)
      assert.equal(typeof summary.metrics.gain.measured, 'number')
      assert.equal(result.status, verification.pass ? 0 : 1, 'el exit code debe seguir a la verificación')

      const report = await readFile(join(outDir, 'report.md'), 'utf8')
      assert.match(report, /^# Reporte de diseño — ia-gain100/m)
      assert.ok(report.includes('## 5. Verificación por simulación'))
      assert.ok(report.includes('## 3. Resistencias seleccionadas'))

      const schematic = await readFile(join(outDir, 'schematic.svg'), 'utf8')
      assert.ok(schematic.trimStart().startsWith('<svg'))
      assert.ok(schematic.includes('</svg>'))

      const bode = await readFile(join(outDir, 'bode.svg'), 'utf8')
      assert.ok(bode.trimStart().startsWith('<svg'))
      assert.ok(bode.includes('</svg>'))
      assert.ok(bode.includes('Ganancia (dB)'))
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)

/* ------------------------------------------------------------------ */
/* End-to-end: solve                                                   */
/* ------------------------------------------------------------------ */

test(
  'solve resuelve un divisor en DC y AC e imprime JSON',
  { skip: mnaReady ? false : 'src/core/mna.js todavía no está integrado' },
  async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'circuit-pilot-solve-'))
    const netlistPath = join(workDir, 'netlist.json')
    try {
      const netlist = {
        schema: 'cir/Netlist/v1',
        nodes: ['0', '1'],
        elements: [
          { type: 'V', name: 'V1', a: '1', b: '0', valueV: 10 },
          { type: 'R', name: 'R1', a: '1', b: '0', valueOhm: 1000 },
        ],
      }
      await writeFile(netlistPath, `${JSON.stringify(netlist, null, 2)}\n`, 'utf8')

      const result = runCli(['solve', netlistPath])
      assert.equal(result.status, 0, `stderr: ${result.stderr}`)

      const output = JSON.parse(result.stdout)
      assert.equal(output.dc.schema, 'cir/DcResult/v1')
      assert.equal(output.ac.schema, 'cir/AcResult/v1')
      assert.ok(Math.abs(output.dc.nodeVoltages['1'] - 10) < 1e-9)
      assert.ok(output.ac.points.length > 1)
      assert.ok(Math.abs(output.ac.points[0].nodeVoltages['1'].re - 10) < 1e-9)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  },
)

test('solve sin netlist sale 2', () => {
  const result = runCli(['solve'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /falta <netlist\.json>/)
})

/* ------------------------------------------------------------------ */
/* Estructura del repo                                                 */
/* ------------------------------------------------------------------ */

test('existen los specs de ejemplo y cumplen el esquema', async () => {
  const specsDir = join(ROOT, 'examples', 'specs')
  const files = (await readdir(specsDir)).filter((file) => file.endsWith('.json')).sort()
  assert.ok(files.length >= 5, `se esperaban al menos 5 specs, hay ${files.length}`)

  const { load } = await import('#runtime')
  const { CIRCUIT_SPEC_SCHEMA, validate } = await load('contract.validate')
  for (const file of files) {
    const spec = JSON.parse(await readFile(join(specsDir, file), 'utf8'))
    const result = validate(CIRCUIT_SPEC_SCHEMA, spec)
    assert.ok(result.valid, `${file} no cumple cir/CircuitSpec/v1: ${JSON.stringify(result.errors)}`)
  }
})

test('el CLI tiene shebang de node', async () => {
  const cli = await readFile(CLI, 'utf8')
  assert.ok(cli.startsWith('#!/usr/bin/env node\n'), 'src/cli.js debe empezar con el shebang')
})
