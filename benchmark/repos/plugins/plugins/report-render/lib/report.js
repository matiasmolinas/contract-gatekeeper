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

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Redondea a `sig` cifras significativas sin notación científica salvo extremos. */
export function fmtNum(value, sig = 4) {
  if (!isFiniteNumber(value)) return '—'
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
  if (!isFiniteNumber(ohm)) return '—'
  const abs = Math.abs(ohm)
  if (abs >= 1e6) return `${fmtNum(ohm / 1e6, 3)} MΩ`
  if (abs >= 1e3) return `${fmtNum(ohm / 1e3, 3)} kΩ`
  return `${fmtNum(ohm, 4)} Ω`
}

/** Formatea una frecuencia: "1.2 kHz", "10 MHz". */
export function fmtHz(hz) {
  if (!isFiniteNumber(hz)) return '—'
  const abs = Math.abs(hz)
  if (abs >= 1e6) return `${fmtNum(hz / 1e6, 3)} MHz`
  if (abs >= 1e3) return `${fmtNum(hz / 1e3, 3)} kHz`
  return `${fmtNum(hz, 3)} Hz`
}

function fmtDb(db) {
  return isFiniteNumber(db) ? `${fmtNum(db, 4)} dB` : '—'
}

function fmtPct(value) {
  return isFiniteNumber(value) ? `${fmtNum(value, 3)} %` : '—'
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
          isFiniteNumber(spec.supply?.positiveV) && isFiniteNumber(spec.supply?.negativeV)
            ? `${fmtNum(spec.supply.positiveV)} V / ${fmtNum(spec.supply.negativeV)} V`
            : '—',
        ],
        [
          'Rango de entrada',
          isFiniteNumber(spec.inputRangeV?.minV) && isFiniteNumber(spec.inputRangeV?.maxV)
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
      .map(([key, value]) => `${key} = ${isFiniteNumber(value) ? fmtNum(value) : String(value)}`)
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
          isFiniteNumber(errorPct)
            ? `error ${fmtPct(errorPct)} (tolerancia ±${fmtNum(gainSpec.tolerancePct)} %)`
            : '—',
        ],
        [
          'Dispersión Monte Carlo (p95)',
          `tolerancia ±${fmtNum(gainSpec.tolerancePct)} %`,
          fmtPct(mcP95),
          isFiniteNumber(mcP95) && isFiniteNumber(gainSpec.tolerancePct)
            ? mcP95 <= gainSpec.tolerancePct
              ? '✓ dentro de tolerancia'
              : '✗ fuera de tolerancia'
            : '—',
        ],
        [
          'CMRR (modelo ideal)',
          fmtDb(metrics.cmrrMinDb ?? spec.cmrrMinDb),
          fmtDb(metrics.cmrrDb),
          isFiniteNumber(metrics.cmrrDb) && isFiniteNumber(metrics.cmrrMinDb ?? spec.cmrrMinDb)
            ? `${fmtNum(metrics.cmrrDb - (metrics.cmrrMinDb ?? spec.cmrrMinDb))} dB de margen`
            : '—',
        ],
        [
          'Ancho de banda (−3 dB)',
          fmtHz(spec.bandwidthHz),
          fmtHz(metrics.bandwidthHz),
          isFiniteNumber(metrics.bandwidthHz) && isFiniteNumber(spec.bandwidthHz)
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
  if (!value || !isFiniteNumber(value.re) || !isFiniteNumber(value.im)) return null
  return Math.hypot(value.re, value.im)
}

/**
 * Puntos (f, dB) de la ganancia de tensión |Vout|/|Vd|.
 * Si el AC no expone `in+`/`in-`, se asume excitación diferencial unitaria.
 */
function bodePoints(ac, outNode) {
  const points = []
  for (const point of ac?.points ?? []) {
    if (!point || !isFiniteNumber(point.fHz) || point.fHz <= 0) continue
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
