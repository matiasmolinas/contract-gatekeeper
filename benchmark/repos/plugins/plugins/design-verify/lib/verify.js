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
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Formatea un número para el reporte (sin arrastrar ruido de coma flotante). */
function fmt(value, digits = 3) {
  if (!isFiniteNumber(value)) return String(value)
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
  const nominal = isFiniteNumber(gainSpec.nominal) ? gainSpec.nominal : Number.NaN
  const tolerancePct = isFiniteNumber(gainSpec.tolerancePct) ? gainSpec.tolerancePct : 0
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
    isFiniteNumber(measured) &&
    isFiniteNumber(nominal) &&
    isFiniteNumber(errorPct) &&
    Math.abs(errorPct) <= tolerancePct + 1e-9
  const gainNominalMargin = isFiniteNumber(errorPct)
    ? tolerancePct - Math.abs(errorPct)
    : Number.NaN
  const gainNominal = check(
    'GAIN_NOMINAL',
    'Ganancia DC simulada dentro de la tolerancia respecto de la nominal',
    `${fmt(nominal)} × (±${fmt(tolerancePct)} %)`,
    isFiniteNumber(measured)
      ? `${fmt(measured)} × (error ${fmt(errorPct)} %)`
      : String(measured ?? 'sin medir'),
    gainNominalPass,
    `${fmt(gainNominalMargin)} % de margen`,
  )

  // --- MONTE_CARLO_GAIN: dispersión estadística sola -------------------------
  const mcPass =
    isFiniteNumber(mcP95AbsPct) && isFiniteNumber(tolerancePct)
      ? mcP95AbsPct <= tolerancePct + 1e-9
      : false
  const mcMargin = isFiniteNumber(mcP95AbsPct) ? tolerancePct - mcP95AbsPct : Number.NaN
  const monteCarlo = check(
    'MONTE_CARLO_GAIN',
    'Dispersión de ganancia p95 (Monte Carlo, resistencias ±1 %) dentro de la tolerancia',
    `≤ ${fmt(tolerancePct)} %`,
    isFiniteNumber(mcP95AbsPct) ? `${fmt(mcP95AbsPct)} %` : String(mcP95AbsPct ?? 'sin medir'),
    mcPass,
    `${fmt(mcMargin)} % de margen`,
  )

  // --- GAIN_TOLERANCE: error sistemático + dispersión (peor caso esperado) ---
  const combinedPct =
    isFiniteNumber(errorPct) && isFiniteNumber(mcP95AbsPct)
      ? Math.abs(errorPct) + mcP95AbsPct
      : Number.NaN
  const combinedPass = isFiniteNumber(combinedPct) && combinedPct <= tolerancePct + 1e-9
  const combinedMargin = isFiniteNumber(combinedPct) ? tolerancePct - combinedPct : Number.NaN
  const gainTolerance = check(
    'GAIN_TOLERANCE',
    'Error sistemático + dispersión p95 combinados dentro de la tolerancia de ganancia',
    `≤ ${fmt(tolerancePct)} %`,
    isFiniteNumber(combinedPct) ? `${fmt(combinedPct)} %` : String(combinedPct ?? 'sin medir'),
    combinedPass,
    `${fmt(combinedMargin)} % de margen`,
  )

  // --- BANDWIDTH -------------------------------------------------------------
  const bandwidthPass =
    isFiniteNumber(bandwidthHz) &&
    isFiniteNumber(requiredBandwidthHz) &&
    bandwidthHz >= requiredBandwidthHz
  const bandwidthMargin = isFiniteNumber(bandwidthHz)
    ? bandwidthHz - requiredBandwidthHz
    : Number.NaN
  const bandwidth = check(
    'BANDWIDTH',
    'Ancho de banda simulado a −3 dB mayor o igual al requerido',
    `${fmt(requiredBandwidthHz)} Hz`,
    isFiniteNumber(bandwidthHz) ? `${fmt(bandwidthHz)} Hz` : String(bandwidthHz ?? 'sin medir'),
    bandwidthPass,
    isFiniteNumber(bandwidthMargin) ? `${fmt(bandwidthMargin)} Hz de margen` : 'sin margen',
  )

  // --- CMRR ------------------------------------------------------------------
  const cmrrPass =
    isFiniteNumber(cmrrDb) && isFiniteNumber(requiredCmrrDb) && cmrrDb >= requiredCmrrDb
  const cmrrMargin = isFiniteNumber(cmrrDb) ? cmrrDb - requiredCmrrDb : Number.NaN
  const cmrr = check(
    'CMRR',
    'CMRR simulado mayor o igual al mínimo requerido',
    `≥ ${fmt(requiredCmrrDb)} dB`,
    isFiniteNumber(cmrrDb) ? `${fmt(cmrrDb)} dB` : String(cmrrDb ?? 'sin medir'),
    cmrrPass,
    isFiniteNumber(cmrrMargin) ? `${fmt(cmrrMargin)} dB de margen` : 'sin margen',
  )

  // --- SIMULATION_SANE -------------------------------------------------------
  const saneValues = [measured, errorPct, mcP95AbsPct, bandwidthHz, cmrrDb]
  const allFinite = saneValues.every((value) => isFiniteNumber(value))
  const sanePass =
    allFinite && measured > 0 && bandwidthHz > 0 && mcP95AbsPct >= 0 && cmrrDb >= 0
  const sane = check(
    'SIMULATION_SANE',
    'Resultados de simulación finitos y coherentes (ganancia > 0, ancho de banda > 0)',
    'métricas finitas y positivas',
    allFinite
      ? `G=${fmt(measured)}; BW=${fmt(bandwidthHz)} Hz; CMRR=${fmt(cmrrDb)} dB; MC p95=${fmt(mcP95AbsPct)} %`
      : 'hay métricas no finitas',
    sanePass,
    sanePass ? 'consistente' : 'inconsistente',
  )

  const checks = [gainNominal, monteCarlo, gainTolerance, bandwidth, cmrr, sane]

  // --- Advertencias ----------------------------------------------------------
  if (!isFiniteNumber(measured) || !isFiniteNumber(errorPct)) {
    warnings.push('La simulación no devolvió una ganancia DC finita: revisar el netlist y el solver.')
  }
  if (!isFiniteNumber(bandwidthHz) || bandwidthHz <= 0) {
    warnings.push('No se pudo medir un ancho de banda −3 dB válido en el rango del barrido.')
  } else if (isFiniteNumber(requiredBandwidthHz) && bandwidthHz < requiredBandwidthHz) {
    warnings.push(
      'Ancho de banda simulado menor al requerido: aumentar el GBW del op-amp, reducir la ganancia por etapa o reevaluar el requisito.',
    )
  }
  if (isFiniteNumber(cmrrDb) && cmrrDb > IDEAL_CMRR_WARNING_DB) {
    warnings.push(
      `CMRR simulado de ${fmt(cmrrDb)} dB: es el límite del modelo ideal. En hardware real lo limita el apareamiento de resistencias; usar resistencias de precisión y/o un INA integrado.`,
    )
  }
  if (isFiniteNumber(mcP95AbsPct) && isFiniteNumber(tolerancePct) && mcP95AbsPct > tolerancePct) {
    warnings.push(
      'La dispersión Monte Carlo p95 supera la tolerancia de ganancia: usar resistencias de 0.1 % o trimar Rg.',
    )
  }
  if (isFiniteNumber(gainSpec.tolerancePct) && gainSpec.tolerancePct <= 0) {
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
