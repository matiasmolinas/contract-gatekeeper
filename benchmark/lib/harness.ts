// benchmark/lib/harness.ts
// Orquestador de un brazo del experimento. Todo lo que reporta ocurrió de
// verdad: cada historia la implementa un agente en su propio git worktree, se
// verifica con el mecanismo del brazo, se mergea con `git merge` y se juzga con
// un test de aceptación que el agente nunca vio.
import fs from 'node:fs';
import path from 'node:path';
import { exec, runAgent, type AgentCheck, type AgentRun, type ExecResult } from './agent.js';
import { emptyUsage, mergeUsage, type ChatProvider, type UsageTotals } from './llm.js';

export interface Story {
  id: string;
  title: string;
  prompt: string;
  /** Cápsula objetivo: en brazos con locks, las historias con la misma clave se serializan. */
  lockKey?: string;
  /** Test de aceptación oculto (ruta absoluta, fuera del árbol que ve el agente). */
  acceptanceFile: string;
}

export interface GateResult {
  ok: boolean;
  ms: number;
  feedback?: string;                 // lo que se le devuelve al agente si no pasa
  detail: Record<string, unknown>;
}

export interface Arm {
  name: string;
  sourceDir: string;
  systemPrompt: string;
  checks: Record<string, AgentCheck>;
  suiteCommand: string[];            // batería completa del árbol
  acceptanceDir: string;             // dónde se deja el test oculto para correrlo
  acceptanceCommand(fileInRepo: string): string[];
  /** Verificación de la rama de la historia antes del merge. */
  preMerge(worktree: string, story: Story): Promise<GateResult>;
  /** Verificación del resultado del merge cuando main avanzó desde que la rama salió. */
  postMerge?(repo: string, story: Story, preMerge: GateResult): Promise<GateResult | null>;
  lock?: {
    acquire(repo: string, key: string, agentId: string): Promise<ExecResult>;
    release(repo: string, key: string, agentId: string): Promise<ExecResult>;
  };
}

export type AttemptOutcome =
  | 'merged'
  | 'agent_error'
  | 'no_changes'
  | 'gate_failed'
  | 'merge_conflict'
  | 'post_merge_failed';

export interface AttemptRecord {
  attempt: number;
  baseSha: string;
  outcome: AttemptOutcome;
  agent: AgentRun;
  changedFiles: string[];
  patch: string;
  gate: GateResult | null;
  postMerge: GateResult | null;
  mainMovedSinceBase: boolean;
  mergeQueueWaitMs: number;
  conflictFiles: string[];
}

export interface StoryResult {
  storyId: string;
  title: string;
  lockKey: string | null;
  lockWaitMs: number;
  attempts: AttemptRecord[];
  merged: boolean;
  acceptanceAtMerge: boolean | null;
  acceptanceFinal: boolean | null;
  usage: UsageTotals;
  wallMs: number;
}

export interface ArmResult {
  arm: string;
  provider: string;
  live: boolean;
  models: string[];
  baselineSuiteMs: number;
  stories: StoryResult[];
  finalSuite: { passed: boolean; ms: number };
  usage: UsageTotals;
  wallMs: number;
}

export interface RunArmOptions {
  workDir: string;       // directorio desechable para el repo y sus worktrees
  concurrency?: number;  // agentes en paralelo
  maxAttempts?: number;  // intentos por historia (el primero más los reintentos)
  maxTurns?: number;
  log?: (line: string) => void;
}

