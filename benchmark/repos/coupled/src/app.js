/* ===== types ===== */

/**
 * Tipos de referencia del piloto (solo JSDoc; no hay código en runtime).
 * @typedef {{ re: number, im: number }} Complex
 * @typedef {{ type: 'R', name: string, a: string, b: string, valueOhm: number }} Resistor
 * @typedef {{ type: 'C', name: string, a: string, b: string, valueF: number }} Capacitor
 * @typedef {{ type: 'L', name: string, a: string, b: string, valueH: number }} Inductor
 * @typedef {{ type: 'V', name: string, a: string, b: string, valueV: number }} VoltageSource
 * @typedef {{ type: 'I', name: string, a: string, b: string, valueA: number }} CurrentSource
 * @typedef {{ type: 'VCVS', name: string, outP: string, outN: string, inP: string, inN: string, gain: number }} Vcvs
 * @typedef {{ type: 'OPAMP', name: string, inP: string, inN: string, out: string, gain: number, poleHz: number }} OpAmp
 * @typedef {Resistor|Capacitor|Inductor|VoltageSource|CurrentSource|Vcvs|OpAmp} Element
 * @typedef {{ schema: 'cir/Netlist/v1', nodes: string[], elements: Element[] }} Netlist
 * @typedef {{ schema: 'cir/CircuitSpec/v1', id?: string, target: 'instrumentation_amplifier', gain: { nominal: number, tolerancePct: number }, bandwidthHz: number, cmrrMinDb: number, supply: { positiveV: number, negativeV: number }, inputRangeV: { minV: number, maxV: number }, sourceImpedanceOhm: number, constraints: { resistorSeries: 'E24'|'E96', monolithicAllowed: boolean, opAmpModel: string } }} CircuitSpec
 * @typedef {{ schema: 'cir/DcResult/v1', nodeVoltages: Record<string, number>, branchCurrents: Record<string, number>, warnings: string[] }} DcResult
 * @typedef {{ schema: 'cir/AcResult/v1', points: Array<{ fHz: number, nodeVoltages: Record<string, Complex>, branchCurrents: Record<string, Complex> }>, warnings: string[] }} AcResult
 * @typedef {{ name: string, valueOhm: number, series: 'E24'|'E96' }} ResistorChoice
 * @typedef {{ name: string, gain: number, poleHz: number }} OpAmpChoice
 * @typedef {{ schema: 'cir/DesignProposal/v1', specId: string, topology: 'three_op_amp'|'monolithic', resistors: ResistorChoice[], opAmps: OpAmpChoice[], netlist: Netlist, expected: Record<string, number>, assumptions: string[], clarifyingQuestions?: string[] }} DesignProposal
 * @typedef {{ schema: 'cir/Verification/v1', pass: boolean, checks: Array<{ id: string, description: string, required: unknown, actual: unknown, pass: boolean, margin: unknown }>, warnings: string[] }} VerificationReport
 * @typedef {{ gain: { nominal: number, measured: number, errorPct: number, mcP95AbsPct: number }, bandwidthHz: number, cmrrDb: number, cmrrMinDb: number }} Metrics
 */

/* ===== complex ===== */

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

/* ===== linalg ===== */

/**
 * Álgebra lineal densa del piloto: resolución de `A·x = b` real y compleja
 * mediante eliminación gaussiana con pivoteo parcial.
 *
 * Ambas rutinas copian la matriz y el vector (nunca mutan las entradas) y
 * lanzan `SingularMatrixError` cuando el pivote máximo de una columna cae por
 * debajo de `PIVOT_EPS`.
 */
const complexAbs = abs
const complexDiv = div
const complexMul = mul
const complexSub = sub
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

/* ===== mna ===== */

/**
 * Análisis nodal modificado (MNA) del piloto.
 *
 * Subconjunto lineal soportado: `R`, `C`, `L`, `V`, `I`, `VCVS` y `OPAMP`.
 * El nodo de referencia es siempre `'0'` (ground). Las incógnitas son todas las
 * tensiones de nodo salvo ground, más una corriente de rama por cada fuente de
 * tensión: `V`, `L` (sólo en DC, donde el inductor es un corto), `VCVS` y
 * `OPAMP`.
 *
 * Convenciones de signo:
 * - `V`: `a` es el terminal positivo y `b` el negativo; la corriente de rama
 *   reportada circula de `a` hacia `b` por dentro de la fuente.
 * - `I`: inyecta corriente de `b` hacia `a` (positiva entra al nodo `a`).
 * - `VCVS`: `V(outP) − V(outN) = gain · (V(inP) − V(inN))`.
 * - `OPAMP`: se estampa como VCVS con `outN = '0'` y ganancia compleja
 *   `gain / (1 + j·f/poleHz)` en AC (en DC vale `gain`).
 */
const complexAdd = add
const GROUND_mna = '0'
const ELEMENT_TYPES = new Set(['R', 'C', 'L', 'V', 'I', 'VCVS', 'OPAMP'])

/** Barrido AC por defecto, sólo para llamadas sin `frequencies` (adaptadores). */
export const DEFAULT_AC_FREQUENCIES = Object.freeze([10, 100, 1000, 10000, 100000])

/** Error de netlist inválido o de simulación imposible; expone un `code` estable. */
export class NetlistError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {object} [options]
   */
  constructor(message, code = 'NETLIST_INVALID', options) {
    super(message, options)
    this.name = 'NetlistError'
    this.code = code
  }
}

/** @param {unknown} value */
function isFiniteNumber_mna(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** @param {unknown} value */
function isPlainObject_mna(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Valida un netlist sin lanzar excepciones.
 *
 * @param {unknown} netlist
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateNetlist(netlist) {
  const errors = []
  if (!isPlainObject_mna(netlist)) {
    return { ok: false, errors: ['[E_NETLIST] el netlist debe ser un objeto'] }
  }
  if (netlist.schema !== undefined && netlist.schema !== 'cir/Netlist/v1') {
    errors.push(`[E_SCHEMA] schema desconocido '${netlist.schema}' (esperado 'cir/Netlist/v1')`)
  }

  const nodes = netlist.nodes
  const nodeSet = new Set()
  if (!Array.isArray(nodes) || nodes.length === 0) {
    errors.push('[E_NODES] nodes debe ser un arreglo no vacío de strings')
  } else {
    for (const node of nodes) {
      if (typeof node !== 'string' || node.length === 0) {
        errors.push(`[E_NODES] nodo inválido ${JSON.stringify(node)}: debe ser un string no vacío`)
      } else if (nodeSet.has(node)) {
        errors.push(`[E_NODE_DUPLICATE] nodo duplicado '${node}'`)
      } else {
        nodeSet.add(node)
      }
    }
    if (!nodeSet.has(GROUND_mna)) {
      errors.push(`[E_GROUND] falta el nodo de referencia ground '${GROUND_mna}'`)
    }
  }

  const elements = netlist.elements
  if (!Array.isArray(elements) || elements.length === 0) {
    errors.push('[E_ELEMENTS] elements debe ser un arreglo no vacío')
  } else {
    const names = new Set()
    elements.forEach((element, index) => {
      validateElement(element, index, nodeSet, names, errors)
    })
  }
  return { ok: errors.length === 0, errors }
}

/** Verifica que dos campos de nodo no sean el mismo nodo (fuente cortocircuitada). */
function checkDistinctNodes(element, label, fieldA, fieldB, errors) {
  if (element[fieldA] === element[fieldB] && typeof element[fieldA] === 'string') {
    errors.push(
      `[E_NODE_SHORT] elemento ${label}: '${fieldA}' y '${fieldB}' no pueden ser el mismo nodo ('${element[fieldA]}')`,
    )
  }
}

/**
 * Valida un elemento individual y acumula errores legibles.
 * @param {any} element
 * @param {number} index
 * @param {Set<string>} nodeSet
 * @param {Set<string>} names
 * @param {string[]} errors
 */
function validateElement(element, index, nodeSet, names, errors) {
  const fallback = `#${index}`
  if (!isPlainObject_mna(element)) {
    errors.push(`[E_ELEMENT] elemento ${fallback}: debe ser un objeto`)
    return
  }
  const label = typeof element.name === 'string' && element.name.length > 0 ? element.name : fallback
  if (typeof element.name !== 'string' || element.name.length === 0) {
    errors.push(`[E_NAME] elemento ${fallback}: falta 'name' (string no vacío)`)
  } else if (names.has(element.name)) {
    errors.push(`[E_NAME_DUPLICATE] nombre de elemento duplicado '${element.name}'`)
  } else {
    names.add(element.name)
  }

  const type = element.type
  if (!ELEMENT_TYPES.has(type)) {
    errors.push(
      `[E_TYPE] elemento ${label}: tipo desconocido ${JSON.stringify(type)} (válidos: R, C, L, V, I, VCVS, OPAMP)`,
    )
    return
  }

  /** @param {string} field */
  const checkNode = (field) => {
    const value = element[field]
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`[E_NODE] elemento ${label}: '${field}' debe ser un string no vacío`)
    } else if (!nodeSet.has(value)) {
      errors.push(`[E_NODE_UNKNOWN] elemento ${label}: '${field}' referencia el nodo inexistente '${value}'`)
    }
  }
  /** @param {string} field @param {string} code */
  const checkPositive = (field, code) => {
    const value = element[field]
    if (!isFiniteNumber_mna(value)) {
      errors.push(`[E_VALUE] elemento ${label}: '${field}' debe ser un número finito`)
    } else if (value <= 0) {
      errors.push(`[${code}] elemento ${label}: '${field}' debe ser > 0 (recibido ${value})`)
    }
  }
  /** @param {string} field @param {string} code */
  const checkNonNegative = (field, code) => {
    const value = element[field]
    if (!isFiniteNumber_mna(value)) {
      errors.push(`[E_VALUE] elemento ${label}: '${field}' debe ser un número finito`)
    } else if (value < 0) {
      errors.push(`[${code}] elemento ${label}: '${field}' debe ser >= 0 (recibido ${value})`)
    }
  }

  switch (type) {
    case 'R':
      checkNode('a')
      checkNode('b')
      checkDistinctNodes(element, label, 'a', 'b', errors)
      checkPositive('valueOhm', 'E_RESISTOR_VALUE')
      break
    case 'C':
      checkNode('a')
      checkNode('b')
      checkDistinctNodes(element, label, 'a', 'b', errors)
      checkPositive('valueF', 'E_CAPACITOR_VALUE')
      break
    case 'L':
      checkNode('a')
      checkNode('b')
      checkDistinctNodes(element, label, 'a', 'b', errors)
      checkPositive('valueH', 'E_INDUCTOR_VALUE')
      break
    case 'V':
      checkNode('a')
      checkNode('b')
      checkDistinctNodes(element, label, 'a', 'b', errors)
      if (!isFiniteNumber_mna(element.valueV)) {
        errors.push(`[E_VALUE] elemento ${label}: 'valueV' debe ser un número finito`)
      }
      break
    case 'I':
      checkNode('a')
      checkNode('b')
      checkDistinctNodes(element, label, 'a', 'b', errors)
      if (!isFiniteNumber_mna(element.valueA)) {
        errors.push(`[E_VALUE] elemento ${label}: 'valueA' debe ser un número finito`)
      }
      break
    case 'VCVS':
      checkNode('outP')
      checkNode('outN')
      checkNode('inP')
      checkNode('inN')
      checkDistinctNodes(element, label, 'outP', 'outN', errors)
      if (!isFiniteNumber_mna(element.gain)) {
        errors.push(`[E_VALUE] elemento ${label}: 'gain' debe ser un número finito`)
      }
      break
    case 'OPAMP':
      checkNode('inP')
      checkNode('inN')
      checkNode('out')
      if (element.out === GROUND_mna) {
        errors.push(`[E_NODE] elemento ${label}: la salida de un OPAMP no puede ser ground '${GROUND_mna}'`)
      }
      checkPositive('gain', 'E_OPAMP_GAIN')
      // poleHz = 0 modela un op-amp ideal de ganancia constante (ver opAmpGain).
      checkNonNegative('poleHz', 'E_OPAMP_POLE')
      break
    default:
      break
  }
}

/**
 * Valida y lanza `NetlistError` si hay errores.
 * @param {unknown} netlist
 */
function assertValidNetlist(netlist) {
  const { ok, errors } = validateNetlist(netlist)
  if (!ok) {
    throw new NetlistError(`netlist inválido: ${errors.join('; ')}`, 'NETLIST_INVALID')
  }
}

// ---------------------------------------------------------------------------
// Álgebra de estampado: las mismas fórmulas para el dominio real y el complejo.
// ---------------------------------------------------------------------------

const REAL_OPS = {
  zero: () => 0,
  one: 1,
  fromReal: (value) => value,
  fromImag: () => {
    throw new Error('INVALID_STAMP: no hay partes imaginarias en DC')
  },
  fromComplex: (value) => value.re,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  out: (value) => value,
  isFinite: (value) => Number.isFinite(value),
}

const COMPLEX_OPS = {
  zero: () => complex(0, 0),
  one: complex(1, 0),
  fromReal: (value) => complex(value, 0),
  fromImag: (value) => complex(0, value),
  fromComplex: (value) => complex(value.re, value.im),
  add: complexAdd,
  sub: complexSub,
  out: (value) => complex(value.re, value.im),
  isFinite: (value) => Number.isFinite(value.re) && Number.isFinite(value.im),
}

/**
 * Ganancia compleja de un OPAMP de un polo a la frecuencia `fHz`.
 * `f = 0` (o `poleHz <= 0`, interpretado como op-amp ideal) devuelve `gain`.
 *
 * @param {number} fHz
 * @param {{ gain: number, poleHz: number }} model
 * @returns {import('./complex.js').Complex}
 */
export function opAmpGain(fHz, model) {
  if (!isPlainObject_mna(model) || !isFiniteNumber_mna(model.gain)) {
    throw new NetlistError('modelo de OPAMP inválido: falta gain finito', 'INVALID_OPAMP_MODEL')
  }
  if (!isFiniteNumber_mna(fHz) || fHz < 0) {
    throw new NetlistError(`frecuencia inválida '${fHz}' para opAmpGain`, 'INVALID_FREQUENCY')
  }
  const poleHz = model.poleHz
  if (!isFiniteNumber_mna(poleHz) || poleHz <= 0 || fHz === 0) {
    return complex(model.gain, 0)
  }
  // gain / (1 + j·x) = gain·(1 − j·x) / (1 + x²)
  const x = fHz / poleHz
  const denominator = 1 + x * x
  return complex(model.gain / denominator, (-model.gain * x) / denominator)
}

/** Indica si el elemento aporta una incógnita de corriente de rama en el modo dado. */
function isBranchElement(element, mode) {
  switch (element.type) {
    case 'V':
      return true
    case 'L':
      return mode === 'dc'
    case 'VCVS':
    case 'OPAMP':
      return true
    default:
      return false
  }
}

/**
 * Arma la matriz MNA y el vector de términos independientes del netlist.
 * @param {any} netlist
 * @param {{ mode: 'dc'|'ac', frequencyHz?: number }} options
 */
function buildSystem(netlist, options) {
  const { mode, frequencyHz = 0 } = options
  const ops = mode === 'dc' ? REAL_OPS : COMPLEX_OPS
  const omega = mode === 'ac' ? 2 * Math.PI * frequencyHz : 0

  const voltageNodes = netlist.nodes.filter((node) => node !== GROUND_mna)
  const nodeIndex = new Map(voltageNodes.map((node, index) => [node, index]))
  const branchElements = netlist.elements.filter((element) => isBranchElement(element, mode))
  const nodeCount = voltageNodes.length
  const size = nodeCount + branchElements.length

  const A = Array.from({ length: size }, () => Array.from({ length: size }, () => ops.zero()))
  const rhs = Array.from({ length: size }, () => ops.zero())
  const branchIndex = new Map()
  branchElements.forEach((element, offset) => {
    branchIndex.set(element.name, nodeCount + offset)
  })

  /**
   * Estampa una admitancia entre `a` y `b`.
   * @param {string} a
   * @param {string} b
   * @param {any} admittance
   */
  const stampAdmittance = (a, b, admittance) => {
    const ia = nodeIndex.get(a)
    const ib = nodeIndex.get(b)
    if (ia !== undefined) A[ia][ia] = ops.add(A[ia][ia], admittance)
    if (ib !== undefined) A[ib][ib] = ops.add(A[ib][ib], admittance)
    if (ia !== undefined && ib !== undefined) {
      A[ia][ib] = ops.sub(A[ia][ib], admittance)
      A[ib][ia] = ops.sub(A[ib][ia], admittance)
    }
  }

  /**
   * Estampa una fuente de tensión (independiente o controlada).
   * @param {{ name: string }} element
   * @param {string} a terminal positivo
   * @param {string} b terminal negativo
   * @param {any} value término independiente
   * @param {{ inP: string, inN: string, gain: any } | null} control
   */
  const stampBranchSource = (element, a, b, value, control) => {
    const k = branchIndex.get(element.name)
    const ia = nodeIndex.get(a)
    const ib = nodeIndex.get(b)
    if (ia !== undefined) {
      A[ia][k] = ops.add(A[ia][k], ops.one)
      A[k][ia] = ops.add(A[k][ia], ops.one)
    }
    if (ib !== undefined) {
      A[ib][k] = ops.sub(A[ib][k], ops.one)
      A[k][ib] = ops.sub(A[k][ib], ops.one)
    }
    rhs[k] = ops.add(rhs[k], value)
    if (control !== null) {
      const ip = nodeIndex.get(control.inP)
      const inn = nodeIndex.get(control.inN)
      if (ip !== undefined) A[k][ip] = ops.sub(A[k][ip], control.gain)
      if (inn !== undefined) A[k][inn] = ops.add(A[k][inn], control.gain)
    }
  }

  for (const element of netlist.elements) {
    switch (element.type) {
      case 'R': {
        stampAdmittance(element.a, element.b, ops.fromReal(1 / element.valueOhm))
        break
      }
      case 'C': {
        // En DC el capacitor es un circuito abierto: no aporta al sistema.
        if (mode === 'ac') stampAdmittance(element.a, element.b, ops.fromImag(omega * element.valueF))
        break
      }
      case 'L': {
        if (mode === 'ac') {
          // Y_L = 1/(jωL) = −j/(ωL)
          stampAdmittance(element.a, element.b, ops.fromImag(-1 / (omega * element.valueH)))
        } else {
          // En DC el inductor es un corto: fuente de 0 V.
          stampBranchSource(element, element.a, element.b, ops.zero(), null)
        }
        break
      }
      case 'V': {
        stampBranchSource(element, element.a, element.b, ops.fromReal(element.valueV), null)
        break
      }
      case 'I': {
        // Inyecta corriente de b hacia a.
        const ia = nodeIndex.get(element.a)
        const ib = nodeIndex.get(element.b)
        const current = ops.fromReal(element.valueA)
        if (ia !== undefined) rhs[ia] = ops.add(rhs[ia], current)
        if (ib !== undefined) rhs[ib] = ops.sub(rhs[ib], current)
        break
      }
      case 'VCVS': {
        stampBranchSource(element, element.outP, element.outN, ops.zero(), {
          inP: element.inP,
          inN: element.inN,
          gain: ops.fromReal(element.gain),
        })
        break
      }
      case 'OPAMP': {
        const gain =
          mode === 'dc'
            ? ops.fromReal(element.gain)
            : ops.fromComplex(opAmpGain(frequencyHz, { gain: element.gain, poleHz: element.poleHz }))
        stampBranchSource(element, element.out, GROUND_mna, ops.zero(), {
          inP: element.inP,
          inN: element.inN,
          gain,
        })
        break
      }
      default:
        break
    }
  }

  return { ops, A, rhs, nodeIndex, branchIndex }
}

