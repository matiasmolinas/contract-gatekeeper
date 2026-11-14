// benchmark/test/plumbing.test.ts
// Prueba de tubería del arnés con un "modelo" guionado y repos de juguete.
// No produce resultados del benchmark: solo comprueba que worktrees, merge
// real, locks, gatekeeper y tests de aceptación se encadenan bien.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { resolveInside, runAgent } from '../lib/agent.js';
import { classicArm, pluginArm, runArm, type Story } from '../lib/harness.js';
import type { ChatMessage, ChatProvider, ToolCall } from '../lib/llm.js';

const ROOT = process.cwd();
const WORK = path.join(ROOT, 'benchmark/.work', `plumbing-${process.pid}`);
const NODE_TEST = ['node', '--test', 'test/'];
const GATEKEEPER = [path.join(ROOT, 'node_modules/.bin/tsx'), path.join(ROOT, 'src/cli.ts')];

function write(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content, 'utf-8');
  }
}

let callId = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `call_${callId++}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) }
});

/**
 * Proveedor guionado: cada historia lleva un marcador `[ID]` y un guion de
 * llamadas a herramientas; el paso se deduce de cuántos turnos lleva la conversación.
 */
function scriptedProvider(scripts: Record<string, (retry: boolean) => ToolCall[]>): ChatProvider {
  return {
    name: 'scripted',
    live: false,
    async chat(messages: ChatMessage[]) {
      await new Promise(r => setTimeout(r, 25)); // deja que los agentes se solapen
      const task = messages[1].content ?? '';
      const id = Object.keys(scripts).find(key => task.includes(`[${key}]`));
      if (!id) throw new Error(`sin guion para: ${task.slice(0, 80)}`);
      const steps = scripts[id](task.includes('A previous attempt was not accepted'));
      const step = messages.filter(m => m.role === 'assistant').length;
      return {
        message: { role: 'assistant', content: null, tool_calls: [steps[step] ?? call('finish', { summary: 'done' })] },
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 },
        model: 'scripted-1',
        finishReason: 'tool_calls',
        latencyMs: 25
      };
    }
  };
}

const appendBeforeEnd = (file: string, code: string) => [
  call('read_file', { path: file }),
  call('replace_in_file', { path: file, old_text: '// END', new_text: `${code}\n// END` }),
  call('run_tests', {}),
  call('finish', { summary: 'added' })
];

