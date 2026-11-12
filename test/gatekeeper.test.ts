// test/gatekeeper.test.ts
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { runGatekeeper } from '../src/engine.js';
import { acquireLock, releaseLock } from '../src/lock-manager.js';
import type { GatekeeperConfig, PluginManifest } from '../src/types.js';

const config: GatekeeperConfig = JSON.parse(fs.readFileSync('./gatekeeper.config.json', 'utf-8'));

const supportStudioManifest: PluginManifest = {
  id: 'plugin-support-studio',
  capability: 'support.ticket.triage',
  version: '1.0.0',
  mode: 'deterministic-js',
  dependsOn: [],
  permissions: ['http:route:/support-studio/*', 'ui:slot:conversation.composer.dock'],
  inputSchema: { text: 'string', channel: 'string' },
  outputSchema: { category: 'string', urgency: 'string', wikiMatched: 'boolean', reply: 'string' },
  budget: { maxLatencyMs: 50, maxTokensPerCall: 0 }
};

// Cápsulas desechables para los casos que los plugins de ejemplo no cubren
const FIXTURES = `test/.fixtures-${process.pid}`;

function pluginSource(id: string, capability: string, extra = '', passed = true): string {
  return `${extra}
export const plugin = {
  manifest: {
    id: '${id}', capability: '${capability}', version: '1.0.0', mode: 'deterministic-js',
    dependsOn: [], permissions: [], inputSchema: {}, outputSchema: {},
    budget: { maxLatencyMs: 50, maxTokensPerCall: 0 }
  },
  async selfTest() {
    return { passed: ${passed}, assertionsRun: 1, durationMs: 0, details: [] };
  }
};
`;
}

function writeFixture(set: string, files: Record<string, string>): GatekeeperConfig {
  const root = path.join(FIXTURES, set);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf-8');
  }
  return { pluginsDir: root, entryFileName: 'index.ts', allowedExternalPackages: [], keyFlows: {} };
}