/**
 * Nodos declarados que ningún elemento referencia (salvo ground).
 * @param {any} netlist
 * @returns {string[]}
 */
function collectWarnings(netlist) {
  const used = new Set([GROUND_mna])
  for (const element of netlist.elements) {
    switch (element.type) {
      case 'VCVS':
        used.add(element.outP)
        used.add(element.outN)
        used.add(element.inP)
        used.add(element.inN)
        break
      case 'OPAMP':
        used.add(element.inP)
        used.add(element.inN)
        used.add(element.out)
        break
      case 'R':
      case 'C':
      case 'L':
      case 'V':
      case 'I':
        used.add(element.a)
        used.add(element.b)
        break
      default:
        break
    }
  }
  const warnings = []
  for (const node of netlist.nodes) {
    if (!used.has(node)) {
      warnings.push(`[W_FLOATING_NODE] el nodo '${node}' no tiene conexiones`)
    }
  }
  return warnings
}

/**
 * Extrae las tensiones de nodo de la solución, incluyendo ground = 0.
 * @param {any} netlist
 * @param {Map<string, number>} nodeIndex
 * @param {any[]} x
 * @param {any} ops
 */
function extractNodeVoltages(netlist, nodeIndex, x, ops) {
  const nodeVoltages = {}
  for (const node of netlist.nodes) {
    if (node === GROUND_mna) {
      nodeVoltages[node] = ops.out(ops.zero())
    } else {
      nodeVoltages[node] = ops.out(x[nodeIndex.get(node)])
    }
  }
  return nodeVoltages
}

/**
 * Extrae las corrientes de las ramas incógnita, indexadas por nombre del elemento.
 * @param {Map<string, number>} branchIndex
 * @param {any[]} x
 * @param {any} ops
 */
function extractBranchCurrents(branchIndex, x, ops) {
  const branchCurrents = {}
  for (const [name, index] of branchIndex) {
    branchCurrents[name] = ops.out(x[index])
  }
  return branchCurrents
}

/**
 * Verifica que la solución no tenga Inf/NaN.
 * @param {any[]} x
 * @param {any} ops
 * @param {string} label
 */
function assertFiniteSolution(x, ops, label) {
  for (const value of x) {
    if (!ops.isFinite(value)) {
      throw new NetlistError(
        `resultado no finito en ${label}: revisá valores extremos del netlist`,
        'NON_FINITE_RESULT',
      )
    }
  }
}

/**
 * Resuelve el punto de operación DC del netlist.
 *
 * @param {any} netlist
 * @returns {import('./types.js').DcResult}
 */
export function solveDc(netlist) {
  assertValidNetlist(netlist)
  const system = buildSystem(netlist, { mode: 'dc' })
  let x
  try {
    x = solveReal(system.A, system.rhs)
  } catch (error) {
    if (error instanceof SingularMatrixError) {
      throw new NetlistError(
        'sistema MNA singular en DC: revisá la referencia a ground, las fuentes de tensión en lazo y los nodos flotantes',
        'SINGULAR_MATRIX',
        { cause: error },
      )
    }
    throw error
  }
  assertFiniteSolution(x, REAL_OPS, 'DC')
  return {
    schema: 'cir/DcResult/v1',
    nodeVoltages: extractNodeVoltages(netlist, system.nodeIndex, x, REAL_OPS),
    branchCurrents: extractBranchCurrents(system.branchIndex, x, REAL_OPS),
    warnings: collectWarnings(netlist),
  }
}

/**
 * Resuelve el barrido AC del netlist en las frecuencias pedidas.
 *
 * @param {any} netlist
 * @param {{ frequencies?: number[] }} [options]
 * @returns {import('./types.js').AcResult}
 */
export function solveAc(netlist, options = {}) {
  assertValidNetlist(netlist)
  const requested = options?.frequencies ?? DEFAULT_AC_FREQUENCIES
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new NetlistError(
      'solveAc requiere options.frequencies: arreglo no vacío de frecuencias en Hz > 0',
      'INVALID_FREQUENCIES',
    )
  }
  for (const frequency of requested) {
    if (!isFiniteNumber_mna(frequency) || frequency <= 0) {
      throw new NetlistError(
        `frecuencia inválida ${JSON.stringify(frequency)}: debe ser un número finito > 0`,
        'INVALID_FREQUENCY',
      )
    }
  }
  const warnings = collectWarnings(netlist)
  const points = requested.map((frequencyHz) => {
    const system = buildSystem(netlist, { mode: 'ac', frequencyHz })
    let x
    try {
      x = solveComplex(system.A, system.rhs)
    } catch (error) {
      if (error instanceof SingularMatrixError) {
        throw new NetlistError(
          `sistema MNA singular en AC a ${frequencyHz} Hz: revisá la referencia a ground y los nodos flotantes`,
          'SINGULAR_MATRIX',
          { cause: error },
        )
      }
      throw error
    }
    assertFiniteSolution(x, COMPLEX_OPS, `AC @ ${frequencyHz} Hz`)
    return {
      fHz: frequencyHz,
      nodeVoltages: extractNodeVoltages(netlist, system.nodeIndex, x, COMPLEX_OPS),
      branchCurrents: extractBranchCurrents(system.branchIndex, x, COMPLEX_OPS),
    }
  })
  return { schema: 'cir/AcResult/v1', points, warnings }
}

/** @typedef {import('./types.js').DcResult} DcResult */
/** @typedef {import('./types.js').AcResult} AcResult */

/* ===== measure ===== */

/**
 * Mediciones de amplificadores sobre el solver MNA.
 *
 * Todas las funciones **clonan** el netlist antes de tocarlo: agregan fuentes
 * de excitación internas (`__meas_vp`, `__meas_vn`) sobre la copia y nunca
 * mutan el netlist del llamador.
 */
const GROUND_measure = '0'
const MEAS_POSITIVE = '__meas_vp'
const MEAS_NEGATIVE = '__meas_vn'

/** Clona un netlist plano (sólo datos JSON: nodos, elementos y valores). */
function cloneNetlist_measure(netlist) {
  return structuredClone(netlist)
}

/** @param {unknown} value */
function isFiniteNumber_measure(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Verifica que los nodos pedidos existan en el netlist. */
function requireNodes(netlist, nodeNames, context) {
  const available = new Set(netlist.nodes)
  const missing = nodeNames.filter((node) => !available.has(node))
  if (missing.length > 0) {
    throw new NetlistError(
      `${context}: nodos inexistentes en el netlist: ${missing.map((node) => `'${node}'`).join(', ')}`,
      'MEASURE_NODE_MISSING',
    )
  }
}

/** Agrega una fuente de tensión ideal con nombre único a la copia del netlist. */
function addVoltageSource(netlist, name, a, b, valueV) {
  const used = new Set(netlist.elements.map((element) => element.name))
  let finalName = name
  let suffix = 2
  while (used.has(finalName)) {
    finalName = `${name}_${suffix}`
    suffix += 1
  }
  netlist.elements.push({ type: 'V', name: finalName, a, b, valueV })
}

/** Error de parámetros de medición, con código estable. */
function measurementError(message, code = 'MEASURE_INVALID_PARAMS') {
  return new NetlistError(message, code)
}

/**
 * Clona el netlist y aplica la excitación diferencial: `V(inP)=+vd/2` y
 * `V(inN)=−vd/2` respecto de ground.
 * @param {any} netlist
 * @param {string} inP
 * @param {string} inN
 * @param {number} vd
 */
function withDifferentialDrive(netlist, inP, inN, vd) {
  if (inP === inN) {
    throw measurementError('inP e inN deben ser nodos distintos para medir una entrada diferencial')
  }
  if (inP === GROUND_measure && inN === GROUND_measure) {
    throw measurementError('inP e inN no pueden ser ambos ground')
  }
  const clone = cloneNetlist_measure(netlist)
  requireNodes(clone, [inP, inN], 'measureDifferentialGain')
  if (inP !== GROUND_measure) addVoltageSource(clone, MEAS_POSITIVE, inP, GROUND_measure, vd / 2)
  if (inN !== GROUND_measure) addVoltageSource(clone, MEAS_NEGATIVE, inN, GROUND_measure, -vd / 2)
  return clone
}

/**
 * Clona el netlist y aplica modo común: `V(inP)=V(inN)=vcm`.
 * @param {any} netlist
 * @param {string} inP
 * @param {string} inN
 * @param {number} vcm
 */
function withCommonModeDrive(netlist, inP, inN, vcm) {
  if (inP === inN) {
    throw measurementError('inP e inN deben ser nodos distintos para medir la ganancia de modo común')
  }
  if (inP === GROUND_measure && inN === GROUND_measure) {
    throw measurementError('inP e inN no pueden ser ambos ground')
  }
  const clone = cloneNetlist_measure(netlist)
  requireNodes(clone, [inP, inN], 'measureCmrr')
  if (inP !== GROUND_measure) addVoltageSource(clone, MEAS_POSITIVE, inP, GROUND_measure, vcm)
  if (inN !== GROUND_measure) addVoltageSource(clone, MEAS_NEGATIVE, inN, GROUND_measure, vcm)
  return clone
}

/** Convierte una ganancia lineal a dB (módulo); 0 → −Infinity. */
function toDb(gain) {
  const magnitude = Math.abs(gain)
  if (magnitude === 0) return -Infinity
  return 20 * Math.log10(magnitude)
}

/**
 * Aplica una entrada diferencial `±vd/2` y devuelve la ganancia diferencial
 * DC `ad = V(outNode)/vd` (con signo) y su versión en dB.
 *
 * @param {{ netlist: any, outNode: string, inP: string, inN: string, vd?: number }} params
 * @returns {{ dc: import('./types.js').DcResult, ad: number, adDb: number }}
 */
export function measureDifferentialGain(params) {
  const { netlist, outNode, inP, inN } = params ?? {}
  const vd = params?.vd ?? 1
  if (!isFiniteNumber_measure(vd) || vd === 0) {
    throw measurementError(`vd debe ser un número finito distinto de 0 (recibido ${vd})`)
  }
  const clone = withDifferentialDrive(netlist, inP, inN, vd)
  requireNodes(clone, [outNode], 'measureDifferentialGain')
  const dc = solveDc(clone)
  const ad = dc.nodeVoltages[outNode] / vd
  return { dc, ad, adDb: toDb(ad) }
}

/**
 * Mide la ganancia de modo común `ac = V(outNode)/vcm` y devuelve el CMRR
 * `20·log10(|ad/ac|)`. Un CMRR ideal (ac = 0) devuelve `Infinity`.
 *
 * @param {{ netlist: any, outNode: string, inP: string, inN: string, vcm?: number }} params
 * @returns {{ dc: import('./types.js').DcResult, ad: number, ac: number, cmrrDb: number }}
 */
export function measureCmrr(params) {
  const { netlist, outNode, inP, inN } = params ?? {}
  const vcm = params?.vcm ?? 1
  if (!isFiniteNumber_measure(vcm) || vcm === 0) {
    throw measurementError(`vcm debe ser un número finito distinto de 0 (recibido ${vcm})`)
  }
  const { ad } = measureDifferentialGain({ netlist, outNode, inP, inN })
  const clone = withCommonModeDrive(netlist, inP, inN, vcm)
  requireNodes(clone, [outNode], 'measureCmrr')
  const dc = solveDc(clone)
  const ac = dc.nodeVoltages[outNode] / vcm
  let cmrrDb
  if (ac === 0) {
    cmrrDb = ad === 0 ? 0 : Infinity
  } else {
    cmrrDb = toDb(ad / ac)
  }
  return { dc, ad, ac, cmrrDb }
}

/**
 * Frecuencia de −3 dB interpolada sobre `|Vout| / |V(inP) − V(inN)|`.
 *
 * Interpola linealmente en escala log-log entre los dos puntos del barrido que
 * rodean la caída a `dcGain/√2`. Si el barrido nunca cae por debajo del umbral,
 * devuelve la última frecuencia medida (cota inferior del ancho de banda).
 *
 * @param {import('./types.js').AcResult} ac
 * @param {{ outNode: string, inP: string, inN: string, dcGain: number }} params
 * @returns {number} frecuencia de −3 dB en Hz
 */
export function bandwidthHz(ac, params) {
  if (!ac || !Array.isArray(ac.points)) {
    throw measurementError('bandwidthHz requiere un AcResult con points', 'INVALID_AC_RESULT')
  }
  const { outNode, inP, inN, dcGain } = params ?? {}
  const reference = Math.abs(Number(dcGain))
  if (!isFiniteNumber_measure(reference) || reference === 0) return 0
  const target = reference / Math.SQRT2

  const samples = []
  for (const point of ac.points) {
    const nodeVoltages = point?.nodeVoltages
    if (!nodeVoltages) continue
    const vp = nodeVoltages[inP]
    const vn = nodeVoltages[inN]
    const vo = nodeVoltages[outNode]
    if (!vp || !vn || !vo) continue
    if (!isFiniteNumber_measure(point.fHz) || point.fHz <= 0) continue
    const differential = complexAbs(complexSub(vp, vn))
    if (!(differential > 0)) continue
    const magnitude = complexAbs(vo) / differential
    if (!Number.isFinite(magnitude)) continue
    samples.push({ fHz: point.fHz, magnitude })
  }
  if (samples.length === 0) return 0
  // El contrato promete points ordenados; por robustez ordenamos igual.
  samples.sort((left, right) => left.fHz - right.fHz)

  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index]
    if (current.magnitude > target) continue
    if (index === 0) return current.fHz
    const previous = samples[index - 1]
    // Interpolación lineal en (log10 f, log10 |H|).
    const logFrequencyLow = Math.log10(previous.fHz)
    const logFrequencyHigh = Math.log10(current.fHz)
    const logMagnitudeLow = Math.log10(previous.magnitude)
    const logMagnitudeHigh = Math.log10(current.magnitude)
    const logTarget = Math.log10(target)
    let ratio
    if (logMagnitudeHigh === logMagnitudeLow) {
      ratio = 0.5 // tramo plano: punto medio del intervalo
    } else {
      ratio = (logTarget - logMagnitudeLow) / (logMagnitudeHigh - logMagnitudeLow)
      ratio = Math.min(1, Math.max(0, ratio))
    }
    return 10 ** (logFrequencyLow + (logFrequencyHigh - logFrequencyLow) * ratio)
  }
  // La ganancia no llegó a caer 3 dB dentro del barrido: devolvemos la cota inferior.
  return samples[samples.length - 1].fHz
}

/* ===== montecarlo ===== */

/**
 * Monte Carlo de tolerancias sobre resistencias.
 *
 * Sin dependencias: el generador `mulberry32` es determinista para una semilla
 * dada, así que dos corridas con el mismo `seed` devuelven exactamente la misma
 * muestra (requisito de reproducibilidad del piloto).
 */