function acceptance(name: string, importPath: string, fn: string, args: number[], expected: number): string {
  const file = path.join(WORK, 'acceptance', `${name}.test.js`);
  write(path.dirname(file), {
    [`${name}.test.js`]: `import test from 'node:test';\nimport assert from 'node:assert';\nimport { ${fn} } from '${importPath}';\ntest('${fn}', () => assert.strictEqual(${fn}(${args.join(', ')}), ${expected}));\n`
  });
  return file;
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });

  // --- El agente no puede salir de su worktree ------------------------------
  const sandbox = path.join(WORK, 'sandbox');
  write(sandbox, { 'a.txt': 'x' });
  assert.throws(() => resolveInside(sandbox, '../outside.txt'), /escapes/);
  assert.throws(() => resolveInside(sandbox, '/etc/passwd'), /escapes/);
  assert.throws(() => resolveInside(sandbox, '.git/config'), /not accessible/);
  assert.ok(resolveInside(sandbox, 'sub/new.txt').endsWith(path.join('sub', 'new.txt')));
  console.log('✅ Sandbox de rutas del agente: OK');

  // --- Herramienta de búsqueda ----------------------------------------------
  write(sandbox, { 'src/big.js': 'const a = 1\nexport function target(x) { return x }\nconst b = 2\n' });
  const searchRun = await runAgent({
    root: sandbox,
    systemPrompt: 'test',
    task: '[SEARCH]',
    provider: scriptedProvider({ SEARCH: () => [call('search', { pattern: 'function \\w+\\(' }), call('search', { pattern: 'nope', path: 'src' }), call('search', { pattern: 'x', path: '../..' })] }),
    checks: {}
  });
  assert.strictEqual(searchRun.searches, 2);
  assert.deepStrictEqual(searchRun.turns.map(t => t.toolCalls[0].ok), [true, true, false, true]);
  console.log('✅ Herramienta de búsqueda (regex, acotada al repo): OK');

  // --- Brazo clásico: dos historias en paralelo sobre el mismo archivo ------
  const classicSrc = path.join(WORK, 'src-classic');
  write(classicSrc, {
    'package.json': '{ "type": "module" }\n',
    'calc.js': 'export function add(a, b) { return a + b; }\n// END\n',
    'test/calc.test.js':
      "import test from 'node:test';\nimport assert from 'node:assert';\nimport { add } from '../calc.js';\ntest('add', () => assert.strictEqual(add(1, 2), 3));\n"
  });
  const classicStories: Story[] = [
    { id: 'C1', title: 'sub', prompt: '[C1] add sub', acceptanceFile: acceptance('c1', '../calc.js', 'sub', [5, 2], 3) },
    { id: 'C2', title: 'mul', prompt: '[C2] add mul', acceptanceFile: acceptance('c2', '../calc.js', 'mul', [5, 2], 10) }
  ];
  const classic = await runArm(
    classicArm({
      sourceDir: classicSrc,
      systemPrompt: 'test',
      suiteCommand: NODE_TEST,
      acceptanceDir: 'test',
      acceptanceCommand: file => ['node', '--test', file]
    }),
    classicStories,
    scriptedProvider({
      C1: () => appendBeforeEnd('calc.js', 'export function sub(a, b) { return a - b; }'),
      C2: () => appendBeforeEnd('calc.js', 'export function mul(a, b) { return a * b; }')
    }),
    { workDir: path.join(WORK, 'classic'), concurrency: 2 }
  );

  const outcomes = classic.stories.map(s => s.attempts.map(a => a.outcome).join('>')).sort();
  assert.deepStrictEqual(outcomes, ['merge_conflict>merged', 'merged'], JSON.stringify(outcomes));
  const conflicted = classic.stories.find(s => s.attempts.length === 2)!;
  assert.deepStrictEqual(conflicted.attempts[0].conflictFiles, ['calc.js']);
  assert.ok(classic.stories.every(s => s.merged && s.acceptanceAtMerge && s.acceptanceFinal));
  assert.strictEqual(classic.finalSuite.passed, true);
  // 3 intentos × 4 turnos × 15 tokens: la suma sale solo de los `usage` devueltos
  assert.strictEqual(classic.usage.calls, 12);
  assert.strictEqual(classic.usage.totalTokens, 180);
  assert.strictEqual(classic.usage.cacheHitTokens, 48);
  assert.strictEqual(classic.live, false);
  console.log('✅ Brazo clásico (conflicto real de git merge -> reintento sobre main nuevo): OK');

  // --- Brazo de plugins: locks, FAST_TRACK, ESCALATE y REJECTED -------------
  const capsule = (id: string) => `export const plugin = {
  manifest: {
    id: 'plugin-${id}', capability: 'cap.${id}', version: '1.0.0', mode: 'deterministic-js',
    dependsOn: [], permissions: [], inputSchema: { x: 'number' }, outputSchema: { y: 'number' },
    budget: { maxLatencyMs: 50, maxTokensPerCall: 0 }
  },
  async selfTest() { return { passed: double(2) === 4, assertionsRun: 1, durationMs: 0, details: [] }; }
};
export function double(x) { return x * 2; }
// END
`;
  const pluginSrc = path.join(WORK, 'src-plugins');
  write(pluginSrc, {
    'package.json': '{ "type": "module" }\n',
    'gatekeeper.config.json': JSON.stringify({
      pluginsDir: 'plugins',
      entryFileName: 'index.js',
      allowedExternalPackages: [],
      keyFlows: { 'flow-a': ['cap.a'], 'flow-b': ['cap.b'] }
    }),
    'plugins/a/index.js': capsule('a'),
    'plugins/b/index.js': capsule('b'),
    'shared/util.js': 'export const VERSION = 1;\n// END\n',
    'test/a.test.js':
      "import test from 'node:test';\nimport assert from 'node:assert';\nimport { double } from '../plugins/a/index.js';\ntest('double', () => assert.strictEqual(double(2), 4));\n"
  });
  const pluginStories: Story[] = [
    { id: 'P1', title: 'triple', prompt: '[P1]', lockKey: 'a', acceptanceFile: acceptance('p1', '../plugins/a/index.js', 'triple', [2], 6) },
    { id: 'P2', title: 'quad', prompt: '[P2]', lockKey: 'a', acceptanceFile: acceptance('p2', '../plugins/a/index.js', 'quad', [2], 8) },
    { id: 'P3', title: 'shared', prompt: '[P3]', acceptanceFile: acceptance('p3', '../shared/util.js', 'bump', [1], 2) },
    { id: 'P4', title: 'illegal import', prompt: '[P4]', lockKey: 'b', acceptanceFile: acceptance('p4', '../plugins/b/index.js', 'half', [4], 2) }
  ];
  const plugins = await runArm(
    pluginArm({
      sourceDir: pluginSrc,
      systemPrompt: 'test',
      suiteCommand: NODE_TEST,
      acceptanceDir: 'test',
      acceptanceCommand: file => ['node', '--test', file],
      gatekeeperCommand: GATEKEEPER
    }),
    pluginStories,
    scriptedProvider({
      P1: () => appendBeforeEnd('plugins/a/index.js', 'export function triple(x) { return x * 3; }'),
      P2: () => appendBeforeEnd('plugins/a/index.js', 'export function quad(x) { return x * 4; }'),
      P3: () => appendBeforeEnd('shared/util.js', 'export function bump(x) { return x + 1; }'),
      P4: retry =>
        retry
          ? appendBeforeEnd('plugins/b/index.js', 'export function half(x) { return x / 2; }')
          : [
              ...appendBeforeEnd(
                'plugins/b/index.js',
                "import { double as d } from '../a/index.js';\nexport function half(x) { return d(x) / 4; }"
              ).slice(0, 2),
              call('run_gatekeeper', {}),
              call('finish', { summary: 'done' })
            ]
    }),
    { workDir: path.join(WORK, 'plugins'), concurrency: 4 }
  );

  const byId = Object.fromEntries(plugins.stories.map(s => [s.storyId, s]));
  const verdict = (id: string, attempt = 0) => byId[id].attempts[attempt].gate?.detail.verdict;

  // Misma cápsula: el lock las serializa, no hay conflicto de merge y la espera queda medida
  assert.deepStrictEqual([byId.P1.attempts.length, byId.P2.attempts.length], [1, 1]);
  assert.deepStrictEqual([verdict('P1'), verdict('P2')], ['FAST_TRACK', 'FAST_TRACK']);
  assert.ok(Math.max(byId.P1.lockWaitMs, byId.P2.lockWaitMs) > 50, 'una de las dos debió esperar el lock');
  // Código compartido: escala y corre la batería completa
  assert.strictEqual(verdict('P3'), 'ESCALATE_TO_E2E');
  assert.deepStrictEqual(byId.P3.attempts[0].gate?.detail.affectedKeyFlows, ['flow-a', 'flow-b']);
  assert.strictEqual(typeof byId.P3.attempts[0].gate?.detail.escalatedSuiteMs, 'number');
  // Import ilegal: rechazado, vuelve al agente y el segundo intento entra
  assert.deepStrictEqual(byId.P4.attempts.map(a => a.outcome), ['gate_failed', 'merged']);
  assert.strictEqual(verdict('P4', 0), 'REJECTED');
  assert.ok(plugins.stories.every(s => s.merged && s.acceptanceAtMerge && s.acceptanceFinal));
  assert.strictEqual(plugins.finalSuite.passed, true);
  assert.ok(!fs.existsSync(path.join(WORK, 'plugins/repo/.gatekeeper-locks.json')) ||
    fs.readFileSync(path.join(WORK, 'plugins/repo/.gatekeeper-locks.json'), 'utf-8').trim() === '{}');
  console.log('✅ Brazo de plugins (lock serializa, FAST_TRACK, ESCALATE con batería, REJECTED -> reintento): OK');

  console.log('\n🎉 Tubería del benchmark verificada (proveedor guionado: esto no es un resultado).');
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(WORK, { recursive: true, force: true }));
