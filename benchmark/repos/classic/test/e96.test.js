import test from 'node:test'
import assert from 'node:assert/strict'
import { E96, nearestE96, e96Values, formatOhm } from '../src/core/e96.js'

test('E96 contiene las 96 mantisas ordenadas de 1.00 a 9.76', () => {
  assert.equal(E96.length, 96)
  assert.equal(E96[0], 1)
  assert.equal(E96[E96.length - 1], 9.76)
  for (let index = 1; index < E96.length; index += 1) {
    assert.ok(E96[index] > E96[index - 1], `E96[${index}] debe ser mayor que E96[${index - 1}]`)
  }
  for (const value of E96) {
    assert.ok(value >= 1 && value < 10, `mantisa fuera de [1, 10): ${value}`)
  }
})

test('nearestE96 devuelve el mismo valor con error 0 para toda la serie', () => {
  for (const mantissa of E96) {
    for (const scale of [1, 100, 1000, 10000, 1000000]) {
      const value = Number((mantissa * scale).toPrecision(12))
      const nearest = nearestE96(value)
      assert.equal(nearest.valueOhm, value, `nearestE96(${value})`)
      assert.ok(Math.abs(nearest.errorPct) < 1e-9, `error de ${value} debe ser 0`)
    }
  }
})

test('nearestE96 redondea al valor comercial más cercano y reporta el error', () => {
  const result = nearestE96(202)
  assert.equal(result.valueOhm, 200)
  assert.ok(result.errorPct < 0)
  assert.ok(Math.abs(result.errorPct - -0.9900990099009901) < 1e-9)
})

test('nearestE96 cruza la frontera de década (9.9 kΩ → 10 kΩ)', () => {
  const result = nearestE96(9900)
  assert.equal(result.valueOhm, 10000)
  assert.ok(result.errorPct > 0)
  assert.ok(Math.abs(result.errorPct - 1.0101010101010102) < 1e-9)
})

test('nearestE96 rechaza valores no positivos o no finitos', () => {
  for (const invalid of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => nearestE96(invalid), RangeError)
  }
})

test('e96Values devuelve todos los valores de la serie en el rango', () => {
  const values = e96Values(100, 1000)
  assert.equal(values.length, 97) // 96 mantisas × 100 Ω + el 1.00 kΩ del extremo
  assert.equal(values[0], 100)
  assert.equal(values[values.length - 1], 1000)
  for (const value of values) {
    assert.ok(value >= 100 && value <= 1000)
  }
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] > values[index - 1])
  }
  assert.deepEqual(e96Values(1000, 1000), [1000])
})

test('e96Values valida el rango', () => {
  assert.throws(() => e96Values(1000, 100), RangeError)
  assert.throws(() => e96Values(0, 100), RangeError)
  assert.throws(() => e96Values(100, Number.NaN), RangeError)
})

test('formatOhm usa prefijos legibles', () => {
  assert.equal(formatOhm(10000), '10 kΩ')
  assert.equal(formatOhm(202), '202 Ω')
  assert.equal(formatOhm(9760), '9.76 kΩ')
  assert.equal(formatOhm(4990), '4.99 kΩ')
  assert.equal(formatOhm(1000000), '1 MΩ')
  assert.equal(formatOhm(1500000), '1.5 MΩ')
  assert.equal(formatOhm(102), '102 Ω')
  assert.equal(formatOhm(Number.NaN), '—')
})