/** Exclusión mutua en proceso: las tareas esperan su turno en orden de llegada. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => (release = resolve));
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

const git = (cwd: string, ...args: string[]) =>
  exec('git', ['-c', 'user.name=benchmark', '-c', 'user.email=benchmark@example.invalid', ...args], { cwd });

async function gitOk(cwd: string, ...args: string[]): Promise<string> {
  const result = await git(cwd, ...args);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} falló (${result.code}): ${result.output.slice(-500)}`);
  return result.output.trim();
}

export async function runArm(
  arm: Arm,
  stories: Story[],
  provider: ChatProvider,
  options: RunArmOptions
): Promise<ArmResult> {
  const t0 = performance.now();
  const log = options.log ?? (() => {});
  const maxAttempts = options.maxAttempts ?? 3;
  const repo = path.join(options.workDir, 'repo');
  const worktrees = path.join(options.workDir, 'wt');

  // Repo del brazo: copia limpia del árbol fuente con un único commit base
  fs.rmSync(options.workDir, { recursive: true, force: true });
  fs.mkdirSync(worktrees, { recursive: true });
  fs.cpSync(arm.sourceDir, repo, {
    recursive: true,
    filter: source => !['node_modules', '.git'].includes(path.basename(source))
  });
  await gitOk(repo, 'init', '-q', '-b', 'main');
  fs.appendFileSync(
    path.join(repo, '.git', 'info', 'exclude'),
    `\n.gatekeeper-*\n${arm.acceptanceDir}/__acceptance__*\n`
  );
  await gitOk(repo, 'add', '-A');
  await gitOk(repo, 'commit', '-q', '-m', 'base');

  const runSuite = (cwd: string) => exec(arm.suiteCommand[0], arm.suiteCommand.slice(1), { cwd });
  const baseline = await runSuite(repo);
  if (baseline.code !== 0) {
    throw new Error(`[${arm.name}] la batería base no pasa; el experimento no puede empezar:\n${baseline.output.slice(-1500)}`);
  }

  const runAcceptance = async (story: Story): Promise<boolean> => {
    const relative = path.posix.join(arm.acceptanceDir, `__acceptance__${path.basename(story.acceptanceFile)}`);
    const target = path.join(repo, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(story.acceptanceFile, target);
    try {
      const command = arm.acceptanceCommand(relative);
      return (await exec(command[0], command.slice(1), { cwd: repo })).code === 0;
    } finally {
      fs.rmSync(target, { force: true });
    }
  };

  const mergeQueue = new Mutex();
  const capsuleLocks = new Map<string, Mutex>();
  const models = new Set<string>();

  const runStory = async (story: Story): Promise<StoryResult> => {
    const startedAt = performance.now();
    const result: StoryResult = {
      storyId: story.id,
      title: story.title,
      lockKey: arm.lock && story.lockKey ? story.lockKey : null,
      lockWaitMs: 0,
      attempts: [],
      merged: false,
      acceptanceAtMerge: null,
      acceptanceFinal: null,
      usage: emptyUsage(),
      wallMs: 0
    };
    const agentId = `agent-${story.id}`;

    const work = async () => {
      let feedback = '';
      for (let attempt = 1; attempt <= maxAttempts && !result.merged; attempt++) {
        const branch = `story/${story.id}-a${attempt}`;
        const worktree = path.join(worktrees, `${story.id}-a${attempt}`);
        const baseSha = await gitOk(repo, 'rev-parse', 'main');
        await gitOk(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'main');

        const record: AttemptRecord = {
          attempt,
          baseSha,
          outcome: 'agent_error',
          agent: await runAgent({
            root: worktree,
            systemPrompt: arm.systemPrompt,
            task: feedback ? `${story.prompt}\n\nA previous attempt was not accepted:\n${feedback}` : story.prompt,
            provider,
            checks: arm.checks,
            maxTurns: options.maxTurns
          }),
          changedFiles: [],
          patch: '',
          gate: null,
          postMerge: null,
          mainMovedSinceBase: false,
          mergeQueueWaitMs: 0,
          conflictFiles: []
        };
        result.attempts.push(record);
        mergeUsage(result.usage, record.agent.usage);
        for (const turn of record.agent.turns) if (turn.model) models.add(turn.model);

        try {
          if (record.agent.stopReason === 'provider_error') {
            feedback = `The run stopped with an error: ${record.agent.error}`;
            continue;
          }

          await gitOk(worktree, 'add', '-A');
          if ((await git(worktree, 'diff', '--cached', '--quiet')).code === 0) {
            record.outcome = 'no_changes';
            feedback = 'No files were changed.';
            continue;
          }
          await gitOk(worktree, 'commit', '-q', '-m', `${story.id}: ${story.title}`);
          record.changedFiles = (await gitOk(repo, 'diff', '--name-only', baseSha, branch)).split('\n').filter(Boolean);
          record.patch = (await gitOk(repo, 'diff', baseSha, branch)).slice(0, 200_000);

          record.gate = await arm.preMerge(worktree, story);
          if (!record.gate.ok) {
            record.outcome = 'gate_failed';
            feedback = record.gate.feedback ?? 'The verification step failed.';
            continue;
          }

          const queuedAt = performance.now();
          await mergeQueue.run(async () => {
            record.mergeQueueWaitMs = Math.round(performance.now() - queuedAt);
            const mainBefore = await gitOk(repo, 'rev-parse', 'main');
            record.mainMovedSinceBase = mainBefore !== baseSha;

            const merge = await git(repo, 'merge', '--no-ff', '-q', '-m', `merge ${story.id}`, branch);
            if (merge.code !== 0) {
              record.conflictFiles = (await git(repo, 'diff', '--name-only', '--diff-filter=U')).output
                .split('\n')
                .filter(Boolean);
              await git(repo, 'merge', '--abort');
              record.outcome = 'merge_conflict';
              feedback = `Your change conflicted with other changes merged into main while you worked (files: ${record.conflictFiles.join(', ') || 'unknown'}). You are now on the updated main: apply the change again on top of it.`;
              return;
            }

            if (record.mainMovedSinceBase && arm.postMerge) {
              record.postMerge = await arm.postMerge(repo, story, record.gate!);
              if (record.postMerge && !record.postMerge.ok) {
                await gitOk(repo, 'reset', '-q', '--hard', mainBefore);
                record.outcome = 'post_merge_failed';
                feedback = record.postMerge.feedback ?? 'The verification of the merged result failed.';
                return;
              }
            }

            record.outcome = 'merged';
            result.merged = true;
            result.acceptanceAtMerge = await runAcceptance(story);
          });
        } finally {
          await git(repo, 'worktree', 'remove', '--force', worktree);
          log(`[${arm.name}] ${story.id} intento ${attempt}: ${record.outcome}`);
        }
      }
    };

    if (arm.lock && story.lockKey) {
      const key = story.lockKey;
      if (!capsuleLocks.has(key)) capsuleLocks.set(key, new Mutex());
      const waitingSince = performance.now();
      await capsuleLocks.get(key)!.run(async () => {
        result.lockWaitMs = Math.round(performance.now() - waitingSince);
        const acquired = await arm.lock!.acquire(repo, key, agentId);
        if (acquired.code !== 0) throw new Error(`[${arm.name}] no se pudo tomar el lock de '${key}': ${acquired.output}`);
        try {
          await work();
        } finally {
          await arm.lock!.release(repo, key, agentId);
        }
      });
    } else {
      await work();
    }

    result.wallMs = Math.round(performance.now() - startedAt);
    return result;
  };

  // Enjambre: hasta `concurrency` agentes a la vez
  const results: StoryResult[] = new Array(stories.length);
  let next = 0;
  const worker = async () => {
    while (next < stories.length) {
      const index = next++;
      results[index] = await runStory(stories[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, stories.length) }, worker));

  // Estado final de main: batería completa y todos los tests de aceptación otra vez
  const finalSuite = await runSuite(repo);
  for (const [index, story] of stories.entries()) {
    if (results[index].merged) results[index].acceptanceFinal = await runAcceptance(story);
  }

  const usage = emptyUsage();
  for (const story of results) mergeUsage(usage, story.usage);

  return {
    arm: arm.name,
    provider: provider.name,
    live: provider.live,
    models: [...models].sort(),
    baselineSuiteMs: baseline.ms,
    stories: results,
    finalSuite: { passed: finalSuite.code === 0, ms: finalSuite.ms },
    usage,
    wallMs: Math.round(performance.now() - t0)
  };
}

// ---------------------------------------------------------------------------
// Brazos
// ---------------------------------------------------------------------------

export interface ClassicArmOptions {
  /** Nombre del brazo; por defecto 'classic'. */
  name?: string;
  sourceDir: string;
  systemPrompt: string;
  suiteCommand: string[];
  acceptanceDir: string;
  acceptanceCommand(fileInRepo: string): string[];
}

