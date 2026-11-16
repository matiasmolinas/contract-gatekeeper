// src/graph-resolver.ts
import type { AffectedKeyFlow, GatekeeperConfig, KeyFlowDefinition, PluginManifest } from './types.js';

/**
 * Valida una entrada de `keyFlows` y la lleva a la forma completa.
 * Devuelve un mensaje de error si no es ni un arreglo de capabilities ni un objeto válido.
 */
export function normalizeKeyFlow(name: string, definition: KeyFlowDefinition): AffectedKeyFlow | string {
  const isStrings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);

  if (isStrings(definition)) return { name, capabilities: definition };
  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    return `keyFlows.${name}: se esperaba un arreglo de capabilities o un objeto { capabilities, entryUrl?, done? }`;
  }
  if (!isStrings(definition.capabilities)) {
    return `keyFlows.${name}.capabilities: se esperaba un arreglo de capabilities`;
  }
  for (const field of ['entryUrl', 'done'] as const) {
    const value = definition[field];
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      return `keyFlows.${name}.${field}: se esperaba un texto no vacío`;
    }
  }
  const unknown = Object.keys(definition).filter(key => !['capabilities', 'entryUrl', 'done'].includes(key));
  if (unknown.length > 0) {
    return `keyFlows.${name}: campo desconocido "${unknown[0]}" (se admiten capabilities, entryUrl y done)`;
  }
  return {
    name,
    capabilities: definition.capabilities,
    ...(definition.entryUrl !== undefined ? { entryUrl: definition.entryUrl } : {}),
    ...(definition.done !== undefined ? { done: definition.done } : {})
  };
}

/** Errores de la sección `keyFlows` de una config; vacío si es válida. */
export function keyFlowErrors(config: GatekeeperConfig): string[] {
  const flows: unknown = config.keyFlows ?? {};
  if (flows === null || typeof flows !== 'object' || Array.isArray(flows)) {
    return ['keyFlows: se esperaba un objeto { nombreDelFlujo: … }'];
  }
  return Object.entries(flows as Record<string, KeyFlowDefinition>)
    .map(([name, definition]) => normalizeKeyFlow(name, definition))
    .filter((result): result is string => typeof result === 'string');
}

export function resolveAffectedGraph(
  directlyAffectedCapabilities: string[],
  allManifests: PluginManifest[],
  config: GatekeeperConfig
): { allAffectedCapabilities: string[]; affectedKeyFlows: string[]; affectedKeyFlowDetails: AffectedKeyFlow[] } {
  const affectedSet = new Set<string>(directlyAffectedCapabilities);

  // Propagación transitiva hacia arriba (plugins compuestos que dependen de esta capacidad)
  let added = true;
  while (added) {
    added = false;
    for (const m of allManifests) {
      if (!affectedSet.has(m.capability)) {
        const consumesAffected = m.dependsOn.some(dep => affectedSet.has(dep));
        if (consumesAffected) {
          affectedSet.add(m.capability);
          added = true;
        }
      }
    }
  }

  const allAffectedCapabilities = Array.from(affectedSet);

  // Cruzar contra config.keyFlows para saber qué flujos de usuario están en el radio de impacto
  const affectedKeyFlowDetails: AffectedKeyFlow[] = [];
  for (const [flowName, definition] of Object.entries(config.keyFlows ?? {})) {
    const flow = normalizeKeyFlow(flowName, definition);
    if (typeof flow === 'string') throw new Error(flow);
    if (flow.capabilities.some(cap => affectedSet.has(cap))) {
      affectedKeyFlowDetails.push(flow);
    }
  }

  return {
    allAffectedCapabilities,
    affectedKeyFlows: affectedKeyFlowDetails.map(flow => flow.name),
    affectedKeyFlowDetails
  };
}
