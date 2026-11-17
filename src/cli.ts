#!/usr/bin/env node
// src/cli.ts
import fs from 'node:fs';
import path from 'node:path';
import { cleanupTempArtifacts, runGatekeeper } from './engine.js';
import { keyFlowErrors } from './graph-resolver.js';
import { selectionConfigErrors } from './test-selector.js';
import { testBudgetErrors } from './test-budget.js';
import { shadowRecord, summarizeShadow } from './shadow.js';
import { parseReplayCases, runReplay } from './replay.js';
import { acquireLock, checkContention, releaseLock } from './lock-manager.js';
import type { GatekeeperConfig, GatekeeperVerdict } from './types.js';

const USAGE = `Uso:
  contract-gatekeeper init
  contract-gatekeeper check [--base <ref>] [--head <ref>] [--working-tree] [--files a,b] [--agent <id>] [--json]
  contract-gatekeeper shadow --verdict <verdict.json> --suite-exit <code> [--failed-tests a,b | --failed-tests-file <file>] --out <shadow.jsonl>
  contract-gatekeeper shadow-summary <shadow.jsonl> [--json]
  contract-gatekeeper replay <cases.json> [--json]
  contract-gatekeeper lock <capsule> <agentId>
  contract-gatekeeper unlock <capsule> <agentId>
  contract-gatekeeper check-contention <capsule> [agentId]`;