/** Brazo clásico: toda rama corre la batería completa, antes y después del merge. */
export function classicArm(options: ClassicArmOptions): Arm {
  const suite = async (cwd: string): Promise<GateResult> => {
    const result = await exec(options.suiteCommand[0], options.suiteCommand.slice(1), { cwd });
    return {
      ok: result.code === 0,
      ms: result.ms,
      feedback: result.code === 0 ? undefined : `The test suite failed:\n${result.output.slice(-3000)}`,
      detail: { check: 'full-suite', exitCode: result.code }
    };
  };
  return {
    name: 'classic',
    ...options,
    checks: { run_tests: { description: 'Run the full test suite of the repository.', command: options.suiteCommand } },
    preMerge: worktree => suite(worktree),
    postMerge: repo => suite(repo)
  };
}

export interface PluginArmOptions extends ClassicArmOptions {
  /** Prefijo del comando del gatekeeper, p. ej. ['node', '/abs/dist/cli.js'] */
  gatekeeperCommand: string[];
  /** false = sin locks de cápsula: las historias corren en paralelo y git decide. Por defecto true. */
  locks?: boolean;
}

/**
 * Brazo de plugins: la rama pasa por `contract-gatekeeper check --base main`.
 * FAST_TRACK mergea sin más; ESCALATE_TO_E2E corre además la batería completa
 * (aquí hace de chequeo escalado); REJECTED vuelve al agente con el reporte.
 */
