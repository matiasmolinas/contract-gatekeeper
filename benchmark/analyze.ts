// benchmark/analyze.ts
// Análisis agrupado de una o más carpetas de resultados de la MISMA revisión del
// protocolo. Junta todas las corridas por brazo y responde, con su incertidumbre,
// cuánto difiere cada brazo del brazo de referencia.
//
//   npx tsx benchmark/analyze.ts <carpeta> [<carpeta>…] [--baseline classic] [--out archivo.md]
import fs from 'node:fs';
import path from 'node:path';
import type { ArmResult } from './lib/harness.js';
import { median, metrics, percentile, storyCycles, type ArmMetrics } from './lib/metrics.js';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
};
const BASELINE = option('baseline', 'classic');
const OUT = option('out', '');
const folders = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
if (folders.length === 0) {
  console.error('Uso: npx tsx benchmark/analyze.ts <carpeta de resultados> [...]');
  process.exit(2);
}

interface Run {
  source: string;
  metrics: ArmMetrics;
  storyTokens: Record<string, number>;
  cycles: ReturnType<typeof storyCycles>;
}
const byArm = new Map<string, Run[]>();
for (const folder of folders) {
  for (const file of fs.readdirSync(folder).filter(name => /^run\d+-.+\.json$/.test(name)).sort()) {
    const result = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf-8')) as ArmResult;
    if (!result.live) continue;
    if (!byArm.has(result.arm)) byArm.set(result.arm, []);
    byArm.get(result.arm)!.push({
      source: `${path.basename(path.resolve(folder))}/${file}`,
      metrics: metrics(result),
      storyTokens: Object.fromEntries(result.stories.map(s => [s.storyId, s.usage.totalTokens])),
      cycles: storyCycles(result)
    });
  }
}

// PRNG con semilla fija: el bootstrap da lo mismo cada vez que se corre
let seed = 20261115;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const resample = (values: number[]) => values.map(() => values[Math.floor(random() * values.length)]);

/** Cociente de medias brazo/referencia con intervalo bootstrap del 95 % (remuestreando corridas). */
function ratio(arm: number[], base: number[]): { point: number; low: number; high: number } {
  const draws: number[] = [];
  for (let i = 0; i < 10_000; i++) draws.push(mean(resample(arm)) / mean(resample(base)));
  draws.sort((a, b) => a - b);
  return { point: mean(arm) / mean(base), low: draws[249], high: draws[9749] };
}

const fmt = (v: number) => (Number.isInteger(v) || Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Number(v.toFixed(3))));
const spread = (values: number[]) =>
  values.length > 1 ? `${fmt(median(values))} (${fmt(Math.min(...values))}–${fmt(Math.max(...values))})` : fmt(values[0]);
const pct = (r: number) => `${r >= 1 ? '+' : '−'}${Math.abs((r - 1) * 100).toFixed(0)} %`;

const arms = [...byArm.keys()].sort((a, b) => (a === BASELINE ? -1 : b === BASELINE ? 1 : a.localeCompare(b)));
const pick = (arm: string, f: (m: ArmMetrics) => number) => byArm.get(arm)!.map(run => f(run.metrics));
const base = byArm.get(BASELINE);
if (!base) {
  console.error(`No hay corridas del brazo de referencia '${BASELINE}'.`);
  process.exit(2);
}

const lines: string[] = [
  '# Pooled analysis',
  '',
  `Result folders: ${folders.map(f => `\`${path.basename(path.resolve(f))}\``).join(', ')}`,
  '',
  `Runs per arm: ${arms.map(arm => `${arm} ${byArm.get(arm)!.length}`).join(' · ')}. Cells show the median across runs with the range in parentheses.`,
  '',
  `| Metric | ${arms.join(' | ')} |`,
  `| --- | ${arms.map(() => '---').join(' | ')} |`
];
const rows: [string, (m: ArmMetrics) => number][] = [
  ['Stories passing their hidden acceptance test on final main (of 12)', m => m.acceptedFinal],
  ['Agent attempts', m => m.attempts],
  ['Real git merge conflicts', m => m.mergeConflicts],
  ['Rejected by the verification step', m => m.gateFailures],
  ['Attempts cut off at the turn limit', m => m.attemptsCutOffAtTurnLimit],
  ['LLM calls', m => m.llmCalls],
  ['Total tokens (API usage)', m => m.totalTokens],
  ['Cost reported by the provider (US$)', m => m.costUsd],
  ['Full test-suite runs during integration', m => m.fullSuiteRuns],
  ['Time waiting for a capsule lock, summed (s)', m => Math.round(m.lockWaitMs / 1000)],
  ['Wall-clock time of the arm (s)', m => Math.round(m.wallMs / 1000)]
];
for (const [label, f] of rows) lines.push(`| ${label} | ${arms.map(arm => spread(pick(arm, f))).join(' | ')} |`);

lines.push('', `## Difference from \`${BASELINE}\``, '');
lines.push(
  'Ratio of means, arm over baseline, with a 95 % bootstrap interval obtained by resampling runs. An interval that contains 1 means the data cannot tell the two arms apart on that metric.',
  '',
  '| Arm | Total tokens | LLM calls | Wall-clock time |',
  '| --- | --- | --- | --- |'
);
for (const arm of arms.filter(a => a !== BASELINE)) {
  const cell = (f: (m: ArmMetrics) => number) => {
    const r = ratio(pick(arm, f), pick(BASELINE, f));
    return `${pct(r.point)} (${pct(r.low)} to ${pct(r.high)})`;
  };
  lines.push(`| ${arm} | ${cell(m => m.totalTokens)} | ${cell(m => m.llmCalls)} | ${cell(m => m.wallMs)} |`);
}

