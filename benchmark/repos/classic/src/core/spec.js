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
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** @param {unknown} value */
function isPlainObject(value) {
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
  const id = isFiniteNumber(input.id) ? undefined : input.id
  if (typeof id === 'string' && id.length > 0) spec.id = id

  const rawGain = input.gain
  let nominal
  let tolerancePct
  if (isFiniteNumber(rawGain)) {
    nominal = rawGain
  } else if (isPlainObject(rawGain)) {
    if (isFiniteNumber(rawGain.nominal)) nominal = rawGain.nominal
    if (isFiniteNumber(rawGain.tolerancePct)) tolerancePct = rawGain.tolerancePct
  } else if (isFiniteNumber(input.gainNominal)) {
    nominal = input.gainNominal
  }
  if (tolerancePct === undefined) {
    if (isFiniteNumber(input.gainTolerancePct)) tolerancePct = input.gainTolerancePct
    else if (isFiniteNumber(input.tolerancePct)) tolerancePct = input.tolerancePct
  }
  if (nominal === undefined || !Number.isFinite(nominal) || nominal < 1) {
    questions.push('¿Cuál es la ganancia nominal requerida (V/V)?')
  } else {
    spec.gain.nominal = nominal
  }
  if (isFiniteNumber(tolerancePct) && tolerancePct >= 0) {
    spec.gain.tolerancePct = tolerancePct
  }

  const bandwidth = decodeFrequency(input.bandwidthHz ?? input.bandwidth)
  if (bandwidth === undefined) {
    questions.push('¿Qué ancho de banda mínimo necesitás a −3 dB (Hz o kHz)?')
  } else {
    spec.bandwidthHz = bandwidth
  }

  const cmrr = input.cmrrMinDb ?? input.cmrrDb ?? input.cmrr
  if (!isFiniteNumber(cmrr)) {
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
  if (isFiniteNumber(value) && value >= 1) return value
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
  if (isFiniteNumber(value)) return value
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
  if (isFiniteNumber(value) && value > 0) {
    return { positiveV: value, negativeV: -value }
  }
  if (isPlainObject(value)) {
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
  if (isFiniteNumber(value) && value > 0) {
    return { minV: -value, maxV: value }
  }
  if (Array.isArray(value) && value.length === 2) {
    const minV = decodeNumber(value[0])
    const maxV = decodeNumber(value[1])
    if (minV !== undefined && maxV !== undefined && minV < maxV) return { minV, maxV }
    return undefined
  }
  if (isPlainObject(value)) {
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
  if (!isPlainObject(value)) return constraints
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
  if (isPlainObject(input)) {
    const parsed = fromObject(input)
    return { ...parsed, source: 'json' }
  }
  throw new TypeError('parseRequirement esperaba un objeto spec o un string con el requisito')
}
