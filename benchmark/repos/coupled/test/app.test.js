/* ===== complex ===== */
{
/**
 * Tests del álgebra compleja (`src/core/complex.js`).
 * Casos algebraicos exactos, con tolerancia 1e-12.
 */
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { abs, add, arg, complex, div, fmt, isZero, mul, neg, scale, sub } = await import('../src/app.js')
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
}

/* ===== linalg ===== */
{
/**
 * Tests del álgebra lineal (`src/core/linalg.js`): Gauss con pivoteo parcial,
 * en dominio real y complejo, sin mutar entradas.
 */
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { complex } = await import('../src/app.js')
const { SingularMatrixError, solveComplex, solveReal } = await import('../src/app.js')
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
}

/* ===== mna ===== */
{
/**
 * Tests del solver MNA (`src/core/mna.js`).
 * Todos los circuitos tienen solución analítica conocida.
 */
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { validateNetlist, solveDc, solveAc, opAmpGain, NetlistError, DEFAULT_AC_FREQUENCIES } = await import('../src/app.js')
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
}

/* ===== measure ===== */
{
/**
 * Tests de mediciones (`src/core/measure.js`): ganancia diferencial, CMRR y
 * ancho de banda −3 dB. Incluyen un amplificador de instrumentación de 3
 * op-amps con ganancia analítica (1 + 2·R1/Rg)·(R3/R2) = 101.
 */
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { bandwidthHz, measureCmrr, measureDifferentialGain } = await import('../src/app.js')
const { NetlistError, solveAc } = await import('../src/app.js')
const TAU = 2 * Math.PI

/** Compara números con tolerancia relativa. */
function assertClose(actual, expected, relTol, label = '') {
  const tolerance = Math.max(Math.abs(expected) * relTol, 1e-12)
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: esperado ${expected}, obtenido ${actual} (tolerancia ${tolerance})`,
  )
}

/** Barrido logarítmico determinista (sin reloj ni aleatoriedad). */
function logspace(minHz, maxHz, points) {
  const logMin = Math.log10(minHz)
  const logMax = Math.log10(maxHz)
  const step = (logMax - logMin) / (points - 1)
  return Array.from({ length: points }, (_, index) => 10 ** (logMin + step * index))
}

/**
 * Amplificador de instrumentación de 3 op-amps, sin fuentes de entrada
 * (las agrega `measure.js`). Ganancia esperada: (1 + 2·R1/Rg) · (R4/R3) = 101.
 */
function buildIaNetlist() {
  const opAmp = (name, inP, inN, out) => ({
    type: 'OPAMP',
    name,
    inP,
    inN,
    out,
    gain: 1e9,
    poleHz: 1e3,
  })
  return {
    schema: 'cir/Netlist/v1',
    nodes: ['0', 'in+', 'in-', 'n1', 'n2', 'o1', 'o2', 'n3', 'n4', 'out'],
    elements: [
      { type: 'R', name: 'R1', a: 'o1', b: 'n1', valueOhm: 10000 },
      { type: 'R', name: 'R2', a: 'o2', b: 'n2', valueOhm: 10000 },
      { type: 'R', name: 'Rg', a: 'n1', b: 'n2', valueOhm: 200 },
      // Segunda etapa: restador de ganancia unitaria.
      { type: 'R', name: 'R3', a: 'o2', b: 'n3', valueOhm: 10000 },
      { type: 'R', name: 'R4', a: 'o1', b: 'n4', valueOhm: 10000 },
      { type: 'R', name: 'R5', a: 'n3', b: 'out', valueOhm: 10000 },
      { type: 'R', name: 'R6', a: 'n4', b: '0', valueOhm: 10000 },
      opAmp('U1', 'in+', 'n1', 'o1'),
      opAmp('U2', 'in-', 'n2', 'o2'),
      opAmp('U3', 'n4', 'n3', 'out'),
    ],
  }
}

const IA_GAIN = (1 + (2 * 10000) / 200) * 1 // 101
const REL = 1e-6

test('measureDifferentialGain: IA de 3 op-amps con ganancia 101', () => {
  const { dc, ad, adDb } = measureDifferentialGain({
    netlist: buildIaNetlist(),
    outNode: 'out',
    inP: 'in+',
    inN: 'in-',
  })
  assertClose(ad, IA_GAIN, REL, 'ad')
  // A0 = 1e9 deja un error de ganancia finita ~1e-7: el dB se compara con 1e-6 relativo.
  assertClose(adDb, 20 * Math.log10(IA_GAIN), 1e-6, 'adDb')
  assert.equal(dc.schema, 'cir/DcResult/v1')
  // La excitación diferencial deja el modo común en 0.
  assertClose(dc.nodeVoltages['in+'], 0.5, 1e-12, 'V(in+)')
  assertClose(dc.nodeVoltages['in-'], -0.5, 1e-12, 'V(in-)')
  assertClose(dc.nodeVoltages.out, IA_GAIN, REL, 'V(out)')
})

test('measureDifferentialGain: la ganancia no depende de vd (linealidad)', () => {
  const small = measureDifferentialGain({
    netlist: buildIaNetlist(),
    outNode: 'out',
    inP: 'in+',
    inN: 'in-',
    vd: 0.01,
  })
  assertClose(small.ad, IA_GAIN, REL, 'ad(vd=0.01)')
})

test('measureDifferentialGain no muta el netlist original', () => {
  const original = buildIaNetlist()
  const snapshot = JSON.parse(JSON.stringify(original))
  measureDifferentialGain({ netlist: original, outNode: 'out', inP: 'in+', inN: 'in-' })
  assert.deepEqual(original, snapshot)
  assert.equal(
    original.elements.some((element) => element.name.startsWith('__meas')),
    false,
    'no deben quedar fuentes de medición en el original',
  )
})

test('measureCmrr: IA con resistencias apareadas tiene CMRR alto y ad correcta', () => {
  const { ad, ac, cmrrDb, dc } = measureCmrr({
    netlist: buildIaNetlist(),
    outNode: 'out',
    inP: 'in+',
    inN: 'in-',
  })
  assertClose(ad, IA_GAIN, REL, 'ad')
  assert.ok(Math.abs(ac) < 1e-3, `ganancia de modo común demasiado alta: ${ac}`)
  assert.ok(cmrrDb > 120, `CMRR esperado > 120 dB, obtenido ${cmrrDb}`)
  assert.equal(dc.schema, 'cir/DcResult/v1')
  // Con excitación de modo común pura, las dos entradas valen vcm = 1 V.
  assertClose(dc.nodeVoltages['in+'], 1, 1e-12, 'V(in+)')
  assertClose(dc.nodeVoltages['in-'], 1, 1e-12, 'V(in-)')
})

test('measureCmrr no muta el netlist original', () => {
  const original = buildIaNetlist()
  const snapshot = JSON.parse(JSON.stringify(original))
  measureCmrr({ netlist: original, outNode: 'out', inP: 'in+', inN: 'in-' })
  assert.deepEqual(original, snapshot)
})

test('las mediciones validan nodos y parámetros con errores claros', () => {
  const netlist = buildIaNetlist()
  assert.throws(
    () => measureDifferentialGain({ netlist, outNode: 'no_existe', inP: 'in+', inN: 'in-' }),
    (error) => {
      assert.ok(error instanceof NetlistError)
      assert.equal(error.code, 'MEASURE_NODE_MISSING')
      return true
    },
  )
  assert.throws(
    () => measureDifferentialGain({ netlist, outNode: 'out', inP: 'in+', inN: 'in+' }),
    /distintos/,
  )
  assert.throws(
    () => measureDifferentialGain({ netlist, outNode: 'out', inP: 'in+', inN: 'in-', vd: 0 }),
    /vd/,
  )
  assert.throws(
    () => measureCmrr({ netlist, outNode: 'out', inP: 'in+', inN: 'in-', vcm: 0 }),
    /vcm/,
  )
})

test('bandwidthHz: RC pasabajos da fc = 1/(2πRC) dentro del 0,1 %', () => {
  const netlist = {
    schema: 'cir/Netlist/v1',
    nodes: ['0', 'in', 'out'],
    elements: [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 1 },
      { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
      { type: 'C', name: 'C1', a: 'out', b: '0', valueF: 1e-6 },
    ],
  }
  const fc = 1 / (TAU * 1000 * 1e-6)
  const ac = solveAc(netlist, { frequencies: logspace(1, 1e5, 400) })
  const bandwidth = bandwidthHz(ac, { outNode: 'out', inP: 'in', inN: '0', dcGain: 1 })
  assertClose(bandwidth, fc, 1e-3, 'bw')
})

test('bandwidthHz: amplificador de un polo sigue GBW/ganancia', () => {
  const base = {
    schema: 'cir/Netlist/v1',
    nodes: ['0', 'in', 'fb', 'out'],
    elements: [
      { type: 'OPAMP', name: 'U1', inP: 'in', inN: 'fb', out: 'out', gain: 1e5, poleHz: 10 },
      { type: 'R', name: 'R1', a: 'fb', b: '0', valueOhm: 1000 },
      { type: 'R', name: 'R2', a: 'out', b: 'fb', valueOhm: 9000 },
    ],
  }
  // Ganancia DC exacta del lazo: 10·A0/(A0+10) ≈ 9.999.
  const dcGain = (10 * 1e5) / (1e5 + 10)
  // Para el barrido AC hace falta una fuente de entrada (0,5 V = vd/2 con vd = 1).
  const acNetlist = structuredClone(base)
  acNetlist.elements.push({ type: 'V', name: '__ac_vp', a: 'in', b: '0', valueV: 0.5 })
  const ac = solveAc(acNetlist, { frequencies: logspace(1, 1e6, 600) })
  const bandwidth = bandwidthHz(ac, { outNode: 'out', inP: 'in', inN: '0', dcGain })
  // Polo del lazo: poleHz·(A0 + 10)/10 = 100010 Hz.
  const expected = (10 * (1e5 + 10)) / 10
  assertClose(bandwidth, expected, 1e-3, 'bw')
})

test('bandwidthHz: cota inferior si el barrido no llega a −3 dB', () => {
  const netlist = {
    schema: 'cir/Netlist/v1',
    nodes: ['0', 'in', 'out'],
    elements: [
      { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 1 },
      { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
      { type: 'C', name: 'C1', a: 'out', b: '0', valueF: 1e-6 },
    ],
  }
  const ac = solveAc(netlist, { frequencies: [1, 2, 5, 10] })
  const bandwidth = bandwidthHz(ac, { outNode: 'out', inP: 'in', inN: '0', dcGain: 1 })
  assert.equal(bandwidth, 10)
})

test('bandwidthHz: dcGain nulo devuelve 0 y un AcResult inválido lanza error', () => {
  const ac = solveAc(
    {
      schema: 'cir/Netlist/v1',
      nodes: ['0', 'in', 'out'],
      elements: [
        { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 1 },
        { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
        { type: 'C', name: 'C1', a: 'out', b: '0', valueF: 1e-6 },
      ],
    },
    { frequencies: [1, 10] },
  )
  assert.equal(bandwidthHz(ac, { outNode: 'out', inP: 'in', inN: '0', dcGain: 0 }), 0)
  assert.throws(() => bandwidthHz(null, {}), /AcResult/)
})
}

/* ===== montecarlo ===== */
{
/**
 * Tests de Monte Carlo (`src/core/montecarlo.js`): PRNG determinista,
 * perturbación de resistencias y estadísticos reproducibles.
 */
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { solveDc } = await import('../src/app.js')
const { mulberry32, runMonteCarlo } = await import('../src/app.js')
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
}

/* ===== e96 ===== */
{
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { E96, nearestE96, e96Values, formatOhm } = await import('../src/app.js')
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
}

/* ===== ia ===== */
{
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { designIa, buildIaNetlist, evaluateProposal } = await import('../src/app.js')
const { nearestE96 } = await import('../src/app.js')
const { validateNetlist } = await import('../src/app.js')
const { CIRCUIT_SPEC_SCHEMA, DESIGN_PROPOSAL_SCHEMA, NETLIST_SCHEMA } = await import('../src/app.js')
const { validate } = await import('../src/app.js')
/** Spec base para los tests, con overrides de primer nivel. */
function baseSpec(overrides = {}) {
  return {
    schema: 'cir/CircuitSpec/v1',
    id: 'test-ia',
    target: 'instrumentation_amplifier',
    gain: { nominal: 100, tolerancePct: 1 },
    bandwidthHz: 10000,
    cmrrMinDb: 80,
    supply: { positiveV: 15, negativeV: -15 },
    inputRangeV: { minV: -0.01, maxV: 0.01 },
    sourceImpedanceOhm: 350,
    constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-10mhz' },
    ...overrides,
  }
}

/** Verifica que un valor sea exactamente un valor comercial E96. */
function assertE96(valueOhm, label) {
  const nearest = nearestE96(valueOhm)
  assert.equal(nearest.valueOhm, valueOhm, `${label} = ${valueOhm} no es un valor E96`)
}

test('designIa(gain 100) elige 3 op-amps con error de ganancia < 1 %', () => {
  const spec = baseSpec()
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, spec).valid, true)
  const proposal = designIa(spec)
  assert.equal(validate(DESIGN_PROPOSAL_SCHEMA, proposal).valid, true)
  assert.equal(proposal.topology, 'three_op_amp')
  assert.equal(proposal.specId, 'test-ia')
  assert.ok(Math.abs(proposal.expected.gainErrorPct) < 1)
  assert.ok(Math.abs(proposal.expected.gain - 100) < 1)

  const byName = new Map(proposal.resistors.map((resistor) => [resistor.name, resistor]))
  for (const name of ['R1', 'Rg', 'R2', 'R3']) {
    assert.ok(byName.has(name), `falta la resistencia ${name}`)
    assertE96(byName.get(name).valueOhm, name)
    assert.equal(byName.get(name).series, 'E96')
  }
  assert.equal(byName.get('R2').valueOhm, 10000)
  assert.equal(byName.get('R3').valueOhm, 10000)
  assert.equal(proposal.opAmps.length, 3)
  for (const opAmp of proposal.opAmps) {
    assert.ok(opAmp.gain > 1)
    assert.ok(opAmp.poleHz > 0)
  }
})

test('buildIaNetlist(3 op-amps) produce un netlist válido con los nodos del contrato', () => {
  const proposal = designIa(baseSpec())
  const netlist = buildIaNetlist(proposal)
  assert.equal(validate(NETLIST_SCHEMA, netlist).valid, true)
  assert.deepEqual(validateNetlist(netlist), { ok: true, errors: [] })
  assert.deepEqual(netlist.nodes, ['in+', 'in-', 'a_fb', 'b_fb', 'a', 'b', 'n', 'p', 'out', '0'])

  const opAmps = netlist.elements.filter((element) => element.type === 'OPAMP')
  assert.equal(opAmps.length, 3)
  assert.deepEqual(
    opAmps.map((opAmp) => [opAmp.inP, opAmp.inN, opAmp.out]),
    [
      ['in+', 'a_fb', 'a'],
      ['in-', 'b_fb', 'b'],
      ['p', 'n', 'out'],
    ],
  )
  // El netlist no trae fuentes: las agrega measure.js al medir.
  assert.equal(netlist.elements.some((element) => element.type === 'V'), false)
  // Nombres únicos y valores positivos.
  const names = netlist.elements.map((element) => element.name)
  assert.equal(new Set(names).size, names.length)
})

test('evaluateProposal devuelve DC, AC logarítmico 1 Hz–10 MHz y métricas coherentes', () => {
  const spec = baseSpec()
  const proposal = designIa(spec)
  const result = evaluateProposal(spec, proposal, { monteCarloRuns: 20, seed: 7 })

  assert.equal(result.dc.schema, 'cir/DcResult/v1')
  assert.equal(result.ac.schema, 'cir/AcResult/v1')
  assert.ok(result.ac.points.length >= 60, `puntos AC: ${result.ac.points.length}`)
  const first = result.ac.points[0]
  const last = result.ac.points[result.ac.points.length - 1]
  assert.ok(Math.abs(first.fHz - 1) < 1e-9)
  assert.ok(Math.abs(last.fHz - 10e6) < 1e-3)
  for (let index = 1; index < result.ac.points.length; index += 1) {
    assert.ok(result.ac.points[index].fHz > result.ac.points[index - 1].fHz)
  }
  assert.ok(result.ac.points[0].nodeVoltages['in+'])
  assert.ok(result.ac.points[0].nodeVoltages['out'])

  const { metrics } = result
  assert.equal(metrics.gain.nominal, 100)
  assert.ok(Math.abs(metrics.gain.measured - 100) / 100 < 0.01)
  assert.ok(Math.abs(metrics.gain.errorPct) < 1)
  assert.ok(Number.isFinite(metrics.gain.mcP95AbsPct) && metrics.gain.mcP95AbsPct >= 0)
  assert.ok(Number.isFinite(metrics.bandwidthHz) && metrics.bandwidthHz > 0)
  assert.ok(Number.isFinite(metrics.cmrrDb) && metrics.cmrrDb >= 80)
  assert.equal(metrics.cmrrMinDb, 80)

  // La ganancia medida debe coincidir con la esperada analítica (modelo ideal).
  assert.ok(Math.abs(metrics.gain.measured - proposal.expected.gain) / proposal.expected.gain < 0.01)
})

test('evaluateProposal es reproducible con la misma semilla y determinista', () => {
  const spec = baseSpec()
  const proposal = designIa(spec)
  const first = evaluateProposal(spec, proposal, { monteCarloRuns: 15, seed: 123 })
  const second = evaluateProposal(spec, proposal, { monteCarloRuns: 15, seed: 123 })
  assert.deepEqual(first.metrics, second.metrics)
  // Y designIa también es determinista.
  assert.deepEqual(designIa(spec), designIa(spec))
})

test('designIa elige la topología monolítica cuando es más precisa (INA128-like)', () => {
  const spec = baseSpec({
    id: 'mono-50',
    gain: { nominal: 50, tolerancePct: 5 },
    constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'ina128-like' },
  })
  const proposal = designIa(spec)
  assert.equal(proposal.topology, 'monolithic')
  assert.equal(proposal.resistors.length, 1)
  assert.equal(proposal.resistors[0].name, 'Rg')
  assertE96(proposal.resistors[0].valueOhm, 'Rg')
  assert.equal(validate(DESIGN_PROPOSAL_SCHEMA, proposal).valid, true)

  const netlist = buildIaNetlist(proposal)
  assert.deepEqual(validateNetlist(netlist), { ok: true, errors: [] })
  const opAmps = netlist.elements.filter((element) => element.type === 'OPAMP')
  assert.equal(opAmps.length, 1)
  assert.deepEqual([opAmps[0].inP, opAmps[0].inN, opAmps[0].out], ['p', 'n', 'out'])
  // La red de resistencias que realiza G = 1 + 50 kΩ/Rg está en el netlist.
  const resistorNames = netlist.elements
    .filter((element) => element.type === 'R')
    .map((element) => element.name)
  assert.deepEqual(resistorNames, ['Rg1', 'Rf1', 'Rf2', 'Rg2', 'Rf3', 'Rf4'])

  const { metrics } = evaluateProposal(spec, proposal, { monteCarloRuns: 20, seed: 5 })
  assert.ok(Math.abs(metrics.gain.measured - 50) / 50 < 0.01)
  // El Monte Carlo debe mover la ganancia: Rg entra en la red del netlist.
  assert.ok(metrics.gain.mcP95AbsPct > 0.05, `MC p95 = ${metrics.gain.mcP95AbsPct}`)
})

test('designIa respeta monolithicAllowed=false', () => {
  const spec = baseSpec({
    gain: { nominal: 50, tolerancePct: 5 },
    constraints: { resistorSeries: 'E96', monolithicAllowed: false, opAmpModel: 'generic-10mhz' },
  })
  const proposal = designIa(spec)
  assert.equal(proposal.topology, 'three_op_amp')
})

test('designIa considera el ancho de banda requerido al elegir valores E96', () => {
  const spec = baseSpec({
    id: 'bw-100k',
    gain: { nominal: 100, tolerancePct: 5 },
    bandwidthHz: 100000,
  })
  const proposal = designIa(spec)
  const { metrics } = evaluateProposal(spec, proposal, { monteCarloRuns: 15, seed: 9 })
  assert.ok(
    metrics.bandwidthHz >= spec.bandwidthHz,
    `ancho de banda ${metrics.bandwidthHz} Hz < requerido ${spec.bandwidthHz} Hz`,
  )
  // El error de ganancia sigue dentro de la tolerancia pedida.
  assert.ok(Math.abs(metrics.gain.errorPct) < spec.gain.tolerancePct)
})

test('designIa devuelve el mejor intento y preguntas si no alcanza la tolerancia', () => {
  const spec = baseSpec({ id: 'imposible', gain: { nominal: 100, tolerancePct: 0.05 } })
  const proposal = designIa(spec)
  assert.equal(proposal.topology, 'three_op_amp')
  assert.ok(Math.abs(proposal.expected.gainErrorPct) > 0.05)
  assert.ok(proposal.clarifyingQuestions.length >= 1)
  assert.ok(proposal.clarifyingQuestions.some((question) => /No se alcanzó/.test(question)))
  assert.equal(validate(DESIGN_PROPOSAL_SCHEMA, proposal).valid, true)
})

test('un op-amp de mayor GBW da más ancho de banda a igual ganancia', () => {
  const slowSpec = baseSpec({
    id: 'slow',
    constraints: { resistorSeries: 'E96', monolithicAllowed: false, opAmpModel: 'generic-1mhz' },
  })
  const fastSpec = baseSpec({
    id: 'fast',
    constraints: { resistorSeries: 'E96', monolithicAllowed: false, opAmpModel: 'generic-10mhz' },
  })
  const slow = evaluateProposal(slowSpec, designIa(slowSpec), { monteCarloRuns: 5, seed: 1 })
  const fast = evaluateProposal(fastSpec, designIa(fastSpec), { monteCarloRuns: 5, seed: 1 })
  assert.ok(fast.metrics.bandwidthHz > slow.metrics.bandwidthHz * 5)
})

test('el máximo de resistencias del spec fuerza la topología monolítica', () => {
  const spec = baseSpec({
    gain: { nominal: 100, tolerancePct: 5 },
    constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'ina128-like', maxResistors: 1 },
  })
  const proposal = designIa(spec)
  assert.equal(proposal.topology, 'monolithic')
  assert.ok(proposal.resistors.length <= 1)
})
}

/* ===== spec ===== */
{
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { defaultSpec, parseRequirement } = await import('../src/app.js')
const { CIRCUIT_SPEC_SCHEMA } = await import('../src/app.js')
const { validate, assertValid } = await import('../src/app.js')
const fullSpec = {
  schema: 'cir/CircuitSpec/v1',
  id: 'spec-completo',
  target: 'instrumentation_amplifier',
  gain: { nominal: 100, tolerancePct: 1.5 },
  bandwidthHz: 10000,
  cmrrMinDb: 80,
  supply: { positiveV: 15, negativeV: -15 },
  inputRangeV: { minV: -0.01, maxV: 0.01 },
  sourceImpedanceOhm: 350,
  constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-10mhz' },
}

test('defaultSpec es válido, completo y se devuelve por copia', () => {
  const spec = defaultSpec()
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, spec).valid, true)
  assert.equal(spec.target, 'instrumentation_amplifier')
  assert.equal(spec.gain.nominal, 100)
  assert.ok(spec.bandwidthHz > 0)
  assert.ok(spec.cmrrMinDb > 0)
  assert.equal(spec.supply.positiveV, 15)
  assert.equal(spec.supply.negativeV, -15)

  // Copia independiente: mutar una instancia no contamina la siguiente.
  spec.gain.nominal = 12345
  assert.equal(defaultSpec().gain.nominal, 100)
})

test('parseRequirement acepta un objeto completo y no pregunta nada', () => {
  const parsed = parseRequirement(fullSpec)
  assert.equal(parsed.source, 'json')
  assert.deepEqual(parsed.questions, [])
  assert.equal(parsed.spec.id, 'spec-completo')
  assert.equal(parsed.spec.gain.nominal, 100)
  assert.equal(parsed.spec.gain.tolerancePct, 1.5)
  assert.equal(parsed.spec.bandwidthHz, 10000)
  assert.equal(parsed.spec.cmrrMinDb, 80)
  assert.equal(parsed.spec.sourceImpedanceOhm, 350)
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
})

test('parseRequirement completa un objeto parcial con defaults y preguntas', () => {
  const parsed = parseRequirement({ gain: { nominal: 10 } })
  assert.equal(parsed.source, 'json')
  assert.equal(parsed.spec.gain.nominal, 10)
  assert.equal(parsed.spec.gain.tolerancePct, defaultSpec().gain.tolerancePct)
  assert.ok(parsed.questions.length >= 5, `se esperaban preguntas, recibidas ${parsed.questions.length}`)
  assert.ok(parsed.questions.some((question) => /ancho de banda/i.test(question)))
  assert.ok(parsed.questions.some((question) => /CMRR/i.test(question)))
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
})

test('parseRequirement acepta formatos laxos en el objeto (gain numérico, supply 15)', () => {
  const parsed = parseRequirement({
    gain: 50,
    bandwidth: '5 kHz',
    cmrr: 90,
    supply: 12,
    inputRange: 0.02,
    sourceImpedance: '350 Ω',
  })
  assert.equal(parsed.spec.gain.nominal, 50)
  assert.equal(parsed.spec.bandwidthHz, 5000)
  assert.equal(parsed.spec.cmrrMinDb, 90)
  assert.deepEqual(parsed.spec.supply, { positiveV: 12, negativeV: -12 })
  assert.deepEqual(parsed.spec.inputRangeV, { minV: -0.02, maxV: 0.02 })
  assert.equal(parsed.spec.sourceImpedanceOhm, 350)
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
})

test('parseRequirement descarta claves desconocidas y respeta el esquema', () => {
  const parsed = parseRequirement({ ...fullSpec, campoRaro: 42, constraints: { ...fullSpec.constraints, extra: true } })
  assert.equal(Object.hasOwn(parsed.spec, 'campoRaro'), false)
  assert.equal(Object.hasOwn(parsed.spec.constraints, 'extra'), false)
  assert.doesNotThrow(() => assertValid(CIRCUIT_SPEC_SCHEMA, parsed.spec, 'spec'))
})

test('parseRequirement interpreta texto en español (caso galga del anexo)', () => {
  const texto =
    'necesito amplificar la señal de una galga extensométrica, gain 100, ancho de banda ≥10 kHz, ' +
    'alimentación ±15 V, error de ganancia <1 %'
  const parsed = parseRequirement(texto)
  assert.equal(parsed.source, 'text')
  assert.equal(parsed.spec.gain.nominal, 100)
  assert.equal(parsed.spec.gain.tolerancePct, 1)
  assert.equal(parsed.spec.bandwidthHz, 10000)
  assert.equal(parsed.spec.supply.positiveV, 15)
  assert.equal(parsed.spec.supply.negativeV, -15)
  assert.equal(parsed.spec.sourceImpedanceOhm, 350) // puente de galga típico
  // El texto no dice CMRR ni rango de entrada: se completan y se pregunta.
  assert.ok(parsed.questions.some((question) => /CMRR/i.test(question)))
  assert.ok(parsed.questions.some((question) => /rango/i.test(question)))
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
})

test('parseRequirement interpreta texto en inglés con todos los datos', () => {
  const texto =
    'strain gauge front-end: gain 50, bandwidth 5 kHz, CMRR 90 dB, supply ±12 V, ' +
    'input range ±20 mV, source impedance 350 ohm'
  const parsed = parseRequirement(texto)
  assert.equal(parsed.spec.gain.nominal, 50)
  assert.equal(parsed.spec.bandwidthHz, 5000)
  assert.equal(parsed.spec.cmrrMinDb, 90)
  assert.deepEqual(parsed.spec.supply, { positiveV: 12, negativeV: -12 })
  assert.deepEqual(parsed.spec.inputRangeV, { minV: -0.02, maxV: 0.02 })
  assert.equal(parsed.spec.sourceImpedanceOhm, 350)
  assert.deepEqual(parsed.questions, [])
})

test('parseRequirement con texto sin datos devuelve defaults y preguntas', () => {
  const parsed = parseRequirement('necesito un amplificador de instrumentación para un sensor')
  assert.equal(parsed.source, 'text')
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, parsed.spec).valid, true)
  assert.ok(parsed.questions.length >= 5)
  assert.equal(parsed.spec.gain.nominal, defaultSpec().gain.nominal)
})

test('parseRequirement rechaza entradas que no son objeto ni texto', () => {
  for (const invalid of [undefined, null, 42, [], true]) {
    assert.throws(() => parseRequirement(invalid), TypeError)
  }
})
}

/* ===== verify ===== */
{
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { verifyDesign } = await import('../src/app.js')
const { VERIFICATION_SCHEMA } = await import('../src/app.js')
const { validate } = await import('../src/app.js')
const spec = {
  schema: 'cir/CircuitSpec/v1',
  id: 'verify-test',
  target: 'instrumentation_amplifier',
  gain: { nominal: 100, tolerancePct: 1 },
  bandwidthHz: 10000,
  cmrrMinDb: 80,
  supply: { positiveV: 15, negativeV: -15 },
  inputRangeV: { minV: -0.01, maxV: 0.01 },
  sourceImpedanceOhm: 350,
  constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-10mhz' },
}

/** @param {Partial<Record<string, number>>} overrides */
function makeMetrics(overrides = {}) {
  const gain = {
    nominal: 100,
    measured: 100.2,
    errorPct: 0.2,
    mcP95AbsPct: 0.3,
    ...overrides.gain,
  }
  return {
    gain,
    bandwidthHz: overrides.bandwidthHz ?? 20000,
    cmrrDb: overrides.cmrrDb ?? 90,
    cmrrMinDb: overrides.cmrrMinDb ?? 80,
  }
}

function checkById(report, id) {
  return report.checks.find((item) => item.id === id)
}

test('verifyDesign aprueba un diseño que cumple todos los requisitos', () => {
  const report = verifyDesign(spec, makeMetrics())
  assert.equal(validate(VERIFICATION_SCHEMA, report).valid, true)
  assert.equal(report.pass, true)
  assert.deepEqual(
    report.checks.map((item) => item.id),
    ['GAIN_NOMINAL', 'MONTE_CARLO_GAIN', 'GAIN_TOLERANCE', 'BANDWIDTH', 'CMRR', 'SIMULATION_SANE'],
  )
  for (const item of report.checks) {
    assert.equal(item.pass, true, `el check ${item.id} debería pasar`)
    assert.ok(typeof item.description === 'string' && item.description.length > 0)
    assert.ok(item.required !== undefined)
    assert.ok(item.actual !== undefined)
    assert.ok(item.margin !== undefined)
  }
})

test('verifyDesign falla GAIN_NOMINAL y GAIN_TOLERANCE si la ganancia se sale de tolerancia', () => {
  const report = verifyDesign(spec, makeMetrics({ gain: { measured: 102, errorPct: 2 } }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'GAIN_NOMINAL').pass, false)
  assert.equal(checkById(report, 'GAIN_TOLERANCE').pass, false)
  assert.equal(checkById(report, 'SIMULATION_SANE').pass, true)
})

test('verifyDesign falla MONTE_CARLO_GAIN si la dispersión p95 supera la tolerancia', () => {
  const report = verifyDesign(spec, makeMetrics({ gain: { mcP95AbsPct: 2 } }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'MONTE_CARLO_GAIN').pass, false)
  assert.equal(checkById(report, 'GAIN_NOMINAL').pass, true)
  assert.equal(checkById(report, 'GAIN_TOLERANCE').pass, false)
})

test('verifyDesign falla BANDWIDTH si el ancho de banda simulado es menor al requerido', () => {
  const report = verifyDesign(spec, makeMetrics({ bandwidthHz: 5000 }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'BANDWIDTH').pass, false)
  assert.equal(report.warnings.some((warning) => /Ancho de banda/i.test(warning)), true)
})

test('verifyDesign falla CMRR si no alcanza el mínimo requerido', () => {
  const report = verifyDesign(spec, makeMetrics({ cmrrDb: 70 }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'CMRR').pass, false)
})

test('verifyDesign falla SIMULATION_SANE con métricas no finitas', () => {
  const report = verifyDesign(spec, makeMetrics({ gain: { measured: Number.NaN, errorPct: Number.NaN } }))
  assert.equal(report.pass, false)
  assert.equal(checkById(report, 'SIMULATION_SANE').pass, false)
  assert.equal(validate(VERIFICATION_SCHEMA, report).valid, true)
})

test('verifyDesign reporta pass global solo si todos los checks pasan', () => {
  const report = verifyDesign(spec, makeMetrics())
  assert.equal(report.pass, report.checks.every((item) => item.pass === true))
  const failed = verifyDesign(spec, makeMetrics({ gain: { measured: 120, errorPct: 20 } }))
  assert.equal(failed.pass, false)
  assert.ok(failed.warnings.length > 0)
  assert.equal(validate(VERIFICATION_SCHEMA, failed).valid, true)
})

test('verifyDesign advierte cuando el CMRR es el del modelo ideal', () => {
  const report = verifyDesign(spec, makeMetrics({ cmrrDb: 200 }))
  assert.equal(report.pass, true)
  assert.equal(report.warnings.some((warning) => /CMRR/i.test(warning)), true)
})
}

/* ===== report ===== */
{
/**
 * Tests de los reportes: Markdown, esquemático SVG y Bode SVG.
 * No dependen del pipeline: usan fixtures con la forma de INTERFACES.md.
 */

const { test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { escapeXml, fmtHz, fmtOhm, pickOutNode, renderBodeSvg, renderMarkdown, renderSchematicSvg } = await import('../src/app.js')
/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeSpec(overrides = {}) {
  return {
    schema: 'cir/CircuitSpec/v1',
    id: 'ia-test',
    target: 'instrumentation_amplifier',
    gain: { nominal: 100, tolerancePct: 5 },
    bandwidthHz: 10000,
    cmrrMinDb: 80,
    supply: { positiveV: 15, negativeV: -15 },
    inputRangeV: { minV: -0.01, maxV: 0.01 },
    sourceImpedanceOhm: 350,
    constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-10mhz' },
    ...overrides,
  }
}

function makeProposal(overrides = {}) {
  return {
    schema: 'cir/DesignProposal/v1',
    specId: 'ia-test',
    topology: 'three_op_amp',
    resistors: [
      { name: 'R1', valueOhm: 10000, series: 'E96' },
      { name: 'Rg', valueOhm: 202, series: 'E96' },
      { name: 'R2', valueOhm: 10000, series: 'E96' },
      { name: 'R3', valueOhm: 10000, series: 'E96' },
    ],
    opAmps: [{ name: 'generic-10mhz', gain: 100000, poleHz: 10 }],
    netlist: {
      schema: 'cir/Netlist/v1',
      nodes: ['0', 'in+', 'in-', 'a', 'b', 'a_fb', 'b_fb', 'out'],
      elements: [
        { type: 'OPAMP', name: 'A1', inP: 'in+', inN: 'a_fb', out: 'a', gain: 100000, poleHz: 10 },
        { type: 'OPAMP', name: 'A2', inP: 'in-', inN: 'b_fb', out: 'b', gain: 100000, poleHz: 10 },
        { type: 'OPAMP', name: 'A3', inP: 'b', inN: 'a', out: 'out', gain: 100000, poleHz: 10 },
        { type: 'R', name: 'R1a', a: 'a', b: 'a_fb', valueOhm: 10000 },
        { type: 'R', name: 'R1b', a: 'b_fb', b: 'b', valueOhm: 10000 },
        { type: 'R', name: 'Rg', a: 'a_fb', b: 'b_fb', valueOhm: 202 },
      ],
    },
    expected: { gain: 100 },
    assumptions: ['Resistencias al 1 %', 'Op-amps ideales con polo de 10 Hz'],
    ...overrides,
  }
}

function makeMetrics(overrides = {}) {
  return {
    gain: { nominal: 100, measured: 100.2, errorPct: 0.2, mcP95AbsPct: 1.1 },
    bandwidthHz: 12500,
    cmrrDb: 95,
    cmrrMinDb: 80,
    ...overrides,
  }
}

function makeVerification(overrides = {}) {
  return {
    schema: 'cir/Verification/v1',
    pass: true,
    checks: [
      {
        id: 'GAIN_NOMINAL',
        description: 'Ganancia dentro de la tolerancia',
        required: '100 ± 5 %',
        actual: '100.2',
        pass: true,
        margin: '4.8 %',
      },
      {
        id: 'BANDWIDTH',
        description: 'Ancho de banda mínimo',
        required: '10 kHz',
        actual: '12.5 kHz',
        pass: true,
        margin: '2.5 kHz',
      },
      {
        id: 'CMRR',
        description: 'Rechazo de modo común',
        required: '80 dB',
        actual: '95 dB',
        pass: true,
        margin: '15 dB',
      },
    ],
    warnings: ['Los modelos de op-amp son genéricos.'],
    ...overrides,
  }
}

function makeAc(fc = 1e4) {
  const frequencies = [1, 10, 100, 1000, 10000, 100000, 1000000]
  const points = frequencies.map((fHz) => {
    const gain = 100 / Math.sqrt(1 + (fHz / fc) ** 2)
    return {
      fHz,
      nodeVoltages: {
        out: { re: gain, im: 0 },
        'in+': { re: 0.5, im: 0 },
        'in-': { re: -0.5, im: 0 },
      },
      branchCurrents: {},
    }
  })
  return { schema: 'cir/AcResult/v1', points, warnings: [] }
}

function makeResult(overrides = {}) {
  return {
    spec: makeSpec(),
    proposal: makeProposal(),
    dc: {
      schema: 'cir/DcResult/v1',
      nodeVoltages: { out: 0.5 },
      branchCurrents: {},
      warnings: [],
    },
    ac: makeAc(),
    metrics: makeMetrics(),
    verification: makeVerification(),
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

test('renderMarkdown incluye requisito, topología, resistencias, métricas y verificación', () => {
  const markdown = renderMarkdown(makeResult())

  assert.equal(typeof markdown, 'string')
  assert.match(markdown, /^# Reporte de diseño — ia-test/m)
  assert.ok(markdown.includes('✓ PASS'), 'debe indicar el resultado global')
  assert.ok(markdown.includes('Amplificador de instrumentación de 3 op-amps'), 'debe nombrar la topología')
  assert.ok(markdown.includes('| R1 |'), 'debe listar resistencias')
  assert.ok(markdown.includes('10 kΩ'), 'debe formatear el valor de R1')
  assert.ok(markdown.includes('202 Ω'), 'debe formatear el valor de Rg')

  for (const section of [
    '## 1. Requisito',
    '## 2. Topología elegida',
    '## 3. Resistencias seleccionadas',
    '## 4. Métricas simuladas',
    '## 5. Verificación por simulación',
    '## 6. Supuestos',
  ]) {
    assert.ok(markdown.includes(section), `falta la sección ${section}`)
  }
  assert.match(markdown, /^## \d+\. Advertencias$/m, 'falta la sección de advertencias')

  assert.ok(markdown.includes('Ganancia DC'))
  assert.ok(markdown.includes('Monte Carlo'))
  assert.ok(markdown.includes('CMRR'))
  assert.ok(markdown.includes('Ancho de banda'))
  assert.ok(markdown.includes('GAIN_NOMINAL'))
  assert.ok(markdown.includes('✓'))
  assert.ok(markdown.includes('Los modelos de op-amp son genéricos.'), 'debe incluir warnings')
  assert.ok(markdown.includes('Resistencias al 1 %'), 'debe incluir supuestos')
  assert.ok(markdown.includes('![Esquemático funcional](schematic.svg)'))
  assert.ok(markdown.includes('![Respuesta en frecuencia (Bode)](bode.svg)'))
  assert.ok(!markdown.includes('undefined'), 'no debe filtrar undefined')
})

test('renderMarkdown marca FAIL y checks reprobados con ✗', () => {
  const verification = makeVerification({
    pass: false,
    checks: [
      {
        id: 'GAIN_TOLERANCE',
        description: 'Tolerancia de ganancia',
        required: '±5 %',
        actual: '7.2 %',
        pass: false,
        margin: '-2.2 %',
      },
    ],
    warnings: [],
  })

  const markdown = renderMarkdown(makeResult({ verification }))
  assert.ok(markdown.includes('✗ FAIL'), 'debe indicar FAIL')
  assert.ok(markdown.includes('✗'), 'debe marcar el check reprobado')
  assert.ok(markdown.includes('GAIN_TOLERANCE'))
})

test('renderMarkdown funciona con un resultado mínimo', () => {
  const markdown = renderMarkdown({ spec: makeSpec() })
  assert.equal(typeof markdown, 'string')
  assert.ok(markdown.includes('# Reporte de diseño — ia-test'))
  assert.ok(!markdown.includes('undefined'))
})

test('renderMarkdown escapa pipes en celdas y no rompe la tabla', () => {
  const verification = makeVerification({
    checks: [
      {
        id: 'PIPE',
        description: 'check con | pipe',
        required: 'a | b',
        actual: 1,
        pass: true,
        margin: 0,
      },
    ],
  })
  const markdown = renderMarkdown(makeResult({ verification }))
  assert.ok(markdown.includes('check con \\| pipe'))
  assert.ok(markdown.includes('a \\| b'))
})

/* ------------------------------------------------------------------ */
/* Esquemático                                                         */
/* ------------------------------------------------------------------ */

test('renderSchematicSvg (3 op-amps) es un SVG autocontenido y legible', () => {
  const svg = renderSchematicSvg(makeProposal())

  assert.ok(svg.trimStart().startsWith('<svg'), 'debe empezar con <svg')
  assert.ok(svg.trimEnd().endsWith('</svg>'), 'debe cerrar el SVG')
  assert.equal((svg.match(/<svg/g) ?? []).length, 1)
  assert.equal((svg.match(/<\/svg>/g) ?? []).length, 1)
  assert.ok(svg.includes('viewBox="0 0 920 560"'))
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'))

  // Nodos y etiquetas de resistencias
  for (const label of ['in+', 'in−', 'out', 'R1', 'Rg', 'R2', 'R3', 'A1', 'A2', 'A3']) {
    assert.ok(svg.includes(label), `debe incluir la etiqueta ${label}`)
  }
  assert.ok(svg.includes('10 kΩ'))
  assert.ok(svg.includes('202 Ω'))
  assert.ok(svg.includes('<path'), 'debe dibujar triángulos de op-amp')
  assert.ok((svg.match(/<polyline/g) ?? []).length >= 1, 'debe dibujar cables')

  // Sin recursos externos ni contenido ejecutable
  assert.ok(!svg.includes('@import'))
  assert.ok(!svg.includes('<image'))
  assert.ok(!svg.includes('<foreignObject'))
  assert.ok(!svg.includes('NaN'))
  assert.ok(!svg.includes('undefined'))
})

test('renderSchematicSvg (monolítico) usa el modelo INA128-like y Rg', () => {
  const proposal = makeProposal({
    topology: 'monolithic',
    resistors: [{ name: 'Rg', valueOhm: 1020, series: 'E96' }],
    opAmps: [{ name: 'ina128-like', gain: 100000, poleHz: 100 }],
  })
  const svg = renderSchematicSvg(proposal)

  assert.ok(svg.trimStart().startsWith('<svg'))
  assert.ok(svg.includes('INA128-like'))
  assert.ok(svg.includes('1.02 kΩ'))
  assert.ok(svg.includes('in+') && svg.includes('in−') && svg.includes('out'))
  assert.ok(svg.includes('Rg'))
  assert.ok(!svg.includes('undefined'))
})

test('renderSchematicSvg acepta dimensiones personalizadas', () => {
  const svg = renderSchematicSvg(makeProposal(), { width: 1000, height: 600 })
  assert.ok(svg.includes('viewBox="0 0 1000 600"'))
})

/* ------------------------------------------------------------------ */
/* Bode                                                                */
/* ------------------------------------------------------------------ */

test('renderBodeSvg grafica la ganancia con eje logarítmico y marca de -3 dB', () => {
  const svg = renderBodeSvg(makeAc(), { outNode: 'out' })

  assert.ok(svg.trimStart().startsWith('<svg'))
  assert.ok(svg.trimEnd().endsWith('</svg>'))
  assert.ok(svg.includes('Respuesta en frecuencia'))
  assert.ok(svg.includes('Ganancia (dB)'))
  assert.ok(svg.includes('f (Hz)'))
  assert.ok(svg.includes('−3 dB'))
  assert.ok(svg.includes('f₋₃dB'))
  assert.ok(svg.includes('<polyline'), 'debe dibujar la curva de ganancia')
  assert.ok(svg.includes('<circle'), 'debe marcar el cruce de -3 dB')

  // La marca de -3 dB debe caer cerca de 10 kHz (fc del fixture).
  assert.match(svg, /f₋₃dB = 9\.9\d kHz/)

  // Etiquetas de frecuencia en el eje X
  assert.ok(svg.includes('1 Hz'))
  assert.ok(svg.includes('1 MHz'))

  assert.ok(!svg.includes('NaN'))
  assert.ok(!svg.includes('undefined'))
  assert.ok(!svg.includes('@import'))
})

test('renderBodeSvg respeta el nodo de salida y el rango de frecuencias', () => {
  const ac = makeAc()
  const svg = renderBodeSvg(ac, { outNode: 'vout' })
  assert.ok(svg.includes('Sin datos AC'), 'sin datos para el nodo debe ser un SVG válido con aviso')
  assert.ok(svg.includes('vout'))
  assert.ok(svg.trimEnd().endsWith('</svg>'))
})

test('renderBodeSvg tolera un AC vacío', () => {
  const svg = renderBodeSvg({ schema: 'cir/AcResult/v1', points: [], warnings: [] }, { outNode: 'out' })
  assert.ok(svg.trimStart().startsWith('<svg'))
  assert.ok(svg.trimEnd().endsWith('</svg>'))
  assert.ok(svg.includes('Sin datos AC'))
})

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

test('helpers de formato y escape', () => {
  assert.equal(fmtOhm(10000), '10 kΩ')
  assert.equal(fmtOhm(202), '202 Ω')
  assert.equal(fmtOhm(1.5e6), '1.5 MΩ')
  assert.equal(fmtHz(1000), '1 kHz')
  assert.equal(fmtHz(1e6), '1 MHz')
  assert.equal(fmtHz(10), '10 Hz')
  assert.equal(escapeXml('a<b>&"'), 'a&lt;b&gt;&amp;&quot;')
})

test('pickOutNode usa el nodo "out" o el primer OPAMP', () => {
  assert.equal(pickOutNode(makeProposal()), 'out')
  assert.equal(
    pickOutNode({ netlist: { nodes: ['0', 'vout'], elements: [{ type: 'OPAMP', out: 'vout' }] } }),
    'vout',
  )
  assert.equal(pickOutNode({}), 'out')
})
}

/* ===== pipeline ===== */
{
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { designPipeline } = await import('../src/app.js')
const { CIRCUIT_SPEC_SCHEMA } = await import('../src/app.js')
const { validate } = await import('../src/app.js')
const spec = {
  schema: 'cir/CircuitSpec/v1',
  id: 'pipeline-gain100',
  target: 'instrumentation_amplifier',
  gain: { nominal: 100, tolerancePct: 1 },
  bandwidthHz: 10000,
  cmrrMinDb: 80,
  supply: { positiveV: 15, negativeV: -15 },
  inputRangeV: { minV: -0.01, maxV: 0.01 },
  sourceImpedanceOhm: 350,
  constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-1mhz' },
}

test('pipeline end-to-end con spec estructurado', () => {
  const result = designPipeline(spec, { monteCarloRuns: 40, seed: 7 })
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, result.spec).valid, true)
  assert.ok(['three_op_amp', 'monolithic'].includes(result.proposal.topology))
  assert.equal(result.proposal.netlist.schema, 'cir/Netlist/v1')
  assert.ok(result.metrics.gain.measured > 0)
  assert.ok(Array.isArray(result.verification.checks))
  assert.ok(result.verification.checks.length >= 5)
  assert.match(result.report.markdown, /Amplificador de instrumentación|Amplificador de instrumentacion/i)
  assert.match(result.report.schematicSvg, /<svg/)
  assert.match(result.report.bodeSvg, /<svg/)
})

test('pipeline desde texto libre y determinista', () => {
  const texto = 'necesito amplificar una galga extensometrica, ganancia 100, ancho de banda 10 kHz, alimentacion +-15 V, CMRR 80 dB'
  const a = designPipeline(texto, { monteCarloRuns: 20, seed: 11 })
  const b = designPipeline(texto, { monteCarloRuns: 20, seed: 11 })
  assert.equal(a.spec.gain.nominal, 100)
  assert.equal(a.spec.bandwidthHz, 10000)
  assert.equal(a.spec.supply.positiveV, 15)
  assert.equal(a.spec.supply.negativeV, -15)
  assert.deepEqual(
    a.proposal.resistors.map((r) => r.valueOhm),
    b.proposal.resistors.map((r) => r.valueOhm),
  )
  assert.deepEqual(a.metrics, b.metrics)
})

test('pipeline con gain 10 y gain 1000 genera propuestas distintas', () => {
  const low = designPipeline({ ...spec, id: 'g10', gain: { nominal: 10, tolerancePct: 1 } }, { monteCarloRuns: 10, seed: 1 })
  const high = designPipeline({ ...spec, id: 'g1000', gain: { nominal: 1000, tolerancePct: 1 } }, { monteCarloRuns: 10, seed: 1 })
  assert.notDeepEqual(
    low.proposal.resistors.map((r) => r.valueOhm),
    high.proposal.resistors.map((r) => r.valueOhm),
  )
})
}

/* ===== contract ===== */
{
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { CIRCUIT_SPEC_SCHEMA, NETLIST_SCHEMA, DESIGN_PROPOSAL_SCHEMA, MANIFEST_SCHEMA } = await import('../src/app.js')
const { validate, assertValid } = await import('../src/app.js')
const validSpec = {
  schema: 'cir/CircuitSpec/v1',
  id: 'test-gain100',
  target: 'instrumentation_amplifier',
  gain: { nominal: 100, tolerancePct: 1 },
  bandwidthHz: 10000,
  cmrrMinDb: 80,
  supply: { positiveV: 15, negativeV: -15 },
  inputRangeV: { minV: -0.01, maxV: 0.01 },
  sourceImpedanceOhm: 350,
  constraints: { resistorSeries: 'E96', monolithicAllowed: true, opAmpModel: 'generic-1mhz' },
}

const validNetlist = {
  schema: 'cir/Netlist/v1',
  nodes: ['in', 'out', '0'],
  elements: [
    { type: 'V', name: 'V1', a: 'in', b: '0', valueV: 10 },
    { type: 'R', name: 'R1', a: 'in', b: 'out', valueOhm: 1000 },
    { type: 'R', name: 'R2', a: 'out', b: '0', valueOhm: 3000 },
  ],
}

test('spec valido pasa el schema', () => {
  assert.equal(validate(CIRCUIT_SPEC_SCHEMA, validSpec).valid, true)
})

test('spec sin gain falla con error de campo requerido', () => {
  const invalid = structuredClone(validSpec)
  delete invalid.gain
  const result = validate(CIRCUIT_SPEC_SCHEMA, invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.message.includes('gain')))
})

test('spec con campo no permitido falla por additionalProperties', () => {
  const invalid = { ...validSpec, extra: true }
  const result = validate(CIRCUIT_SPEC_SCHEMA, invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.message.includes('extra')))
})

test('netlist valido pasa el schema', () => {
  assert.equal(validate(NETLIST_SCHEMA, validNetlist).valid, true)
})

test('proposal con netlist embebido usa $ref local', () => {
  const proposal = {
    schema: 'cir/DesignProposal/v1',
    specId: 'test-gain100',
    topology: 'three_op_amp',
    resistors: [{ name: 'R1', valueOhm: 10000, series: 'E96' }],
    opAmps: [{ name: 'U1', gain: 1e6, poleHz: 1 }],
    netlist: validNetlist,
    expected: { gain: 100 },
    assumptions: ['op-amps ideales'],
  }
  assert.equal(validate(DESIGN_PROPOSAL_SCHEMA, proposal).valid, true)
})

test('manifest de plugin valido', () => {
  const manifest = {
    apiVersion: 'dsh.plugin/v0.1',
    id: 'com.acme.cir.solver',
    name: 'Solver MNA',
    version: '0.1.0',
    kind: 'deterministic',
    profile: 'sidecar-native',
    description: 'Resuelve netlists lineales.',
    capabilities: [{}],
    provides: [{}],
    health: {},
    selfTest: {},
    telemetry: {},
    permissions: {},
    lifecycle: {},
    compatibility: {},
    docs: {},
  }
  assert.equal(validate(MANIFEST_SCHEMA, manifest).valid, true)
})

test('assertValid lanza con detalle legible', () => {
  assert.throws(
    () => assertValid(CIRCUIT_SPEC_SCHEMA, { schema: 'cir/CircuitSpec/v1' }, 'spec'),
    /spec inválido/,
  )
})
}

/* ===== support ===== */
{
// Tests de caracterización del núcleo de soporte. El piloto original no traía
// tests para este módulo; se agregan para que ambos árboles del benchmark
// partan de la misma batería base.
const { default: test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { CATEGORIES, URGENCIES, buildWikiIndex, classifyTicket, draftReply, generateWikiArticle, searchWiki } = await import('../src/app.js')
test('classifyTicket reconoce un problema de API por sus palabras clave', () => {
  const result = classifyTicket('My API key returns 401 on every endpoint')
  assert.equal(result.category, 'api')
  assert.ok(CATEGORIES.includes(result.category))
  assert.ok(URGENCIES.includes(result.urgency))
})

test('classifyTicket marca urgencia alta y sentimiento negativo', () => {
  const result = classifyTicket('This is urgent, I am frustrated: the app is down')
  assert.equal(result.urgency, 'high')
  assert.equal(result.sentiment, 'negative')
})

test('classifyTicket cae en "other" con urgencia baja cuando no reconoce nada', () => {
  assert.deepEqual(classifyTicket('hello there'), { category: 'other', sentiment: 'neutral', urgency: 'low' })
})

test('searchWiki encuentra el artículo de cobro duplicado', () => {
  const result = searchWiki('I see a duplicate charge on my invoice, please refund')
  assert.equal(result.found, true)
  assert.equal(result.key, 'billing')
  assert.match(result.article.title, /Duplicate charge/)
})

test('searchWiki no inventa resultados', () => {
  assert.deepEqual(searchWiki('what a lovely day'), { found: false })
})

test('draftReply resuelve con la wiki cuando hay artículo', () => {
  const result = draftReply({ ticketId: 'T-0042', text: 'Webhook delivery is intermittent' })
  assert.equal(result.ticketId, 'T-0042')
  assert.equal(result.resolved, true)
  assert.deepEqual(result.wiki, { found: true, key: 'integration' })
  assert.match(result.reply, /retry backoff/)
  assert.match(result.reply, /Support @ Acme/)
})

test('draftReply escala cuando la wiki no tiene respuesta', () => {
  const result = draftReply({ text: 'what a lovely day' })
  assert.equal(result.resolved, false)
  assert.deepEqual(result.wiki, { found: false, key: null })
  assert.match(result.reply, /escalated/)
})

test('generateWikiArticle renderiza las secciones del artículo', () => {
  const md = generateWikiArticle({
    id: 'Issue 7',
    title: 'Login loop',
    symptom: 'Users bounce back to the login page',
    cause: 'Stale session cookie',
    resolution: 'Clear the cookie',
    tags: 'login',
  })
  assert.match(md, /^# Login loop/)
  assert.match(md, /\*\*ID:\*\* `issue-7`/)
  assert.match(md, /## Symptom/)
  assert.match(md, /## Root cause/)
  assert.match(md, /## Resolution/)
})

test('buildWikiIndex lista los artículos', () => {
  const md = buildWikiIndex([{ id: 'a1', title: 'First' }, { id: 'b2', title: 'Second' }])
  assert.match(md, /- \[First\]\(a1\.md\)/)
  assert.match(md, /- \[Second\]\(b2\.md\)/)
})
}

/* ===== cli ===== */
{
/**
 * Tests de la CLI: --help, errores de uso y flujo end-to-end de "design".
 *
 * Los tests de integración se marcan como skip mientras los módulos que proveen
 * otros teammates (pipeline.js, mna.js) todavía no están integrados; al integrarse
 * corren automáticamente sin cambiar el test.
 */

const { test } = await import('node:test')
const { default: assert } = await import('node:assert/strict')
const { spawnSync } = await import('node:child_process')
const { mkdtemp, readFile, readdir, rm, writeFile } = await import('node:fs/promises')
const { existsSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const { fileURLToPath, pathToFileURL } = await import('node:url')
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

const pipelineReady = await canImport('src/app.js')
const mnaReady = await canImport('src/app.js')

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

  const { CIRCUIT_SPEC_SCHEMA } = await import('../src/app.js')
  const { validate } = await import('../src/app.js')
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
}
