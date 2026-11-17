// test/gatekeeper.test.ts
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runGatekeeper } from '../src/engine.js';
import { acquireLock, releaseLock } from '../src/lock-manager.js';
import { selectTests } from '../src/test-selector.js';
import type { GatekeeperConfig, PluginManifest, SelectedTest } from '../src/types.js';

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
  assert.deepStrictEqual(res3.reasons, ['PERMISSIONS_ESCALATED']); // ya no es "estrictamente interno"
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

  // ESCENARIO 8: Formas de esconder un import al escáner
  const cfg8 = writeFixture('evasion', {
    'other/index.ts': pluginSource('plugin-other', 'cap.other'),
    'other/x.ts': 'export const x = 1;\n',
    // `//` dentro de un string no es comentario: el import de la misma línea debe verse
    'slashes/index.ts': pluginSource(
      'plugin-slashes',
      'cap.slashes',
      `const msg = "Format: //network-share/path"; import { x } from "../other/x.js";\nvoid msg; void x;`
    ),
    // import() con backticks, con y sin interpolación
    'backtick/index.ts': pluginSource('plugin-backtick', 'cap.backtick', 'export const load = () => import(`../other/x.js`);'),
    'template/index.ts': pluginSource(
      'plugin-template',
      'cap.template',
      'export const load = (n: string) => import(`../other/${n}.js`);\nexport const ok = (n: string) => import(`./local/${n}.js`);'
    ),
    // `import { type A }` puede sobrevivir como import en runtime: se rechaza con sugerencia
    'inline/index.ts': pluginSource('plugin-inline', 'cap.inline', `import { type X } from '../other/x.js';\nexport type Y = X;`),
    // Imports mencionados solo en comentarios o texto: no cuentan
    'quiet/index.ts': pluginSource(
      'plugin-quiet',
      'cap.quiet',
      `// import a from '../other/x.js';\n/* import b from '../other/x.js'; */\nconst url = 'https://example.com/a//b';\nconst words = ['sync', 'import', 'export', 'link'];\nconst doc = "run require('../other/x.js') to load";\nvoid url; void words; void doc;`
    )
  });
  const scan = async (capsule: string) =>
    runGatekeeper(cfg8, { explicitFiles: [`${cfg8.pluginsDir}/${capsule}/index.ts`], baselineManifests: {} });

  for (const capsule of ['slashes', 'backtick', 'template', 'inline']) {
    const res = await scan(capsule);
    assert.strictEqual(res.verdict, 'REJECTED', `${capsule}: ${JSON.stringify(res.importViolations)}`);
    assert.deepStrictEqual(res.reasons, ['ILLEGAL_CROSS_CAPSULE_IMPORT'], capsule);
    assert.strictEqual(res.importViolations.length, 1, `${capsule}: ${JSON.stringify(res.importViolations)}`);
  }
  assert.match((await scan('inline')).importViolations[0].reason, /import type/);
  assert.strictEqual((await scan('quiet')).verdict, 'FAST_TRACK');
  console.log('✅ Escenario 8 (`//` en strings, backticks, template literals, `{ type X }` -> REJECTED): OK');

  // ESCENARIO 9: Baseline real desde git cuando el PR renombra archivos internos
  const repo = path.resolve(FIXTURES, 'repo');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
      cwd: repo,
      stdio: 'ignore'
    });
  const capsuleAt = (name: string, helper: string, permissions: string) => ({
    [`plugins/${name}/index.ts`]: `import { latency } from './${helper}.js';
export const plugin = {
  manifest: {
    id: 'plugin-${name}', capability: 'cap.${name}', version: '1.0.0', mode: 'deterministic-js',
    dependsOn: [], permissions: [${permissions}], inputSchema: {}, outputSchema: {},
    budget: { maxLatencyMs: latency, maxTokensPerCall: 0 }
  },
  async selfTest() { return { passed: true, assertionsRun: 1, durationMs: 0, details: [] }; }
};
`,
    [`plugins/${name}/${helper}.ts`]: 'export const latency = 50;\n'
  });
  const writeRepo = (files: Record<string, string>) => {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), content, 'utf-8');
    }
  };
  fs.mkdirSync(repo, { recursive: true });
  git('init', '-q', '-b', 'main');
  writeRepo({ ...capsuleAt('renamed', 'old-helper', ''), ...capsuleAt('escalated', 'old-helper', '') });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  // El PR renombra el helper en ambas cápsulas; solo `escalated` además pide un permiso nuevo
  fs.rmSync(path.join(repo, 'plugins/renamed/old-helper.ts'));
  fs.rmSync(path.join(repo, 'plugins/escalated/old-helper.ts'));
  writeRepo({ ...capsuleAt('renamed', 'new-helper', ''), ...capsuleAt('escalated', 'new-helper', `'fs:write'`) });
  git('add', '-A');
  git('commit', '-q', '-m', 'rename helper');

  const repoConfig: GatekeeperConfig = { pluginsDir: 'plugins', entryFileName: 'index.ts', allowedExternalPackages: [], keyFlows: {} };
  const previousCwd = process.cwd();
  process.chdir(repo);
  try {
    const res9 = await runGatekeeper(repoConfig, { explicitFiles: ['plugins/renamed/index.ts'] });
    assert.strictEqual(res9.verdict, 'FAST_TRACK', JSON.stringify(res9, null, 2));
    assert.deepStrictEqual(res9.warnings, []);

    const res9b = await runGatekeeper(repoConfig, { explicitFiles: ['plugins/escalated/index.ts'] });
    assert.strictEqual(res9b.verdict, 'ESCALATE_TO_E2E', JSON.stringify(res9b, null, 2));
    assert.deepStrictEqual(res9b.reasons, ['PERMISSIONS_ESCALATED']);

    const res9c = await runGatekeeper(repoConfig, {});
    assert.deepStrictEqual(res9c.touchedCapsules.sort(), ['escalated', 'renamed']);
    assert.ok(res9c.reasons.includes('MULTIPLE_CAPSULES_TOUCHED'));

    const leftovers = fs.readdirSync('plugins').filter(name => name.startsWith('.gatekeeper-base-'));
    assert.deepStrictEqual(leftovers, []);
  } finally {
    process.chdir(previousCwd);
  }
  console.log('✅ Escenario 9 (Baseline desde git con archivo interno renombrado -> diff de manifest correcto): OK');

  // ESCENARIO 10: Un flujo declara dónde empieza y cómo se ve terminado
  const res10 = await runGatekeeper(config, { explicitFiles: ['src/shared/global.css'] });
  assert.deepStrictEqual(res10.affectedKeyFlowDetails, [
    { name: 'instrumentation-amplifier-bench', capabilities: ['electronics.amplifier.solve'] },
    {
      name: 'customer-support-triage-dock',
      capabilities: ['support.ticket.triage'],
      entryUrl: '/support-studio',
      done: 'The triage card shows a category, an urgency and a drafted reply'
    },
    { name: 'full-workspace-composer', capabilities: ['electronics.amplifier.solve', 'support.ticket.triage'] }
  ]);
  // Los nombres siguen saliendo igual que antes: quien solo lee `affectedKeyFlows` no nota el cambio
  assert.deepStrictEqual(res10.affectedKeyFlows, res10.affectedKeyFlowDetails.map(flow => flow.name));
  // FAST_TRACK no pide ningún flujo, en ninguna de las dos formas
  assert.deepStrictEqual(res1.affectedKeyFlowDetails, []);

  // Una config mal formada falla con un mensaje claro, no con un flujo ignorado en silencio
  const badFlows: [string, unknown][] = [
    ['capabilities', { 'flow-x': { entryUrl: '/x' } }],
    ['entryUrl', { 'flow-x': { capabilities: ['cap.a'], entryUrl: 42 } }],
    ['campo desconocido', { 'flow-x': { capabilities: ['cap.a'], url: '/x' } }],
    ['arreglo de capabilities', { 'flow-x': 'cap.a' }]
  ];
  for (const [expected, keyFlows] of badFlows) {
    await assert.rejects(
      runGatekeeper({ ...config, keyFlows: keyFlows as GatekeeperConfig['keyFlows'] }, { explicitFiles: [] }),
      (err: Error) => err.message.includes(expected),
      `se esperaba un error que mencione "${expected}"`
    );
  }
  console.log('✅ Escenario 10 (Flujos con entryUrl y done; forma corta intacta; config inválida -> error claro): OK');

  // ESCENARIO 11: Selección de tests dentro de una cápsula
  const cfg11 = {
    ...writeFixture('selection', {
      'calc/index.ts': pluginSource('plugin-calc', 'cap.calc', `import { add } from './lib/math.js';\nvoid add;`),
      'calc/lib/math.ts': `import { fmt } from './format.js';\nexport const add = (a: number, b: number) => fmt(a + b);\n`,
      'calc/lib/format.ts': 'export const fmt = (n: number) => String(n);\n',
      'calc/lib/orphan.ts': 'export const unused = 1;\n',
      'calc/data/table.json': '{"rows": []}\n',
      'calc/test/math.test.ts': `import { add } from '../lib/math.js';\nvoid add;\n`,
      'calc/test/entry.test.ts': `import { load } from '#runtime';\nvoid load;\n`,
      'calc/test/other.test.ts': `import fs from 'node:fs';\nvoid fs;\n`,
      'dyn/index.ts': pluginSource('plugin-dyn', 'cap.dyn', 'export const pick = (name: string) => import(name);'),
      'dyn/lib/a.ts': 'export const a = 1;\n',
      'dyn/test/a.test.ts': `import { a } from '../lib/a.js';\nvoid a;\n`,
      'dyn/test/b.test.ts': 'export {};\n'
    }),
    allowedExternalPackages: ['#runtime']
  };
  const sel = (files: string[], extra: Partial<GatekeeperConfig> = {}) =>
    selectTests({ ...cfg11, ...extra }, files.map(f => `${cfg11.pluginsDir}/${f}`), cfg11.pluginsDir);
  const short = (r: { selectedTests: SelectedTest[] }) =>
    Object.fromEntries(r.selectedTests.map(t => [t.file.slice(cfg11.pluginsDir.length + 1), t.reason]));

  // Dueño por nombre + consumidor vía el archivo de entrada (import '#runtime')
  assert.deepStrictEqual(short(sel(['calc/lib/math.ts'])), {
    'calc/test/entry.test.ts': 'import-consumer',
    'calc/test/math.test.ts': 'owner'
  });
  // Transitivo: format <- math <- test/math.test.ts
  assert.deepStrictEqual(short(sel(['calc/lib/format.ts'])), {
    'calc/test/entry.test.ts': 'import-consumer',
    'calc/test/math.test.ts': 'import-consumer'
  });
  assert.deepStrictEqual(short(sel(['calc/test/other.test.ts'])), { 'calc/test/other.test.ts': 'changed-test' });

  // Lo que no se puede determinar amplía a todos los tests de la cápsula
  const allCalc = { 'calc/test/entry.test.ts': 'fallback-all', 'calc/test/math.test.ts': 'fallback-all', 'calc/test/other.test.ts': 'fallback-all' };
  const json = sel(['calc/data/table.json']);
  assert.deepStrictEqual(short(json), allCalc);
  assert.match(json.notes[0], /not code and no extraInputs rule/);
  assert.deepStrictEqual(short(sel(['calc/lib/orphan.ts'])), allCalc);
  assert.deepStrictEqual(short(sel(['calc/data/table.json', 'calc/test/other.test.ts'])), {
    ...allCalc,
    'calc/test/other.test.ts': 'changed-test'
  });
  // Con un dueño explícito, el fixture deja de ser desconocido
  assert.deepStrictEqual(short(sel(['calc/data/table.json'], { extraInputs: { calc: { 'data/*.json': ['test/math.test.ts'] } } })), {
    'calc/test/math.test.ts': 'owner'
  });
  // Un import(variable) en la cápsula: el grafo no es confiable
  const dyn = sel(['dyn/lib/a.ts']);
  assert.deepStrictEqual(short(dyn), { 'dyn/test/a.test.ts': 'fallback-all', 'dyn/test/b.test.ts': 'fallback-all' });
  assert.match(dyn.notes[0], /dynamic import/);
  // testFilePatterns propios
  assert.deepStrictEqual(short(sel(['calc/lib/format.ts'], { testFilePatterns: ['**/math.test.ts'] })), {
    'calc/test/math.test.ts': 'import-consumer'
  });

  // El veredicto lleva la selección; un archivo compartido selecciona todo
  const res11 = await runGatekeeper(cfg11, { explicitFiles: [`${cfg11.pluginsDir}/calc/lib/math.ts`], baselineManifests: {} });
  assert.strictEqual(res11.verdict, 'FAST_TRACK', JSON.stringify(res11, null, 2));
  assert.deepStrictEqual(res11.selectedTests.map(t => t.reason), ['import-consumer', 'owner']);
  const res11b = await runGatekeeper(cfg11, { explicitFiles: ['src/shared/global.css', `${cfg11.pluginsDir}/calc/lib/math.ts`] });
  assert.strictEqual(res11b.verdict, 'ESCALATE_TO_E2E');
  assert.ok(res11b.selectedTests.some(t => t.file === 'test/gatekeeper.test.ts' && t.reason === 'fallback-all'));
  assert.ok(res11b.selectionNotes.some(n => n.includes('outside every capsule')));
  // Configs viejas siguen igual; una config de selección mal formada falla claro
  assert.deepStrictEqual(res1.selectedTests, []);
  await assert.rejects(runGatekeeper({ ...config, testFilePatterns: 'x' as unknown as string[] }, { explicitFiles: [] }), /testFilePatterns/);
  await assert.rejects(runGatekeeper({ ...config, extraInputs: { calc: { 'a.json': 'x' } } as never }, { explicitFiles: [] }), /extraInputs/);
  console.log('✅ Escenario 11 (Selección: dueño, consumidor transitivo, test cambiado; lo desconocido amplía a fallback-all): OK');

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
