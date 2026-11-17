// src/shadow.ts
// Modo sombra: el veredicto no se usa para gatear; se corre la batería completa
// igual y se anota si el veredicto (o la selección de tests) se habría perdido
// una falla. Sirve para medir antes de confiar.
import type { ClassificationReason, GatekeeperVerdict, SelectedTest, VerdictStatus } from './types.js';

export interface ShadowRecord {
  recordedAt: string;
  baseRef: string;
  headRef: string;
  verdict: VerdictStatus;
  reasons: ClassificationReason[];
  touchedCapsules: string[];
  selectedTests: string[];
  /** La selección incluyó `fallback-all`: no se angostó. */
  selectionWidened: boolean;
  fullSuiteExitCode: number;
  fullSuiteFailed: boolean;
  /** Tests que fallaron en la batería completa; null si no se informaron. */
  failedTests: string[] | null;
  /** Tests que fallaron y no estaban seleccionados; null si no se sabe. */
  failedOutsideSelection: string[] | null;
  /** FAST_TRACK con la batería completa en rojo. */
  verdictMiss: boolean;
  /** Un test que falló quedó fuera de la selección; null si no se informaron los fallidos. */
  selectionMiss: boolean | null;
  miss: boolean;
}

const normalize = (p: string) => p.trim().replace(/\\/g, '/').replace(/^\.\//, '');

export function shadowRecord(
  verdict: GatekeeperVerdict,
  suite: { exitCode: number; failedTests?: string[] },
  now: Date = new Date()
): ShadowRecord {
  const selected = (verdict.selectedTests ?? []) as SelectedTest[];
  const selectedFiles = selected.map(t => normalize(t.file));
  const fullSuiteFailed = suite.exitCode !== 0;
  const failedTests = suite.failedTests ? [...new Set(suite.failedTests.map(normalize).filter(Boolean))].sort() : null;
  const failedOutsideSelection = failedTests ? failedTests.filter(f => !selectedFiles.includes(f)) : null;
  const verdictMiss = fullSuiteFailed && verdict.verdict === 'FAST_TRACK';
  const selectionMiss = failedOutsideSelection === null ? null : fullSuiteFailed && failedOutsideSelection.length > 0;
  return {
    recordedAt: now.toISOString(),
    baseRef: verdict.baseRef,
    headRef: verdict.headRef,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
    touchedCapsules: verdict.touchedCapsules,
    selectedTests: selectedFiles,
    selectionWidened: selected.some(t => t.reason === 'fallback-all'),
    fullSuiteExitCode: suite.exitCode,
    fullSuiteFailed,
    failedTests,
    failedOutsideSelection,
    verdictMiss,
    selectionMiss,
    miss: verdictMiss || selectionMiss === true
  };
}

export interface ShadowSummary {
  runs: number;
  unreadableLines: number;
  fastTracks: number;
  fullSuiteFailures: number;
  misses: number;
  verdictMisses: number;
  selectionMisses: number;
  /** Batería en rojo sin lista de fallidos: no se puede saber si la selección los cubría. */
  selectionUnknown: number;
  /** Corridas que el gatekeeper angostó (FAST_TRACK o selección sin fallback-all) sin perder ninguna falla. */
  narrowable: number;
  narrowableShare: number;
  missRateAmongFastTracks: number;
}

export function summarizeShadow(lines: string[]): ShadowSummary {
  const records: ShadowRecord[] = [];
  let unreadableLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed?.verdict !== 'string' || typeof parsed?.miss !== 'boolean') throw new Error('not a shadow record');
      records.push(parsed);
    } catch {
      unreadableLines++;
    }
  }
  const count = (f: (r: ShadowRecord) => boolean) => records.filter(f).length;
  const fastTracks = count(r => r.verdict === 'FAST_TRACK');
  const verdictMisses = count(r => r.verdictMiss);
  // Angostada: FAST_TRACK, o una selección que no cayó en fallback-all. Segura: sin
  // falla perdida y, si la batería falló, sabiendo cuáles fallaron (lo desconocido no cuenta como seguro).
  const narrowable = count(
    r => (r.verdict === 'FAST_TRACK' || !r.selectionWidened) && !r.miss && !(r.fullSuiteFailed && r.selectionMiss === null)
  );
  const ratio = (a: number, b: number) => (b === 0 ? 0 : Number((a / b).toFixed(4)));
  return {
    runs: records.length,
    unreadableLines,
    fastTracks,
    fullSuiteFailures: count(r => r.fullSuiteFailed),
    misses: count(r => r.miss),
    verdictMisses,
    selectionMisses: count(r => r.selectionMiss === true),
    selectionUnknown: count(r => r.selectionMiss === null && r.fullSuiteFailed),
    narrowable,
    narrowableShare: ratio(narrowable, records.length),
    missRateAmongFastTracks: ratio(verdictMisses, fastTracks)
  };
}
