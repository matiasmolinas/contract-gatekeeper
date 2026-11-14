// benchmark/run.ts
// Corrida real del experimento A/B. Requiere OPENROUTER_API_KEY o DEEPSEEK_API_KEY.
//
//   npx tsx benchmark/run.ts [--runs 3] [--arms classic,plugins] [--stories S01,S02]
//                            [--concurrency 4] [--max-turns 30] [--out <dir>]
//
// Cada corrida ejecuta las historias en los dos brazos con el mismo modelo, el
// mismo prompt de sistema y las mismas herramientas. Guarda el resultado crudo
// de cada brazo (cada turno con su `usage`, cada parche, cada veredicto) y un
// resumen. Nada del resumen se estima: todo sale de lo que ocurrió.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { classicArm, pluginArm, runArm, type Arm, type ArmResult, type Story } from './lib/harness.js';
import { createProviderFromEnv } from './lib/llm.js';
import { STORIES, acceptanceSource, type ArmName } from './stories.js';

const ROOT = process.cwd();
const flag = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const RUNS = Number(flag('runs', '1'));
const ARMS = flag('arms', 'classic,plugins').split(',') as ArmName[];
const ONLY = flag('stories', '').split(',').filter(Boolean);
const CONCURRENCY = Number(flag('concurrency', '4'));
const MAX_TURNS = Number(flag('max-turns', '30'));
const MAX_ATTEMPTS = 3;

// El mismo prompt para los dos brazos: la única diferencia entre ellos es el árbol.
const SYSTEM_PROMPT = `You are a software engineer working alone in a git repository. Other engineers are changing the same repository in parallel.

Start by reading ARCHITECTURE.md. Then make the change you are asked for:
- Follow the conventions and rules of the repository.
- Keep the existing tests passing and add tests for your change next to the existing ones.
- Change only what the task needs.
- Run the checks available to you before finishing, and call finish when they pass.`;

const SUITE: Record<ArmName, string[]> = {
  coupled: ['node', '--test', 'test/'],
  classic: ['node', '--test', 'test/'],
  plugins: ['node', '--test', 'plugins/*/test/*.test.js', 'test/*.test.js']
};

