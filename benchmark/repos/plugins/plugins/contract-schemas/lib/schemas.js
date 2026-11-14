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
