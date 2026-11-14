/**
 * Tests de los reportes: Markdown, esquemático SVG y Bode SVG.
 * No dependen del pipeline: usan fixtures con la forma de INTERFACES.md.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  escapeXml,
  fmtHz,
  fmtOhm,
  pickOutNode,
  renderBodeSvg,
  renderMarkdown,
  renderSchematicSvg,
} from '../src/core/report.js'

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