/** Clona un netlist plano (sólo datos JSON: nodos, elementos y valores). */
function cloneNetlist_montecarlo(netlist) {
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
    const perturbed = cloneNetlist_montecarlo(netlist)
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

/* ===== e96 ===== */

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
function isFiniteNumber_e96(value) {
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
  if (!isFiniteNumber_e96(value) || value <= 0) {
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
  if (!isFiniteNumber_e96(valueOhm)) return '—'
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

/* ===== ia ===== */

/**
 * Síntesis y evaluación del amplificador de instrumentación (IA).
 *
 * Dos topologías soportadas:
 * - `three_op_amp`: dos buffers de entrada + etapa de diferencia. La ganancia
 *   es `G = (1 + 2·R1/Rg) · (R3/R2)` con `R2 = R3 = 10 kΩ` (G2 = 1).
 * - `monolithic`: modelo INA128-like con `G = 1 + 50 kΩ/Rg`. El netlist usa un
 *   solo op-amp y descompone la red interna trimada (50 kΩ) para que el Monte
 *   Carlo de tolerancias de resistencias sea trazable.
 *
 * La elección de topología y de valores E96 es determinista: minimiza el error
 * de ganancia y respeta (si se puede) el ancho de banda y el máximo de
 * resistencias del spec. Si no se alcanza la tolerancia, devuelve el mejor
 * intento y agrega preguntas de aclaración en el `DesignProposal`.
 *
 * Unidades: ohmios, voltios, hercios, ganancias en V/V. ESM puro, sin deps.
 */

/** @typedef {import('./types.js').CircuitSpec} CircuitSpec */
/** @typedef {import('./types.js').DesignProposal} DesignProposal */

const DEFAULT_GAIN = 100
const DEFAULT_TOLERANCE_PCT = 1
const THREE_OP_AMP_PHYSICAL_RESISTORS = 7
const MONOLITHIC_PHYSICAL_RESISTORS = 1
const DIFF_AMP_RESISTOR_OHM = 10000
const INTERNAL_GAIN_RESISTOR_OHM = 50000
const RESISTOR_TOLERANCE_PCT = 1
const DEFAULT_MC_RUNS = 200
const DEFAULT_MC_SEED = 12345
const SWEEP_MIN_HZ = 1
const SWEEP_MAX_HZ = 10e6
const SWEEP_POINTS = 61
const CMRR_IDEAL_CAP_DB = 200
/** Factor de seguridad sobre el ancho de banda analítico al elegir valores. */
const BANDWIDTH_SAFETY_FACTOR = 0.98
/** Tolerancia numérica para comparar errores relativos. */
const EPS = 1e-9

/** Modelos de op-amp disponibles (el `constraints.opAmpModel` del spec). */
const OPAMP_LIBRARY = {
  'generic-1mhz': { openLoopGain: 1e6, gbwHz: 1e6, label: 'genérico 1 MHz' },
  'generic-10mhz': { openLoopGain: 1e6, gbwHz: 1e7, label: 'genérico 10 MHz' },
  'ina128-like': { openLoopGain: 1e6, gbwHz: 1.3e6, label: 'INA128-like' },
}
const DEFAULT_OPAMP_MODEL = 'generic-10mhz'

/** @param {unknown} value */
function isFiniteNumber_ia(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Redondea a `digits` cifras significativas, sin notación científica. */
function roundTo(value, digits = 6) {
  if (!isFiniteNumber_ia(value)) return value
  return Number(value.toPrecision(digits))
}

/** Devuelve el primer número finito positivo de la lista, o el fallback. */
function firstFinite(...values) {
  for (const value of values) {
    if (isFiniteNumber_ia(value) && value > 0) return value
  }
  return undefined
}

/** Resuelve el modelo de op-amp declarado en el spec. */
function resolveOpAmpModel(spec) {
  const key = spec?.constraints?.opAmpModel
  if (typeof key === 'string' && Object.hasOwn(OPAMP_LIBRARY, key)) {
    return { key, ...OPAMP_LIBRARY[key] }
  }
  return { key: DEFAULT_OPAMP_MODEL, ...OPAMP_LIBRARY[DEFAULT_OPAMP_MODEL] }
}

/** Ancho de banda mínimo requerido por el spec, si está definido. */
function requiredBandwidthHz(spec) {
  const value = spec?.bandwidthHz
  return isFiniteNumber_ia(value) && value > 0 ? value : undefined
}

/** Umbral de ancho de banda analítico con margen de seguridad (o undefined). */
function bandwidthThresholdHz(spec) {
  const required = requiredBandwidthHz(spec)
  return required === undefined ? undefined : required / BANDWIDTH_SAFETY_FACTOR
}

/** @param {number} predictedHz @param {number} thresholdHz */
function bandwidthFeasible(predictedHz, thresholdHz) {
  if (thresholdHz === undefined) return true
  return isFiniteNumber_ia(predictedHz) && predictedHz >= thresholdHz
}

/* ------------------------------------------------------------------ */
/* Selección de valores E96                                            */
/* ------------------------------------------------------------------ */

/**
 * Genera el candidato de 3 op-amps para un par (R1, Rg) dado.
 * @param {number} r1
 * @param {number} rg
 * @param {number} targetGain
 */
function threeOpAmpCandidate(r1, rg, targetGain) {
  const gain1 = 1 + (2 * r1) / rg
  const gain2 = 1 // R2 = R3 = 10 kΩ
  const gainReal = gain1 * gain2
  return {
    topology: 'three_op_amp',
    r1,
    rg,
    r2: DIFF_AMP_RESISTOR_OHM,
    r3: DIFF_AMP_RESISTOR_OHM,
    gainReal,
    errPct: ((gainReal - targetGain) / targetGain) * 100,
    physicalCount: THREE_OP_AMP_PHYSICAL_RESISTORS,
  }
}

/**
 * Elige R1 y Rg de la serie E96 para la topología de 3 op-amps.
 *
 * Estrategia:
 * 1. Arranca con el par canónico R1 = 10 kΩ y `Rg = nearestE96(2·R1/(G−1))`.
 * 2. Si ese par no cumple tolerancia (o ancho de banda), recorre todos los
 *    pares E96 razonables y elige el de menor |error| entre los viables.
 * 3. Si ningún par cumple, devuelve el mejor intento (el diseño lo reporta).
 *
 * @param {number} targetGain
 * @param {number} tolerancePct
 * @param {number} gbwHz
 * @param {number|undefined} thresholdHz umbral de ancho de banda analítico
 */
function selectThreeOpAmp(targetGain, tolerancePct, gbwHz, thresholdHz) {
  const rank = (candidate) => {
    candidate.predictedBandwidthHz = gbwHz / candidate.gainReal
    candidate.gainFeasible = Math.abs(candidate.errPct) < tolerancePct - EPS
    candidate.bandwidthFeasible = bandwidthFeasible(candidate.predictedBandwidthHz, thresholdHz)
    return candidate
  }

  // Caso G <= 1: la topología no puede bajar de 1; se devuelve el mejor intento.
  if (!(targetGain > 1)) {
    return rank(threeOpAmpCandidate(10000, 1e6, targetGain))
  }

  const canonicalR1 = DIFF_AMP_RESISTOR_OHM
  const canonicalRg = nearestE96((2 * canonicalR1) / (targetGain - 1)).valueOhm
  const canonical = rank(threeOpAmpCandidate(canonicalR1, canonicalRg, targetGain))
  if (canonical.gainFeasible && canonical.bandwidthFeasible) return canonical

  // Búsqueda acotada sobre la serie E96 (R1 de 1 kΩ a 1 MΩ; Rg de 10 Ω a 100 kΩ).
  const r1Values = e96Values(1000, 1e6)
  const rgValues = e96Values(10, 1e5)
  let bestBandwidthFeasible = null
  let bestGainFeasible = null
  let bestOverall = null
  for (const r1 of r1Values) {
    for (const rg of rgValues) {
      const candidate = threeOpAmpCandidate(r1, rg, targetGain)
      const magnitude = Math.abs(candidate.errPct)
      if (bestOverall === null || magnitude < Math.abs(bestOverall.errPct) - EPS) {
        bestOverall = candidate
      }
      if (magnitude < tolerancePct - EPS) {
        if (bestGainFeasible === null || magnitude < Math.abs(bestGainFeasible.errPct) - EPS) {
          bestGainFeasible = candidate
        }
        candidate.predictedBandwidthHz = gbwHz / candidate.gainReal
        if (
          bandwidthFeasible(candidate.predictedBandwidthHz, thresholdHz) &&
          (bestBandwidthFeasible === null ||
            magnitude < Math.abs(bestBandwidthFeasible.errPct) - EPS)
        ) {
          bestBandwidthFeasible = candidate
        }
      }
    }
  }
  const chosen = bestBandwidthFeasible ?? bestGainFeasible ?? bestOverall
  return rank(chosen)
}

/**
 * Elige Rg de la serie E96 para la topología monolítica (G = 1 + 50 kΩ/Rg).
 * La función de ganancia es monótona en Rg, así que el valor E96 más cercano
 * al ideal es el de menor error.
 *
 * @param {number} targetGain
 * @param {number} tolerancePct
 * @param {number} gbwHz
 * @param {number|undefined} thresholdHz
 */
function selectMonolithic(targetGain, tolerancePct, gbwHz, thresholdHz) {
  if (!(targetGain > 1)) return null
  const idealRg = INTERNAL_GAIN_RESISTOR_OHM / (targetGain - 1)
  const rg = nearestE96(idealRg).valueOhm
  const gainReal = 1 + INTERNAL_GAIN_RESISTOR_OHM / rg
  const errPct = ((gainReal - targetGain) / targetGain) * 100
  return {
    topology: 'monolithic',
    rg,
    gainReal,
    errPct,
    physicalCount: MONOLITHIC_PHYSICAL_RESISTORS,
    predictedBandwidthHz: gbwHz / gainReal,
    gainFeasible: Math.abs(errPct) < tolerancePct - EPS,
    bandwidthFeasible: bandwidthFeasible(gbwHz / gainReal, thresholdHz),
  }
}

/** Ranking determinista: factible > banda > |error|; empate conserva el orden. */
function candidateScore(candidate, thresholdHz) {
  const gainRank = candidate.gainFeasible ? 0 : 1
  const bandwidthRank = bandwidthFeasible(candidate.predictedBandwidthHz, thresholdHz) ? 0 : 1
  return gainRank * 1000 + bandwidthRank * 100 + Math.abs(candidate.errPct)
}

/* ------------------------------------------------------------------ */
/* Síntesis                                                            */
/* ------------------------------------------------------------------ */

/**
 * Diseña un amplificador de instrumentación para un `CircuitSpec`.
 *
 * @param {CircuitSpec} spec
 * @returns {DesignProposal}
 */
export function designIa(spec = {}) {
  const targetGain = firstFinite(spec?.gain?.nominal) ?? DEFAULT_GAIN
  const tolerancePct = isFiniteNumber_ia(spec?.gain?.tolerancePct)
    ? Math.max(0, spec.gain.tolerancePct)
    : DEFAULT_TOLERANCE_PCT
  const model = resolveOpAmpModel(spec)
  const thresholdHz = bandwidthThresholdHz(spec)
  const constraints = spec?.constraints ?? {}
  const monolithicAllowed = constraints.monolithicAllowed !== false
  const maxResistors = Number.isInteger(constraints.maxResistors) ? constraints.maxResistors : Infinity
  const specId = typeof spec?.id === 'string' && spec.id.length > 0 ? spec.id : 'sin-id'

  const clarifyingQuestions = []
  const three = selectThreeOpAmp(targetGain, tolerancePct, model.gbwHz, thresholdHz)
  const mono = monolithicAllowed
    ? selectMonolithic(targetGain, tolerancePct, model.gbwHz, thresholdHz)
    : null

  const candidates = []
  let constraintViolated = false
  if (three && three.physicalCount <= maxResistors) candidates.push(three)
  if (mono && mono.physicalCount <= maxResistors) candidates.push(mono)
  if (candidates.length === 0) {
    // El spec es imposible bajo las restricciones: se devuelve el mejor intento.
    if (three) candidates.push(three)
    if (mono) candidates.push(mono)
    constraintViolated = true
  }

  // Sort estable: ante empate de error se conserva three_op_amp antes que monolithic.
  const chosen = [...candidates].sort(
    (left, right) => candidateScore(left, thresholdHz) - candidateScore(right, thresholdHz),
  )[0]

  const chosenGainFeasible = Math.abs(chosen.errPct) < tolerancePct - EPS
  const chosenBandwidthFeasible = bandwidthFeasible(chosen.predictedBandwidthHz, thresholdHz)
  if (!chosenGainFeasible) {
    clarifyingQuestions.push(
      `No se alcanzó G = ${roundTo(targetGain, 6)} con tolerancia ±${roundTo(tolerancePct, 4)} % usando la serie E96: ` +
        `el mejor intento da G = ${roundTo(chosen.gainReal, 6)} (error ${roundTo(chosen.errPct, 4)} %). ` +
        '¿Relajamos la tolerancia, permitimos la serie E24 o agregamos una etapa de ganancia?',
    )
  }
  if (!chosenBandwidthFeasible) {
    const required = requiredBandwidthHz(spec)
    clarifyingQuestions.push(
      `El modelo de op-amp (${model.label}, GBW = ${roundTo(model.gbwHz / 1e6, 3)} MHz) ` +
        `no alcanza ${roundTo(required ?? 0, 6)} Hz a G = ${roundTo(chosen.gainReal, 4)}: ` +
        `estimado ${roundTo(chosen.predictedBandwidthHz, 6)} Hz. ` +
        '¿Permitís un op-amp de mayor GBW o reducimos el ancho de banda requerido?',
    )
  }
  if (constraintViolated) {
    clarifyingQuestions.push(
      `Las restricciones del spec (máx. ${constraints.maxResistors} resistencias) no permiten la topología elegida; ` +
        'se devuelve el mejor intento. ¿Relajamos esa restricción?',
    )
  }
  if (!(targetGain > 1)) {
    clarifyingQuestions.push(
      'La ganancia nominal pedida es 1 (o menor): un IA no puede atenuar sin red de atenuación externa. ' +
        '¿La ganancia mínima real es 2 o más?',
    )
  }

  const opAmpPoleHz = model.gbwHz / model.openLoopGain
  const opAmpEntry = { name: 'U1', gain: model.openLoopGain, poleHz: opAmpPoleHz }
  const opAmps =
    chosen.topology === 'three_op_amp'
      ? [
          { ...opAmpEntry, name: 'U1' },
          { ...opAmpEntry, name: 'U2' },
          { ...opAmpEntry, name: 'U3' },
        ]
      : [{ ...opAmpEntry, name: 'U1' }]

  const resistors =
    chosen.topology === 'three_op_amp'
      ? [
          { name: 'R1', valueOhm: chosen.r1, series: 'E96' },
          { name: 'Rg', valueOhm: chosen.rg, series: 'E96' },
          { name: 'R2', valueOhm: chosen.r2, series: 'E96' },
          { name: 'R3', valueOhm: chosen.r3, series: 'E96' },
        ]
      : [{ name: 'Rg', valueOhm: chosen.rg, series: 'E96' }]

  const expected = {
    gain: roundTo(chosen.gainReal, 6),
    gainErrorPct: roundTo(chosen.errPct, 6),
    bandwidthHz: roundTo(chosen.predictedBandwidthHz, 6),
    gbwHz: model.gbwHz,
  }
  if (chosen.topology === 'three_op_amp') {
    expected.gainStage1 = roundTo(1 + (2 * chosen.r1) / chosen.rg, 6)
    expected.gainStage2 = 1
  }

  const assumptions =
    chosen.topology === 'three_op_amp'
      ? [
          `Modelo de op-amp de un polo: A0 = ${model.openLoopGain}, GBW = ${roundTo(model.gbwHz / 1e6, 4)} MHz (${model.label}); los op-amps reales tienen más polos, slew rate y ruido.`,
          'R1, R2 y R3 representan pares de resistencias iguales: la topología usa 7 resistencias físicas (2×R1, Rg, 2×R2, 2×R3).',
          'La etapa de diferencia usa R2 = R3 = 10 kΩ (G2 = 1); el error de ganancia incluye el redondeo E96 de R1 y Rg.',
          'Solver MNA lineal: no modela saturación, offset, ruido ni impedancia de salida. Verificar que la salida máxima (±G·Vin) entre en la alimentación.',
          'CMRR ideal del modelo: en hardware real lo limitan el apareamiento de resistencias y el CMRR del op-amp; usar resistencias de 0.1 % en la etapa de diferencia.',
          'Revisión humana obligatoria antes de fabricar; este diseño no es apto para aplicaciones safety-critical.',
        ]
      : [
          'Modelo monolítico INA128-like: G = 1 + 50 kΩ/Rg. El netlist descompone la red interna trimada (50 kΩ) y Rg en un solo op-amp diferencial para que el Monte Carlo de resistencias sea trazable.',
          `Modelo de op-amp de un polo: A0 = ${model.openLoopGain}, GBW = ${roundTo(model.gbwHz / 1e6, 4)} MHz (${model.label}).`,
          'Rg es la única resistencia externa de ganancia; usar 0.1 % y baja deriva térmica para conservar la ganancia y el CMRR.',
          'Solver MNA lineal: no modela saturación, offset, ruido ni impedancia de salida. Verificar que la salida máxima (±G·Vin) entre en la alimentación.',
          'Revisión humana obligatoria antes de fabricar; este diseño no es apto para aplicaciones safety-critical.',
        ]

  const proposal = {
    schema: 'cir/DesignProposal/v1',
    specId,
    topology: chosen.topology,
    resistors,
    opAmps,
    netlist: { schema: 'cir/Netlist/v1', nodes: [], elements: [] },
    expected,
    assumptions,
    clarifyingQuestions,
  }
  proposal.netlist = buildIaNetlist(proposal)
  return proposal
}

/* ------------------------------------------------------------------ */
/* Netlist                                                             */
/* ------------------------------------------------------------------ */

/** Nodos de la topología de 3 op-amps (contrato del piloto). */
const THREE_OP_AMP_NODES = Object.freeze([
  'in+',
  'in-',
  'a_fb',
  'b_fb',
  'a',
  'b',
  'n',
  'p',
  'out',
  '0',
])

/** @param {unknown} value */
function positive(value) {
  return isFiniteNumber_ia(value) && value > 0 ? value : undefined
}

/**
 * Construye el netlist de un `DesignProposal` (sin fuentes de entrada: las
 * agrega `measure.js` al medir).
 *
 * Topología de 3 op-amps:
 * - Entradas `in+`/`in-` a los buffers U1/U2 (nodos `a`/`b`).
 * - R1 y Rg fijan la ganancia de entrada: `R1a: a–a_fb`, `Rg: a_fb–b_fb`,
 *   `R1b: b_fb–b`.
 * - Etapa de diferencia U3 (`p`, `n`): `R2a: a–p`, `R3a: p–0`,
 *   `R2b: b–n`, `R3b: n–out`.
 *
 * Monolítico: un solo `OPAMP` diferencial (`in+`, `in-`, `out`) rodeado por la
 * red de resistencias que realiza `G = 1 + 50 kΩ/Rg` (50 kΩ internos trimados).
 *
 * @param {DesignProposal} proposal
 * @returns {import('./types.js').Netlist}
 */
export function buildIaNetlist(proposal) {
  if (proposal === null || typeof proposal !== 'object') {
    throw new TypeError('buildIaNetlist esperaba un DesignProposal')
  }
  const resistors = Array.isArray(proposal.resistors) ? proposal.resistors : []
  const opAmps = Array.isArray(proposal.opAmps) ? proposal.opAmps : []
  const resistorValue = (name) => {
    const found = resistors.find((item) => item?.name === name)
    return positive(found?.valueOhm)
  }
  const opAmpAt = (index) => {
    const found = opAmps[index] ?? opAmps[0]
    if (!found) return { gain: 1e6, poleHz: 1 }
    return {
      gain: positive(found.gain) ?? 1e6,
      poleHz: positive(found.poleHz) ?? 1,
    }
  }

  if (proposal.topology === 'three_op_amp') {
    const r1 = resistorValue('R1')
    const rg = resistorValue('Rg')
    const r2 = resistorValue('R2') ?? DIFF_AMP_RESISTOR_OHM
    const r3 = resistorValue('R3') ?? DIFF_AMP_RESISTOR_OHM
    if (r1 === undefined || rg === undefined) {
      throw new Error('buildIaNetlist: faltan R1 o Rg en el proposal (topología three_op_amp)')
    }
    const amplifier = opAmpAt(0)
    const elements = [
      { type: 'R', name: 'R1a', a: 'a', b: 'a_fb', valueOhm: r1 },
      { type: 'R', name: 'Rg', a: 'a_fb', b: 'b_fb', valueOhm: rg },
      { type: 'R', name: 'R1b', a: 'b_fb', b: 'b', valueOhm: r1 },
      { type: 'R', name: 'R2a', a: 'a', b: 'p', valueOhm: r2 },
      { type: 'R', name: 'R3a', a: 'p', b: '0', valueOhm: r3 },
      { type: 'R', name: 'R2b', a: 'b', b: 'n', valueOhm: r2 },
      { type: 'R', name: 'R3b', a: 'n', b: 'out', valueOhm: r3 },
      {
        type: 'OPAMP',
        name: 'U1',
        inP: 'in+',
        inN: 'a_fb',
        out: 'a',
        gain: amplifier.gain,
        poleHz: amplifier.poleHz,
      },
      {
        type: 'OPAMP',
        name: 'U2',
        inP: 'in-',
        inN: 'b_fb',
        out: 'b',
        gain: opAmpAt(1).gain,
        poleHz: opAmpAt(1).poleHz,
      },
      {
        type: 'OPAMP',
        name: 'U3',
        inP: 'p',
        inN: 'n',
        out: 'out',
        gain: opAmpAt(2).gain,
        poleHz: opAmpAt(2).poleHz,
      },
    ]
    return { schema: 'cir/Netlist/v1', nodes: [...THREE_OP_AMP_NODES], elements }
  }

  if (proposal.topology === 'monolithic') {
    const rg = resistorValue('Rg')
    if (rg === undefined) {
      throw new Error('buildIaNetlist: falta Rg en el proposal (topología monolithic)')
    }
    const internal = INTERNAL_GAIN_RESISTOR_OHM
    const amplifier = opAmpAt(0)
    // Etapa de diferencia (un solo op-amp): G = (50 kΩ + Rg) / Rg = 1 + 50 kΩ/Rg.
    const elements = [
      { type: 'R', name: 'Rg1', a: 'in+', b: 'p', valueOhm: rg },
      { type: 'R', name: 'Rf1', a: 'p', b: 'n1', valueOhm: internal },
      { type: 'R', name: 'Rf2', a: 'n1', b: '0', valueOhm: rg },
      { type: 'R', name: 'Rg2', a: 'in-', b: 'n', valueOhm: rg },
      { type: 'R', name: 'Rf3', a: 'n', b: 'n2', valueOhm: internal },
      { type: 'R', name: 'Rf4', a: 'n2', b: 'out', valueOhm: rg },
      {
        type: 'OPAMP',
        name: 'U1',
        inP: 'p',
        inN: 'n',
        out: 'out',
        gain: amplifier.gain,
        poleHz: amplifier.poleHz,
      },
    ]
    return {
      schema: 'cir/Netlist/v1',
      nodes: ['in+', 'in-', 'p', 'n', 'n1', 'n2', 'out', '0'],
      elements,
    }
  }

  throw new Error(`buildIaNetlist: topología desconocida '${String(proposal.topology)}'`)
}

/* ------------------------------------------------------------------ */
/* Evaluación                                                          */
/* ------------------------------------------------------------------ */

/** Frecuencias del barrido: log 1 Hz–10 MHz más las frecuencias pedidas. */
function buildFrequencies(explicitFrequencies, spec) {
  const frequencies = []
  const seen = new Set()
  const add = (value) => {
    if (!isFiniteNumber_ia(value) || value <= 0) return
    const rounded = Number(value.toPrecision(6))
    if (seen.has(rounded)) return
    seen.add(rounded)
    frequencies.push(rounded)
  }
  if (Array.isArray(explicitFrequencies) && explicitFrequencies.length > 0) {
    for (const value of explicitFrequencies) add(value)
  } else {
    const logMin = Math.log10(SWEEP_MIN_HZ)
    const logMax = Math.log10(SWEEP_MAX_HZ)
    for (let index = 0; index < SWEEP_POINTS; index += 1) {
      const logFrequency = logMin + ((logMax - logMin) * index) / (SWEEP_POINTS - 1)
      add(10 ** logFrequency)
    }
  }
  const specBandwidth = requiredBandwidthHz(spec)
  if (specBandwidth !== undefined) add(specBandwidth)
  frequencies.sort((left, right) => left - right)
  return frequencies
}

/** Amplitud de la excitación diferencial: el doble del rango de entrada. */
function differentialDrive(spec) {
  const range = spec?.inputRangeV
  const maxAbs = Math.max(Math.abs(range?.minV ?? 0), Math.abs(range?.maxV ?? 0))
  const vd = 2 * maxAbs
  return isFiniteNumber_ia(vd) && vd > 0 ? vd : 0.02
}

/** Netlist de medición AC: fuentes diferenciales `±vd/2` sobre una copia. */
function withDifferentialSources(netlist, vd) {
  const elements = netlist.elements
    .filter((element) => !(element?.type === 'V' && String(element.name).startsWith('__meas_')))
    .map((element) => ({ ...element }))
  elements.push({ type: 'V', name: '__meas_vp', a: 'in+', b: '0', valueV: vd / 2 })
  elements.push({ type: 'V', name: '__meas_vn', a: 'in-', b: '0', valueV: -vd / 2 })
  return { schema: 'cir/Netlist/v1', nodes: [...netlist.nodes], elements }
}

/** Acota el CMRR ideal (∞) a un valor finito y reportable. */
function sanitizeCmrr(cmrrDb) {
  if (cmrrDb === Infinity) return CMRR_IDEAL_CAP_DB
  if (!isFiniteNumber_ia(cmrrDb)) return Number.NaN
  return Math.min(cmrrDb, CMRR_IDEAL_CAP_DB)
}

/** Porcentaje p95 de desvío absoluto de las muestras respecto de la referencia. */
function p95AbsolutePct(samples, reference) {
  if (!Array.isArray(samples) || samples.length === 0) return 0
  if (!isFiniteNumber_ia(reference) || reference === 0) return Number.NaN
  const deviations = samples
    .filter((sample) => isFiniteNumber_ia(sample))
    .map((sample) => Math.abs(sample / reference - 1) * 100)
    .sort((left, right) => left - right)
  if (deviations.length === 0) return Number.NaN
  const index = Math.min(deviations.length - 1, Math.ceil(0.95 * deviations.length) - 1)
  return deviations[index]
}

/**
 * Simula un `DesignProposal` y devuelve DC, AC y métricas.
 *
 * - Ganancia DC y CMRR con `measure.js` (excitación diferencial y de modo común).
 * - Barrido AC logarítmico 1 Hz–10 MHz (más las frecuencias del spec) y ancho
 *   de banda −3 dB interpolado.
 * - Monte Carlo de ganancia con tolerancia de resistencias del 1 % y semilla
 *   fija (reproducible).
 *
 * @param {CircuitSpec} spec
 * @param {DesignProposal} proposal
 * @param {{ frequencies?: number[], monteCarloRuns?: number, seed?: number }} [options]
 * @returns {{ dc: import('./types.js').DcResult, ac: import('./types.js').AcResult, metrics: import('./types.js').Metrics }}
 */
export function evaluateProposal(spec = {}, proposal = {}, options = {}) {
  const netlist = proposal?.netlist ?? buildIaNetlist(proposal)
  const runs = Number.isInteger(options.monteCarloRuns) && options.monteCarloRuns > 0
    ? options.monteCarloRuns
    : DEFAULT_MC_RUNS
  const seed = isFiniteNumber_ia(options.seed) ? options.seed : DEFAULT_MC_SEED
  const frequencies = buildFrequencies(options.frequencies, spec)
  const vd = differentialDrive(spec)

  const warnings = []

  // Ganancia DC diferencial.
  const gainMeasurement = measureDifferentialGain({
    netlist,
    outNode: 'out',
    inP: 'in+',
    inN: 'in-',
    vd,
  })

  // CMRR: el modelo ideal puede dar ∞ (se acota para reportar).
  let cmrrDb
  const rawCmrr = measureCmrr({ netlist, outNode: 'out', inP: 'in+', inN: 'in-', vcm: 1 })
  const rawCmrrDb = rawCmrr.cmrrDb
  cmrrDb = sanitizeCmrr(rawCmrrDb)
  if (rawCmrrDb === Infinity) {
    warnings.push(
      `CMRR ideal en el modelo lineal (acotado a ${CMRR_IDEAL_CAP_DB} dB para el reporte); el hardware real está limitado por el apareamiento de resistencias.`,
    )
  }

  // Barrido AC con excitación diferencial.
  const ac = solveAc(withDifferentialSources(netlist, vd), { frequencies })
  const dcGain = Math.abs(gainMeasurement.ad)
  const measuredBandwidth = bandwidthHz(ac, {
    outNode: 'out',
    inP: 'in+',
    inN: 'in-',
    dcGain,
  })
  if (
    isFiniteNumber_ia(measuredBandwidth) &&
    measuredBandwidth >= frequencies[frequencies.length - 1] * (1 - 1e-9) &&
    isFiniteNumber_ia(dcGain) &&
    dcGain > 0
  ) {
    warnings.push(
      'La ganancia no cayó 3 dB dentro del barrido AC (1 Hz–10 MHz): el ancho de banda reportado es una cota inferior.',
    )
  }

  // Monte Carlo de ganancia (resistencias ±1 %, semilla fija).
  const monteCarlo = runMonteCarlo({
    netlist,
    runs,
    tolerancePct: RESISTOR_TOLERANCE_PCT,
    seed,
    evaluate: (perturbedNetlist) => {
      const measured = measureDifferentialGain({
        netlist: perturbedNetlist,
        outNode: 'out',
        inP: 'in+',
        inN: 'in-',
        vd,
      })
      return Math.abs(measured.ad)
    },
  })

  const nominal = firstFinite(spec?.gain?.nominal) ?? DEFAULT_GAIN
  const measured = gainMeasurement.ad
  const errorPct = ((measured - nominal) / nominal) * 100
  const mcP95AbsPct = p95AbsolutePct(monteCarlo.samples, dcGain)

  const metrics = {
    gain: {
      nominal,
      measured: roundTo(measured, 8),
      errorPct: roundTo(errorPct, 8),
      mcP95AbsPct: roundTo(mcP95AbsPct, 8),
    },
    bandwidthHz: roundTo(measuredBandwidth, 8),
    cmrrDb: roundTo(cmrrDb, 8),
    cmrrMinDb: isFiniteNumber_ia(spec?.cmrrMinDb) ? spec.cmrrMinDb : 0,
  }

  if (warnings.length > 0) {
    ac.warnings = [...(ac.warnings ?? []), ...warnings]
  }
  return { dc: gainMeasurement.dc, ac, metrics }
}

/* ===== spec ===== */

/**
 * Interpretación de requisitos: `CircuitSpec` por defecto y parser de texto libre.
 *
 * Acepta un objeto ya estructurado (JSON) o un texto en español/inglés redactado
 * por una persona, extrae lo que puede y completa los campos faltantes con
 * `defaultSpec()`. Cada campo faltante (o ilegible) genera una pregunta de
 * aclaración, de modo que el pipeline pueda pedir los datos antes de diseñar.
 *
 * Sin dependencias, sin red y sin reloj: la misma entrada produce siempre la
 * misma salida.
 */

/** @typedef {import('./types.js').CircuitSpec} CircuitSpec */

const DEFAULT_GAIN_NOMINAL = 100
const DEFAULT_GAIN_TOLERANCE_PCT = 1
const DEFAULT_BANDWIDTH_HZ = 10000
const DEFAULT_CMRR_MIN_DB = 80
const DEFAULT_SUPPLY_V = 15
const DEFAULT_INPUT_RANGE_V = 0.01
const DEFAULT_SOURCE_IMPEDANCE_OHM = 350
const STRAIN_GAUGE_SOURCE_IMPEDANCE_OHM = 350
const OPAMP_MODELS = new Set(['generic-1mhz', 'generic-10mhz', 'ina128-like'])
const RESISTOR_SERIES = new Set(['E24', 'E96'])

/** @param {unknown} value */
function isFiniteNumber_spec(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** @param {unknown} value */
function isPlainObject_spec(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Convierte "1,5" o "1.5" a número; devuelve NaN si no se puede. */
function parseDecimal(raw) {
  if (typeof raw === 'number') return raw
  if (typeof raw !== 'string') return Number.NaN
  return Number(raw.replace(/\./g, '').replace(',', '.'))
}

/** Multiplicador de prefijo de frecuencia (k → 10³, M → 10⁶, G → 10⁹). */
function frequencyMultiplier(prefix) {
  if (!prefix) return 1
  const normalized = prefix.toUpperCase()
  if (normalized === 'K') return 1e3
  if (normalized === 'M') return 1e6
  if (normalized === 'G') return 1e9
  return 1
}

/** Multiplicador de prefijo de tensión (m → 10⁻³, µ/u → 10⁻⁶). */
function voltageMultiplier(prefix) {
  if (!prefix) return 1
  if (prefix === 'm') return 1e-3
  if (prefix === 'µ' || prefix === 'u') return 1e-6
  return 1
}

/**
 * Especificación por defecto: amplificador de instrumentación para galga
 * extensométrica, ganancia 100, 10 kHz de ancho de banda y ±15 V.
 * Devuelve un objeto nuevo en cada llamada (no compartir estado mutable).
 *
 * @returns {CircuitSpec}
 */
export function defaultSpec() {
  return {
    schema: 'cir/CircuitSpec/v1',
    id: 'spec-por-defecto',
    target: 'instrumentation_amplifier',
    gain: { nominal: DEFAULT_GAIN_NOMINAL, tolerancePct: DEFAULT_GAIN_TOLERANCE_PCT },
    bandwidthHz: DEFAULT_BANDWIDTH_HZ,
    cmrrMinDb: DEFAULT_CMRR_MIN_DB,
    supply: { positiveV: DEFAULT_SUPPLY_V, negativeV: -DEFAULT_SUPPLY_V },
    inputRangeV: { minV: -DEFAULT_INPUT_RANGE_V, maxV: DEFAULT_INPUT_RANGE_V },
    sourceImpedanceOhm: DEFAULT_SOURCE_IMPEDANCE_OHM,
    constraints: {
      resistorSeries: 'E96',
      monolithicAllowed: true,
      opAmpModel: 'generic-10mhz',
    },
  }
}

/* ------------------------------------------------------------------ */
/* Heurísticas de texto libre                                          */
/* ------------------------------------------------------------------ */

const NUMBER = '([0-9]+(?:[.,][0-9]+)?)'
const NUMBER_RE = new RegExp(NUMBER)

/** Busca la ganancia nominal evitando confundirla con la tolerancia. */
function findGain(text) {
  const patterns = [
    new RegExp(`(?:ganancia|gain)\\s*(?:nominal|de\\s+ganancia)?\\s*(?:=|:)?\\s*(?:de|of)?\\s*${NUMBER}`, 'gi'),
    new RegExp(`${NUMBER}\\s*(?:x|×)\\s*(?:de\\s+)?(?:ganancia|gain)`, 'gi'),
    new RegExp(`(?:^|[\\s,;])g\\s*=\\s*${NUMBER}`, 'gi'),
    new RegExp(`(?:amplificar|amplify)[^.\\n]{0,40}?${NUMBER}`, 'gi'),
  ]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(text)) !== null) {
      const before = text.slice(Math.max(0, match.index - 30), match.index).toLowerCase()
      if (/(?:error|tolerancia|precisi[oó]n|impedancia|impedance)/.test(before)) continue
      const value = parseDecimal(match[1])
      if (Number.isFinite(value) && value >= 1) return value
    }
  }
  return undefined
}

/** Busca el ancho de banda (Hz/kHz/MHz), con contexto o sin él. */
function findBandwidth(text) {
  const contextPattern = new RegExp(
    `(?:ancho\\s+de\\s+banda|bandwidth|frecuencia\\s+de\\s+corte|cutoff)[^.\\n]{0,35}?${NUMBER}\\s*(k|K|M|G)?\\s*hz`,
    'i',
  )
  const contextual = text.match(contextPattern)
  if (contextual) {
    const value = parseDecimal(contextual[1]) * frequencyMultiplier(contextual[2])
    if (Number.isFinite(value) && value >= 1) return value
  }
  const anyPattern = new RegExp(`${NUMBER}\\s*(k|K|M|G)?\\s*hz`, 'gi')
  let match
  while ((match = anyPattern.exec(text)) !== null) {
    const value = parseDecimal(match[1]) * frequencyMultiplier(match[2])
    if (Number.isFinite(value) && value >= 1) return value
  }
  return undefined
}

/** Busca el CMRR mínimo en dB. */
function findCmrr(text) {
  const pattern = new RegExp(
    `(?:cmrr|rechazo\\s+de\\s+modo\\s+com[uú]n|common[\\s-]?mode\\s+rejection)[^.\\n]{0,35}?${NUMBER}\\s*(?:db)?`,
    'i',
  )
  const match = text.match(pattern)
  if (!match) return undefined
  const value = parseDecimal(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** Busca la alimentación simétrica (±V) o asimétrica (+V/−V). */
function findSupply(text) {
  const asymmetric = text.match(
    new RegExp(`\\+${NUMBER}\\s*v\\s*\\/\\s*[-−]${NUMBER}\\s*v`, 'i'),
  )
  if (asymmetric) {
    const positiveV = parseDecimal(asymmetric[1])
    const negativeV = parseDecimal(asymmetric[2])
    if (Number.isFinite(positiveV) && Number.isFinite(negativeV)) {
      return { positiveV, negativeV: -Math.abs(negativeV) }
    }
  }
  const patterns = [
    new RegExp(
      `(?:alimentaci[oó]n|supply|fuente)\\s*(?:de|:)?\\s*(?:±|\\+\\/-|\\+-|\\+−|\\+\\s*\\/\\s*-)?\\s*${NUMBER}\\s*v`,
      'i',
    ),
    new RegExp(`(?:±|\\+\\/-|\\+-|\\+−)\\s*${NUMBER}\\s*v`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const value = parseDecimal(match[1])
    if (Number.isFinite(value) && value > 0) {
      return { positiveV: value, negativeV: -value }
    }
  }
  return undefined
}

/** Busca el rango de entrada diferencial (p. ej. "±10 mV"). */
function findInputRange(text) {
  const prefix = `(?:rango\\s+de\\s+entrada|input\\s+range|entrada\\s+diferencial|se[ñn]al\\s+de\\s+entrada)`
  const symmetric = text.match(
    new RegExp(`${prefix}[^.\\n]{0,35}?(?:±|\\+\\/-|\\+-|\\+−)?\\s*${NUMBER}\\s*(m|µ|u)?\\s*v`, 'i'),
  )
  if (symmetric) {
    const magnitude = parseDecimal(symmetric[1]) * voltageMultiplier(symmetric[2])
    if (Number.isFinite(magnitude) && magnitude > 0) {
      return { minV: -magnitude, maxV: magnitude }
    }
  }
  const minMax = text.match(
    new RegExp(
      `${prefix}[^.\\n]{0,35}?[-−]${NUMBER}\\s*(m|µ|u)?\\s*v\\s*(?:a|to)\\s*\\+?${NUMBER}\\s*(m|µ|u)?\\s*v`,
      'i',
    ),
  )
  if (minMax) {
    const minV = -parseDecimal(minMax[1]) * voltageMultiplier(minMax[2])
    const maxV = parseDecimal(minMax[3]) * voltageMultiplier(minMax[4])
    if (Number.isFinite(minV) && Number.isFinite(maxV) && minV < maxV) {
      return { minV, maxV }
    }
  }
  return undefined
}

/** Busca la impedancia de fuente. */
function findSourceImpedance(text) {
  const pattern = new RegExp(
    `(?:impedancia|impedance)[^.\\n]{0,30}?${NUMBER}\\s*(?:ω|Ω|ohm(?:s)?)`,
    'i',
  )
  const match = text.match(pattern)
  if (match) {
    const value = parseDecimal(match[1])
    if (Number.isFinite(value) && value > 0) return value
  }
  return undefined
}

/** Heurística de sensor: galga extensométrica / strain gauge / celda de carga. */
function looksLikeStrainGauge(text) {
  return /galga|strain[\s-]?gauge|extensom[eé]tric|celda\s+de\s+carga|load\s+cell/i.test(text)
}

/** Busca la tolerancia de ganancia en porcentaje (p. ej. "error < 1 %"). */
function findTolerancePct(text) {
  const pattern = new RegExp(
    `(?:error|tolerancia|precisi[oó]n)[^.\\n]{0,45}?${NUMBER}\\s*%`,
    'i',
  )
  const match = text.match(pattern)
  if (!match) return undefined
  const value = parseDecimal(match[1])
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/* ------------------------------------------------------------------ */
/* Normalización                                                       */
/* ------------------------------------------------------------------ */

/** Completa y normaliza un objeto spec ya estructurado (parcial o completo). */
function fromObject(input) {
  const base = defaultSpec()
  const spec = defaultSpec()
  const questions = []
  const id = isFiniteNumber_spec(input.id) ? undefined : input.id
  if (typeof id === 'string' && id.length > 0) spec.id = id

  const rawGain = input.gain
  let nominal
  let tolerancePct
  if (isFiniteNumber_spec(rawGain)) {
    nominal = rawGain
  } else if (isPlainObject_spec(rawGain)) {
    if (isFiniteNumber_spec(rawGain.nominal)) nominal = rawGain.nominal
    if (isFiniteNumber_spec(rawGain.tolerancePct)) tolerancePct = rawGain.tolerancePct
  } else if (isFiniteNumber_spec(input.gainNominal)) {
    nominal = input.gainNominal
  }
  if (tolerancePct === undefined) {
    if (isFiniteNumber_spec(input.gainTolerancePct)) tolerancePct = input.gainTolerancePct
    else if (isFiniteNumber_spec(input.tolerancePct)) tolerancePct = input.tolerancePct
  }
  if (nominal === undefined || !Number.isFinite(nominal) || nominal < 1) {
    questions.push('¿Cuál es la ganancia nominal requerida (V/V)?')
  } else {
    spec.gain.nominal = nominal
  }
  if (isFiniteNumber_spec(tolerancePct) && tolerancePct >= 0) {
    spec.gain.tolerancePct = tolerancePct
  }

  const bandwidth = decodeFrequency(input.bandwidthHz ?? input.bandwidth)
  if (bandwidth === undefined) {
    questions.push('¿Qué ancho de banda mínimo necesitás a −3 dB (Hz o kHz)?')
  } else {
    spec.bandwidthHz = bandwidth
  }

  const cmrr = input.cmrrMinDb ?? input.cmrrDb ?? input.cmrr
  if (!isFiniteNumber_spec(cmrr)) {
    questions.push('¿Qué CMRR mínimo necesitás (en dB)?')
  } else {
    spec.cmrrMinDb = cmrr
  }

  const supply = normalizeSupply(input.supply ?? input.supplyV)
  if (supply === undefined) {
    questions.push('¿Qué alimentación tenés disponible (p. ej. ±15 V)?')
  } else {
    spec.supply = supply
  }

  const inputRange = normalizeInputRange(input.inputRangeV ?? input.inputRange)
  if (inputRange === undefined) {
    questions.push('¿Cuál es el rango de la señal de entrada (p. ej. ±10 mV)?')
  } else {
    spec.inputRangeV = inputRange
  }

  const sourceImpedance = decodeNumber(input.sourceImpedanceOhm ?? input.sourceImpedance)
  if (sourceImpedance === undefined || !Number.isFinite(sourceImpedance) || sourceImpedance < 0) {
    questions.push('¿Cuál es la impedancia de la fuente o del sensor (Ω)?')
  } else {
    spec.sourceImpedanceOhm = sourceImpedance
  }

  spec.constraints = normalizeConstraints(input.constraints, base.constraints)
  return { spec, questions }
}

/** Extrae lo que pueda de un texto libre y completa el resto con defaults. */
function fromText(text) {
  const spec = defaultSpec()
  const questions = []
  let found = 0

  const gain = findGain(text)
  if (gain === undefined) questions.push('¿Cuál es la ganancia nominal requerida (V/V)?')
  else {
    spec.gain.nominal = gain
    found += 1
  }

  const tolerancePct = findTolerancePct(text)
  if (tolerancePct !== undefined) spec.gain.tolerancePct = tolerancePct

  const bandwidth = findBandwidth(text)
  if (bandwidth === undefined) {
    questions.push('¿Qué ancho de banda mínimo necesitás a −3 dB (Hz o kHz)?')
  } else {
    spec.bandwidthHz = bandwidth
    found += 1
  }

  const cmrr = findCmrr(text)
  if (cmrr === undefined) questions.push('¿Qué CMRR mínimo necesitás (en dB)?')
  else {
    spec.cmrrMinDb = cmrr
    found += 1
  }

  const supply = findSupply(text)
  if (supply === undefined) questions.push('¿Qué alimentación tenés disponible (p. ej. ±15 V)?')
  else {
    spec.supply = supply
    found += 1
  }

  const inputRange = findInputRange(text)
  if (inputRange === undefined) {
    questions.push('¿Cuál es el rango de la señal de entrada (p. ej. ±10 mV)?')
  } else {
    spec.inputRangeV = inputRange
    found += 1
  }

  const sourceImpedance = findSourceImpedance(text)
  if (sourceImpedance !== undefined) {
    spec.sourceImpedanceOhm = sourceImpedance
    found += 1
  } else if (looksLikeStrainGauge(text)) {
    // Galga extensométrica típica: puente de 350 Ω. Se asume y no se pregunta.
    spec.sourceImpedanceOhm = STRAIN_GAUGE_SOURCE_IMPEDANCE_OHM
  } else {
    questions.push('¿Cuál es la impedancia de la fuente o del sensor (Ω)?')
  }

  if (looksLikeStrainGauge(text)) {
    spec.constraints.monolithicAllowed = true
  }

  spec.id = found > 0 ? 'spec-texto' : 'spec-por-defecto'
  return { spec, questions }
}

/** Decodifica una frecuencia dada como número o texto ("10 kHz"). */
function decodeFrequency(value) {
  if (isFiniteNumber_spec(value) && value >= 1) return value
  if (typeof value === 'string') {
    const match = value.match(NUMBER_RE)
    if (!match) return undefined
    const unit = value.match(/(k|K|M|G)?\s*hz/i)
    const multiplier = unit ? frequencyMultiplier(unit[1]) : 1
    const parsed = parseDecimal(match[1]) * multiplier
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined
  }
  return undefined
}

/** Decodifica un número con signo (acepta "350", 350, "-0.01" o "350 Ω"). */
function decodeNumber(value) {
  if (isFiniteNumber_spec(value)) return value
  if (typeof value === 'string') {
    const match = value.match(NUMBER_RE)
    if (!match) return undefined
    const sign = /[-−]\s*$/.test(value.slice(0, match.index ?? 0)) ? -1 : 1
    const parsed = sign * parseDecimal(match[1])
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Normaliza la alimentación a `{ positiveV, negativeV }`. */
function normalizeSupply(value) {
  if (isFiniteNumber_spec(value) && value > 0) {
    return { positiveV: value, negativeV: -value }
  }
  if (isPlainObject_spec(value)) {
    const positiveV = decodeNumber(value.positiveV ?? value.positive ?? value.plusV)
    const negativeV = decodeNumber(value.negativeV ?? value.negative ?? value.minusV)
    if (positiveV !== undefined && negativeV !== undefined && positiveV > 0 && negativeV < 0) {
      return { positiveV, negativeV }
    }
    if (positiveV !== undefined && positiveV > 0) {
      return { positiveV, negativeV: -positiveV }
    }
    return undefined
  }
  if (typeof value === 'string') {
    const symmetric = value.match(new RegExp(`(?:±|\\+\\/-|\\+-|\\+−)\\s*${NUMBER}`))
    if (symmetric) {
      const magnitude = parseDecimal(symmetric[1])
      if (Number.isFinite(magnitude) && magnitude > 0) {
        return { positiveV: magnitude, negativeV: -magnitude }
      }
    }
  }
  return undefined
}

/** Normaliza el rango de entrada a `{ minV, maxV }`. */
function normalizeInputRange(value) {
  if (isFiniteNumber_spec(value) && value > 0) {
    return { minV: -value, maxV: value }
  }
  if (Array.isArray(value) && value.length === 2) {
    const minV = decodeNumber(value[0])
    const maxV = decodeNumber(value[1])
    if (minV !== undefined && maxV !== undefined && minV < maxV) return { minV, maxV }
    return undefined
  }
  if (isPlainObject_spec(value)) {
    const minV = decodeNumber(value.minV ?? value.min)
    const maxV = decodeNumber(value.maxV ?? value.max)
    if (minV !== undefined && maxV !== undefined && minV < maxV) return { minV, maxV }
    return undefined
  }
  if (typeof value === 'string') {
    const symmetric = value.match(new RegExp(`(?:±|\\+\\/-|\\+-|\\+−)?\\s*${NUMBER}\\s*(m|µ|u)?\\s*v`, 'i'))
    if (symmetric) {
      const magnitude = parseDecimal(symmetric[1]) * voltageMultiplier(symmetric[2])
      if (Number.isFinite(magnitude) && magnitude > 0) {
        return { minV: -magnitude, maxV: magnitude }
      }
    }
  }
  return undefined
}

/** Normaliza las restricciones del spec, descartando claves desconocidas. */
function normalizeConstraints(value, fallback) {
  const constraints = { ...fallback }
  if (!isPlainObject_spec(value)) return constraints
  if (typeof value.resistorSeries === 'string' && RESISTOR_SERIES.has(value.resistorSeries)) {
    constraints.resistorSeries = value.resistorSeries
  }
  if (typeof value.monolithicAllowed === 'boolean') {
    constraints.monolithicAllowed = value.monolithicAllowed
  }
  if (typeof value.opAmpModel === 'string' && OPAMP_MODELS.has(value.opAmpModel)) {
    constraints.opAmpModel = value.opAmpModel
  }
  if (Number.isInteger(value.maxResistors) && value.maxResistors >= 1) {
    constraints.maxResistors = value.maxResistors
  }
  return constraints
}

/**
 * Interpreta un requisito y devuelve un `CircuitSpec` normalizado.
 *
 * - Si `input` es un objeto, se trata como spec estructurado (admite campos
 *   parciales y formatos laxos: `gain` numérico, `supply: 15`, etc.).
 * - Si `input` es un string, se parsea texto libre en español/inglés.
 *
 * Los campos faltantes se completan con `defaultSpec()` y se listan en
 * `questions` para que un agente (o una persona) los confirme.
 *
 * @param {object|string} input
 * @returns {{ spec: CircuitSpec, questions: string[], source: 'json'|'text' }}
 */
export function parseRequirement(input) {
  if (typeof input === 'string') {
    const parsed = fromText(input)
    return { ...parsed, source: 'text' }
  }
  if (isPlainObject_spec(input)) {
    const parsed = fromObject(input)
    return { ...parsed, source: 'json' }
  }
  throw new TypeError('parseRequirement esperaba un objeto spec o un string con el requisito')
}

/* ===== verify ===== */

/**
 * Verificación del diseño contra el requisito (`CircuitSpec`).
 *
 * Recibe las métricas que produce `evaluateProposal` (ganancia DC medida, CMRR,
 * ancho de banda y dispersión Monte Carlo) y emite un `VerificationReport` con
 * checks explícitos, márgenes numéricos y advertencias. No simula: solo compara
 * contra el contrato, de modo que sus tests son puramente deterministas.
 *
 * Checks mínimos:
 * - `GAIN_NOMINAL`: error sistemático de ganancia dentro de la tolerancia.
 * - `GAIN_TOLERANCE`: error sistemático + dispersión Monte Carlo p95 dentro de
 *   la tolerancia (peor caso esperado razonable).
 * - `MONTE_CARLO_GAIN`: dispersión p95 dentro de la tolerancia de ganancia.
 * - `BANDWIDTH`: ancho de banda simulado >= requerido.
 * - `CMRR`: CMRR simulado >= mínimo requerido.
 * - `SIMULATION_SANE`: todas las métricas son finitas y coherentes.
 */

/** @typedef {import('./types.js').Metrics} Metrics */
/** @typedef {import('./types.js').VerificationReport} VerificationReport */

/** CMRR por encima de este valor se considera "ideal" para el modelo lineal. */
const IDEAL_CMRR_WARNING_DB = 150

/** @param {unknown} value */
function isFiniteNumber_verify(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Formatea un número para el reporte (sin arrastrar ruido de coma flotante). */
function fmt_verify(value, digits = 3) {
  if (!isFiniteNumber_verify(value)) return String(value)
  return String(Number(value.toPrecision(digits)))
}

/**
 * Construye un check de verificación.
 * @param {string} id
 * @param {string} description
 * @param {unknown} required
 * @param {unknown} actual
 * @param {boolean} pass
 * @param {unknown} margin
 */
function check(id, description, required, actual, pass, margin) {
  return { id, description, required, actual, pass: pass === true, margin }
}

/**
 * Verifica un diseño contra su spec.
 *
 * @param {import('./types.js').CircuitSpec} spec
 * @param {Metrics} metrics
 * @returns {VerificationReport}
 */
export function verifyDesign(spec, metrics) {
  const gainSpec = spec?.gain ?? {}
  const nominal = isFiniteNumber_verify(gainSpec.nominal) ? gainSpec.nominal : Number.NaN
  const tolerancePct = isFiniteNumber_verify(gainSpec.tolerancePct) ? gainSpec.tolerancePct : 0
  const measured = metrics?.gain?.measured
  const errorPct = metrics?.gain?.errorPct
  const mcP95AbsPct = metrics?.gain?.mcP95AbsPct
  const bandwidthHz = metrics?.bandwidthHz
  const cmrrDb = metrics?.cmrrDb
  const requiredBandwidthHz = spec?.bandwidthHz
  const requiredCmrrDb = spec?.cmrrMinDb

  const warnings = []

  // --- GAIN_NOMINAL: error sistemático contra la ganancia pedida -------------
  const gainNominalPass =
    isFiniteNumber_verify(measured) &&
    isFiniteNumber_verify(nominal) &&
    isFiniteNumber_verify(errorPct) &&
    Math.abs(errorPct) <= tolerancePct + 1e-9
  const gainNominalMargin = isFiniteNumber_verify(errorPct)
    ? tolerancePct - Math.abs(errorPct)
    : Number.NaN
  const gainNominal = check(
    'GAIN_NOMINAL',
    'Ganancia DC simulada dentro de la tolerancia respecto de la nominal',
    `${fmt_verify(nominal)} × (±${fmt_verify(tolerancePct)} %)`,
    isFiniteNumber_verify(measured)
      ? `${fmt_verify(measured)} × (error ${fmt_verify(errorPct)} %)`
      : String(measured ?? 'sin medir'),
    gainNominalPass,
    `${fmt_verify(gainNominalMargin)} % de margen`,
  )

  // --- MONTE_CARLO_GAIN: dispersión estadística sola -------------------------
  const mcPass =
    isFiniteNumber_verify(mcP95AbsPct) && isFiniteNumber_verify(tolerancePct)
      ? mcP95AbsPct <= tolerancePct + 1e-9
      : false
  const mcMargin = isFiniteNumber_verify(mcP95AbsPct) ? tolerancePct - mcP95AbsPct : Number.NaN
  const monteCarlo = check(
    'MONTE_CARLO_GAIN',
    'Dispersión de ganancia p95 (Monte Carlo, resistencias ±1 %) dentro de la tolerancia',
    `≤ ${fmt_verify(tolerancePct)} %`,
    isFiniteNumber_verify(mcP95AbsPct) ? `${fmt_verify(mcP95AbsPct)} %` : String(mcP95AbsPct ?? 'sin medir'),
    mcPass,
    `${fmt_verify(mcMargin)} % de margen`,
  )

  // --- GAIN_TOLERANCE: error sistemático + dispersión (peor caso esperado) ---
  const combinedPct =
    isFiniteNumber_verify(errorPct) && isFiniteNumber_verify(mcP95AbsPct)
      ? Math.abs(errorPct) + mcP95AbsPct
      : Number.NaN
  const combinedPass = isFiniteNumber_verify(combinedPct) && combinedPct <= tolerancePct + 1e-9
  const combinedMargin = isFiniteNumber_verify(combinedPct) ? tolerancePct - combinedPct : Number.NaN
  const gainTolerance = check(
    'GAIN_TOLERANCE',
    'Error sistemático + dispersión p95 combinados dentro de la tolerancia de ganancia',
    `≤ ${fmt_verify(tolerancePct)} %`,
    isFiniteNumber_verify(combinedPct) ? `${fmt_verify(combinedPct)} %` : String(combinedPct ?? 'sin medir'),
    combinedPass,
    `${fmt_verify(combinedMargin)} % de margen`,
  )

  // --- BANDWIDTH -------------------------------------------------------------
  const bandwidthPass =
    isFiniteNumber_verify(bandwidthHz) &&
    isFiniteNumber_verify(requiredBandwidthHz) &&
    bandwidthHz >= requiredBandwidthHz
  const bandwidthMargin = isFiniteNumber_verify(bandwidthHz)
    ? bandwidthHz - requiredBandwidthHz
    : Number.NaN
  const bandwidth = check(
    'BANDWIDTH',
    'Ancho de banda simulado a −3 dB mayor o igual al requerido',
    `${fmt_verify(requiredBandwidthHz)} Hz`,
    isFiniteNumber_verify(bandwidthHz) ? `${fmt_verify(bandwidthHz)} Hz` : String(bandwidthHz ?? 'sin medir'),
    bandwidthPass,
    isFiniteNumber_verify(bandwidthMargin) ? `${fmt_verify(bandwidthMargin)} Hz de margen` : 'sin margen',
  )

  // --- CMRR ------------------------------------------------------------------
  const cmrrPass =
    isFiniteNumber_verify(cmrrDb) && isFiniteNumber_verify(requiredCmrrDb) && cmrrDb >= requiredCmrrDb
  const cmrrMargin = isFiniteNumber_verify(cmrrDb) ? cmrrDb - requiredCmrrDb : Number.NaN
  const cmrr = check(
    'CMRR',
    'CMRR simulado mayor o igual al mínimo requerido',
    `≥ ${fmt_verify(requiredCmrrDb)} dB`,
    isFiniteNumber_verify(cmrrDb) ? `${fmt_verify(cmrrDb)} dB` : String(cmrrDb ?? 'sin medir'),
    cmrrPass,
    isFiniteNumber_verify(cmrrMargin) ? `${fmt_verify(cmrrMargin)} dB de margen` : 'sin margen',
  )

  // --- SIMULATION_SANE -------------------------------------------------------
  const saneValues = [measured, errorPct, mcP95AbsPct, bandwidthHz, cmrrDb]
  const allFinite = saneValues.every((value) => isFiniteNumber_verify(value))
  const sanePass =
    allFinite && measured > 0 && bandwidthHz > 0 && mcP95AbsPct >= 0 && cmrrDb >= 0
  const sane = check(
    'SIMULATION_SANE',
    'Resultados de simulación finitos y coherentes (ganancia > 0, ancho de banda > 0)',
    'métricas finitas y positivas',
    allFinite
      ? `G=${fmt_verify(measured)}; BW=${fmt_verify(bandwidthHz)} Hz; CMRR=${fmt_verify(cmrrDb)} dB; MC p95=${fmt_verify(mcP95AbsPct)} %`
      : 'hay métricas no finitas',
    sanePass,
    sanePass ? 'consistente' : 'inconsistente',
  )

  const checks = [gainNominal, monteCarlo, gainTolerance, bandwidth, cmrr, sane]

  // --- Advertencias ----------------------------------------------------------
  if (!isFiniteNumber_verify(measured) || !isFiniteNumber_verify(errorPct)) {
    warnings.push('La simulación no devolvió una ganancia DC finita: revisar el netlist y el solver.')
  }
  if (!isFiniteNumber_verify(bandwidthHz) || bandwidthHz <= 0) {
    warnings.push('No se pudo medir un ancho de banda −3 dB válido en el rango del barrido.')
  } else if (isFiniteNumber_verify(requiredBandwidthHz) && bandwidthHz < requiredBandwidthHz) {
    warnings.push(
      'Ancho de banda simulado menor al requerido: aumentar el GBW del op-amp, reducir la ganancia por etapa o reevaluar el requisito.',
    )
  }
  if (isFiniteNumber_verify(cmrrDb) && cmrrDb > IDEAL_CMRR_WARNING_DB) {
    warnings.push(
      `CMRR simulado de ${fmt_verify(cmrrDb)} dB: es el límite del modelo ideal. En hardware real lo limita el apareamiento de resistencias; usar resistencias de precisión y/o un INA integrado.`,
    )
  }
  if (isFiniteNumber_verify(mcP95AbsPct) && isFiniteNumber_verify(tolerancePct) && mcP95AbsPct > tolerancePct) {
    warnings.push(
      'La dispersión Monte Carlo p95 supera la tolerancia de ganancia: usar resistencias de 0.1 % o trimar Rg.',
    )
  }
  if (isFiniteNumber_verify(gainSpec.tolerancePct) && gainSpec.tolerancePct <= 0) {
    warnings.push('La tolerancia de ganancia es 0 %: ningún diseño con resistencias comerciales puede cumplirla.')
  }
  if (!gainNominalPass) {
    warnings.push(
      'La ganancia DC simulada se aparta de la nominal más que la tolerancia pedida: revisar la selección E96 (o relajar la tolerancia).',
    )
  } else if (!combinedPass) {
    warnings.push(
      'El error sistemático más la dispersión p95 superan la tolerancia de ganancia: usar resistencias más precisas o trimar la etapa.',
    )
  }
  if (!sanePass) {
    warnings.push('Verificación fallida: revisar los checks marcados en ✗ antes de fabricar.')
  }

  return {
    schema: 'cir/Verification/v1',
    pass: checks.every((item) => item.pass === true),
    checks,
    warnings,
  }
}

/* ===== report ===== */

/**
 * Reportes del piloto de circuitos: Markdown, esquemático SVG y curva de Bode SVG.
 *
 * Reglas de la casa:
 * - ESM puro, sin dependencias externas ni acceso a red/reloj.
 * - SVG autocontenido: sin fuentes externas, sin recursos remotos, colores
 *   pensados para verse bien sobre fondo claro y oscuro (tarjeta blanca).
 * - Los identificadores van en inglés; comentarios y textos visibles en español.
 */

/** @typedef {{ re: number, im: number }} Complex */

const FONT =
  "font-family=\"ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif\""
const INK = '#0f172a'
const INK_SOFT = '#475569'
const LINE = '#1f2937'
const GRID = '#e2e8f0'
const ACCENT = '#1d4ed8'
const PASS = '#15803d'
const FAIL = '#b91c1c'
const PAPER = '#ffffff'
const PAPER_BORDER = '#cbd5e1'

/* ------------------------------------------------------------------ */
/* Formato numérico (independiente del locale)                         */
/* ------------------------------------------------------------------ */

function isFiniteNumber_report(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Redondea a `sig` cifras significativas sin notación científica salvo extremos. */
export function fmtNum(value, sig = 4) {
  if (!isFiniteNumber_report(value)) return '—'
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || abs < 1e-3) {
    return value.toExponential(2)
  }
  const rounded = Number(value.toPrecision(sig))
  return String(rounded)
}

/** Formatea una resistencia en ohmios: "10 kΩ", "202 Ω", "1.5 MΩ". */
export function fmtOhm(ohm) {
  if (!isFiniteNumber_report(ohm)) return '—'
  const abs = Math.abs(ohm)
  if (abs >= 1e6) return `${fmtNum(ohm / 1e6, 3)} MΩ`
  if (abs >= 1e3) return `${fmtNum(ohm / 1e3, 3)} kΩ`
  return `${fmtNum(ohm, 4)} Ω`
}

/** Formatea una frecuencia: "1.2 kHz", "10 MHz". */
export function fmtHz(hz) {
  if (!isFiniteNumber_report(hz)) return '—'
  const abs = Math.abs(hz)
  if (abs >= 1e6) return `${fmtNum(hz / 1e6, 3)} MHz`
  if (abs >= 1e3) return `${fmtNum(hz / 1e3, 3)} kHz`
  return `${fmtNum(hz, 3)} Hz`
}

function fmtDb(db) {
  return isFiniteNumber_report(db) ? `${fmtNum(db, 4)} dB` : '—'
}

function fmtPct(value) {
  return isFiniteNumber_report(value) ? `${fmtNum(value, 3)} %` : '—'
}

/** Escapa texto para incrustarlo en SVG/XML. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Escapa texto para celdas de tabla Markdown. */
function mdCell(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

const TOPOLOGY_LABEL = {
  three_op_amp: 'Amplificador de instrumentación de 3 op-amps',
  monolithic: 'Amplificador monolítico (INA128-like)',
}

function topologyLabel(topology) {
  return TOPOLOGY_LABEL[topology] ?? String(topology ?? 'desconocida')
}

/** Nodo de salida declarado en el netlist; por defecto 'out'. */
export function pickOutNode(proposal) {
  const nodes = proposal?.netlist?.nodes
  if (Array.isArray(nodes) && nodes.includes('out')) return 'out'
  const opamps = (proposal?.netlist?.elements ?? []).filter((el) => el?.type === 'OPAMP')
  for (const opamp of opamps) {
    if (typeof opamp.out === 'string' && opamp.out !== '0') return opamp.out
  }
  return 'out'
}

function mergeWarnings(...lists) {
  const seen = new Set()
  const result = []
  for (const list of lists) {
    for (const item of list ?? []) {
      const text = String(item)
      if (!seen.has(text)) {
        seen.add(text)
        result.push(text)
      }
    }
  }
  return result
}

function checkMark(pass) {
  return pass === true ? '✓' : pass === false ? '✗' : '·'
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */

function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`).join('\n')
  return [head, sep, body].filter((part) => part !== '').join('\n')
}

/**
 * Reporte Markdown completo de un resultado del pipeline.
 * @param {{
 *   spec?: any, proposal?: any, dc?: any, ac?: any,
 *   metrics?: any, verification?: any,
 *   report?: { markdown?: string, schematicSvg?: string, bodeSvg?: string }
 * }} result
 * @returns {string}
 */
export function renderMarkdown(result = {}) {
  const { spec = {}, proposal = {}, metrics = {}, verification = {}, dc = {}, ac = {} } = result
  const specId = spec.id ?? proposal.specId ?? 'sin-id'
  const topology = proposal.topology ?? 'desconocida'
  const outNode = pickOutNode(proposal)

  const gainSpec = spec.gain ?? {}
  const nominal = gainSpec.nominal
  const measured = metrics.gain?.measured
  const errorPct = metrics.gain?.errorPct
  const mcP95 = metrics.gain?.mcP95AbsPct

  const passed = verification.pass === true
  const checks = Array.isArray(verification.checks) ? verification.checks : []
  const passedChecks = checks.filter((check) => check?.pass === true).length

  const warnings = mergeWarnings(
    verification.warnings,
    dc?.warnings,
    ac?.warnings,
  )

  const lines = []

  lines.push(`# Reporte de diseño — ${specId}`)
  lines.push('')
  lines.push(
    `**Resultado global:** ${passed ? '✓ PASS' : '✗ FAIL'} (${passedChecks}/${checks.length} checks aprobados)`,
  )
  lines.push('')
  lines.push(
    '> Reporte generado automáticamente por `circuit-pilot` a partir de un solver MNA determinista. ' +
      'Es una ayuda de diseño, **no** un reemplazo de la revisión humana: antes de fabricar, revisá tolerancias, ' +
      'derating, layout, protecciones de entrada y disipación.',
  )
  lines.push('')

  // 1. Requisito
  lines.push('## 1. Requisito')
  lines.push('')
  lines.push(
    table(
      ['Campo', 'Valor'],
      [
        ['ID del spec', specId],
        ['Objetivo', spec.target ?? 'instrumentation_amplifier'],
        ['Ganancia nominal', `${fmtNum(nominal)} ×`],
        ['Tolerancia de ganancia', fmtPct(gainSpec.tolerancePct)],
        ['Ancho de banda requerido (−3 dB)', fmtHz(spec.bandwidthHz)],
        ['CMRR mínimo', fmtDb(spec.cmrrMinDb)],
        [
          'Alimentación',
          isFiniteNumber_report(spec.supply?.positiveV) && isFiniteNumber_report(spec.supply?.negativeV)
            ? `${fmtNum(spec.supply.positiveV)} V / ${fmtNum(spec.supply.negativeV)} V`
            : '—',
        ],
        [
          'Rango de entrada',
          isFiniteNumber_report(spec.inputRangeV?.minV) && isFiniteNumber_report(spec.inputRangeV?.maxV)
            ? `${fmtNum(spec.inputRangeV.minV)} V a ${fmtNum(spec.inputRangeV.maxV)} V`
            : '—',
        ],
        ['Impedancia de fuente', fmtOhm(spec.sourceImpedanceOhm)],
        [
          'Restricciones',
          spec.constraints
            ? `serie ${spec.constraints.resistorSeries ?? '—'}; monolítico ${
                spec.constraints.monolithicAllowed === false ? 'no permitido' : 'permitido'
              }; modelo ${spec.constraints.opAmpModel ?? '—'}`
            : '—',
        ],
      ],
    ),
  )
  lines.push('')

  // 2. Topología
  lines.push('## 2. Topología elegida')
  lines.push('')
  lines.push(`- **Topología:** ${topologyLabel(topology)} (\`${topology}\`)`)
  if (Array.isArray(proposal.opAmps) && proposal.opAmps.length > 0) {
    const models = proposal.opAmps
      .map((opAmp) => `${opAmp.name} (A₀ = ${fmtNum(opAmp.gain)}, polo = ${fmtHz(opAmp.poleHz)})`)
      .join('; ')
    lines.push(`- **Modelos de op-amp:** ${models}`)
  }
  if (proposal.expected && Object.keys(proposal.expected).length > 0) {
    const expected = Object.entries(proposal.expected)
      .map(([key, value]) => `${key} = ${isFiniteNumber_report(value) ? fmtNum(value) : String(value)}`)
      .join('; ')
    lines.push(`- **Valores esperados:** ${expected}`)
  }
  if (topology === 'three_op_amp') {
    lines.push('- **Ecuación de ganancia:** G ≈ (1 + 2·R1/Rg) · (R3/R2)')
  } else if (topology === 'monolithic') {
    lines.push('- **Ecuación de ganancia:** G ≈ 1 + 50 kΩ/Rg (modelo INA128-like)')
  }
  lines.push('')

  // 3. Resistencias
  lines.push('## 3. Resistencias seleccionadas')
  lines.push('')
  const resistors = Array.isArray(proposal.resistors) ? proposal.resistors : []
  if (resistors.length === 0) {
    lines.push('_El proposal no incluye resistencias._')
  } else {
    lines.push(
      table(
        ['Nombre', 'Valor', 'Serie'],
        resistors.map((resistor) => [resistor.name, fmtOhm(resistor.valueOhm), resistor.series ?? '—']),
      ),
    )
    lines.push('')
    lines.push(
      '_Los valores provienen de la serie E96; el error de ganancia ya incluye el redondeo al valor comercial._',
    )
  }
  lines.push('')

  // 4. Métricas
  lines.push('## 4. Métricas simuladas')
  lines.push('')
  lines.push(
    table(
      ['Métrica', 'Requerido', 'Simulado', 'Error / margen'],
      [
        [
          'Ganancia DC',
          `${fmtNum(nominal)} ×`,
          `${fmtNum(measured)} ×`,
          isFiniteNumber_report(errorPct)
            ? `error ${fmtPct(errorPct)} (tolerancia ±${fmtNum(gainSpec.tolerancePct)} %)`
            : '—',
        ],
        [
          'Dispersión Monte Carlo (p95)',
          `tolerancia ±${fmtNum(gainSpec.tolerancePct)} %`,
          fmtPct(mcP95),
          isFiniteNumber_report(mcP95) && isFiniteNumber_report(gainSpec.tolerancePct)
            ? mcP95 <= gainSpec.tolerancePct
              ? '✓ dentro de tolerancia'
              : '✗ fuera de tolerancia'
            : '—',
        ],
        [
          'CMRR (modelo ideal)',
          fmtDb(metrics.cmrrMinDb ?? spec.cmrrMinDb),
          fmtDb(metrics.cmrrDb),
          isFiniteNumber_report(metrics.cmrrDb) && isFiniteNumber_report(metrics.cmrrMinDb ?? spec.cmrrMinDb)
            ? `${fmtNum(metrics.cmrrDb - (metrics.cmrrMinDb ?? spec.cmrrMinDb))} dB de margen`
            : '—',
        ],
        [
          'Ancho de banda (−3 dB)',
          fmtHz(spec.bandwidthHz),
          fmtHz(metrics.bandwidthHz),
          isFiniteNumber_report(metrics.bandwidthHz) && isFiniteNumber_report(spec.bandwidthHz)
            ? metrics.bandwidthHz >= spec.bandwidthHz
              ? `✓ ${fmtNum(metrics.bandwidthHz / spec.bandwidthHz)}× del requerido`
              : `✗ falta ${fmtHz(spec.bandwidthHz - metrics.bandwidthHz)}`
            : '—',
        ],
      ],
    ),
  )
  lines.push('')
  lines.push(
    '_Método: MNA en DC y barrido AC logarítmico; CMRR de modo común sobre el modelo ideal (cota superior, no incluye apareamiento real de resistencias); Monte Carlo con tolerancia de resistencias del 1 % y semilla fija (reproducible)._',
  )
  lines.push('')

  // 5. Verificación
  lines.push('## 5. Verificación por simulación')
  lines.push('')
  if (checks.length === 0) {
    lines.push('_Sin checks de verificación en el resultado._')
  } else {
    lines.push(
      table(
        ['', 'Check', 'Requerido', 'Medido', 'Margen'],
        checks.map((check) => [
          checkMark(check?.pass),
          `${check?.id ?? '—'} — ${check?.description ?? ''}`,
          check?.required,
          check?.actual,
          check?.margin,
        ]),
      ),
    )
  }
  lines.push('')

  // 6. Supuestos
  lines.push('## 6. Supuestos')
  lines.push('')
  const assumptions = Array.isArray(proposal.assumptions) ? proposal.assumptions : []
  if (assumptions.length === 0) {
    lines.push('_Sin supuestos declarados._')
  } else {
    for (const assumption of assumptions) lines.push(`- ${assumption}`)
  }
  lines.push('')

  // 7. Preguntas abiertas
  const questions = Array.isArray(proposal.clarifyingQuestions) ? proposal.clarifyingQuestions : []
  if (questions.length > 0) {
    lines.push('## 7. Preguntas abiertas')
    lines.push('')
    for (const question of questions) lines.push(`- ${question}`)
    lines.push('')
  }

  // 8. Advertencias (7 si no hubo preguntas abiertas)
  lines.push(`## ${questions.length > 0 ? 8 : 7}. Advertencias`)
  lines.push('')
  if (warnings.length === 0) {
    lines.push('_Sin advertencias del solver ni del verificador._')
  } else {
    for (const warning of warnings) lines.push(`- ⚠ ${warning}`)
  }
  lines.push('')

  // 9. Artefactos (8 si no hubo preguntas abiertas)
  lines.push(`## ${questions.length > 0 ? 9 : 8}. Artefactos`)
  lines.push('')
  lines.push('- `proposal.json` — topología, valores y netlist propuesto.')
  lines.push('- `verification.json` — checks detallados.')
  lines.push('- `schematic.svg` — esquemático funcional.')
  lines.push('- `bode.svg` — respuesta en frecuencia.')
  lines.push('- `netlist.json` — netlist reproducible para el solver.')
  lines.push('')
  lines.push(`![Esquemático funcional](schematic.svg)`)
  lines.push('')
  lines.push(`![Respuesta en frecuencia (Bode)](bode.svg)`)
  lines.push('')
  lines.push(`_Nodo de salida: \`${outNode}\`._`)
  lines.push('')

  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Primitivas SVG                                                      */
/* ------------------------------------------------------------------ */

function svgDocument({ width, height, title, description, body }) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<desc>${escapeXml(description)}</desc>`,
    body,
    '</svg>',
    '',
  ].join('\n')
}

function svgText(x, y, value, options = {}) {
  const {
    size = 14,
    fill = INK,
    anchor = 'start',
    weight = 'normal',
    transform,
  } = options
  const attrs = [
    `x="${round2(x)}"`,
    `y="${round2(y)}"`,
    `font-size="${size}"`,
    `fill="${fill}"`,
    `text-anchor="${anchor}"`,
    `font-weight="${weight}"`,
    FONT,
  ]
  if (transform) attrs.push(`transform="${transform}"`)
  return `<text ${attrs.join(' ')}>${escapeXml(value)}</text>`
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function svgLine(x1, y1, x2, y2, options = {}) {
  const { stroke = LINE, width = 1.6, dash = null } = options
  const attrs = [
    `x1="${round2(x1)}"`, `y1="${round2(y1)}"`,
    `x2="${round2(x2)}"`, `y2="${round2(y2)}"`,
    `stroke="${stroke}"`, `stroke-width="${width}"`, 'stroke-linecap="round"',
  ]
  if (dash) attrs.push(`stroke-dasharray="${dash}"`)
  return `<line ${attrs.join(' ')}/>`
}

function svgPolyline(points, options = {}) {
  const { stroke = LINE, width = 1.6, fill = 'none', dash = null } = options
  const attrs = [
    `points="${points.map(([x, y]) => `${round2(x)},${round2(y)}`).join(' ')}"`,
    `fill="${fill}"`, `stroke="${stroke}"`, `stroke-width="${width}"`,
    'stroke-linejoin="round"', 'stroke-linecap="round"',
  ]
  if (dash) attrs.push(`stroke-dasharray="${dash}"`)
  return `<polyline ${attrs.join(' ')}/>`
}

function svgRect(x, y, w, h, options = {}) {
  const { fill = PAPER, stroke = LINE, width = 1.6, rx = 0 } = options
  return `<rect x="${round2(x)}" y="${round2(y)}" width="${round2(w)}" height="${round2(h)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" rx="${rx}"/>`
}

function svgCircle(x, y, r, options = {}) {
  const { fill = PAPER, stroke = LINE, width = 1.6 } = options
  return `<circle cx="${round2(x)}" cy="${round2(y)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`
}

/** Triángulo de op-amp apuntando a la derecha. `x` es el borde izquierdo, `y` el centro. */
function opAmpTriangle(x, y, label, options = {}) {
  const { halfHeight = 46, width = 84, invertTop = false, note } = options
  const apexX = x + width
  const topPin = y - 18
  const bottomPin = y + 18
  const topSymbol = invertTop ? '−' : '+'
  const bottomSymbol = invertTop ? '+' : '−'
  const parts = [
    `<path d="M ${round2(x)} ${round2(y - halfHeight)} L ${round2(apexX)} ${round2(y)} L ${round2(x)} ${round2(y + halfHeight)} Z" fill="#eff6ff" stroke="${LINE}" stroke-width="1.8" stroke-linejoin="round"/>`,
    svgText(x + 14, topPin + 6, topSymbol, { size: 18, weight: 'bold', fill: INK }),
    svgText(x + 14, bottomPin + 6, bottomSymbol, { size: 18, weight: 'bold', fill: INK }),
    svgText(apexX + 8, y - 6, label, { size: 13, weight: 'bold', fill: INK_SOFT }),
  ]
  if (note) parts.push(svgText(apexX + 8, y + 14, note, { size: 11, fill: INK_SOFT }))
  return parts.join('\n')
}

function resistorBox(x, y, orientation, label, value) {
  if (orientation === 'v') {
    const w = 26
    const h = 48
    return [
      svgRect(x - w / 2, y - h / 2, w, h, { fill: PAPER }),
      svgText(x + w / 2 + 8, y - 2, label, { size: 13, weight: 'bold' }),
      svgText(x + w / 2 + 8, y + 14, value, { size: 12, fill: INK_SOFT }),
    ].join('\n')
  }
  const w = 64
  const h = 26
  return [
    svgRect(x - w / 2, y - h / 2, w, h, { fill: PAPER }),
    svgText(x, y - h / 2 - 8, label, { size: 13, weight: 'bold', anchor: 'middle' }),
    svgText(x, y + h / 2 + 16, value, { size: 12, fill: INK_SOFT, anchor: 'middle' }),
  ].join('\n')
}

function nodeDot(x, y, label, options = {}) {
  const { dx = 8, dy = -8, anchor = 'start' } = options
  return [
    svgCircle(x, y, 3.6, { fill: PAPER }),
    label ? svgText(x + dx, y + dy, label, { size: 12, fill: INK_SOFT, anchor }) : '',
  ]
    .join('\n')
}

function groundSymbol(x, y) {
  return [
    svgLine(x, y, x, y + 14, { width: 1.4 }),
    svgLine(x - 13, y + 14, x + 13, y + 14, { width: 1.6 }),
    svgLine(x - 8, y + 19, x + 8, y + 19, { width: 1.4 }),
    svgLine(x - 4, y + 24, x + 4, y + 24, { width: 1.2 }),
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* Esquemático                                                         */
/* ------------------------------------------------------------------ */

function resistorIndex(proposal) {
  const map = new Map()
  for (const resistor of proposal?.resistors ?? []) {
    if (resistor && typeof resistor.name === 'string') {
      map.set(resistor.name.toLowerCase(), resistor)
    }
  }
  return map
}

function resistorValueOf(proposal, name) {
  const resistor = resistorIndex(proposal).get(String(name).toLowerCase())
  return resistor ? fmtOhm(resistor.valueOhm) : ''
}

function findResistor(proposal, name, fallbackPosition) {
  const index = resistorIndex(proposal)
  const match = index.get(name.toLowerCase())
  if (match) return match
  const list = proposal?.resistors ?? []
  return list[fallbackPosition]
}

/**
 * Esquemático SVG funcional y legible (no es un dibujo apto para fabricación).
 * @param {any} proposal
 * @param {{ width?: number, height?: number }} [opts]
 * @returns {string}
 */
export function renderSchematicSvg(proposal = {}, opts = {}) {
  const topology = proposal?.topology ?? 'three_op_amp'
  if (topology === 'monolithic') {
    return renderMonolithicSchematic(proposal, opts)
  }
  return renderThreeOpAmpSchematic(proposal, opts)
}

function renderThreeOpAmpSchematic(proposal, opts) {
  const width = opts.width ?? 920
  const height = opts.height ?? 560

  const r1 = findResistor(proposal, 'R1', 0)
  const rg = findResistor(proposal, 'Rg', 1)
  const r2 = findResistor(proposal, 'R2', 2)
  const r3 = findResistor(proposal, 'R3', 3)
  const valueOf = (resistor, fallback) => (resistor ? fmtOhm(resistor.valueOhm) : fallback)

  const R1 = valueOf(r1, '—')
  const RG = valueOf(rg, '—')
  const R2 = valueOf(r2, '—')
  const R3 = valueOf(r3, '—')
  const gainText =
    r1 && rg ? `G ≈ (1 + 2·R1/Rg) · (R3/R2) = (1 + 2·${R1}/${RG}) · (${R3}/${R2})` : 'G ≈ (1 + 2·R1/Rg) · (R3/R2)'

  const body = []
  body.push(svgRect(0.5, 0.5, width - 1, height - 1, { fill: PAPER, stroke: PAPER_BORDER, rx: 10 }))
  body.push(svgText(28, 40, 'Esquemático funcional — amplificador de instrumentación (3 op-amps)', { size: 20, weight: 'bold' }))
  body.push(svgText(28, 66, gainText, { size: 13, fill: INK_SOFT }))
  body.push(svgText(28, 84, 'R1 se usa en ambos buffers; Rg fija la ganancia de entrada; A3 resta las salidas.', { size: 12, fill: INK_SOFT }))

  // Entradas
  body.push(nodeDot(52, 150, 'in+', { dx: -2, dy: -12, anchor: 'start' }))
  body.push(nodeDot(52, 390, 'in−', { dx: -2, dy: 22, anchor: 'start' }))
  body.push(svgLine(52, 150, 170, 132))
  body.push(svgLine(52, 390, 170, 372))

  // A1 / A2 (buffers)
  body.push(opAmpTriangle(170, 150, 'A1', { note: 'buffer' }))
  body.push(opAmpTriangle(170, 390, 'A2', { note: 'buffer' }))

  // Eje vertical de realimentación: R1 (×2), Rg y nodos a_fb / b_fb
  body.push(svgLine(300, 150, 300, 390, { stroke: LINE, width: 1.6 }))
  body.push(resistorBox(300, 190, 'v', 'R1', R1))
  body.push(resistorBox(300, 270, 'v', 'Rg', RG))
  body.push(resistorBox(300, 350, 'v', 'R1', R1))

  // Salidas de A1/A2 hacia la cadena
  body.push(svgLine(254, 150, 300, 150))
  body.push(svgLine(254, 390, 300, 390))

  // Nodos de realimentación
  body.push(nodeDot(300, 230, 'a_fb', { dx: -14, dy: -6, anchor: 'end' }))
  body.push(nodeDot(300, 310, 'b_fb', { dx: -14, dy: -6, anchor: 'end' }))

  // Realimentación a las entradas inversoras de los buffers
  body.push(svgPolyline([[300, 230], [150, 230], [150, 168], [170, 168]]))
  body.push(svgPolyline([[300, 310], [150, 310], [150, 408], [170, 408]]))

  // A3: etapa de diferencia (resta)
  body.push(svgLine(300, 230, 450, 230))
  body.push(svgLine(450, 230, 450, 236))
  body.push(svgLine(450, 236, 528, 236))
  body.push(resistorBox(560, 236, 'h', 'R2', R2))
  body.push(svgPolyline([[592, 236], [632, 236], [632, 252], [650, 252]]))

  body.push(svgLine(300, 310, 450, 310))
  body.push(svgLine(450, 310, 450, 304))
  body.push(svgLine(450, 304, 528, 304))
  body.push(resistorBox(560, 304, 'h', 'R3', R3))
  body.push(svgPolyline([[592, 304], [632, 304], [632, 288], [650, 288]]))

  body.push(opAmpTriangle(650, 270, 'A3', { invertTop: true, note: 'diferencia' }))

  // Salida
  body.push(svgLine(734, 270, 830, 270))
  body.push(nodeDot(830, 270, 'out', { dx: -26, dy: -10 }))
  body.push(groundSymbol(830, 286))

  // Notas
  body.push(svgText(28, 476, 'Notas:', { size: 13, weight: 'bold' }))
  body.push(
    svgText(
      28,
      496,
      'Diagrama funcional (no apto para fabricación). Los valores son nominales de la serie E96; ' +
        'el error de ganancia incluye el redondeo comercial.',
      { size: 12, fill: INK_SOFT },
    ),
  )
  body.push(
    svgText(28, 514, 'Revisar derating, layout, protecciones de entrada y disipación antes de fabricar.', {
      size: 12,
      fill: INK_SOFT,
    }),
  )
  body.push(svgText(28, 534, `Topología: ${proposal?.topology ?? 'three_op_amp'} — revisión humana requerida.`, { size: 12, fill: INK_SOFT }))

  return svgDocument({
    width,
    height,
    title: 'Esquemático del amplificador de instrumentación (3 op-amps)',
    description:
      'Diagrama funcional con dos buffers de entrada, resistencias R1 y Rg de ganancia y etapa de diferencia A3.',
    body: body.filter(Boolean).join('\n'),
  })
}

function renderMonolithicSchematic(proposal, opts) {
  const width = opts.width ?? 920
  const height = opts.height ?? 500
  const rg = findResistor(proposal, 'Rg', 0)
  const RG = rg ? fmtOhm(rg.valueOhm) : '—'
  const opAmp = Array.isArray(proposal?.opAmps) ? proposal.opAmps[0] : undefined

  const body = []
  body.push(svgRect(0.5, 0.5, width - 1, height - 1, { fill: PAPER, stroke: PAPER_BORDER, rx: 10 }))
  body.push(svgText(28, 40, 'Esquemático funcional — amplificador monolítico (INA128-like)', { size: 20, weight: 'bold' }))
  body.push(svgText(28, 66, `G ≈ 1 + 50 kΩ / Rg = 1 + 50 kΩ / ${RG}`, { size: 13, fill: INK_SOFT }))
  body.push(svgText(28, 84, 'El INA128 integra los tres op-amps; Rg es la única resistencia externa de ganancia.', { size: 12, fill: INK_SOFT }))

  // Entradas
  body.push(nodeDot(52, 207, 'in+', { dx: -2, dy: -12 }))
  body.push(nodeDot(52, 243, 'in−', { dx: -2, dy: 24 }))
  body.push(svgLine(52, 207, 300, 207))
  body.push(svgLine(52, 243, 300, 243))

  // Amplificador monolítico (triángulo)
  body.push(`<path d="M 300 148 L 458 225 L 300 302 Z" fill="#eff6ff" stroke="${LINE}" stroke-width="1.8" stroke-linejoin="round"/>`)
  body.push(svgText(314, 201, '+', { size: 18, weight: 'bold' }))
  body.push(svgText(314, 251, '−', { size: 18, weight: 'bold' }))
  body.push(svgText(380, 220, 'INA128-like', { size: 13, weight: 'bold', anchor: 'middle' }))
  body.push(svgText(380, 240, 'A1', { size: 12, fill: INK_SOFT, anchor: 'middle' }))

  // Salida
  body.push(svgLine(458, 225, 830, 225))
  body.push(nodeDot(830, 225, 'out', { dx: -26, dy: -10 }))
  body.push(groundSymbol(830, 241))

  // Rg externa (pines de ganancia del paquete), fuera del triángulo
  body.push(svgLine(380, 330, 380, 264, { stroke: '#94a3b8', width: 1.4, dash: '5 4' }))
  body.push(svgRect(367, 330, 26, 44, { fill: PAPER }))
  body.push(svgText(404, 342, 'Rg', { size: 13, weight: 'bold' }))
  body.push(svgText(404, 360, RG, { size: 12, fill: INK_SOFT }))
  body.push(svgText(404, 378, 'pines de ganancia (1–8)', { size: 11, fill: INK_SOFT }))

  // Anotaciones del modelo de op-amp
  if (opAmp) {
    body.push(
      svgText(28, 416, `Modelo: ${opAmp.name} · A₀ = ${fmtNum(opAmp.gain)} · polo = ${fmtHz(opAmp.poleHz)}`, {
        size: 12,
        fill: INK_SOFT,
      }),
    )
  }
  body.push(svgText(28, 442, 'Notas:', { size: 13, weight: 'bold' }))
  body.push(
    svgText(
      28,
      462,
      'Diagrama funcional (no apto para fabricación). Rg se conecta entre los pines de ganancia del paquete; ' +
        'el lazo interno queda dentro del integrado.',
      { size: 12, fill: INK_SOFT },
    ),
  )
  body.push(svgText(28, 482, `Topología: ${proposal?.topology ?? 'monolithic'} — revisión humana requerida.`, { size: 12, fill: INK_SOFT }))

  return svgDocument({
    width,
    height,
    title: 'Esquemático del amplificador monolítico (INA128-like)',
    description: 'Diagrama funcional de un amplificador de instrumentación monolítico con resistencia de ganancia Rg.',
    body: body.filter(Boolean).join('\n'),
  })
}

/* ------------------------------------------------------------------ */
/* Bode                                                                */
/* ------------------------------------------------------------------ */

function complexMagnitude(value) {
  if (!value || !isFiniteNumber_report(value.re) || !isFiniteNumber_report(value.im)) return null
  return Math.hypot(value.re, value.im)
}

/**
 * Puntos (f, dB) de la ganancia de tensión |Vout|/|Vd|.
 * Si el AC no expone `in+`/`in-`, se asume excitación diferencial unitaria.
 */
function bodePoints(ac, outNode) {
  const points = []
  for (const point of ac?.points ?? []) {
    if (!point || !isFiniteNumber_report(point.fHz) || point.fHz <= 0) continue
    const vout = complexMagnitude(point.nodeVoltages?.[outNode])
    if (vout === null || vout === 0) continue
    let denominator = 1
    const vp = point.nodeVoltages?.['in+']
    const vn = point.nodeVoltages?.['in-']
    if (vp && vn) {
      const differential = Math.hypot(vp.re - vn.re, vp.im - vn.im)
      if (differential > 1e-12) denominator = differential
    }
    const db = 20 * Math.log10(vout / denominator)
    if (Number.isFinite(db)) points.push({ fHz: point.fHz, db })
  }
  points.sort((a, b) => a.fHz - b.fHz)
  return points
}

/** Primera frecuencia donde la ganancia cae 3 dB respecto de la ganancia DC (interpolada en log-f). */
function findMinus3Db(points, dcGain) {
  const target = dcGain - 3
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]
    const current = points[i]
    if (previous.db > target && current.db <= target) {
      const t = (previous.db - target) / (previous.db - current.db)
      if (!Number.isFinite(t)) return null
      const logF = Math.log10(previous.fHz) + t * (Math.log10(current.fHz) - Math.log10(previous.fHz))
      return { fHz: 10 ** logF, db: target }
    }
  }
  return null
}

function niceTickStep(range, targetTicks = 6) {
  const raw = range / Math.max(2, targetTicks)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const candidates = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude)
  return candidates.find((candidate) => candidate >= raw) ?? candidates[candidates.length - 1]
}

/**
 * Curva de Bode de la ganancia en dB con marca de −3 dB.
 * @param {any} ac AcResult
 * @param {{ outNode: string, width?: number, height?: number }} opts
 * @returns {string}
 */
export function renderBodeSvg(ac = {}, opts = {}) {
  const width = opts.width ?? 760
  const height = opts.height ?? 440
  const outNode = opts.outNode ?? 'out'
  const points = bodePoints(ac, outNode)

  if (points.length === 0) {
    return svgDocument({
      width,
      height,
      title: `Respuesta en frecuencia — ${outNode}`,
      description: 'Sin datos AC para el nodo de salida.',
      body: [
        svgRect(0.5, 0.5, width - 1, height - 1, { fill: PAPER, stroke: PAPER_BORDER, rx: 10 }),
        svgText(width / 2, height / 2 - 8, 'Sin datos AC', { size: 22, weight: 'bold', anchor: 'middle' }),
        svgText(width / 2, height / 2 + 20, `No hay puntos para el nodo "${outNode}".`, {
          size: 13,
          fill: INK_SOFT,
          anchor: 'middle',
        }),
      ].join('\n'),
    })
  }

  const dcGain = points[0].db
  const crossing = findMinus3Db(points, dcGain)
  const targetDb = dcGain - 3

  // Dominio X logarítmico
  const logMin = Math.log10(points[0].fHz)
  const logMax = Math.log10(points[points.length - 1].fHz)
  const logSpan = Math.max(logMax - logMin, 0.01)

  // Dominio Y en dB
  const allDb = points.map((point) => point.db)
  let yMin = Math.min(...allDb, targetDb) - 6
  let yMax = Math.max(...allDb, targetDb) + 6
  if (yMax - yMin < 12) {
    const mid = (yMax + yMin) / 2
    yMin = mid - 6
    yMax = mid + 6
  }

  const margin = { left: 78, right: 28, top: 84, bottom: 66 }
  const plotW = width - margin.left - margin.right
  const plotH = height - margin.top - margin.bottom
  const xOfLog = (logF) => margin.left + ((logF - logMin) / logSpan) * plotW
  const yOfDb = (db) => margin.top + ((yMax - db) / (yMax - yMin)) * plotH

  const body = []
  body.push(svgRect(0.5, 0.5, width - 1, height - 1, { fill: PAPER, stroke: PAPER_BORDER, rx: 10 }))
  body.push(svgText(24, 34, `Respuesta en frecuencia — ${outNode}`, { size: 19, weight: 'bold' }))
  const subtitle = crossing
    ? `Ganancia DC = ${fmtDb(dcGain)} · f₋₃dB = ${fmtHz(crossing.fHz)} · ${points.length} puntos`
    : `Ganancia DC = ${fmtDb(dcGain)} · sin cruce de −3 dB en el barrido · ${points.length} puntos`
  body.push(svgText(24, 58, subtitle, { size: 12.5, fill: INK_SOFT }))

  // Grilla horizontal
  const yStep = niceTickStep(yMax - yMin, 6)
  const firstY = Math.ceil(yMin / yStep) * yStep
  for (let db = firstY; db <= yMax + 1e-9; db += yStep) {
    const y = yOfDb(db)
    body.push(svgLine(margin.left, y, margin.left + plotW, y, { stroke: GRID, width: 1 }))
    body.push(svgText(margin.left - 10, y + 4, `${fmtNum(db, 3)} dB`, { size: 11, fill: INK_SOFT, anchor: 'end' }))
  }

  // Grilla vertical por décadas
  for (let decade = Math.ceil(logMin); decade <= Math.floor(logMax); decade += 1) {
    const x = xOfLog(decade)
    body.push(svgLine(x, margin.top, x, margin.top + plotH, { stroke: GRID, width: 1 }))
    body.push(svgText(x, margin.top + plotH + 20, fmtHz(10 ** decade), { size: 11, fill: INK_SOFT, anchor: 'middle' }))
  }
  // Etiquetas de borde del barrido, solo si no coinciden con una década ya rotulada
  if (Math.abs(logMax - Math.round(logMax)) > 1e-9) {
    body.push(
      svgText(margin.left + plotW, margin.top + plotH + 20, fmtHz(points[points.length - 1].fHz), {
        size: 11,
        fill: INK_SOFT,
        anchor: 'end',
      }),
    )
  }
  if (Math.abs(logMin - Math.round(logMin)) > 1e-9) {
    body.push(
      svgText(margin.left, margin.top + plotH + 20, fmtHz(points[0].fHz), {
        size: 11,
        fill: INK_SOFT,
        anchor: 'start',
      }),
    )
  }

  // Ejes
  body.push(svgLine(margin.left, margin.top, margin.left, margin.top + plotH, { width: 1.6 }))
  body.push(svgLine(margin.left, margin.top + plotH, margin.left + plotW, margin.top + plotH, { width: 1.6 }))
  body.push(svgText(margin.left + plotW / 2, height - 18, 'f (Hz)', { size: 13, weight: 'bold', anchor: 'middle' }))
  body.push(
    svgText(18, margin.top + plotH / 2, 'Ganancia (dB)', {
      size: 13,
      weight: 'bold',
      anchor: 'middle',
      transform: `rotate(-90 18 ${round2(margin.top + plotH / 2)})`,
    }),
  )

  // Marca de −3 dB
  const yTarget = yOfDb(targetDb)
  body.push(svgLine(margin.left, yTarget, margin.left + plotW, yTarget, { stroke: FAIL, width: 1.4, dash: '6 5' }))
  body.push(svgText(margin.left + plotW - 4, yTarget - 6, '−3 dB', { size: 12, fill: FAIL, anchor: 'end', weight: 'bold' }))

  // Curva de ganancia
  const polyline = points.map((point) => [xOfLog(Math.log10(point.fHz)), yOfDb(point.db)])
  body.push(svgPolyline(polyline, { stroke: ACCENT, width: 2.2 }))

  // Marca vertical de f₋₃dB
  if (crossing) {
    const xCross = xOfLog(Math.log10(crossing.fHz))
    body.push(svgLine(xCross, yTarget, xCross, margin.top + plotH, { stroke: FAIL, width: 1.2, dash: '4 4' }))
    body.push(svgCircle(xCross, yTarget, 4, { fill: FAIL, stroke: FAIL }))
    body.push(
      svgText(xCross - 8, yTarget + 18, `f₋₃dB = ${fmtHz(crossing.fHz)}`, {
        size: 12,
        fill: FAIL,
        weight: 'bold',
        anchor: 'end',
      }),
    )
  }

  return svgDocument({
    width,
    height,
    title: `Respuesta en frecuencia del nodo ${outNode}`,
    description: 'Diagrama de Bode con ganancia en dB, eje logarítmico de frecuencia y marca de −3 dB.',
    body: body.filter(Boolean).join('\n'),
  })
}

/* ===== pipeline ===== */

/**
 * Pipeline end-to-end del piloto: spec -> sintesis -> simulacion -> verificacion -> reporte.
 */
/**
 * @param {object|string} input spec estructurado o texto libre
 * @param {{ frequencies?: number[], monteCarloRuns?: number, seed?: number }} [options]
 */
export function designPipeline(input, options = {}) {
  const parsed = parseRequirement(input)
  const { spec, questions } = parsed
  const proposal = designIa(spec)
  const { dc, ac, metrics } = evaluateProposal(spec, proposal, options)
  const verification = verifyDesign(spec, metrics)
  const result = { spec, proposal, dc, ac, metrics, verification, questions }
  result.report = {
    markdown: renderMarkdown(result),
    schematicSvg: renderSchematicSvg(proposal),
    bodeSvg: renderBodeSvg(ac, { outNode: 'out' }),
  }
  return result
}

/* ===== schemas ===== */

/**
 * Esquemas JSON del piloto. Subconjunto de JSON Schema 2020-12 que valida
 * `src/contract/validate.js` (sin dependencias externas).
 */

const OMIT = undefined

export const CIRCUIT_SPEC_SCHEMA = {
  $id: 'cir/CircuitSpec/v1',
  type: 'object',
  required: [
    'schema',
    'target',
    'gain',
    'bandwidthHz',
    'cmrrMinDb',
    'supply',
    'inputRangeV',
    'sourceImpedanceOhm',
    'constraints',
  ],
  properties: {
    schema: { const: 'cir/CircuitSpec/v1' },
    id: { type: 'string' },
    target: { enum: ['instrumentation_amplifier'] },
    gain: {
      type: 'object',
      required: ['nominal'],
      properties: {
        nominal: { type: 'number', minimum: 1 },
        tolerancePct: { type: 'number', minimum: 0 },
      },
      additionalProperties: false,
    },
    bandwidthHz: { type: 'number', minimum: 1 },
    cmrrMinDb: { type: 'number' },
    supply: {
      type: 'object',
      required: ['positiveV', 'negativeV'],
      properties: {
        positiveV: { type: 'number' },
        negativeV: { type: 'number' },
      },
      additionalProperties: false,
    },
    inputRangeV: {
      type: 'object',
      required: ['minV', 'maxV'],
      properties: {
        minV: { type: 'number' },
        maxV: { type: 'number' },
      },
      additionalProperties: false,
    },
    sourceImpedanceOhm: { type: 'number', minimum: 0 },
    constraints: {
      type: 'object',
      properties: {
        resistorSeries: { enum: ['E24', 'E96'] },
        monolithicAllowed: { type: 'boolean' },
        opAmpModel: {
          enum: ['generic-1mhz', 'generic-10mhz', 'ina128-like'],
        },
        maxResistors: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
}

 export const NETLIST_SCHEMA = {
  $id: 'cir/Netlist/v1',
  type: 'object',
  required: ['schema', 'nodes', 'elements'],
  properties: {
    schema: { const: 'cir/Netlist/v1' },
    nodes: { type: 'array', minItems: 1, items: { type: 'string' } },
    elements: { type: 'array', minItems: 1, items: { type: 'object' } },
  },
  additionalProperties: false,
}

export const SIM_RESULT_SCHEMA = {
  $id: 'cir/SimResult/v1',
  type: 'object',
  required: ['schema'],
  properties: { schema: { type: 'string' } },
  additionalProperties: true,
}

export const DESIGN_PROPOSAL_SCHEMA = {
  $id: 'cir/DesignProposal/v1',
  type: 'object',
  required: ['schema', 'specId', 'topology', 'resistors', 'opAmps', 'netlist', 'expected', 'assumptions'],
  properties: {
    schema: { const: 'cir/DesignProposal/v1' },
    specId: { type: 'string' },
    topology: { enum: ['three_op_amp', 'monolithic'] },
    resistors: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'valueOhm', 'series'],
        properties: {
          name: { type: 'string' },
          valueOhm: { type: 'number', minimum: 0 },
          series: { enum: ['E24', 'E96'] },
        },
        additionalProperties: false,
      },
    },
    opAmps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'gain', 'poleHz'],
        properties: {
          name: { type: 'string' },
          gain: { type: 'number', minimum: 1 },
          poleHz: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    netlist: { $ref: '#/$defs/netlist' },
    expected: { type: 'object' },
    assumptions: { type: 'array', items: { type: 'string' } },
    clarifyingQuestions: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
  $defs: { netlist: NETLIST_SCHEMA },
}

export const VERIFICATION_SCHEMA = {
  $id: 'cir/Verification/v1',
  type: 'object',
  required: ['schema', 'pass', 'checks'],
  properties: {
    schema: { const: 'cir/Verification/v1' },
    pass: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'description', 'pass'],
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          required: {},
          actual: {},
          pass: { type: 'boolean' },
          margin: {},
        },
        additionalProperties: true,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
}

export const MANIFEST_SCHEMA = {
  $id: 'dsh.plugin/v0.1',
  type: 'object',
  required: [
    'apiVersion',
    'id',
    'name',
    'version',
    'kind',
    'profile',
    'description',
    'capabilities',
    'provides',
    'health',
    'selfTest',
    'telemetry',
    'permissions',
    'lifecycle',
    'compatibility',
    'docs',
  ],
  properties: {
    apiVersion: { const: 'dsh.plugin/v0.1' },
    id: { type: 'string', pattern: '^[a-z][a-z0-9]*([.-][a-z0-9]+)+$' },
    name: { type: 'string', minLength: 1 },
    version: { type: 'string' },
    kind: { enum: ['deterministic', 'agentic', 'composite'] },
    profile: { enum: ['inproc-ts', 'sidecar-native', 'mcp', 'agentic', 'composite'] },
    description: { type: 'string', minLength: 1 },
    capabilities: { type: 'array', minItems: 1, items: { type: 'object' } },
    provides: { type: 'array', minItems: 1, items: { type: 'object' } },
    health: { type: 'object' },
    selfTest: { type: 'object' },
    telemetry: { type: 'object' },
    permissions: { type: 'object' },
    lifecycle: { type: 'object' },
    compatibility: { type: 'object' },
    docs: { type: 'object' },
  },
  additionalProperties: true,
}

export { OMIT }

/* ===== validate ===== */

/**
 * Validador de JSON Schema (subconjunto) sin dependencias.
 * Soporta: type, properties, required, additionalProperties, items, enum,
 * const, minimum, maximum, minItems, maxItems, minLength, maxLength, pattern,
 * oneOf y $ref local a #/$defs/<name>.
 */

/** @typedef {{ path: string, message: string }} ValidationError */

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

function typeMatches(expected, value) {
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  if (expected === 'integer') return actual === 'integer'
  if (Array.isArray(expected)) return expected.some((t) => typeMatches(t, value))
  return actual === expected
}

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`UNSUPPORTED_REF: ${ref}`)
  }
  const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let node = root
  for (const part of parts) {
    if (node == null || typeof node !== 'object') throw new Error(`BAD_REF: ${ref}`)
    node = node[part]
  }
  if (node === undefined) throw new Error(`BAD_REF: ${ref}`)
  return node
}

function validateNode(node, value, root, path, errors) {
  if (node == null || node === true) return

  if (node.$ref) {
    validateNode(resolveRef(root, node.$ref), value, root, path, errors)
    return
  }

  if (node.oneOf) {
    const matches = node.oneOf.filter((candidate) => {
      const branchErrors = []
      validateNode(candidate, value, root, path, branchErrors)
      return branchErrors.length === 0
    })
    if (matches.length !== 1) {
      errors.push({ path, message: `debe cumplir exactamente una variante de oneOf (cumple ${matches.length})` })
    }
    return
  }

  if (node.type !== undefined && !typeMatches(node.type, value)) {
    errors.push({ path, message: `tipo esperado ${JSON.stringify(node.type)}, recibido ${typeOf(value)}` })
    return
  }

  if (node.const !== undefined && value !== node.const) {
    errors.push({ path, message: `debe ser ${JSON.stringify(node.const)}` })
  }

  if (node.enum !== undefined && !node.enum.some((option) => Object.is(option, value))) {
    errors.push({ path, message: `debe ser uno de ${JSON.stringify(node.enum)}` })
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) {
      errors.push({ path, message: `debe ser >= ${node.minimum}` })
    }
    if (node.maximum !== undefined && value > node.maximum) {
      errors.push({ path, message: `debe ser <= ${node.maximum}` })
    }
  }

  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) {
      errors.push({ path, message: `longitud mínima ${node.minLength}` })
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      errors.push({ path, message: `longitud máxima ${node.maxLength}` })
    }
    if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
      errors.push({ path, message: `no cumple el patrón ${node.pattern}` })
    }
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {
      errors.push({ path, message: `mínimo ${node.minItems} elementos` })
    }
    if (node.maxItems !== undefined && value.length > node.maxItems) {
      errors.push({ path, message: `máximo ${node.maxItems} elementos` })
    }
    if (node.items) {
      value.forEach((item, index) => validateNode(node.items, item, root, `${path}[${index}]`, errors))
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (node.required) {
      for (const key of node.required) {
        if (!(key in value)) errors.push({ path, message: `falta el campo requerido "${key}"` })
      }
    }
    if (node.properties) {
      for (const [key, childSchema] of Object.entries(node.properties)) {
        if (key in value) validateNode(childSchema, value[key], root, `${path}.${key}`, errors)
      }
    }
    if (node.additionalProperties === false && node.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in node.properties)) {
          errors.push({ path, message: `campo no permitido "${key}"` })
        }
      }
    } else if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      for (const key of Object.keys(value)) {
        if (!node.properties || !(key in node.properties)) {
          validateNode(node.additionalProperties, value[key], root, `${path}.${key}`, errors)
        }
      }
    }
  }
}

