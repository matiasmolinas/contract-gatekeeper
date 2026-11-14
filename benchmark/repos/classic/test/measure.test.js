/**
 * Tests de mediciones (`src/core/measure.js`): ganancia diferencial, CMRR y
 * ancho de banda −3 dB. Incluyen un amplificador de instrumentación de 3
 * op-amps con ganancia analítica (1 + 2·R1/Rg)·(R3/R2) = 101.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { bandwidthHz, measureCmrr, measureDifferentialGain } from '../src/core/measure.js'
import { NetlistError, solveAc } from '../src/core/mna.js'

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
