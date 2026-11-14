// Registro de capacidades: lo único que las cápsulas comparten.
// Una cápsula publica su API con provide() y usa las de otras con lazy()/load(),
// nunca con un import relativo hacia fuera de su carpeta.
import { readFileSync } from 'node:fs'

const MAP = JSON.parse(readFileSync(new URL('./capabilities.json', import.meta.url), 'utf8'))
const providers = new Map()

/** Publica la API de una capacidad. La primera publicación gana. */
export function provide(capability, api) {
  if (!providers.has(capability)) providers.set(capability, api)
}

/** API de una capacidad ya cargada. */
export function use(capability) {
  const api = providers.get(capability)
  if (!api) throw new Error(`capability not loaded: ${capability}`)
  return api
}

/** Carga las cápsulas que proveen estas capacidades y devuelve su API. */
export async function load(...capabilities) {
  for (const capability of capabilities) {
    if (providers.has(capability)) continue
    const entry = MAP[capability]
    if (!entry) throw new Error(`unknown capability: ${capability}`)
    await import(new URL(`../${entry}`, import.meta.url).href)
  }
  return capabilities.length === 1 ? use(capabilities[0]) : capabilities.map(use)
}

/** Función de otra capacidad, resuelta en el momento de la llamada. */
export const lazy = (capability, name) => (...args) => use(capability)[name](...args)
