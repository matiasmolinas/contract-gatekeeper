/**
 * Serie E96 (IEC 60063) y utilidades de selección de resistencias.
 *
 * La serie normalizada contiene 96 mantisas por década, de 1.00 a 9.76. El
 * valor comercial es `mantisa × 10^n`, con `n` entero. Este módulo no tiene
 * dependencias y es puramente determinista: no usa red, reloj ni azar.
 */

/**
 * Mantisas E96 (96 valores, 1.00 … 9.76), ordenadas de menor a mayor.
 * @type {ReadonlyArray<number>}
 */
export const E96 = Object.freeze([
  1.0, 1.02, 1.05, 1.07, 1.1, 1.13, 1.15, 1.18, 1.21, 1.24,
  1.27, 1.3, 1.33, 1.37, 1.4, 1.43, 1.47, 1.5, 1.54, 1.58,
  1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.0,
  2.05, 2.1, 2.15, 2.21, 2.26, 2.32, 2.37, 2.43, 2.49, 2.55,
  2.61, 2.67, 2.74, 2.8, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24,
  3.32, 3.4, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12,
  4.22, 4.32, 4.42, 4.53, 4.64, 4.75, 4.87, 4.99, 5.11, 5.23,
  5.36, 5.49, 5.62, 5.76, 5.9, 6.04, 6.19, 6.34, 6.49, 6.65,
  6.81, 6.98, 7.15, 7.32, 7.5, 7.68, 7.87, 8.06, 8.25, 8.45,
  8.66, 8.87, 9.09, 9.31, 9.53, 9.76,
])

/** Tolerancia relativa usada para comparar valores flotantes de la serie. */
const REL_EPS = 1e-9

/** @param {unknown} value */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Redondea el producto mantisa × 10^n a 12 cifras significativas para evitar
 * artefactos binarios (p. ej. `2.05 * 100 = 204.99999999999997`).
 * @param {number} value
 * @returns {number}
 */
function canonicalize(value) {
  return Number(value.toPrecision(12))
}

/**
 * Valida que un valor sea un número positivo finito.
 * @param {unknown} value
 * @param {string} context
 * @returns {number}
 */
function requirePositive(value, context) {
  if (!isFiniteNumber(value) || value <= 0) {
    throw new RangeError(
      `${context}: se esperaba un número finito > 0 (recibido ${String(value)})`,
    )
  }
  return value
}

/**
 * Devuelve el valor E96 comercial más cercano a `valueOhm`.
 *
 * Considera las décadas vecinas para que los valores cercanos a un cambio de
 * década elijan correctamente (p. ej. 9.9 kΩ → 10 kΩ).
 *
 * @param {number} valueOhm valor ideal en ohmios (> 0)
 * @returns {{ valueOhm: number, errorPct: number }} valor comercial y error
 *   relativo en porcentaje: `(comercial − ideal) / ideal · 100`.
 */
export function nearestE96(valueOhm) {
  const requested = requirePositive(valueOhm, 'nearestE96')
  const exponent = Math.floor(Math.log10(requested))
  let best = null
  for (let decade = exponent - 1; decade <= exponent + 1; decade += 1) {
    const scale = 10 ** decade
    for (const mantissa of E96) {
      const candidate = canonicalize(mantissa * scale)
      if (candidate <= 0) continue
      const errorPct = ((candidate - requested) / requested) * 100
      const distance = Math.abs(errorPct)
      if (
        best === null ||
        distance < best.distance - REL_EPS ||
        (Math.abs(distance - best.distance) <= REL_EPS && candidate < best.valueOhm)
      ) {
        best = { valueOhm: candidate, errorPct, distance }
      }
    }
  }
  return { valueOhm: best.valueOhm, errorPct: best.errorPct }
}

/**
 * Todos los valores E96 en el rango cerrado `[minOhm, maxOhm]`, ordenados.
 *
 * @param {number} minOhm límite inferior en ohmios (> 0)
 * @param {number} maxOhm límite superior en ohmios (>= minOhm)
 * @returns {number[]}
 */
export function e96Values(minOhm, maxOhm) {
  const min = requirePositive(minOhm, 'e96Values(min)')
  const max = requirePositive(maxOhm, 'e96Values(max)')
  if (max < min) {
    throw new RangeError(`e96Values: maxOhm (${max}) debe ser >= minOhm (${min})`)
  }
  const tolerance = max * REL_EPS
  const firstDecade = Math.floor(Math.log10(min)) - 1
  const lastDecade = Math.floor(Math.log10(max)) + 1
  const values = []
  const seen = new Set()
  for (let decade = firstDecade; decade <= lastDecade; decade += 1) {
    const scale = 10 ** decade
    for (const mantissa of E96) {
      const candidate = canonicalize(mantissa * scale)
      if (candidate < min - tolerance || candidate > max + tolerance) continue
      if (seen.has(candidate)) continue
      seen.add(candidate)
      values.push(candidate)
    }
  }
  values.sort((left, right) => left - right)
  return values
}

/**
 * Formatea una resistencia en ohmios con prefijo legible.
 * Ejemplos: `10000` → `"10 kΩ"`, `202` → `"202 Ω"`, `1500000` → `"1.5 MΩ"`.
 *
 * @param {number} valueOhm
 * @returns {string}
 */
export function formatOhm(valueOhm) {
  if (!isFiniteNumber(valueOhm)) return '—'
  const abs = Math.abs(valueOhm)
  let scaled
  let unit
  if (abs >= 1e6) {
    scaled = valueOhm / 1e6
    unit = 'MΩ'
  } else if (abs >= 1e3) {
    scaled = valueOhm / 1e3
    unit = 'kΩ'
  } else {
    scaled = valueOhm
    unit = 'Ω'
  }
  return `${formatNumber(scaled)} ${unit}`
}

/**
 * Redondea a 4 cifras significativas y quita ceros innecesarios.
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
  if (value === 0) return '0'
  const rounded = Number(value.toPrecision(4))
  return String(rounded)
}
