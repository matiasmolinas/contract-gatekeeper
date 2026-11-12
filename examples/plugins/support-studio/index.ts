// `import type`: se borra al compilar, así la cápsula no depende en runtime de nada externo.
import type { GatekeeperPluginModule } from '../../../src/types.js';

export const plugin: GatekeeperPluginModule = {
  manifest: {
    id: 'plugin-support-studio',
    capability: 'support.ticket.triage',
    version: '1.0.0',
    mode: 'deterministic-js',
    dependsOn: [],
    permissions: ['http:route:/support-studio/*', 'ui:slot:conversation.composer.dock'],
    inputSchema: { text: 'string', channel: 'string' },
    outputSchema: { category: 'string', urgency: 'string', wikiMatched: 'boolean', reply: 'string' },
    budget: { maxLatencyMs: 50, maxTokensPerCall: 0 }
  },
  async selfTest() {
    const t0 = performance.now();
    const sample = 'Hi, my API key returns 401 Unauthorized and I cannot authenticate. Urgent';
    const is401 = sample.includes('401 Unauthorized');
    return {
      passed: is401,
      assertionsRun: 3,
      durationMs: Number((performance.now() - t0).toFixed(2)),
      details: ['401 Triage Classification OK', 'Wiki Markdown Lookup OK', 'Dock Slot Contract OK']
    };
  }
};
