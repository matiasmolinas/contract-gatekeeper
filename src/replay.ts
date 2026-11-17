// src/replay.ts
// Replay de cambios pasados: para cada caso { base, head } se calcula el
// veredicto y la selección de tests tal como los habría dado el gatekeeper, y
// se exige lo que el caso declara. El repositorio no se toca: el árbol de
// `head` se materializa con `git archive` en un directorio temporal.
import fs from 'node:fs';
import path from 'node:path';
import { runGatekeeper, trackTempArtifact, untrackTempArtifact } from './engine.js';
import { materializeTree, refExists, repoPrefix } from './git-inspector.js';
import type { GatekeeperConfig, GatekeeperVerdict } from './types.js';

export interface ReplayCase {
  name: string;
  base: string;
  head: string;
  /** El cambio cruza una frontera: FAST_TRACK es un error. */
  mustEscalate?: boolean;
  /** Tests (rutas relativas a la raíz) que la selección tiene que incluir. */
  mustSelect?: string[];
}

export interface ReplayOutcome {
  name: string;
  ok: boolean;
  verdict: GatekeeperVerdict['verdict'] | null;
  reasons: string[];
  selectedTests: GatekeeperVerdict['selectedTests'];
  failures: string[];
}

export const REPLAY_PREFIX = '.gatekeeper-replay-';
let replayCounter = 0;

/** Valida el archivo de casos: un arreglo o `{ cases: [...] }`. */
export function parseReplayCases(raw: unknown): { cases: ReplayCase[]; errors: string[] } {
  const list = Array.isArray(raw) ? raw : (raw as { cases?: unknown })?.cases;
  if (!Array.isArray(list)) return { cases: [], errors: ['expected an array of cases or { "cases": [...] }'] };
  const errors: string[] = [];
  const cases: ReplayCase[] = [];
  list.forEach((c: Partial<ReplayCase>, i) => {
    const label = typeof c?.name === 'string' && c.name ? c.name : `case #${i + 1}`;
    if (typeof c?.name !== 'string' || !c.name) errors.push(`${label}: "name" is required`);
    if (typeof c?.base !== 'string' || !c.base) errors.push(`${label}: "base" is required`);
    if (typeof c?.head !== 'string' || !c.head) errors.push(`${label}: "head" is required`);
    if (c?.mustEscalate !== undefined && typeof c.mustEscalate !== 'boolean') errors.push(`${label}: "mustEscalate" must be a boolean`);
    if (c?.mustSelect !== undefined && !(Array.isArray(c.mustSelect) && c.mustSelect.every(t => typeof t === 'string' && t))) {
      errors.push(`${label}: "mustSelect" must be an array of test files`);
    }
    if (c?.mustEscalate !== true && !(Array.isArray(c?.mustSelect) && c.mustSelect.length > 0)) {
      errors.push(`${label}: declare "mustEscalate": true or a non-empty "mustSelect"`);
    }
    cases.push(c as ReplayCase);
  });
  return { cases, errors };
}

/**
 * Corre los casos en orden. `fallbackConfig` se usa cuando el árbol de `head`
 * no trae su propio `gatekeeper.config.json`.
 */
export async function runReplay(cases: ReplayCase[], fallbackConfig?: GatekeeperConfig): Promise<ReplayOutcome[]> {
  const repoCwd = process.cwd();
  const prefix = repoPrefix(repoCwd);
  const outcomes: ReplayOutcome[] = [];

  for (const c of cases) {
    const outcome: ReplayOutcome = { name: c.name, ok: false, verdict: null, reasons: [], selectedTests: [], failures: [] };
    outcomes.push(outcome);
    for (const ref of [c.base, c.head]) {
      if (!refExists(ref, repoCwd)) outcome.failures.push(`ref '${ref}' does not resolve to a commit`);
    }
    if (outcome.failures.length > 0) continue;

    const tmp = path.join(repoCwd, `${REPLAY_PREFIX}${process.pid}-${replayCounter++}`);
    trackTempArtifact(tmp);
    try {
      fs.mkdirSync(tmp, { recursive: true });
      materializeTree(c.head, prefix, tmp, repoCwd);
      const configFile = path.join(tmp, 'gatekeeper.config.json');
      const config: GatekeeperConfig | undefined = fs.existsSync(configFile)
        ? JSON.parse(fs.readFileSync(configFile, 'utf-8'))
        : fallbackConfig;
      if (!config) throw new Error(`no gatekeeper.config.json at '${c.head}'`);

      process.chdir(tmp);
      let verdict: GatekeeperVerdict;
      try {
        verdict = await runGatekeeper(config, { baseRef: c.base, headRef: c.head, gitCwd: repoCwd });
      } finally {
        process.chdir(repoCwd);
      }

      outcome.verdict = verdict.verdict;
      outcome.reasons = verdict.reasons;
      outcome.selectedTests = verdict.selectedTests;
      if (c.mustEscalate && verdict.verdict === 'FAST_TRACK') {
        outcome.failures.push(`must escalate, but the verdict is FAST_TRACK (${verdict.reasons.join(', ')})`);
      }
      const selected = new Set(verdict.selectedTests.map(t => t.file));
      for (const test of c.mustSelect ?? []) {
        const normalized = test.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!selected.has(normalized)) outcome.failures.push(`required test not selected: ${normalized}`);
      }
    } catch (err) {
      outcome.failures.push(`could not be evaluated: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      untrackTempArtifact(tmp);
    }
    outcome.ok = outcome.failures.length === 0;
  }
  return outcomes;
}
