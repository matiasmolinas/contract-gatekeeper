/**
 * Validador de JSON Schema (subconjunto) sin dependencias.
 * Soporta: type, properties, required, additionalProperties, items, enum,
 * const, minimum, maximum, minItems, maxItems, minLength, maxLength, pattern,
 * oneOf y $ref local a #/$defs/<name>.
 */

/** @typedef {{ path: string, message: string }} ValidationError */

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

function typeMatches(expected, value) {
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  if (expected === 'integer') return actual === 'integer'
  if (Array.isArray(expected)) return expected.some((t) => typeMatches(t, value))
  return actual === expected
}

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`UNSUPPORTED_REF: ${ref}`)
  }
  const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  let node = root
  for (const part of parts) {
    if (node == null || typeof node !== 'object') throw new Error(`BAD_REF: ${ref}`)
    node = node[part]
  }
  if (node === undefined) throw new Error(`BAD_REF: ${ref}`)
  return node
}

function validateNode(node, value, root, path, errors) {
  if (node == null || node === true) return

  if (node.$ref) {
    validateNode(resolveRef(root, node.$ref), value, root, path, errors)
    return
  }

  if (node.oneOf) {
    const matches = node.oneOf.filter((candidate) => {
      const branchErrors = []
      validateNode(candidate, value, root, path, branchErrors)
      return branchErrors.length === 0
    })
    if (matches.length !== 1) {
      errors.push({ path, message: `debe cumplir exactamente una variante de oneOf (cumple ${matches.length})` })
    }
    return
  }

  if (node.type !== undefined && !typeMatches(node.type, value)) {
    errors.push({ path, message: `tipo esperado ${JSON.stringify(node.type)}, recibido ${typeOf(value)}` })
    return
  }

  if (node.const !== undefined && value !== node.const) {
    errors.push({ path, message: `debe ser ${JSON.stringify(node.const)}` })
  }

  if (node.enum !== undefined && !node.enum.some((option) => Object.is(option, value))) {
    errors.push({ path, message: `debe ser uno de ${JSON.stringify(node.enum)}` })
  }

  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) {
      errors.push({ path, message: `debe ser >= ${node.minimum}` })
    }
    if (node.maximum !== undefined && value > node.maximum) {
      errors.push({ path, message: `debe ser <= ${node.maximum}` })
    }
  }

  if (typeof value === 'string') {
    if (node.minLength !== undefined && value.length < node.minLength) {
      errors.push({ path, message: `longitud mínima ${node.minLength}` })
    }
    if (node.maxLength !== undefined && value.length > node.maxLength) {
      errors.push({ path, message: `longitud máxima ${node.maxLength}` })
    }
    if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
      errors.push({ path, message: `no cumple el patrón ${node.pattern}` })
    }
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) {
      errors.push({ path, message: `mínimo ${node.minItems} elementos` })
    }
    if (node.maxItems !== undefined && value.length > node.maxItems) {
      errors.push({ path, message: `máximo ${node.maxItems} elementos` })
    }
    if (node.items) {
      value.forEach((item, index) => validateNode(node.items, item, root, `${path}[${index}]`, errors))
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (node.required) {
      for (const key of node.required) {
        if (!(key in value)) errors.push({ path, message: `falta el campo requerido "${key}"` })
      }
    }
    if (node.properties) {
      for (const [key, childSchema] of Object.entries(node.properties)) {
        if (key in value) validateNode(childSchema, value[key], root, `${path}.${key}`, errors)
      }
    }
    if (node.additionalProperties === false && node.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in node.properties)) {
          errors.push({ path, message: `campo no permitido "${key}"` })
        }
      }
    } else if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      for (const key of Object.keys(value)) {
        if (!node.properties || !(key in node.properties)) {
          validateNode(node.additionalProperties, value[key], root, `${path}.${key}`, errors)
        }
      }
    }
  }
}

/**
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
export function validate(schema, value) {
  const errors = []
  validateNode(schema, value, schema, '$', errors)
  return { valid: errors.length === 0, errors }
}

export function assertValid(schema, value, label = 'valor') {
  const result = validate(schema, value)
  if (!result.valid) {
    const detail = result.errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n')
    throw new Error(`${label} inválido:\n${detail}`)
  }
}

export function formatErrors(errors) {
  return errors.map((e) => `${e.path}: ${e.message}`).join('\n')
}