export function pluginArm(options: PluginArmOptions): Arm {
  const [gk, ...gkArgs] = options.gatekeeperCommand;
  const suite = (cwd: string) => exec(options.suiteCommand[0], options.suiteCommand.slice(1), { cwd });

  return {
    name: options.name ?? 'plugins',
    sourceDir: options.sourceDir,
    systemPrompt: options.systemPrompt,
    suiteCommand: options.suiteCommand,
    acceptanceDir: options.acceptanceDir,
    acceptanceCommand: options.acceptanceCommand,
    checks: {
      run_tests: { description: 'Run the full test suite of the repository.', command: options.suiteCommand },
      run_gatekeeper: {
        description: 'Run the contract gatekeeper on your uncommitted changes (the same check that gates the merge).',
        command: [...options.gatekeeperCommand, 'check', '--base', 'main', '--working-tree']
      }
    },
    async preMerge(worktree) {
      const check = await exec(gk, [...gkArgs, 'check', '--base', 'main', '--json'], { cwd: worktree });
      let verdict: Record<string, any>;
      try {
        verdict = JSON.parse(check.output.slice(check.output.indexOf('{'), check.output.lastIndexOf('}') + 1));
      } catch {
        return {
          ok: false,
          ms: check.ms,
          feedback: `The contract gatekeeper could not run:\n${check.output.slice(-2000)}`,
          detail: { check: 'gatekeeper', error: 'unparseable-output' }
        };
      }
      const detail: Record<string, unknown> = {
        check: 'gatekeeper',
        verdict: verdict.verdict,
        reasons: verdict.reasons,
        humanReviewLoad: verdict.humanReviewLoad,
        touchedCapsules: verdict.touchedCapsules,
        outOfCapsuleFiles: verdict.outOfCapsuleFiles,
        affectedKeyFlows: verdict.affectedKeyFlows,
        gatekeeperInternalMs: verdict.totalVerificationTimeMs,
        gatekeeperWallMs: check.ms
      };

      if (verdict.verdict === 'REJECTED') {
        return {
          ok: false,
          ms: check.ms,
          feedback: `The contract gatekeeper rejected the change.\nReasons: ${verdict.reasons?.join(', ')}\n${JSON.stringify(
            { importViolations: verdict.importViolations, warnings: verdict.warnings, selfTestReports: verdict.selfTestReports },
            null,
            2
          ).slice(0, 3000)}`,
          detail
        };
      }
      if (verdict.verdict === 'ESCALATE_TO_E2E') {
        const escalated = await suite(worktree);
        detail.escalatedSuiteMs = escalated.ms;
        detail.escalatedSuiteExitCode = escalated.code;
        return {
          ok: escalated.code === 0,
          ms: check.ms + escalated.ms,
          feedback: escalated.code === 0 ? undefined : `The escalated test suite failed:\n${escalated.output.slice(-3000)}`,
          detail
        };
      }
      return { ok: true, ms: check.ms, detail };
    },
    // Un cambio contenido en su cápsula no se re-verifica aunque main haya avanzado: esa
    // es la apuesta de la arquitectura. Los escalados sí repiten la batería sobre el merge.
    async postMerge(repo, _story, preMerge) {
      if (preMerge.detail.verdict !== 'ESCALATE_TO_E2E') return null;
      const result = await suite(repo);
      return {
        ok: result.code === 0,
        ms: result.ms,
        feedback: result.code === 0 ? undefined : `The test suite failed on the merged result:\n${result.output.slice(-3000)}`,
        detail: { check: 'full-suite', exitCode: result.code }
      };
    },
    lock: options.locks === false ? undefined : {
      acquire: (repo, key, agentId) => exec(gk, [...gkArgs, 'lock', key, agentId], { cwd: repo }),
      release: (repo, key, agentId) => exec(gk, [...gkArgs, 'unlock', key, agentId], { cwd: repo })
    }
  };
}
