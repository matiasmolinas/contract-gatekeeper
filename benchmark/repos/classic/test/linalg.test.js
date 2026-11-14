/**
 * Tests del álgebra lineal (`src/core/linalg.js`): Gauss con pivoteo parcial,
 * en dominio real y complejo, sin mutar entradas.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { complex } from '../src/core/complex.js'
import { SingularMatrixError, solveComplex, solveReal } from '../src/core/linalg.js'

const EPS = 1e-10

/** Compara vectores numéricos con tolerancia relativa. */
function assertVectorClose(actual, expected, eps = EPS) {
  assert.equal(actual.length, expected.length)
  expected.forEach((value, index) => {
    const reference = Math.max(1, Math.abs(value))
    assert.ok(
      Math.abs(actual[index] - value) <= eps * reference,
      `posición ${index}: esperado ${value}, obtenido ${actual[index]}`,
    )
  })
}

/** Compara vectores de complejos. */
function assertComplexVectorClose(actual, expected, eps = EPS) {
  assert.equal(actual.length, expected.length)
  expected.forEach((value, index) => {
    const referenceRe = Math.max(1, Math.abs(value.re))
    const referenceIm = Math.max(1, Math.abs(value.im))
    assert.ok(Math.abs(actual[index].re - value.re) <= eps * referenceRe, `re[${index}]`)
    assert.ok(Math.abs(actual[index].im - value.im) <= eps * referenceIm, `im[${index}]`)
  })
}

test('solveReal resuelve un sistema 2×2 conocido', () => {
  const A = [
    [2, 1],
    [1, 3],
  ]
  // 2x + y = 5; x + 3y = 10 → x = 1, y = 3.
  const x = solveReal(A, [5, 10])
  assertVectorClose(x, [1, 3])
})

test('solveReal pivotea cuando el pivote natural es cero', () => {
  const A = [
    [0, 1],
    [1, 0],
  ]
  // y = 2; x = 3.
  const x = solveReal(A, [2, 3])
  assertVectorClose(x, [3, 2])
})

test('solveReal resuelve un sistema triangular 3×3', () => {
  const A = [
    [1, 2, 3],
    [0, 4, 5],
    [0, 0, 6],
  ]
  const expected = [1, -1, 2]
  const b = [
    1 * expected[0] + 2 * expected[1] + 3 * expected[2],
    4 * expected[1] + 5 * expected[2],
    6 * expected[2],
  ]
  assertVectorClose(solveReal(A, b), expected)
})

test('solveReal no muta la matriz ni el vector de entrada', () => {
  const A = [
    [4, -2, 1],
    [-2, 4, -2],
    [1, -2, 4],
  ]
  const b = [11, -16, 17]
  const aCopy = A.map((row) => row.slice())
  const bCopy = b.slice()
  solveReal(A, b)
  assert.deepEqual(A, aCopy)
  assert.deepEqual(b, bCopy)
})

test('solveReal lanza SingularMatrixError con matriz singular', () => {
  assert.throws(
    () =>
      solveReal(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    (error) => {
      assert.ok(error instanceof SingularMatrixError)
      assert.ok(error instanceof Error)
      assert.equal(error.name, 'SingularMatrixError')
      assert.match(error.message, /singular/i)
      return true
    },
  )
})

test('solveReal detecta un pivote numéricamente nulo', () => {
  assert.throws(
    () =>
      solveReal(
        [
          [1, 2],
          [2, 4 + 1e-13],
        ],
        [1, 2],
      ),
    SingularMatrixError,
  )
})

test('solveComplex resuelve A·x = b con coeficientes complejos', () => {
  // A triangular superior, x = [1+1j, 2−1j].
  const A = [
    [complex(1, 1), complex(2, 0)],
    [complex(0, 0), complex(3, -1)],
  ]
  // b se calcula a mano: b0 = 4, b1 = 5−5j.
  const x = solveComplex(A, [complex(4, 0), complex(5, -5)])
  assertComplexVectorClose(x, [complex(1, 1), complex(2, -1)])
})

test('solveComplex pivotea por módulo cuando hace falta', () => {
  const A = [
    [complex(0, 0), complex(1, 0)],
    [complex(1, 0), complex(0, 0)],
  ]
  assertComplexVectorClose(solveComplex(A, [complex(2, 0), complex(3, 0)]), [
    complex(3, 0),
    complex(2, 0),
  ])
})

test('solveComplex no muta entradas y respeta A·x = b', () => {
  const A = [
    [complex(2, 1), complex(-1, 0)],
    [complex(1, -1), complex(3, 2)],
  ]
  const b = [complex(4, 2), complex(1, -3)]
  const aCopy = A.map((row) => row.map((value) => ({ ...value })))
  const bCopy = b.map((value) => ({ ...value }))
  const x = solveComplex(A, b)
  assert.deepEqual(A, aCopy)
  assert.deepEqual(b, bCopy)
  // Verificación directa del residual A·x − b.
  for (let row = 0; row < 2; row += 1) {
    let sum = complex(0, 0)
    for (let column = 0; column < 2; column += 1) {
      sum = {
        re: sum.re + A[row][column].re * x[column].re - A[row][column].im * x[column].im,
        im: sum.im + A[row][column].re * x[column].im + A[row][column].im * x[column].re,
      }
    }
    const reference = Math.max(1, Math.abs(b[row].re), Math.abs(b[row].im))
    assert.ok(Math.abs(sum.re - b[row].re) <= 1e-10 * reference)
    assert.ok(Math.abs(sum.im - b[row].im) <= 1e-10 * reference)
  }
})

test('solveComplex lanza SingularMatrixError con matriz compleja singular', () => {
  assert.throws(
    () =>
      solveComplex(
        [
          [complex(1, 0), complex(0, 0)],
          [complex(2, 0), complex(0, 0)],
        ],
        [complex(1, 0), complex(2, 0)],
      ),
    SingularMatrixError,
  )
})

test('errores de dimensiones son claros y no son SingularMatrixError', () => {
  assert.throws(() => solveReal([[1, 2]], [1, 2]), /INVALID_MATRIX/)
  assert.throws(() => solveReal([[1, 2], [3, 4]], [1, 2, 3]), /INVALID_MATRIX/)
  assert.throws(() => solveReal([], []), /INVALID_MATRIX/)
  assert.throws(() => solveComplex([[complex(1, 0)]], []), /INVALID_MATRIX/)
})
