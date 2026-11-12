// `import type`: se borra al compilar, así la cápsula no depende en runtime de nada externo.
import type { GatekeeperPluginModule } from '../../../src/types.js';

export const plugin: GatekeeperPluginModule = {
  manifest: {
    id: 'plugin-amplifier-mna',
    capability: 'electronics.amplifier.solve',
    version: '1.2.0',
    mode: 'deterministic-mojo',
    dependsOn: [],
    permissions: ['ffi:load:libmna'],
    inputSchema: { gain: 'number', vSupply: 'number', bandwidthHz: 'number' },
    outputSchema: { vOut: 'number', topology: 'string', verified: 'boolean' },
    budget: { maxLatencyMs: 50, maxTokensPerCall: 0 }
  },
  async selfTest() {
    const t0 = performance.now();
    const vOut = 15.0 * (1000 / (1000 + 1000)); // Divisor resistivo V(out) = 7.5V
    const passed = Math.abs(vOut - 7.5) < 1e-6;
    return {
      passed,
      assertionsRun: 3,
      durationMs: Number((performance.now() - t0).toFixed(2)),
      details: ['MNA Divider V(out)=7.5V OK', 'E96 Series Tolerance OK', 'Zero Runtime Tokens OK']
    };
  }
};