/**
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
export function validate(schema, value) {
  const errors = []
  validateNode(schema, value, schema, '$', errors)
  return { valid: errors.length === 0, errors }
}

export function assertValid(schema, value, label = 'valor') {
  const result = validate(schema, value)
  if (!result.valid) {
    const detail = result.errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n')
    throw new Error(`${label} inválido:\n${detail}`)
  }
}

export function formatErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.message}`).join('\n')
}

/* ===== support-core ===== */

/**
 * Support Studio — deterministic support-domain core.
 *
 * Pure functions (no I/O) that classify support tickets, search the knowledge
 * wiki, draft a reply, and generate Markdown wiki articles. This is the
 * deterministic half; an agentic half can enrich it (intent parsing, ambiguous
 * tickets) behind the same contract. English, because the plugin targets an
 * English publishable demo.
 */

export const CATEGORIES = ['billing', 'login', 'api', 'integration', 'bug', 'feature', 'other']
export const URGENCIES = ['low', 'medium', 'high', 'critical']
export const SENTIMENTS = ['negative', 'neutral', 'positive']

const KEYWORDS = {
  billing: ['invoice', 'charge', 'refund', 'payment', 'price', 'subscription', 'overcharge', 'billing'],
  login: ['login', 'sign in', 'password', 'otp', '2fa', 'lock', 'unable to access', 'account'],
  api: ['api key', 'endpoint', 'rate limit', '401', '403', '429', 'websocket', 'authentication error'],
  integration: ['webhook', 'slack', 'connect', 'integration', 'sync', 'import', 'export', 'link'],
  bug: ['crash', 'error', 'broken', 'bug', 'freeze', 'not working', 'fails', 'exception', 'white screen'],
  feature: ['feature', 'request', 'would be nice', 'add support', 'enhancement', 'suggest'],
}