const totals = pick(BASELINE, m => m.totalTokens);
if (totals.length > 2) {
  const sd = Math.sqrt(mean(totals.map(v => (v - mean(totals)) ** 2)) * (totals.length / (totals.length - 1)));
  lines.push(
    '',
    `Run-to-run noise: the total tokens of \`${BASELINE}\` vary with a coefficient of variation of ${((sd / mean(totals)) * 100).toFixed(0)} % across its ${totals.length} runs, with the same code, stories and model.`
  );
}

lines.push('', '## Tokens per story', '', 'Median across runs, in thousands of tokens.', '');
const storyIds = Object.keys(base[0].storyTokens).sort();
lines.push(`| Story | ${arms.join(' | ')} |`, `| --- | ${arms.map(() => '---').join(' | ')} |`);
const storyMedian = (arm: string, id: string) => median(byArm.get(arm)!.map(run => run.storyTokens[id]).filter(v => typeof v === 'number'));
for (const id of storyIds) lines.push(`| ${id} | ${arms.map(arm => Math.round(storyMedian(arm, id) / 1000)).join(' | ')} |`);
lines.push('');
for (const arm of arms.filter(a => a !== BASELINE)) {
  const cheaper = storyIds.filter(id => storyMedian(arm, id) < storyMedian(BASELINE, id)).length;
  lines.push(`- \`${arm}\` has a lower median than \`${BASELINE}\` in ${cheaper} of ${storyIds.length} stories.`);
}
lines.push(
  '',
  '## Cycle time and cost per story',
  '',
  'Cycle time is the wall time from the moment an agent picks a story up to the moment it is merged into main, including any wait for a capsule lock and every attempt. Cost is what the provider reported for all attempts of the story. Story observations are pooled across runs; a story that never merged has a cost but no cycle time.',
  ''
);
const approximate = arms.filter(arm => byArm.get(arm)!.some(run => run.cycles.some(c => c.approximate)));
if (approximate.length > 0) {
  lines.push(
    `Runs recorded before the harness kept merge timestamps (${approximate.map(a => `\`${a}\``).join(', ')}) use the story's wall time instead, which also includes the hidden acceptance test run at merge and the worktree cleanup, so their cycle times are slightly high.`,
    ''
  );
}
lines.push(
  '| Arm | Stories observed | Merged | Cycle time median (s) | Cycle time p90 (s) | Cost per story median (US$) | Cost per story p90 (US$) |',
  '| --- | --- | --- | --- | --- | --- | --- |'
);
const seconds = (ms: number) => (ms / 1000).toFixed(1);
for (const arm of arms) {
  const all = byArm.get(arm)!.flatMap(run => run.cycles);
  const cycle = all.flatMap(c => (c.cycleMs === null ? [] : [c.cycleMs]));
  const cost = all.map(c => c.costUsd);
  lines.push(
    `| ${arm} | ${all.length} | ${cycle.length} | ${seconds(median(cycle))} | ${seconds(percentile(cycle, 90))} | ${median(cost).toFixed(4)} | ${percentile(cost, 90).toFixed(4)} |`
  );
}
lines.push('', 'Median cycle time per story across runs, in seconds:', '');
lines.push(`| Story | ${arms.join(' | ')} |`, `| --- | ${arms.map(() => '---').join(' | ')} |`);
for (const id of storyIds) {
  const cell = (arm: string) => {
    const values = byArm.get(arm)!.flatMap(run => run.cycles.filter(c => c.storyId === id && c.cycleMs !== null).map(c => c.cycleMs!));
    return values.length ? seconds(median(values)) : '–';
  };
  lines.push(`| ${id} | ${arms.map(cell).join(' | ')} |`);
}

lines.push('', 'Runs included:', '', ...arms.flatMap(arm => byArm.get(arm)!.map(run => `- ${arm}: \`${run.source}\``)), '');

const output = lines.join('\n');
if (OUT) fs.writeFileSync(OUT, output, 'utf-8');
console.log(output);
