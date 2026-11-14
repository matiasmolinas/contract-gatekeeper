/**
 * Monte Carlo de tolerancias sobre resistencias.
 *
 * Sin dependencias: el generador `mulberry32` es determinista para una semilla
 * dada, así que dos corridas con el mismo `seed` devuelven exactamente la misma
 * muestra (requisito de reproducibilidad del piloto).
 */
/** Clona un netlist plano (sólo datos JSON: nodos, elementos y valores). */
function cloneNetlist(netlist) {
  return structuredClone(netlist)
}

/**
 * PRNG determinista `mulberry32`: devuelve una función que produce números
 * uniformes en `[0, 1)` a partir de una semilla entera de 32 bits.
 *
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Percentil con interpolación lineal sobre un arreglo ya ordenado.
 * @param {number[]} sorted
 * @param {number} quantile en [0, 1]
 */
function percentile(sorted, quantile) {
  if (sorted.length === 0) return Number.NaN
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * quantile
  const low = Math.floor(position)
  const high = Math.ceil(position)
  if (low === high) return sorted[low]
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}

/**
 * Perturba uniformemente cada resistencia `±tolerancePct` (una muestra por
 * corrida), evalúa el circuito y resume la distribución resultante.
 *
 * @param {{
 *   netlist: any,
 *   runs: number,
 *   tolerancePct: number,
 *   seed: number,
 *   evaluate: (netlistPerturbed: any) => number,
 * }} params
 * @returns {{ samples: number[], mean: number, stdDev: number, p5: number, p95: number }}
 */
export function runMonteCarlo(params) {
  const { netlist, runs, tolerancePct = 0, seed = 0, evaluate } = params ?? {}
  if (netlist === null || typeof netlist !== 'object' || !Array.isArray(netlist.elements)) {
    throw new Error('runMonteCarlo requiere un netlist con elements')
  }
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`runMonteCarlo: runs debe ser un entero >= 1 (recibido ${runs})`)
  }
  if (typeof tolerancePct !== 'number' || !Number.isFinite(tolerancePct) || tolerancePct < 0) {
    throw new Error(`runMonteCarlo: tolerancePct debe ser un número finito >= 0 (recibido ${tolerancePct})`)
  }
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new Error(`runMonteCarlo: seed debe ser un número finito (recibido ${seed})`)
  }
  if (typeof evaluate !== 'function') {
    throw new Error('runMonteCarlo: evaluate debe ser una función')
  }

  const random = mulberry32(seed)
  const spread = tolerancePct / 100
  const samples = []
  for (let run = 0; run < runs; run += 1) {
    const perturbed = cloneNetlist(netlist)
    for (const element of perturbed.elements) {
      if (element?.type !== 'R') continue
      // Siempre se consume una muestra: el orden de los sorteos no depende de tolerancePct.
      const factor = 1 + (2 * random() - 1) * spread
      element.valueOhm = element.valueOhm * factor
    }
    const value = evaluate(perturbed)
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `runMonteCarlo: evaluate devolvió ${String(value)} en la corrida ${run + 1}; se esperaba un número finito`,
      )
    }
    samples.push(value)
  }

  const sorted = [...samples].sort((left, right) => left - right)
  let sum = 0
  for (const sample of samples) sum += sample
  const mean = sum / samples.length
  let squaredSum = 0
  for (const sample of samples) {
    const deviation = sample - mean
    squaredSum += deviation * deviation
  }
  // Desvío estándar poblacional (ddof = 0): la muestra es la distribución completa.
  const stdDev = Math.sqrt(squaredSum / samples.length)
  return { samples, mean, stdDev, p5: percentile(sorted, 0.05), p95: percentile(sorted, 0.95) }
}
