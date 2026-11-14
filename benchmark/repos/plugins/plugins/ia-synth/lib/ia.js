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

import { lazy } from '#runtime'
const solveAc = lazy('circuit.simulate', 'solveAc')
const measureDifferentialGain = lazy('circuit.simulate', 'measureDifferentialGain')
const measureCmrr = lazy('circuit.simulate', 'measureCmrr')
const bandwidthHz = lazy('circuit.simulate', 'bandwidthHz')
const runMonteCarlo = lazy('circuit.simulate', 'runMonteCarlo')
const e96Values = lazy('resistor.series', 'e96Values')
const nearestE96 = lazy('resistor.series', 'nearestE96')
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
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Redondea a `digits` cifras significativas, sin notación científica. */
function roundTo(value, digits = 6) {
  if (!isFiniteNumber(value)) return value
  return Number(value.toPrecision(digits))
}

/** Devuelve el primer número finito positivo de la lista, o el fallback. */
function firstFinite(...values) {
  for (const value of values) {
    if (isFiniteNumber(value) && value > 0) return value
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
  return isFiniteNumber(value) && value > 0 ? value : undefined
}

/** Umbral de ancho de banda analítico con margen de seguridad (o undefined). */
function bandwidthThresholdHz(spec) {
  const required = requiredBandwidthHz(spec)
  return required === undefined ? undefined : required / BANDWIDTH_SAFETY_FACTOR
}

/** @param {number} predictedHz @param {number} thresholdHz */
function bandwidthFeasible(predictedHz, thresholdHz) {
  if (thresholdHz === undefined) return true
  return isFiniteNumber(predictedHz) && predictedHz >= thresholdHz
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
  const tolerancePct = isFiniteNumber(spec?.gain?.tolerancePct)
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
  return isFiniteNumber(value) && value > 0 ? value : undefined
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
    if (!isFiniteNumber(value) || value <= 0) return
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
  return isFiniteNumber(vd) && vd > 0 ? vd : 0.02
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
  if (!isFiniteNumber(cmrrDb)) return Number.NaN
  return Math.min(cmrrDb, CMRR_IDEAL_CAP_DB)
}

/** Porcentaje p95 de desvío absoluto de las muestras respecto de la referencia. */
function p95AbsolutePct(samples, reference) {
  if (!Array.isArray(samples) || samples.length === 0) return 0
  if (!isFiniteNumber(reference) || reference === 0) return Number.NaN
  const deviations = samples
    .filter((sample) => isFiniteNumber(sample))
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
  const seed = isFiniteNumber(options.seed) ? options.seed : DEFAULT_MC_SEED
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
    isFiniteNumber(measuredBandwidth) &&
    measuredBandwidth >= frequencies[frequencies.length - 1] * (1 - 1e-9) &&
    isFiniteNumber(dcGain) &&
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
    cmrrMinDb: isFiniteNumber(spec?.cmrrMinDb) ? spec.cmrrMinDb : 0,
  }

  if (warnings.length > 0) {
    ac.warnings = [...(ac.warnings ?? []), ...warnings]
  }
  return { dc: gainMeasurement.dc, ac, metrics }
}