function loadConfig(): GatekeeperConfig {
  const configPath = path.resolve(process.cwd(), 'gatekeeper.config.json');
  if (!fs.existsSync(configPath)) {
    console.error('❌ Error: gatekeeper.config.json no encontrado en el directorio actual.');
    console.error('   Créalo con: contract-gatekeeper init');
    process.exit(2);
  }
  let config: GatekeeperConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(`❌ Error: gatekeeper.config.json no es JSON válido (${(err as Error).message}).`);
    process.exit(2);
  }
  if (typeof config.pluginsDir !== 'string' || typeof config.entryFileName !== 'string') {
    console.error('❌ Error: gatekeeper.config.json requiere "pluginsDir" y "entryFileName".');
    process.exit(2);
  }
  const flowErrors = [...keyFlowErrors(config), ...selectionConfigErrors(config), ...testBudgetErrors(config)];
  if (flowErrors.length > 0) {
    for (const message of flowErrors) console.error(`❌ Error: gatekeeper.config.json: ${message}`);
    process.exit(2);
  }
  return config;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith('--') ? args[0] : 'check';

  // Si matan el proceso a mitad de la fase 5, no dejar baselines temporales en el repo
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    process.on(signal, () => {
      cleanupTempArtifacts();
      process.exit(code);
    });
  }

  if (command === 'init') {
    const target = path.resolve(process.cwd(), 'gatekeeper.config.json');
    if (fs.existsSync(target)) {
      console.log('ℹ️  gatekeeper.config.json ya existe; no se modificó.');
      process.exit(0);
    }
    // Usa la primera carpeta de módulos que exista en el repo
    const candidates = ['src/modules', 'src/plugins', 'src/features', 'plugins', 'modules'];
    const pluginsDir = candidates.find(dir => fs.existsSync(path.resolve(process.cwd(), dir))) ?? 'src/modules';
    const defaultConfig: GatekeeperConfig = {
      pluginsDir,
      entryFileName: 'index.ts',
      allowedExternalPackages: [],
      keyFlows: {}
    };
    fs.writeFileSync(target, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8');
    console.log(`✅ gatekeeper.config.json creado (pluginsDir: "${pluginsDir}").`);
    console.log('   Ajusta pluginsDir, allowedExternalPackages y keyFlows a tu repo, y corre: contract-gatekeeper check');
    process.exit(0);
  }

  if (command === 'lock') {
    const [, capsule, agentId] = args;
    if (!capsule || !agentId) {
      console.error('Uso: contract-gatekeeper lock <capsule> <agentId>');
      process.exit(2);
    }
    const res = acquireLock(capsule, agentId);
    if (!res.ok) {
      console.error(`🔒 REJECTED: La cápsula '${capsule}' ya está bloqueada por el agente '${res.holder}'.`);
      process.exit(1);
    }
    console.log(`✅ Bloqueo adquirido sobre '${capsule}' para el agente '${agentId}'.`);
    process.exit(0);
  }

  if (command === 'unlock') {
    const [, capsule, agentId] = args;
    if (!capsule || !agentId) {
      console.error('Uso: contract-gatekeeper unlock <capsule> <agentId>');
      process.exit(2);
    }
    if (!releaseLock(capsule, agentId)) {
      console.error(`❌ El agente '${agentId}' no tiene un bloqueo sobre '${capsule}'; no se liberó nada.`);
      process.exit(1);
    }
    console.log(`🔓 Bloqueo liberado sobre '${capsule}'.`);
    process.exit(0);
  }

  if (command === 'check-contention') {
    const [, capsule, agentId] = args;
    if (!capsule) {
      console.error('Uso: contract-gatekeeper check-contention <capsule> [agentId]');
      process.exit(2);
    }
    const lock = checkContention(capsule, agentId);
    if (lock) {
      console.error(`🔒 CONTENTION: '${capsule}' está bloqueada por '${lock.agentId}' desde ${lock.acquiredAt}.`);
      process.exit(1);
    }
    console.log(`✅ Sin contención sobre '${capsule}'.`);
    process.exit(0);
  }

  if (command === 'shadow') {
    const verdictFile = getFlagValue(args, '--verdict');
    const exitArg = getFlagValue(args, '--suite-exit');
    const out = getFlagValue(args, '--out');
    if (!verdictFile || exitArg === undefined || !/^-?\d+$/.test(exitArg) || !out) {
      console.error('Uso: contract-gatekeeper shadow --verdict <verdict.json> --suite-exit <code> [--failed-tests a,b | --failed-tests-file <file>] --out <shadow.jsonl>');
      process.exit(2);
    }
    let verdict: GatekeeperVerdict;
    try {
      const raw = fs.readFileSync(verdictFile, 'utf-8');
      verdict = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      if (typeof verdict.verdict !== 'string') throw new Error('no "verdict" field');
    } catch (err) {
      console.error(`❌ Error: no se pudo leer el veredicto de '${verdictFile}' (${(err as Error).message}).`);
      process.exit(2);
    }
    const listArg = getFlagValue(args, '--failed-tests');
    const listFile = getFlagValue(args, '--failed-tests-file');
    const failedTests = listFile
      ? fs.readFileSync(listFile, 'utf-8').split(/[\n,]/)
      : listArg !== undefined
        ? listArg.split(',')
        : undefined;
    const record = shadowRecord(verdict, {
      exitCode: Number(exitArg),
      failedTests: failedTests?.map(s => s.trim()).filter(Boolean)
    });
    fs.appendFileSync(out, JSON.stringify(record) + '\n', 'utf-8');
    console.log(JSON.stringify(record));
    process.exit(0);
  }

  if (command === 'shadow-summary') {
    const file = args[1];
    if (!file || !fs.existsSync(file)) {
      console.error('Uso: contract-gatekeeper shadow-summary <shadow.jsonl> [--json]');
      process.exit(2);
    }
    const summary = summarizeShadow(fs.readFileSync(file, 'utf-8').split('\n'));
    if (args.includes('--json')) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      const pct = (r: number) => `${(r * 100).toFixed(1)} %`;
      console.log(`Shadow runs:            ${summary.runs}${summary.unreadableLines ? ` (${summary.unreadableLines} unreadable lines skipped)` : ''}`);
      console.log(`FAST_TRACK verdicts:    ${summary.fastTracks}`);
      console.log(`Full-suite failures:    ${summary.fullSuiteFailures}`);
      console.log(`Misses:                 ${summary.misses} (verdict ${summary.verdictMisses}, selection ${summary.selectionMisses}; unknown selection ${summary.selectionUnknown})`);
      console.log(`Miss rate on FAST_TRACK: ${pct(summary.missRateAmongFastTracks)}`);
      console.log(`Could have been narrowed: ${summary.narrowable} of ${summary.runs} (${pct(summary.narrowableShare)})`);
    }
    process.exit(summary.unreadableLines > 0 ? 1 : 0);
  }

  if (command === 'replay') {
    const file = args[1];
    if (!file || !fs.existsSync(file)) {
      console.error('Uso: contract-gatekeeper replay <cases.json> [--json]');
      process.exit(2);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      console.error(`❌ Error: '${file}' no es JSON válido (${(err as Error).message}).`);
      process.exit(2);
    }
    const { cases, errors } = parseReplayCases(raw);
    if (errors.length > 0) {
      for (const message of errors) console.error(`❌ Error: ${file}: ${message}`);
      process.exit(2);
    }
    const fallback = fs.existsSync(path.resolve(process.cwd(), 'gatekeeper.config.json')) ? loadConfig() : undefined;
    const outcomes = await runReplay(cases, fallback);
    if (args.includes('--json')) {
      console.log(JSON.stringify(outcomes, null, 2));
    } else {
      for (const o of outcomes) {
        const detail = o.verdict ? `${o.verdict}, ${o.selectedTests.length} tests selected` : 'not evaluated';
        console.log(`${o.ok ? '✅' : '❌'} ${o.name}: ${detail}`);
        for (const failure of o.failures) console.log(`   ${failure}`);
      }
      const failed = outcomes.filter(o => !o.ok).length;
      console.log(`${outcomes.length - failed} of ${outcomes.length} replay cases passed.`);
    }
    process.exit(outcomes.every(o => o.ok) ? 0 : 1);
  }

  if (command === 'check') {
    const config = loadConfig();
    const jsonFlag = args.includes('--json');
    const filesArg = getFlagValue(args, '--files');
    const baseRef = getFlagValue(args, '--base') ?? 'main';
    const headRef = getFlagValue(args, '--head') ?? 'HEAD';
    const agentId = getFlagValue(args, '--agent');

    const explicitFiles = filesArg
      ? filesArg.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    const verdict = await runGatekeeper(config, {
      baseRef,
      headRef,
      explicitFiles,
      includeWorkingTree: args.includes('--working-tree'),
      agentId
    });

    if (jsonFlag) {
      console.log(JSON.stringify(verdict, null, 2));
    } else {
      printHumanReadable(verdict);
    }

    process.exit(verdict.verdict === 'REJECTED' ? 1 : 0);
  }

  console.error(`Comando desconocido: '${command}'.\n${USAGE}`);
  process.exit(2);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function printHumanReadable(v: GatekeeperVerdict) {
  console.log('======================================================================');
  console.log('🛡️  CONTRACT GATEKEEPER — PRE-PR & CI VERIFICATION REPORT');
  console.log('======================================================================');
  console.log(`Verdict:              ${formatBadge(v.verdict)}`);
  console.log(`Reasons:              ${v.reasons.join(', ')}`);
  console.log(`Human Review Load:    ${v.humanReviewLoad}`);
  console.log(`Verification Time:    ${v.totalVerificationTimeMs} ms`);
  console.log(`Touched Capsules:     ${v.touchedCapsules.length ? v.touchedCapsules.join(', ') : 'None'}`);
  console.log(`Out-of-Capsule Files: ${v.outOfCapsuleFiles.length ? v.outOfCapsuleFiles.join(', ') : 'None'}`);
  console.log(`Contract Mutated:     ${v.contractMutated ? 'Yes' : 'No'}`);
  console.log(`Affected Key Flows:   ${v.affectedKeyFlows.length ? v.affectedKeyFlows.join(', ') : 'None (Global E2E Skipped)'}`);
  for (const flow of v.affectedKeyFlowDetails) {
    if (flow.entryUrl || flow.done) {
      console.log(`  ${flow.name}: starts at ${flow.entryUrl ?? '(not declared)'} · done when: ${flow.done ?? '(not declared)'}`);
    }
  }
  console.log(`Selected Tests:       ${v.selectedTests.length ? '' : 'None'}`);
  for (const test of v.selectedTests) console.log(`  ${test.file} (${test.reason})`);
  for (const note of v.selectionNotes) console.log(`  ↳ ${note}`);
  if (v.testBudget) {
    const b = v.testBudget;
    const state = b.netTestLines === null ? 'not measured' : b.exceeded ? 'EXCEEDED' : b.justification ? `over, justified: ${b.justification}` : 'within';
    console.log(`Test Budget:          ${b.netTestLines ?? '?'} net test lines of ${b.maxNetTestLinesPerChange} (${state})`);
  }
  console.log('----------------------------------------------------------------------');
  for (const [pluginId, report] of Object.entries(v.selfTestReports)) {
    console.log(
      `SelfTest [${pluginId}]: ${report.passed ? '✅ PASSED' : '❌ FAILED'} (${report.assertionsRun} assertions in ${report.durationMs} ms)`
    );
  }
  for (const violation of v.importViolations) {
    console.log(`Illegal import: ${violation.file} → '${violation.importedPath}' (${violation.reason})`);
  }
  for (const warning of v.warnings) {
    console.log(`⚠️  ${warning}`);
  }
  console.log('======================================================================');
}

function formatBadge(verdict: string): string {
  if (verdict === 'FAST_TRACK') return '🟢 FAST_TRACK (Merge-Ready — Skip Global E2E)';
  if (verdict === 'ESCALATE_TO_E2E') return '🟡 ESCALATE_TO_E2E (Run Browser Checks on Affected Key Flows)';
  return '🔴 REJECTED (Block Merge)';
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
