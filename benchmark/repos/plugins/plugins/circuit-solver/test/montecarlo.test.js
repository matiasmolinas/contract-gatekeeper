/**
 * Tests de Monte Carlo (`src/core/montecarlo.js`): PRNG determinista,
 * perturbación de resistencias y estadísticos reproducibles.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { load } from '#runtime'
const { solveDc } = await load('circuit.simulate')
const { mulberry32, runMonteCarlo } = await load('circuit.simulate')
/** Divisor 10 V con R1 = R2 = 10 kΩ → 5 V nominales en el nodo medio. */
function buildDivider() {
  return {
    schema: 'cir/Netlist/v1',
    nodes: ['0', 'in', 'mid'],
    elements: [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 10 },
      { type: 'R', name: 'R1', a: 'in', b: 'mid', valueOhm: 10000 },
      { type: 'R', name: 'R2', a: 'mid', b: '0', valueOhm: 10000 },
    ],
  }
}

/** Evalúa la tensión del nodo medio del divisor. */
function evaluateDivider(netlist) {
  return solveDc(netlist).nodeVoltages.mid
}

test('mulberry32 es determinista para la misma semilla', () => {
  const first = mulberry32(12345)
  const second = mulberry32(12345)
  const sequenceA = Array.from({ length: 20 }, () => first())
  const sequenceB = Array.from({ length: 20 }, () => second())
  assert.deepEqual(sequenceA, sequenceB)
})

test('mulberry32 produce valores en [0, 1) y depende de la semilla', () => {
  const random = mulberry32(7)
  const sequence = Array.from({ length: 100 }, () => random())
  for (const value of sequence) {
    assert.ok(value >= 0 && value < 1, `fuera de rango: ${value}`)
  }
  // No es una secuencia constante.
  assert.ok(new Set(sequence).size > 90)
  const other = mulberry32(8)
  const otherSequence = Array.from({ length: 100 }, () => other())
  assert.notDeepEqual(sequence, otherSequence)
})

test('runMonteCarlo: resumen estadístico del divisor de 5 V', () => {
  const netlist = buildDivider()
  const result = runMonteCarlo({
    netlist,
    runs: 300,
    tolerancePct: 10,
    seed: 42,
    evaluate: evaluateDivider,
  })
  assert.equal(result.samples.length, 300)
  // Por simetría R1 ↔ R2 la media esperada es 5 V.
  assert.ok(Math.abs(result.mean - 5) < 0.05, `media inesperada: ${result.mean}`)
  assert.ok(result.stdDev > 0, 'el desvío estándar debe ser positivo')
  assert.ok(result.p5 < result.mean && result.mean < result.p95)
  // Cota física con tolerancias de ±10 % en ambas resistencias.
  const worstHigh = (10 * 1.1 * 10000) / (0.9 * 10000 + 1.1 * 10000)
  const worstLow = (10 * 0.9 * 10000) / (1.1 * 10000 + 0.9 * 10000)
  for (const sample of result.samples) {
    assert.ok(sample >= worstLow - 1e-9 && sample <= worstHigh + 1e-9, `muestra fuera de cota: ${sample}`)
  }
})

test('runMonteCarlo es reproducible para el mismo seed', () => {
  const params = {
    netlist: buildDivider(),
    runs: 60,
    tolerancePct: 5,
    seed: 2026,
    evaluate: evaluateDivider,
  }
  const first = runMonteCarlo(params)
  const second = runMonteCarlo({ ...params, netlist: buildDivider() })
  assert.deepEqual(first.samples, second.samples)
  assert.equal(first.mean, second.mean)
  assert.equal(first.stdDev, second.stdDev)
  assert.equal(first.p5, second.p5)
  assert.equal(first.p95, second.p95)
})

test('runMonteCarlo cambia con el seed', () => {
  const base = {
    netlist: buildDivider(),
    runs: 40,
    tolerancePct: 5,
    evaluate: evaluateDivider,
  }
  const first = runMonteCarlo({ ...base, seed: 1 })
  const second = runMonteCarlo({ ...base, seed: 2 })
  assert.notDeepEqual(first.samples, second.samples)
})

test('runMonteCarlo no muta el netlist original', () => {
  const netlist = buildDivider()
  const snapshot = JSON.parse(JSON.stringify(netlist))
  runMonteCarlo({ netlist, runs: 25, tolerancePct: 20, seed: 3, evaluate: evaluateDivider })
  assert.deepEqual(netlist, snapshot)
})

test('runMonteCarlo perturba cada resistencia sólo dentro de ±tolerancePct', () => {
  const netlist = buildDivider()
  const observed = []
  runMonteCarlo({
    netlist,
    runs: 50,
    tolerancePct: 10,
    seed: 99,
    evaluate: (perturbed) => {
      for (const element of perturbed.elements) {
        if (element.type === 'R') observed.push(element.valueOhm)
      }
      return 0
    },
  })
  assert.equal(observed.length, 100)
  for (const valueOhm of observed) {
    assert.ok(valueOhm >= 9000 - 1e-9 && valueOhm <= 11000 + 1e-9, `R perturbada fuera de rango: ${valueOhm}`)
  }
  // Al menos una muestra debe diferir del valor nominal.
  assert.ok(observed.some((valueOhm) => Math.abs(valueOhm - 10000) > 1e-9))
})

test('runMonteCarlo con tolerancePct = 0 devuelve muestras constantes', () => {
  const result = runMonteCarlo({
    netlist: buildDivider(),
    runs: 20,
    tolerancePct: 0,
    seed: 5,
    evaluate: evaluateDivider,
  })
  for (const sample of result.samples) {
    assert.ok(Math.abs(sample - 5) < 1e-12)
  }
  assert.equal(result.stdDev, 0)
  assert.equal(result.p5, 5)
  assert.equal(result.p95, 5)
})

test('runMonteCarlo llama a evaluate exactamente runs veces', () => {
  let calls = 0
  runMonteCarlo({
    netlist: buildDivider(),
    runs: 17,
    tolerancePct: 1,
    seed: 11,
    evaluate: () => {
      calls += 1
      return 0
    },
  })
  assert.equal(calls, 17)
})

test('runMonteCarlo valida sus parámetros', () => {
  const netlist = buildDivider()
  assert.throws(() => runMonteCarlo({ netlist, runs: 0, tolerancePct: 1, seed: 1, evaluate: () => 0 }), /runs/)
  assert.throws(() => runMonteCarlo({ netlist, runs: 1.5, tolerancePct: 1, seed: 1, evaluate: () => 0 }), /runs/)
  assert.throws(
    () => runMonteCarlo({ netlist, runs: 1, tolerancePct: -1, seed: 1, evaluate: () => 0 }),
    /tolerancePct/,
  )
  assert.throws(() => runMonteCarlo({ netlist, runs: 1, tolerancePct: 1, seed: NaN, evaluate: () => 0 }), /seed/)
  assert.throws(() => runMonteCarlo({ netlist, runs: 1, tolerancePct: 1, seed: 1 }), /evaluate/)
  assert.throws(() => runMonteCarlo({ runs: 1, tolerancePct: 1, seed: 1, evaluate: () => 0 }), /netlist/)
  assert.throws(
    () => runMonteCarlo({ netlist, runs: 1, tolerancePct: 1, seed: 1, evaluate: () => Number.NaN }),
    /finito/,
  )
})
