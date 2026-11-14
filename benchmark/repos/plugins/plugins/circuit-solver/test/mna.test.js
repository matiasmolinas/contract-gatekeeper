/**
 * Tests del solver MNA (`src/core/mna.js`).
 * Todos los circuitos tienen solución analítica conocida.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { load } from '#runtime'
const { validateNetlist, solveDc, solveAc, opAmpGain, NetlistError, DEFAULT_AC_FREQUENCIES } = await load('circuit.simulate')
const TAU = 2 * Math.PI

/** Arma un netlist con el schema del contrato. */
function netlist(nodes, elements) {
  return { schema: 'cir/Netlist/v1', nodes, elements }
}

/** Compara números con tolerancia relativa (y absoluta mínima). */
function assertClose(actual, expected, relTol = 1e-9, label = '') {
  const tolerance = Math.max(Math.abs(expected) * relTol, 1e-12)
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: esperado ${expected}, obtenido ${actual} (tolerancia ${tolerance})`,
  )
}

/** Módulo de un fasor. */
function magnitude(value) {
  return Math.hypot(value.re, value.im)
}

/** Fase de un fasor en radianes. */
function phase(value) {
  return Math.atan2(value.im, value.re)
}

const DIVIDER = netlist(['0', 'in', 'mid'], [
  { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 10 },
  { type: 'R', name: 'R1', a: 'in', b: 'mid', valueOhm: 1000 },
  { type: 'R', name: 'R2', a: 'mid', b: '0', valueOhm: 1000 },
])

const RC_LOWPASS = netlist(['0', 'in', 'out'], [
  { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 1 },
  { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
  { type: 'C', name: 'C1', a: 'out', b: '0', valueF: 1e-6 },
])

test('validateNetlist acepta un netlist válido', () => {
  assert.deepEqual(validateNetlist(DIVIDER), { ok: true, errors: [] })
})

test('validateNetlist reporta errores claros', () => {
  const cases = [
    {
      name: 'ground faltante',
      value: netlist(['in', 'mid'], [{ type: 'R', name: 'R1', a: 'in', b: 'mid', valueOhm: 1000 }]),
      pattern: /E_GROUND/,
    },
    {
      name: 'nodo inexistente',
      value: netlist(['0', 'in'], [{ type: 'R', name: 'R1', a: 'in', b: 'x', valueOhm: 1000 }]),
      pattern: /nodo inexistente 'x'/,
    },
    {
      name: 'resistencia <= 0',
      value: netlist(['0', 'in'], [
        { type: 'R', name: 'R1', a: 'in', b: '0', valueOhm: 0 },
      ]),
      pattern: /debe ser > 0/,
    },
    {
      name: 'tipo desconocido',
      value: netlist(['0', 'in'], [
        { type: 'D', name: 'D1', a: 'in', b: '0', valueV: 1 },
      ]),
      pattern: /tipo desconocido/,
    },
    {
      name: 'nombre duplicado',
      value: netlist(['0', 'in'], [
        { type: 'R', name: 'R1', a: 'in', b: '0', valueOhm: 1000 },
        { type: 'R', name: 'R1', a: 'in', b: '0', valueOhm: 2000 },
      ]),
      pattern: /duplicado/,
    },
    {
      name: 'fuente cortocircuitada',
      value: netlist(['0', 'in'], [
        { type: 'V', name: 'V1', a: 'in', b: 'in', valueV: 1 },
      ]),
      pattern: /mismo nodo/,
    },
    {
      name: 'OPAMP con polo negativo',
      value: netlist(['0', 'in', 'out'], [
        { type: 'OPAMP', name: 'U1', inP: 'in', inN: 'out', out: 'out', gain: 1e6, poleHz: -1 },
      ]),
      pattern: /poleHz/,
    },
    {
      name: 'resistencia no finita',
      value: netlist(['0', 'in'], [
        { type: 'R', name: 'R1', a: 'in', b: '0', valueOhm: Number.NaN },
      ]),
      pattern: /número finito/,
    },
    { name: 'netlist nulo', value: null, pattern: /E_NETLIST/ },
  ]
  for (const testCase of cases) {
    const result = validateNetlist(testCase.value)
    assert.equal(result.ok, false, `${testCase.name}: debería ser inválido`)
    assert.ok(
      result.errors.some((error) => testCase.pattern.test(error)),
      `${testCase.name}: faltó un error que matchee ${testCase.pattern}; errores: ${JSON.stringify(result.errors)}`,
    )
  }
})

test('solveDc: divisor resistivo de 10 V con R iguales da 5 V', () => {
  const dc = solveDc(DIVIDER)
  assert.equal(dc.schema, 'cir/DcResult/v1')
  assertClose(dc.nodeVoltages.mid, 5, 1e-12, 'mid')
  assertClose(dc.nodeVoltages.in, 10, 1e-12, 'in')
  assert.equal(dc.nodeVoltages['0'], 0)
  // Corriente de rama de la fuente: circula de 'in' hacia '0' por dentro de V1.
  assertClose(dc.branchCurrents.V1, -0.005, 1e-12, 'I(V1)')
  assert.deepEqual(dc.warnings, [])
})

test('solveDc: una fuente de corriente de 1 mA sobre 1 kΩ entrega 1 V', () => {
  const dc = solveDc(
    netlist(['0', 'out'], [
      { type: 'I', name: 'I1', a: 'out', b: '0', valueA: 1e-3 },
      { type: 'R', name: 'R1', a: 'out', b: '0', valueOhm: 1000 },
    ]),
  )
  assertClose(dc.nodeVoltages.out, 1, 1e-12, 'out')
})

test('solveDc: el capacitor es un circuito abierto', () => {
  const dc = solveDc(
    netlist(['0', 'in', 'out'], [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 10 },
      { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
      { type: 'R', name: 'R2', a: 'out', b: '0', valueOhm: 1000 },
      { type: 'C', name: 'C1', a: 'out', b: '0', valueF: 1e-6 },
    ]),
  )
  assertClose(dc.nodeVoltages.out, 5, 1e-12, 'out')
})

test('solveDc: el inductor es un corto (fuente de 0 V)', () => {
  const dc = solveDc(
    netlist(['0', 'in', 'out'], [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 10 },
      { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
      { type: 'L', name: 'L1', a: 'out', b: '0', valueH: 1e-3 },
    ]),
  )
  assertClose(dc.nodeVoltages.out, 0, 1e-9, 'out')
  assertClose(dc.branchCurrents.L1, 0.01, 1e-9, 'I(L1)')
})

test('solveDc: puente de Wheatstone desbalanceado', () => {
  const dc = solveDc(
    netlist(['0', 'in', 'a', 'b'], [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 10 },
      { type: 'R', name: 'R1', a: 'in', b: 'a', valueOhm: 1000 },
      { type: 'R', name: 'R2', a: 'a', b: '0', valueOhm: 1000 },
      { type: 'R', name: 'R3', a: 'in', b: 'b', valueOhm: 1000 },
      { type: 'R', name: 'R4', a: 'b', b: '0', valueOhm: 2000 },
    ]),
  )
  assertClose(dc.nodeVoltages.a, 5, 1e-12, 'Va')
  assertClose(dc.nodeVoltages.b, 20 / 3, 1e-12, 'Vb')
  assertClose(dc.nodeVoltages.a - dc.nodeVoltages.b, -5 / 3, 1e-12, 'Va-Vb')
})

test('solveDc: amplificador no inversor con VCVS ideal (ganancia 10)', () => {
  const dc = solveDc(
    netlist(['0', 'vin', 'fb', 'out'], [
      { type: 'V', name: 'V1', a: 'vin', b: '0', valueV: 0.1 },
      { type: 'VCVS', name: 'U1', outP: 'out', outN: '0', inP: 'vin', inN: 'fb', gain: 1e8 },
      { type: 'R', name: 'R1', a: 'fb', b: '0', valueOhm: 1000 },
      { type: 'R', name: 'R2', a: 'out', b: 'fb', valueOhm: 9000 },
    ]),
  )
  // A/(1 + A/10) ≈ 10 con error relativo ~1e-7 para A = 1e8.
  assertClose(dc.nodeVoltages.out, 1, 1e-6, 'out')
  assert.ok('U1' in dc.branchCurrents, 'el VCVS debe exponer corriente de rama')
})

test('solveDc: amplificador inversor con VCVS ideal (ganancia -10)', () => {
  const dc = solveDc(
    netlist(['0', 'vin', 'sum', 'out'], [
      { type: 'V', name: 'V1', a: 'vin', b: '0', valueV: 0.1 },
      { type: 'R', name: 'R1', a: 'vin', b: 'sum', valueOhm: 1000 },
      { type: 'R', name: 'R2', a: 'sum', b: 'out', valueOhm: 10000 },
      // VCVS como op-amp ideal: entrada no inversora a ground, inversora al nodo suma.
      { type: 'VCVS', name: 'U1', outP: 'out', outN: '0', inP: '0', inN: 'sum', gain: 1e8 },
    ]),
  )
  assertClose(dc.nodeVoltages.out, -1, 1e-6, 'out')
})

test('solveDc: amplificador inversor con OPAMP (ganancia -10)', () => {
  const dc = solveDc(
    netlist(['0', 'vin', 'sum', 'out'], [
      { type: 'V', name: 'V1', a: 'vin', b: '0', valueV: 0.1 },
      { type: 'R', name: 'R1', a: 'vin', b: 'sum', valueOhm: 1000 },
      { type: 'R', name: 'R2', a: 'sum', b: 'out', valueOhm: 10000 },
      { type: 'OPAMP', name: 'U1', inP: '0', inN: 'sum', out: 'out', gain: 1e8, poleHz: 1e6 },
    ]),
  )
  assertClose(dc.nodeVoltages.out, -1, 1e-6, 'out')
})

test('solveDc: seguidor con OPAMP y carga resistiva expone la corriente de salida', () => {
  const dc = solveDc(
    netlist(['0', 'in', 'out'], [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 0.5 },
      { type: 'OPAMP', name: 'U1', inP: 'in', inN: 'out', out: 'out', gain: 1e8, poleHz: 1e6 },
      { type: 'R', name: 'R1', a: 'out', b: '0', valueOhm: 1000 },
    ]),
  )
  assertClose(dc.nodeVoltages.out, 0.5, 1e-8, 'out')
  assertClose(dc.branchCurrents.U1, -0.0005, 1e-8, 'I(U1)')
})

test('solveAc: RC pasabajos vale 1/√2 y −45° en fc = 1/(2πRC)', () => {
  const fc = 1 / (TAU * 1000 * 1e-6)
  const ac = solveAc(RC_LOWPASS, { frequencies: [fc] })
  const out = ac.points[0].nodeVoltages.out
  assertClose(magnitude(out), 1 / Math.SQRT2, 1e-12, '|H(fc)|')
  assertClose(out.re, 0.5, 1e-12, 'Re')
  assertClose(out.im, -0.5, 1e-12, 'Im')
  assertClose(phase(out), -Math.PI / 4, 1e-12, 'fase')
})

test('solveAc: RL pasabajos/altopas con ωL = R vale 1/√2 y +45°', () => {
  // Con R = 1 kΩ y L = 1 H, ω = 1000 rad/s.
  const frequency = 1000 / TAU
  const ac = solveAc(
    netlist(['0', 'in', 'out'], [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 1 },
      { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
      { type: 'L', name: 'L1', a: 'out', b: '0', valueH: 1 },
    ]),
    { frequencies: [frequency] },
  )
  const out = ac.points[0].nodeVoltages.out
  assertClose(magnitude(out), 1 / Math.SQRT2, 1e-12, '|H|')
  assertClose(phase(out), Math.PI / 4, 1e-12, 'fase')
  // En AC el inductor no es incógnita de rama.
  assert.deepEqual(Object.keys(ac.points[0].branchCurrents), ['V1'])
})

test('solveDc: un OPAMP con poleHz = 0 modela un op-amp ideal (ganancia constante)', () => {
  const dc = solveDc(
    netlist(['0', 'in', 'out'], [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 0.5 },
      { type: 'OPAMP', name: 'U1', inP: 'in', inN: 'out', out: 'out', gain: 1e9, poleHz: 0 },
    ]),
  )
  // Error de ganancia finita ~1/A = 1e-9.
  assertClose(dc.nodeVoltages.out, 0.5, 1e-8, 'out')
  const ac = solveAc(
    netlist(['0', 'in', 'out'], [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 1 },
      { type: 'OPAMP', name: 'U1', inP: 'in', inN: 'out', out: 'out', gain: 1e9, poleHz: 0 },
    ]),
    { frequencies: [1e6] },
  )
  // Ideal: |Vout| = A/(1+A) ≈ 1 en cualquier frecuencia.
  assertClose(magnitude(ac.points[0].nodeVoltages.out), 1, 1e-6, '|Vout| AC')
})

test('solveAc: la ganancia compleja del OPAMP afecta el seguidor en f = poleHz', () => {
  const ac = solveAc(
    netlist(['0', 'in', 'out'], [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 1 },
      { type: 'OPAMP', name: 'U1', inP: 'in', inN: 'out', out: 'out', gain: 10, poleHz: 1000 },
    ]),
    { frequencies: [1000] },
  )
  // A = 10/(1+j) = 5−5j → Vout = A/(1+A) → |Vout| = √3050/61.
  assertClose(magnitude(ac.points[0].nodeVoltages.out), Math.sqrt(3050) / 61, 1e-9, '|Vout|')
})

test('solveAc devuelve el shape del contrato, con ground complejo 0', () => {
  const fc = 1 / (TAU * 1000 * 1e-6)
  const ac = solveAc(RC_LOWPASS, { frequencies: [fc / 10, fc, fc * 10] })
  assert.equal(ac.schema, 'cir/AcResult/v1')
  assert.equal(ac.points.length, 3)
  assert.deepEqual(ac.warnings, [])
  const point = ac.points[1]
  assert.equal(point.fHz, fc)
  assert.deepEqual(Object.keys(point.nodeVoltages).sort(), ['0', 'in', 'out'])
  assert.deepEqual(point.nodeVoltages['0'], { re: 0, im: 0 })
  assertClose(point.nodeVoltages.in.re, 1, 1e-12, 'Re(Vin)')
  assertClose(point.nodeVoltages.in.im, 0, 1e-12, 'Im(Vin)')
  assert.deepEqual(Object.keys(point.branchCurrents), ['V1'])
})

test('solveAc usa el barrido por defecto sólo si no se pasan frecuencias', () => {
  const ac = solveAc(RC_LOWPASS)
  assert.deepEqual(
    ac.points.map((point) => point.fHz),
    [...DEFAULT_AC_FREQUENCIES],
  )
})

test('solveAc rechaza frecuencias inválidas con código estable', () => {
  const cases = [
    { options: { frequencies: [] }, label: 'arreglo vacío' },
    { options: { frequencies: [0] }, label: 'cero' },
    { options: { frequencies: [-10] }, label: 'negativa' },
    { options: { frequencies: ['100'] }, label: 'string' },
  ]
  for (const testCase of cases) {
    assert.throws(
      () => solveAc(RC_LOWPASS, testCase.options),
      (error) => {
        assert.ok(error instanceof NetlistError, `${testCase.label}: NetlistError`)
        assert.ok(
          error.code === 'INVALID_FREQUENCIES' || error.code === 'INVALID_FREQUENCY',
          `${testCase.label}: código ${error.code}`,
        )
        return true
      },
    )
  }
})

test('opAmpGain: un polo, f = 0 → gain; f = poleHz → gain/2 − j·gain/2', () => {
  const model = { gain: 1e6, poleHz: 10 }
  assert.deepEqual(opAmpGain(0, model), { re: 1e6, im: 0 })
  assert.deepEqual(opAmpGain(10, model), { re: 5e5, im: -5e5 })
  const far = opAmpGain(1000, model)
  assertClose(magnitude(far), 1e6 / Math.sqrt(10001), 1e-12, '|A(1kHz)|')
  assertClose(phase(far), -Math.atan(100), 1e-12, 'fase')
  // poleHz <= 0 se interpreta como op-amp ideal (sin polo).
  assert.deepEqual(opAmpGain(123, { gain: 10, poleHz: 0 }), { re: 10, im: 0 })
})

test('opAmpGain valida el modelo', () => {
  assert.throws(() => opAmpGain(1, null), /INVALID_OPAMP_MODEL|modelo/)
  assert.throws(() => opAmpGain(1, { poleHz: 10 }), /INVALID_OPAMP_MODEL|modelo/)
  assert.throws(() => opAmpGain(-1, { gain: 1, poleHz: 10 }), /INVALID_FREQUENCY|frecuencia/)
})

test('solveDc: una red singular lanza NetlistError con código SINGULAR_MATRIX', () => {
  assert.throws(
    () =>
      solveDc(
        netlist(['0', 'a', 'sin_conexion'], [
          { type: 'R', name: 'R1', a: 'a', b: '0', valueOhm: 1000 },
          { type: 'V', name: 'V1', a: 'a', b: '0', valueV: 1 },
        ]),
      ),
    (error) => {
      assert.ok(error instanceof NetlistError)
      assert.equal(error.code, 'SINGULAR_MATRIX')
      assert.match(error.message, /singular/i)
      return true
    },
  )
})

test('solveDc: un netlist inválido lanza NetlistError NETLIST_INVALID', () => {
  assert.throws(
    () =>
      solveDc(
        netlist(['a', 'b'], [
          { type: 'R', name: 'R1', a: 'a', b: 'b', valueOhm: 1000 },
        ]),
      ),
    (error) => {
      assert.ok(error instanceof NetlistError)
      assert.equal(error.code, 'NETLIST_INVALID')
      assert.match(error.message, /ground/)
      return true
    },
  )
})
