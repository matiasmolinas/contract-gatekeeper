/**
 * Mediciones de amplificadores sobre el solver MNA.
 *
 * Todas las funciones **clonan** el netlist antes de tocarlo: agregan fuentes
 * de excitación internas (`__meas_vp`, `__meas_vn`) sobre la copia y nunca
 * mutan el netlist del llamador.
 */
import { abs as complexAbs, sub as complexSub } from './complex.js'
import { NetlistError, solveDc } from './mna.js'

const GROUND = '0'
const MEAS_POSITIVE = '__meas_vp'
const MEAS_NEGATIVE = '__meas_vn'

/** Clona un netlist plano (sólo datos JSON: nodos, elementos y valores). */
function cloneNetlist(netlist) {
  return structuredClone(netlist)
}

/** @param {unknown} value */
function isFiniteNumber(value) {
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
  if (inP === GROUND && inN === GROUND) {
    throw measurementError('inP e inN no pueden ser ambos ground')
  }
  const clone = cloneNetlist(netlist)
  requireNodes(clone, [inP, inN], 'measureDifferentialGain')
  if (inP !== GROUND) addVoltageSource(clone, MEAS_POSITIVE, inP, GROUND, vd / 2)
  if (inN !== GROUND) addVoltageSource(clone, MEAS_NEGATIVE, inN, GROUND, -vd / 2)
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
  if (inP === GROUND && inN === GROUND) {
    throw measurementError('inP e inN no pueden ser ambos ground')
  }
  const clone = cloneNetlist(netlist)
  requireNodes(clone, [inP, inN], 'measureCmrr')
  if (inP !== GROUND) addVoltageSource(clone, MEAS_POSITIVE, inP, GROUND, vcm)
  if (inN !== GROUND) addVoltageSource(clone, MEAS_NEGATIVE, inN, GROUND, vcm)
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
  if (!isFiniteNumber(vd) || vd === 0) {
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
  if (!isFiniteNumber(vcm) || vcm === 0) {
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
  if (!isFiniteNumber(reference) || reference === 0) return 0
  const target = reference / Math.SQRT2

  const samples = []
  for (const point of ac.points) {
    const nodeVoltages = point?.nodeVoltages
    if (!nodeVoltages) continue
    const vp = nodeVoltages[inP]
    const vn = nodeVoltages[inN]
    const vo = nodeVoltages[outNode]
    if (!vp || !vn || !vo) continue
    if (!isFiniteNumber(point.fHz) || point.fHz <= 0) continue
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