function buildArm(name: ArmName): Arm {
  const common = {
    sourceDir: path.join(ROOT, 'benchmark/repos', name),
    systemPrompt: SYSTEM_PROMPT,
    suiteCommand: SUITE[name],
    acceptanceDir: 'test',
    acceptanceCommand: (file: string) => ['node', '--test', file]
  };
  return name !== 'plugins'
    ? classicArm({ ...common, name })
    : pluginArm({ ...common, gatekeeperCommand: ['node', path.join(ROOT, 'dist/cli.js')] });
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Métricas de un brazo en una corrida, todas derivadas del resultado crudo. */
function metrics(result: ArmResult) {
  const attempts = result.stories.flatMap(s => s.attempts);
  const outcome = (o: string) => attempts.filter(a => a.outcome === o).length;
  const fullSuite = (detail: Record<string, unknown> | undefined) =>
    detail && (detail.check === 'full-suite' || typeof detail.escalatedSuiteMs === 'number') ? 1 : 0;
  const verdicts: Record<string, number> = {};
  for (const a of attempts) {
    const verdict = a.gate?.detail.verdict;
    if (typeof verdict === 'string') verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
  }
  return {
    stories: result.stories.length,
    merged: result.stories.filter(s => s.merged).length,
    acceptedAtMerge: result.stories.filter(s => s.acceptanceAtMerge).length,
    acceptedFinal: result.stories.filter(s => s.acceptanceFinal).length,
    finalSuitePassed: result.finalSuite.passed,
    attempts: attempts.length,
    mergeConflicts: outcome('merge_conflict'),
    gateFailures: outcome('gate_failed'),
    postMergeFailures: outcome('post_merge_failed'),
    agentErrors: outcome('agent_error') + outcome('no_changes'),
    llmCalls: result.usage.calls,
    llmCallsWithoutUsage: result.usage.callsWithoutUsage,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    totalTokens: result.usage.totalTokens,
    cacheHitTokens: result.usage.cacheHitTokens,
    costUsd: Number(result.usage.costUsd.toFixed(6)),
    filesReadPerAttempt: Number((attempts.reduce((n, a) => n + a.agent.filesRead.length, 0) / Math.max(1, attempts.length)).toFixed(2)),
    charsRead: attempts.reduce((n, a) => n + a.agent.charsRead, 0),
    searches: attempts.reduce((n, a) => n + (a.agent.searches ?? 0), 0),
    attemptsCutOffAtTurnLimit: attempts.filter(a => a.agent.stopReason === 'max_turns').length,
    verificationMs: attempts.reduce((n, a) => n + (a.gate?.ms ?? 0) + (a.postMerge?.ms ?? 0), 0),
    fullSuiteRuns: attempts.reduce((n, a) => n + fullSuite(a.gate?.detail) + fullSuite(a.postMerge?.detail), 0),
    lockWaitMs: result.stories.reduce((n, s) => n + s.lockWaitMs, 0),
    mergeQueueWaitMs: attempts.reduce((n, a) => n + a.mergeQueueWaitMs, 0),
    wallMs: result.wallMs,
    gatekeeperVerdicts: verdicts
  };
}

async function main() {
  const provider = createProviderFromEnv();
  execFileSync('npm', ['run', 'build', '--silent'], { cwd: ROOT, stdio: 'inherit' });

  const stories = STORIES.filter(s => ONLY.length === 0 || ONLY.includes(s.id));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(ROOT, flag('out', path.join('benchmark/results', stamp)));
  const workRoot = path.join(ROOT, 'benchmark/.work', `run-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const meta = {
    startedAt: new Date().toISOString(),
    provider: provider.name,
    temperature: Number(process.env.BENCH_TEMPERATURE ?? 0),
    runs: RUNS,
    arms: ARMS,
    stories: stories.map(s => s.id),
    concurrency: CONCURRENCY,
    maxTurnsPerAttempt: MAX_TURNS,
    maxAttemptsPerStory: MAX_ATTEMPTS,
    systemPrompt: SYSTEM_PROMPT,
    node: process.version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim(),
    dirtyTree: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf-8' }).trim().length > 0
  };

  const perRun: { run: number; arm: ArmName; metrics: ReturnType<typeof metrics>; models: string[] }[] = [];
  for (let run = 1; run <= RUNS; run++) {
    // Se rota qué brazo va primero para no cargarle a uno solo los efectos de horario
    const shift = (run - 1) % ARMS.length;
    const order = [...ARMS.slice(shift), ...ARMS.slice(0, shift)];
    for (const armName of order) {
      const workDir = path.join(workRoot, `run${run}-${armName}`);
      const acceptanceDir = path.join(workRoot, `acceptance-run${run}-${armName}`);
      fs.mkdirSync(acceptanceDir, { recursive: true });
      const armStories: Story[] = stories.map(s => {
        const acceptanceFile = path.join(acceptanceDir, `${s.id}.test.js`);
        fs.writeFileSync(acceptanceFile, acceptanceSource(s, armName), 'utf-8');
        return { id: s.id, title: s.title, prompt: s.prompt, lockKey: s.capsule ?? undefined, acceptanceFile };
      });

      console.log(`\n=== corrida ${run}/${RUNS} · brazo ${armName} · ${armStories.length} historias ===`);
      const result = await runArm(buildArm(armName), armStories, provider, {
        workDir,
        concurrency: CONCURRENCY,
        maxAttempts: MAX_ATTEMPTS,
        maxTurns: MAX_TURNS,
        log: line => console.log(line)
      });
      fs.writeFileSync(path.join(outDir, `run${run}-${armName}.json`), JSON.stringify(result, null, 2), 'utf-8');
      const m = metrics(result);
      perRun.push({ run, arm: armName, metrics: m, models: result.models });
      console.log(
        `    mergeadas ${m.merged}/${m.stories} · aceptadas ${m.acceptedFinal}/${m.stories} · tokens ${m.totalTokens.toLocaleString('en-US')} · conflictos ${m.mergeConflicts} · US$ ${m.costUsd}`
      );
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
  fs.rmSync(workRoot, { recursive: true, force: true });

  const summary = { ...meta, finishedAt: new Date().toISOString(), models: [...new Set(perRun.flatMap(r => r.models))], perRun };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outDir, 'summary.md'), renderMarkdown(summary), 'utf-8');
  console.log(`\nResultados en ${path.relative(ROOT, outDir)}`);
}

function renderMarkdown(summary: {
  startedAt: string;
  provider: string;
  models: string[];
  runs: number;
  stories: string[];
  concurrency: number;
  temperature: number;
  commit: string;
  dirtyTree: boolean;
  perRun: { run: number; arm: ArmName; metrics: ReturnType<typeof metrics> }[];
}): string {
  const arms = [...new Set(summary.perRun.map(r => r.arm))];
  const rows: [string, (m: ReturnType<typeof metrics>) => number][] = [
    ['Stories merged', m => m.merged],
    ['Stories passing their hidden acceptance test on final main', m => m.acceptedFinal],
    ['Agent attempts', m => m.attempts],
    ['Real git merge conflicts', m => m.mergeConflicts],
    ['Rejected by the verification step', m => m.gateFailures],
    ['Failed verification after merge', m => m.postMergeFailures],
    ['LLM calls', m => m.llmCalls],
    ['Prompt tokens (API usage)', m => m.promptTokens],
    ['— of which served from cache', m => m.cacheHitTokens],
    ['Completion tokens (API usage)', m => m.completionTokens],
    ['Total tokens (API usage)', m => m.totalTokens],
    ['Cost reported by the provider (US$)', m => m.costUsd],
    ['Files read per attempt', m => m.filesReadPerAttempt],
    ['Characters read from files', m => m.charsRead],
    ['Searches', m => m.searches],
    ['Attempts cut off at the turn limit', m => m.attemptsCutOffAtTurnLimit],
    ['Full test-suite runs during integration', m => m.fullSuiteRuns],
    ['Verification time, summed (ms)', m => m.verificationMs],
    ['Time waiting for a capsule lock, summed (ms)', m => m.lockWaitMs],
    ['Wall-clock time of the arm (ms)', m => m.wallMs]
  ];
  const cell = (arm: ArmName, pick: (m: ReturnType<typeof metrics>) => number) => {
    const values = summary.perRun.filter(r => r.arm === arm).map(r => pick(r.metrics));
    const fmt = (v: number) => (Number.isInteger(v) ? v.toLocaleString('en-US') : String(Number(v.toFixed(4))));
    return values.length > 1 ? `${fmt(median(values))} (${fmt(Math.min(...values))}–${fmt(Math.max(...values))})` : fmt(values[0] ?? 0);
  };
  const lines = [
    '# A/B swarm benchmark — results',
    '',
    `- Started: ${summary.startedAt}`,
    `- Provider: \`${summary.provider}\` · model reported by the API: ${summary.models.map(m => `\`${m}\``).join(', ') || 'n/a'} · temperature ${summary.temperature}`,
    `- Runs per arm: ${summary.runs} · stories: ${summary.stories.length} · parallel agents: ${summary.concurrency}`,
    `- Repository commit: \`${summary.commit}\`${summary.dirtyTree ? ' (with uncommitted changes)' : ''}`,
    '',
    summary.runs > 1 ? 'Cells show the median across runs, with the range in parentheses.' : 'Single run: no measure of run-to-run variation.',
    '',
    `| Metric | ${arms.join(' | ')} |`,
    `| --- | ${arms.map(() => '---').join(' | ')} |`,
    ...rows.map(([label, pick]) => `| ${label} | ${arms.map(arm => cell(arm, pick)).join(' | ')} |`),
    ''
  ];
  const withVerdicts = summary.perRun.filter(r => Object.keys(r.metrics.gatekeeperVerdicts).length > 0);
  if (withVerdicts.length) {
    lines.push('Gatekeeper verdicts per run (every attempt that reached the gate):', '');
    for (const r of withVerdicts) lines.push(`- run ${r.run}: ${Object.entries(r.metrics.gatekeeperVerdicts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    lines.push('');
  }
  lines.push('Raw data: `runN-<arm>.json` holds every turn with the usage object returned by the API, every patch and every verdict.', '');
  return lines.join('\n');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
