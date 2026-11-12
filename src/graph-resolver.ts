// src/graph-resolver.ts
import type { GatekeeperConfig, PluginManifest } from './types.js';

export function resolveAffectedGraph(
  directlyAffectedCapabilities: string[],
  allManifests: PluginManifest[],
  config: GatekeeperConfig
): { allAffectedCapabilities: string[]; affectedKeyFlows: string[] } {
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
  const affectedKeyFlows: string[] = [];
  for (const [flowName, requiredCaps] of Object.entries(config.keyFlows ?? {})) {
    if (requiredCaps.some(cap => affectedSet.has(cap))) {
      affectedKeyFlows.push(flowName);
    }
  }

  return { allAffectedCapabilities, affectedKeyFlows };
}
