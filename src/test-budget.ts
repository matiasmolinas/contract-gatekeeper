// src/test-budget.ts
// Presupuesto opcional de crecimiento de tests: cuenta las líneas netas que un
// cambio agrega a archivos de test (sin líneas en blanco ni solo-comentario).
import fs from 'node:fs';
import type { GatekeeperConfig, TestBudgetReport } from './types.js';
import { gitOutput } from './git-inspector.js';
import { testMatcher } from './test-selector.js';

export const BUDGET_MARKER = /^\s*gatekeeper-test-budget:\s*(\S.*)$/m;

/** Errores de `testBudget`; vacío si es válido o no está. */
export function testBudgetErrors(config: GatekeeperConfig): string[] {
  const budget: unknown = config.testBudget;
  if (budget === undefined) return [];
  const max = (budget as { maxNetTestLinesPerChange?: unknown })?.maxNetTestLinesPerChange;
  if (budget === null || typeof budget !== 'object' || !Number.isInteger(max) || (max as number) < 0) {
    return ['testBudget: se esperaba { "maxNetTestLinesPerChange": <entero >= 0> }'];
  }
  return [];
}

/** Línea que cuenta: ni en blanco ni solo comentario. */
export function countsAsTestLine(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && !/^(\/\/|\/\*|\*)/.test(t);
}

/** Líneas netas (agregadas menos borradas) de un diff unificado. */
export function netLinesOfDiff(diff: string): number {
  let net = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+') && countsAsTestLine(line.slice(1))) net++;
    else if (line.startsWith('-') && countsAsTestLine(line.slice(1))) net--;
  }
  return net;
}

export interface BudgetInput {
  baseRef: string;
  headRef: string;
  touchedFiles: string[];
  /** true si los archivos vienen de --files o --working-tree: se compara el working tree contra la base. */
  workingTree: boolean;
  gitCwd?: string;
}

/** Mide el cambio contra el presupuesto. `netTestLines: null` = no se pudo medir. */
export function evaluateTestBudget(config: GatekeeperConfig, input: BudgetInput): TestBudgetReport | null {
  if (!config.testBudget) return null;
  const max = config.testBudget.maxNetTestLinesPerChange;
  const isTest = testMatcher(config);
  const testFiles = input.touchedFiles.filter(isTest);
  const report: TestBudgetReport = { maxNetTestLinesPerChange: max, netTestLines: 0, justification: null, exceeded: false };
  if (testFiles.length === 0) return report;

  const cwd = input.gitCwd;
  let net = 0;
  if (input.workingTree) {
    const head = gitOutput(['rev-parse', 'HEAD'], cwd)?.trim();
    const base = head ? gitOutput(['merge-base', input.baseRef, head], cwd)?.trim() : undefined;
    const diff = base ? gitOutput(['diff', '--relative', base, '--', ...testFiles], cwd) : null;
    if (diff === null) return { ...report, netTestLines: null };
    net += netLinesOfDiff(diff);
    // Archivos sin trackear: git diff no los ve; cuentan enteros como agregados
    const tracked = new Set((gitOutput(['ls-files', '--', ...testFiles], cwd) ?? '').split('\n').filter(Boolean));
    for (const file of testFiles) {
      if (tracked.has(file) || !fs.existsSync(file)) continue;
      net += fs.readFileSync(file, 'utf-8').split('\n').filter(countsAsTestLine).length;
    }
  } else {
    const diff = gitOutput(['diff', '--relative', `${input.baseRef}...${input.headRef}`, '--', ...testFiles], cwd);
    if (diff === null) return { ...report, netTestLines: null };
    net = netLinesOfDiff(diff);
  }
  report.netTestLines = net;
  if (net <= max) return report;

  const messages = gitOutput(['log', '--format=%B', `${input.baseRef}..${input.headRef}`], cwd) ?? '';
  const marker = messages.match(BUDGET_MARKER);
  report.justification = marker ? marker[1].trim() : null;
  report.exceeded = !marker;
  return report;
}