const SENTIMENT_WORDS = {
  negative: ['angry', 'frustrated', 'urgent', 'terrible', 'unacceptable', 'furious', 'disappointed', 'awful', 'critical', 'urgent'],
  positive: ['thanks', 'great', 'love', 'awesome', 'perfect', 'appreciate', 'works well', 'happy'],
}

// Fake knowledge base (wiki) that a real install would persist on disk.
export const KNOWLEDGE_BASE = {
  api: {
    title: 'API returns 401 Unauthorized',
    body: 'The 401 is almost always an expired or invalid API key. Rotate the key in the dashboard and retry within 60s. If you use a webhook signature, verify HMAC uses the current secret and UTC timestamps.',
    keywords: ['401', 'api key', 'unauthorized', 'expired key', 'rotate key'],
  },
  login: {
    title: 'Cannot sign in after password reset',
    body: 'Clear the OTP that is cached in the app (Settings → Security → Clear OTP), then sign in again. If 2FA is on, re-enter the backup codes. Lockouts release automatically after 15 minutes.',
    keywords: ['login', 'password', 'otp', '2fa', 'locked', 'reset'],
  },
  billing: {
    title: 'Duplicate charge on the same invoice',
    body: 'A duplicate invoice is a transient double-submission on the payment gateway. Refund the extra line from Billing → Invoices → Refund; the reconciliation job settles automatically within 24h.',
    keywords: ['duplicate', 'charge', 'invoice', 'refund', 'billing'],
  },
  integration: {
    title: 'Webhook delivery is intermittent',
    body: 'Confirm the endpoint returns 2xx within 5s and enables a retry. Our retry backoff is 1m, 5m, 15m, then 30m (max 4). Enable the webhook log in the dashboard to see each attempt payload and status.',
    keywords: ['webhook', 'intermittent', 'delivery', 'retry', 'slack'],
  },
  bug: {
    title: 'White screen after the 2.4.0 update',
    body: 'A stale cache commonly causes this. Hard-reload (Cmd/Ctrl+Shift+R) and clear localStorage for the app domain. If it persists, uninstall and reinstall; your data is synced in the cloud.',
    keywords: ['white screen', 'cache', 'update', 'blank', 'load'],
  },
}

