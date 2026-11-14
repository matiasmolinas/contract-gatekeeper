/**
 * Tests del álgebra compleja (`src/core/complex.js`).
 * Casos algebraicos exactos, con tolerancia 1e-12.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { load } from '#runtime'
const { abs, add, arg, complex, div, fmt, isZero, mul, neg, scale, sub } = await load('circuit.simulate')
const EPS = 1e-12

/** Compara números con tolerancia relativa y absoluta. */
function assertClose(actual, expected, eps = EPS) {
  const scaleRef = Math.max(1, Math.abs(expected))
  assert.ok(
    Math.abs(actual - expected) <= eps * scaleRef,
    `esperado ${expected}, obtenido ${actual} (tolerancia ${eps})`,
  )
}

/** Compara complejos componente a componente. */
function assertComplexClose(actual, expected, eps = EPS) {
  assertClose(actual.re, expected.re, eps)
  assertClose(actual.im, expected.im, eps)
}

test('complex() construye un complejo con parte imaginaria 0 por defecto', () => {
  assert.deepEqual(complex(3), { re: 3, im: 0 })
  assert.deepEqual(complex(1.5, -2), { re: 1.5, im: -2 })
})

test('add/sub son exactas y no mutan las entradas', () => {
  const a = complex(1, 2)
  const b = complex(3, -4)
  assert.deepEqual(add(a, b), { re: 4, im: -2 })
  assert.deepEqual(sub(a, b), { re: -2, im: 6 })
  assert.deepEqual(a, { re: 1, im: 2 })
  assert.deepEqual(b, { re: 3, im: -4 })
})

test('mul respeta la suma de fases: (1+2j)(3−4j) = 11+2j', () => {
  assertComplexClose(mul(complex(1, 2), complex(3, -4)), complex(11, 2))
})

test('div calcula el cociente: (1+2j)/(3−4j) = −0.2+0.4j', () => {
  assertComplexClose(div(complex(1, 2), complex(3, -4)), complex(-0.2, 0.4))
})

test('div es inversa de mul', () => {
  const a = complex(2.5, -1.25)
  const b = complex(-0.75, 3.5)
  assertComplexClose(div(mul(a, b), b), a, 1e-10)
})

test('div lanza Error("DIVISION_BY_ZERO") cuando el divisor es nulo', () => {
  assert.throws(
    () => div(complex(1, 2), complex(0, 0)),
    (error) => {
      assert.equal(error.message, 'DIVISION_BY_ZERO')
      assert.equal(error.code, 'DIVISION_BY_ZERO')
      return true
    },
  )
  // También con un divisor numéricamente nulo dentro del épsilon.
  assert.throws(() => div(complex(1, 0), complex(1e-15, -1e-15)), /DIVISION_BY_ZERO/)
})

test('neg y scale', () => {
  assert.deepEqual(neg(complex(1, -2)), { re: -1, im: 2 })
  assert.deepEqual(scale(complex(2, -3), 2), { re: 4, im: -6 })
  assert.deepEqual(scale(complex(2, -3), 0), { re: 0, im: -0 })
})

test('abs y arg', () => {
  assertClose(abs(complex(3, 4)), 5)
  assertClose(abs(complex(0, 0)), 0)
  assertClose(arg(complex(0, 1)), Math.PI / 2)
  assertClose(arg(complex(-1, 0)), Math.PI)
  assertClose(arg(complex(1, 1)), Math.PI / 4)
  assertClose(arg(complex(-1, -1)), (-3 * Math.PI) / 4)
  assert.equal(arg(complex(0, 0)), 0)
})

test('isZero usa el épsilon configurable', () => {
  assert.equal(isZero(complex(0, 0)), true)
  assert.equal(isZero(complex(1e-15, -1e-15)), true)
  assert.equal(isZero(complex(1e-6, 0)), false)
  assert.equal(isZero(complex(1e-6, 0), 1e-5), true)
})

test('fmt produce el formato "re±imj" con tres decimales', () => {
  assert.equal(fmt(complex(1.234, 2)), '1.234+2.000j')
  assert.equal(fmt(complex(1.5, -0.25)), '1.500-0.250j')
  assert.equal(fmt(complex(-0.5, 0)), '-0.500+0.000j')
})

test('las operaciones son puras (entradas congeladas no se mutan)', () => {
  const a = Object.freeze(complex(1, 2))
  const b = Object.freeze(complex(3, -4))
  assert.doesNotThrow(() => {
    add(a, b)
    sub(a, b)
    mul(a, b)
    div(a, b)
    neg(a)
    scale(a, 3)
    abs(a)
    arg(a)
    isZero(a)
    fmt(a)
  })
  assert.deepEqual(a, { re: 1, im: 2 })
  assert.deepEqual(b, { re: 3, im: -4 })
})
