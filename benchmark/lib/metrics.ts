// benchmark/lib/metrics.ts
// Métricas de un brazo en una corrida. Todas se derivan del resultado crudo.
import type { ArmResult } from './harness.js';

export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Métricas de un brazo en una corrida, todas derivadas del resultado crudo. */
export function metrics(result: ArmResult) {
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

export type ArmMetrics = ReturnType<typeof metrics>;