/**
 * Classify a ticket into { category, sentiment, urgency }.
 * @param {string} text
 */
export function classifyTicket(text = '') {
  const lower = text.toLowerCase()
  let category = 'other'
  let bestScore = 0
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    const score = words.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; category = cat }
  }
  let sentiment = 'neutral'
  let neg = 0; let pos = 0
  for (const w of SENTIMENT_WORDS.negative) if (lower.includes(w)) neg++
  for (const w of SENTIMENT_WORDS.positive) if (lower.includes(w)) pos++
  if (neg > pos) sentiment = 'negative'
  else if (pos > neg) sentiment = 'positive'
  const urgency = lower.match(/\b(urgent|asap|immediately|critical|outage|down)\b/) ? 'high'
    : (lower.match(/\b(same day|today|soon|frustrated|angry)\b/) ? 'medium' : 'low')
  return { category, sentiment, urgency }
}

/**
 * Search the knowledge base for the best-matching article for a ticket.
 * Returns { found, key, article } or { found:false }.
 * @param {string} text
 */
export function searchWiki(text = '') {
  const lower = text.toLowerCase()
  let bestKey = null
  let bestScore = 0
  for (const [key, article] of Object.entries(KNOWLEDGE_BASE)) {
    const cats = article.keywords
    const score = cats.reduce((acc, w) => acc + (lower.includes(w) ? 2 : 0), 0)
    // category match also counts
    if (lower.includes(key)) score + 2
    if (score > bestScore) { bestScore = score; bestKey = key }
  }
  if (bestKey && bestScore > 0) {
    return { found: true, key: bestKey, article: KNOWLEDGE_BASE[bestKey] }
  }
  return { found: false }
}