async function runTests() {
  console.log('🧪 Ejecutando suite de verificación de Contract Gatekeeper...\n');

  // ESCENARIO 1: Cambio interno aislado dentro de un solo plugin -> FAST_TRACK
  const res1 = await runGatekeeper(config, {
    explicitFiles: ['examples/plugins/support-studio/index.ts'],
    baselineManifests: { 'support-studio': supportStudioManifest }
  });
  assert.strictEqual(res1.verdict, 'FAST_TRACK', JSON.stringify(res1, null, 2));
  assert.deepStrictEqual(res1.reasons, ['STRICT_CAPSULE_INTERNAL_CHANGE']);
  assert.strictEqual(res1.humanReviewLoad, 'LOW');
  assert.strictEqual(res1.contractMutated, false);
  assert.strictEqual(res1.affectedKeyFlows.length, 0);
  assert.deepStrictEqual(Object.keys(res1.selfTestReports), ['plugin-support-studio']);
  console.log('✅ Escenario 1 (Cambio aislado en cápsula -> FAST_TRACK en ' + res1.totalVerificationTimeMs + 'ms): OK');

  // ESCENARIO 2: Cambio en archivo compartido (Regla Shubham: shared style / util) -> ESCALATE_TO_E2E
  const res2 = await runGatekeeper(config, {
    explicitFiles: ['src/shared/global.css']
  });
  assert.strictEqual(res2.verdict, 'ESCALATE_TO_E2E');
  assert.ok(res2.reasons.includes('SHARED_BOUNDARY_TOUCHED'));
  assert.strictEqual(res2.humanReviewLoad, 'HIGH');
  assert.ok(res2.affectedKeyFlows.includes('customer-support-triage-dock'));
  assert.ok(res2.affectedKeyFlows.includes('instrumentation-amplifier-bench'));
  assert.strictEqual(Object.keys(res2.selfTestReports).length, 2);
  console.log('✅ Escenario 2 (Archivo fuera de cápsula -> SHARED_BOUNDARY_TOUCHED -> ESCALATE_TO_E2E): OK');

  // ESCENARIO 3: Mutación de Contrato / Escalada de Permisos -> ESCALATE_TO_E2E
  const res3 = await runGatekeeper(config, {
    explicitFiles: ['examples/plugins/support-studio/index.ts'],
    baselineManifests: {
      'support-studio': {
        ...supportStudioManifest,
        permissions: ['http:route:/support-studio/*'] // Antes tenía menos permisos
      }
    }
  });
  assert.strictEqual(res3.verdict, 'ESCALATE_TO_E2E');
  assert.ok(res3.reasons.includes('PERMISSIONS_ESCALATED'));
  assert.strictEqual(res3.contractMutated, true);
  assert.deepStrictEqual(res3.affectedKeyFlows, ['customer-support-triage-dock', 'full-workspace-composer']);
  console.log('✅ Escenario 3 (Escalada de permisos en manifest -> PERMISSIONS_ESCALATED -> ESCALATE_TO_E2E): OK');

  // ESCENARIO 3b: Cambio de esquema y regresión de budget
  const res3b = await runGatekeeper(config, {
    explicitFiles: ['examples/plugins/support-studio/index.ts'],
    baselineManifests: {
      'support-studio': {
        ...supportStudioManifest,
        inputSchema: { text: 'string' },
        budget: { maxLatencyMs: 20, maxTokensPerCall: 0 }
      }
    }
  });
  assert.strictEqual(res3b.verdict, 'ESCALATE_TO_E2E');
  assert.ok(res3b.reasons.includes('CONTRACT_SCHEMA_MUTATED'));
  assert.ok(res3b.reasons.includes('BUDGET_REGRESSED'));
  console.log('✅ Escenario 3b (Esquema mutado + budget mayor -> ESCALATE_TO_E2E): OK');

  // ESCENARIO 4: Contención entre dos agentes sobre el mismo módulo (Regla Kajetan) -> REJECTED
  assert.strictEqual(acquireLock('support-studio', 'agent-alpha').ok, true);
  try {
    assert.deepStrictEqual(acquireLock('support-studio', 'agent-beta'), { ok: false, holder: 'agent-alpha' });
    const res4 = await runGatekeeper(config, {
      explicitFiles: ['examples/plugins/support-studio/index.ts'],
      agentId: 'agent-beta',
      baselineManifests: {}
    });
    assert.strictEqual(res4.verdict, 'REJECTED');
    assert.ok(res4.reasons.includes('CAPABILITY_LOCKED_BY_ANOTHER_AGENT'));

    const res4own = await runGatekeeper(config, {
      explicitFiles: ['examples/plugins/support-studio/index.ts'],
      agentId: 'agent-alpha',
      baselineManifests: {}
    });
    assert.strictEqual(res4own.verdict, 'FAST_TRACK');
    assert.strictEqual(releaseLock('support-studio', 'agent-beta'), false);
  } finally {
    releaseLock('support-studio', 'agent-alpha');
  }
  console.log('✅ Escenario 4 (Colisión de 2 agentes en el mismo plugin -> CAPABILITY_LOCKED -> REJECTED): OK');

  // ESCENARIO 5: Import que sale de la cápsula -> REJECTED
  const cfg5 = writeFixture('imports', {
    'alpha/index.ts': pluginSource('plugin-alpha', 'cap.alpha', `import { helper } from '../alpha-two/helper.js';\nvoid helper;`),
    'alpha-two/helper.ts': 'export const helper = 1;\n',
    'alpha-two/index.ts': pluginSource('plugin-alpha-two', 'cap.alpha.two', `import leftPad from 'left-pad';\nvoid leftPad;`),
    'clean/index.ts': pluginSource(
      'plugin-clean',
      'cap.clean',
      `import type { Helper } from '../alpha-two/helper.js';\nimport fs from 'node:fs';\nimport { local } from './local.js';\nvoid fs; void local;\nexport type H = Helper;`
    ),
    'clean/local.ts': 'export const local = 1;\n'
  });
  const res5 = await runGatekeeper(cfg5, {
    explicitFiles: [`${cfg5.pluginsDir}/alpha/index.ts`],
    baselineManifests: {}
  });
  assert.strictEqual(res5.verdict, 'REJECTED');
  assert.ok(res5.reasons.includes('ILLEGAL_CROSS_CAPSULE_IMPORT'));
  // `alpha-two` comparte prefijo con `alpha`: no debe contar como "dentro" de la cápsula
  assert.strictEqual(res5.importViolations[0]?.importedPath, '../alpha-two/helper.js');

  const res5b = await runGatekeeper(cfg5, {
    explicitFiles: [`${cfg5.pluginsDir}/clean/index.ts`],
    baselineManifests: {}
  });
  assert.strictEqual(res5b.verdict, 'FAST_TRACK', JSON.stringify(res5b, null, 2));
  console.log('✅ Escenario 5 (Import fuera de cápsula -> REJECTED; import type e imports internos -> OK): OK');

  // ESCENARIO 6: selfTest() que falla, y cápsula sin plugin cargable -> REJECTED
  const cfg6 = writeFixture('selftest', {
    'failing/index.ts': pluginSource('plugin-failing', 'cap.failing', '', false),
    'broken/index.ts': 'export const nothing = 1;\n'
  });
  const res6 = await runGatekeeper(cfg6, {
    explicitFiles: [`${cfg6.pluginsDir}/failing/index.ts`],
    baselineManifests: {}
  });
  assert.strictEqual(res6.verdict, 'REJECTED');
  assert.ok(res6.reasons.includes('SELFTEST_FAILED'));

  const res6b = await runGatekeeper(cfg6, {
    explicitFiles: [`${cfg6.pluginsDir}/broken/index.ts`],
    baselineManifests: {}
  });
  assert.strictEqual(res6b.verdict, 'REJECTED');
  assert.ok(res6b.reasons.includes('SELFTEST_FAILED'));
  console.log('✅ Escenario 6 (selfTest fallido / plugin no cargable -> SELFTEST_FAILED -> REJECTED): OK');

  // ESCENARIO 7: Sin cambios, y archivo suelto en la raíz de pluginsDir
  const res7 = await runGatekeeper(config, { explicitFiles: [] });
  assert.strictEqual(res7.verdict, 'FAST_TRACK');
  assert.strictEqual(res7.humanReviewLoad, 'NONE');

  const res7b = await runGatekeeper(config, { explicitFiles: ['examples/plugins/registry.ts'] });
  assert.strictEqual(res7b.verdict, 'ESCALATE_TO_E2E');
  assert.deepStrictEqual(res7b.touchedCapsules, []);
  assert.deepStrictEqual(res7b.outOfCapsuleFiles, ['examples/plugins/registry.ts']);
  console.log('✅ Escenario 7 (Sin cambios -> NONE; archivo en raíz de pluginsDir -> SHARED_BOUNDARY): OK');

  console.log('\n🎉 Todos los escenarios deterministas pasaron exitosamente.');
}

runTests()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(FIXTURES, { recursive: true, force: true });
  });
