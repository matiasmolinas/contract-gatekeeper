/**
 * Aritmética de números complejos sobre objetos planos `{ re, im }`.
 *
 * Se usa en todo el solver AC (admitancias, fasores y ganancia compleja de los
 * op-amps). Todas las funciones son puras: nunca mutan sus argumentos.
 *
 * @typedef {{ re: number, im: number }} Complex
 */

/** Épsilon por defecto para considerar un complejo nulo. */
export const ZERO_EPS = 1e-12

/**
 * Construye un complejo.
 * @param {number} re parte real
 * @param {number} [im] parte imaginaria
 * @returns {Complex}
 */
export function complex(re, im = 0) {
  return { re, im }
}

/**
 * Suma de complejos.
 * @param {Complex} a
 * @param {Complex} b
 * @returns {Complex}
 */
export function add(a, b) {
  return { re: a.re + b.re, im: a.im + b.im }
}

/**
 * Resta de complejos.
 * @param {Complex} a
 * @param {Complex} b
 * @returns {Complex}
 */
export function sub(a, b) {
  return { re: a.re - b.re, im: a.im - b.im }
}

/**
 * Producto de complejos.
 * @param {Complex} a
 * @param {Complex} b
 * @returns {Complex}
 */
export function mul(a, b) {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  }
}

/**
 * Cociente de complejos.
 * @param {Complex} a
 * @param {Complex} b
 * @returns {Complex}
 * @throws {Error} `DIVISION_BY_ZERO` si |b| es cero (dentro del épsilon).
 */
export function div(a, b) {
  if (isZero(b)) {
    const error = new Error('DIVISION_BY_ZERO')
    error.code = 'DIVISION_BY_ZERO'
    throw error
  }
  const denominator = b.re * b.re + b.im * b.im
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  }
}

/**
 * Negación de un complejo.
 * @param {Complex} a
 * @returns {Complex}
 */
export function neg(a) {
  return { re: -a.re, im: -a.im }
}

/**
 * Escala un complejo por un número real.
 * @param {Complex} a
 * @param {number} k
 * @returns {Complex}
 */
export function scale(a, k) {
  return { re: a.re * k, im: a.im * k }
}

/**
 * Módulo de un complejo.
 * @param {Complex} a
 * @returns {number}
 */
export function abs(a) {
  return Math.hypot(a.re, a.im)
}

/**
 * Argumento (fase) en radianes, en el rango (-π, π].
 * @param {Complex} a
 * @returns {number}
 */
export function arg(a) {
  return Math.atan2(a.im, a.re)
}

/**
 * Indica si un complejo es numéricamente cero.
 * @param {Complex} a
 * @param {number} [eps] umbral de módulo
 * @returns {boolean}
 */
export function isZero(a, eps = ZERO_EPS) {
  return abs(a) <= eps
}

/**
 * Formatea un complejo, p. ej. `"1.234+2.000j"`.
 * @param {Complex} a
 * @returns {string}
 */
export function fmt(a) {
  const sign = a.im >= 0 ? '+' : '-'
  return `${a.re.toFixed(3)}${sign}${Math.abs(a.im).toFixed(3)}j`
}