/**
 * Draft a support reply.
 * @param {{ ticketId: string, text: string }} input
 */
export function draftReply({ ticketId = 'T-0001', text = '' } = {}) {
  const lower = text.toLowerCase()
  const classification = classifyTicket(text)
  const wiki = searchWiki(text)
  const greeting = classification.sentiment === 'negative'
    ? 'Thanks for reaching out — I am sorry this is causing friction, and I want to help.'
    : 'Hi there, thanks for contacting us!'
  const categoryLine = `I see this is a **${classification.category}** issue.`

  let resolution
  let resolved
  if (wiki.found) {
    resolved = true
    resolution = wiki.article.body
  } else {
    resolved = false
    resolution = 'I have escalated this to our team for a closer look, and I will follow up shortly with a fix or workaround.'
  }

  const signature = '— Jenny, Support @ Acme'
  return {
    ticketId,
    classification,
    wiki: { found: wiki.found, key: wiki.key ?? null },
    resolved,
    reply: `${greeting}\n\n${categoryLine}\n\n${resolution}\n\n${signature}`,
  }
}

/**
 * Generate a Markdown wiki article from a resolved issue.
 * @param {{ title: string, symptom: string, cause: string, resolution: string, tags: string } | string} input
 */
export function generateWikiArticle(input = {}) {
  if (typeof input === 'string') {
    const r = draftReply({ text: input })
    const title = r.wiki.found ? `${r.wiki.article.title} (resolved)` : 'New issue resolved'
    return mdArticle({
      id: `issue-${r.ticketId.toLowerCase().replace('-', '')}`,
      title,
      symptom: input,
      cause: r.wiki.found ? r.wiki.article.title : 'Under investigation — root cause determined after follow-up.',
      resolution: r.wiki.found ? r.wiki.article.body : 'Resolution pending follow-up.',
      tags: r.classification.category,
    })
  }
  return mdArticle(input)
}

/** Render a single wiki article in Markdown. */
function mdArticle({ id, title, symptom, cause, resolution, tags }) {
  const slug = (id || title || 'article').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return [
    `# ${title || 'Support article'}`,
    '',
    `> **ID:** \`${slug}\` · **Tags:** ${tags || 'support'}`,
    '',
    '## Symptom',
    '',
    symptom || '_Not provided_',
    '',
    '## Root cause',
    '',
    cause || '_Under investigation_',
    '',
    '## Resolution',
    '',
    resolution || '_Pending_',
    '',
  ].join('\n')
}

/**
 * Build the knowledge wiki index (Markdown) from the articles.
 * @param {Array<{ id: string, title: string }>} articles
 */
export function buildWikiIndex(articles = []) {
  const lines = ['# Knowledge Wiki', '', '> Auto-generated by the Support Studio from resolved tickets.', '', '## Articles', '', ...articles.map((a) => `- [${a.title}](${a.id}.md)`), '', '_Last updated automatically._', '']
  return lines.join('\n')
}
