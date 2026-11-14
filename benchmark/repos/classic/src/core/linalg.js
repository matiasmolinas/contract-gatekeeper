/**
 * Álgebra lineal densa del piloto: resolución de `A·x = b` real y compleja
 * mediante eliminación gaussiana con pivoteo parcial.
 *
 * Ambas rutinas copian la matriz y el vector (nunca mutan las entradas) y
 * lanzan `SingularMatrixError` cuando el pivote máximo de una columna cae por
 * debajo de `PIVOT_EPS`.
 */
import { abs as complexAbs, div as complexDiv, mul as complexMul, sub as complexSub } from './complex.js'

/** Umbral de pivoteo: por debajo de este módulo la matriz se considera singular. */
export const PIVOT_EPS = 1e-12

/** Error estable para matrices singulares o mal condicionadas. */
export class SingularMatrixError extends Error {
  /**
   * @param {string} [message]
   * @param {object} [options]
   */
  constructor(message = 'Matriz singular: pivote máximo por debajo del umbral', options) {
    super(message, options)
    this.name = 'SingularMatrixError'
    this.code = 'SINGULAR_MATRIX'
  }
}

/**
 * Valida dimensiones y devuelve el número de incógnitas.
 * @param {Array<Array<number|object>>} A
 * @param {Array<number|object>} b
 * @returns {number}
 */
function requireSquareSystem(A, b) {
  if (!Array.isArray(A) || A.length === 0) {
    throw new Error('INVALID_MATRIX: A debe ser una matriz no vacía')
  }
  const n = A.length
  if (!Array.isArray(b) || b.length !== n) {
    throw new Error('INVALID_MATRIX: b debe ser un arreglo de igual longitud que A')
  }
  for (const row of A) {
    if (!Array.isArray(row) || row.length !== n) {
      throw new Error('INVALID_MATRIX: A debe ser cuadrada (n × n)')
    }
  }
  return n
}

/**
 * Resuelve `A·x = b` con coeficientes reales (Gauss, pivoteo parcial).
 * @param {number[][]} A
 * @param {number[]} b
 * @returns {number[]}
 * @throws {SingularMatrixError} si la matriz es singular
 */
export function solveReal(A, b) {
  const n = requireSquareSystem(A, b)
  // Copia profunda de las filas: no mutamos las entradas.
  const M = A.map((row) => row.slice())
  const y = b.slice()

  for (let column = 0; column < n; column += 1) {
    // Pivoteo parcial: fila con mayor |valor| en la columna.
    let pivotRow = column
    let pivotMagnitude = Math.abs(M[column][column])
    for (let row = column + 1; row < n; row += 1) {
      const magnitude = Math.abs(M[row][column])
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude
        pivotRow = row
      }
    }
    if (pivotMagnitude < PIVOT_EPS) {
      throw new SingularMatrixError(
        `Matriz singular: pivote ${pivotMagnitude} < ${PIVOT_EPS} en la columna ${column}`,
      )
    }
    if (pivotRow !== column) {
      const tmpRow = M[column]
      M[column] = M[pivotRow]
      M[pivotRow] = tmpRow
      const tmpValue = y[column]
      y[column] = y[pivotRow]
      y[pivotRow] = tmpValue
    }
    const pivot = M[column][column]
    for (let row = column + 1; row < n; row += 1) {
      const factor = M[row][column] / pivot
      if (factor === 0) continue
      M[row][column] = 0
      for (let k = column + 1; k < n; k += 1) {
        M[row][k] -= factor * M[column][k]
      }
      y[row] -= factor * y[column]
    }
  }

  // Sustitución regresiva.
  const x = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = y[row]
    for (let k = row + 1; k < n; k += 1) {
      sum -= M[row][k] * x[k]
    }
    x[row] = sum / M[row][row]
  }
  return x
}

/**
 * Resuelve `A·x = b` con coeficientes complejos (Gauss, pivoteo parcial por módulo).
 * @param {import('./complex.js').Complex[][]} A
 * @param {import('./complex.js').Complex[]} b
 * @returns {import('./complex.js').Complex[]}
 * @throws {SingularMatrixError} si la matriz es singular
 */
export function solveComplex(A, b) {
  const n = requireSquareSystem(A, b)
  // Copia de las filas: los objetos complejos son inmutables por convención.
  const M = A.map((row) => row.slice())
  const y = b.slice()

  for (let column = 0; column < n; column += 1) {
    let pivotRow = column
    let pivotMagnitude = complexAbs(M[column][column])
    for (let row = column + 1; row < n; row += 1) {
      const magnitude = complexAbs(M[row][column])
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude
        pivotRow = row
      }
    }
    if (pivotMagnitude < PIVOT_EPS) {
      throw new SingularMatrixError(
        `Matriz compleja singular: pivote ${pivotMagnitude} < ${PIVOT_EPS} en la columna ${column}`,
      )
    }
    if (pivotRow !== column) {
      const tmpRow = M[column]
      M[column] = M[pivotRow]
      M[pivotRow] = tmpRow
      const tmpValue = y[column]
      y[column] = y[pivotRow]
      y[pivotRow] = tmpValue
    }
    const pivot = M[column][column]
    for (let row = column + 1; row < n; row += 1) {
      const factor = complexDiv(M[row][column], pivot)
      if (complexAbs(factor) === 0) continue
      M[row][column] = { re: 0, im: 0 }
      for (let k = column + 1; k < n; k += 1) {
        M[row][k] = complexSub(M[row][k], complexMul(factor, M[column][k]))
      }
      y[row] = complexSub(y[row], complexMul(factor, y[column]))
    }
  }

  // Sustitución regresiva.
  const x = new Array(n).fill(null)
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = y[row]
    for (let k = row + 1; k < n; k += 1) {
      sum = complexSub(sum, complexMul(M[row][k], x[k]))
    }
    x[row] = complexDiv(sum, M[row][row])
  }
  return x
}
