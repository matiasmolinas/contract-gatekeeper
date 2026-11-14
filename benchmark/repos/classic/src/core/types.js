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

export {}
