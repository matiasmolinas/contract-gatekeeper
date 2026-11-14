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
import { complex, add as complexAdd, sub as complexSub } from './complex.js'
import { SingularMatrixError, solveComplex, solveReal } from './linalg.js'

const GROUND = '0'
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
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** @param {unknown} value */
function isPlainObject(value) {
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
  if (!isPlainObject(netlist)) {
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
    if (!nodeSet.has(GROUND)) {
      errors.push(`[E_GROUND] falta el nodo de referencia ground '${GROUND}'`)
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
  if (!isPlainObject(element)) {
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
    if (!isFiniteNumber(value)) {
      errors.push(`[E_VALUE] elemento ${label}: '${field}' debe ser un número finito`)
    } else if (value <= 0) {
      errors.push(`[${code}] elemento ${label}: '${field}' debe ser > 0 (recibido ${value})`)
    }
  }
  /** @param {string} field @param {string} code */
  const checkNonNegative = (field, code) => {
    const value = element[field]
    if (!isFiniteNumber(value)) {
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
      if (!isFiniteNumber(element.valueV)) {
        errors.push(`[E_VALUE] elemento ${label}: 'valueV' debe ser un número finito`)
      }
      break
    case 'I':
      checkNode('a')
      checkNode('b')
      checkDistinctNodes(element, label, 'a', 'b', errors)
      if (!isFiniteNumber(element.valueA)) {
        errors.push(`[E_VALUE] elemento ${label}: 'valueA' debe ser un número finito`)
      }
      break
    case 'VCVS':
      checkNode('outP')
      checkNode('outN')
      checkNode('inP')
      checkNode('inN')
      checkDistinctNodes(element, label, 'outP', 'outN', errors)
      if (!isFiniteNumber(element.gain)) {
        errors.push(`[E_VALUE] elemento ${label}: 'gain' debe ser un número finito`)
      }
      break
    case 'OPAMP':
      checkNode('inP')
      checkNode('inN')
      checkNode('out')
      if (element.out === GROUND) {
        errors.push(`[E_NODE] elemento ${label}: la salida de un OPAMP no puede ser ground '${GROUND}'`)
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
  if (!isPlainObject(model) || !isFiniteNumber(model.gain)) {
    throw new NetlistError('modelo de OPAMP inválido: falta gain finito', 'INVALID_OPAMP_MODEL')
  }
  if (!isFiniteNumber(fHz) || fHz < 0) {
    throw new NetlistError(`frecuencia inválida '${fHz}' para opAmpGain`, 'INVALID_FREQUENCY')
  }
  const poleHz = model.poleHz
  if (!isFiniteNumber(poleHz) || poleHz <= 0 || fHz === 0) {
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

  const voltageNodes = netlist.nodes.filter((node) => node !== GROUND)
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
        stampBranchSource(element, element.out, GROUND, ops.zero(), {
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
  const used = new Set([GROUND])
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
    if (node === GROUND) {
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
    if (!isFiniteNumber(frequency) || frequency <= 0) {
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
