// src/engine.ts
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ClassificationReason,
  GatekeeperConfig,
  GatekeeperPluginModule,
  GatekeeperVerdict,
  HumanReviewLoad,
  ImportViolation,
  PluginManifest,
  SelfTestResult,
  VerdictStatus
} from './types.js';
import { getChangedFilesFromGit, readFileAtRef, refExists } from './git-inspector.js';
import { scanCapsuleImports } from './import-scanner.js';
import { resolveAffectedGraph } from './graph-resolver.js';
import { readLocks } from './lock-manager.js';

export type * from './types.js';

export interface RunOptions {
  baseRef?: string;
  headRef?: string;
  explicitFiles?: string[];
  agentId?: string;
  /**
   * Manifests de la rama base por nombre de cápsula. Si se omite, se leen de
   * git (`baseRef:<pluginsDir>/<capsule>/<entryFileName>`).
   */
  baselineManifests?: Record<string, PluginManifest>;
}

const REJECTING: ClassificationReason[] = [
  'SELFTEST_FAILED',
  'ILLEGAL_CROSS_CAPSULE_IMPORT',
  'CAPABILITY_LOCKED_BY_ANOTHER_AGENT'
];

const ESCALATING: ClassificationReason[] = [
  'SHARED_BOUNDARY_TOUCHED',
  'MULTIPLE_CAPSULES_TOUCHED',
  'CONTRACT_SCHEMA_MUTATED',
  'PERMISSIONS_ESCALATED',
  'BUDGET_REGRESSED'
];

const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

export async function runGatekeeper(
  config: GatekeeperConfig,
  options: RunOptions = {}
): Promise<GatekeeperVerdict> {
  const t0 = performance.now();
  const baseRef = options.baseRef ?? 'main';
  const headRef = options.headRef ?? 'HEAD';

  const reasons = new Set<ClassificationReason>();
  const warnings: string[] = [];
  const importViolations: ImportViolation[] = [];
  const selfTestReports: Record<string, SelfTestResult> = {};
  const directlyAffected = new Set<string>();
  let allManifests: PluginManifest[] = [];
  let contractMutated = false;

  // FASE 1: Obtener archivos modificados
  const touchedFiles = Array.from(
    new Set(
      (options.explicitFiles ?? getChangedFilesFromGit(baseRef, headRef))
        .map(normalizePath)
        .filter(Boolean)
    )
  );

  const pluginsDir = normalizePath(config.pluginsDir).replace(/\/+$/, '');
  const touchedCapsulesSet = new Set<string>();
  const outOfCapsuleFiles: string[] = [];

  // FASE 2: Clasificación de Frontera de Cápsula
  for (const file of touchedFiles) {
    const rest = file.startsWith(`${pluginsDir}/`) ? file.slice(pluginsDir.length + 1) : '';
    const slash = rest.indexOf('/');
    if (slash > 0) {
      touchedCapsulesSet.add(rest.slice(0, slash));
    } else {
      // Fuera de pluginsDir, o un archivo suelto en la raíz de pluginsDir
      outOfCapsuleFiles.push(file);
    }
  }

  const touchedCapsules = Array.from(touchedCapsulesSet);

  if (touchedFiles.length === 0) {
    reasons.add('NO_FILES_CHANGED');
  } else {
    if (outOfCapsuleFiles.length > 0) reasons.add('SHARED_BOUNDARY_TOUCHED');
    if (touchedCapsules.length > 1) reasons.add('MULTIPLE_CAPSULES_TOUCHED');
    if (outOfCapsuleFiles.length === 0 && touchedCapsules.length === 1) {
      reasons.add('STRICT_CAPSULE_INTERNAL_CHANGE');
    }
  }

  const finish = (): GatekeeperVerdict => {
    const reasonList = Array.from(reasons);
    let verdict: VerdictStatus = 'FAST_TRACK';
    let humanReviewLoad: HumanReviewLoad = 'LOW';

    if (reasonList.some(r => REJECTING.includes(r))) {
      verdict = 'REJECTED';
      humanReviewLoad = 'HIGH';
    } else if (reasonList.some(r => ESCALATING.includes(r))) {
      verdict = 'ESCALATE_TO_E2E';
      humanReviewLoad = 'HIGH';
    } else if (reasons.has('NO_FILES_CHANGED')) {
      humanReviewLoad = 'NONE';
    }

    const { allAffectedCapabilities, affectedKeyFlows } = resolveAffectedGraph(
      Array.from(directlyAffected),
      allManifests,
      config
    );

    return {
      timestamp: new Date().toISOString(),
      baseRef,
      headRef,
      verdict,
      reasons: reasonList,
      humanReviewLoad,
      touchedFiles,
      touchedCapsules,
      outOfCapsuleFiles,
      contractMutated,
      affectedCapabilities: allAffectedCapabilities,
      affectedKeyFlows: verdict === 'FAST_TRACK' ? [] : affectedKeyFlows,
      selfTestReports,
      importViolations,
      warnings,
      totalVerificationTimeMs: Number((performance.now() - t0).toFixed(2))
    };
  };

  // FASE 3: Auditoría de Bloqueos de Agentes en Paralelo
  if (options.agentId) {
    const activeLocks = readLocks();
    for (const capsule of touchedCapsules) {
      const lock = activeLocks[capsule];
      if (lock && lock.agentId !== options.agentId) {
        reasons.add('CAPABILITY_LOCKED_BY_ANOTHER_AGENT');
        warnings.push(`Capsule '${capsule}' is locked by agent '${lock.agentId}'.`);
      }
    }
    // Rechazo inmediato: no se ejecuta código de una cápsula que es de otro agente
    if (reasons.has('CAPABILITY_LOCKED_BY_ANOTHER_AGENT')) return finish();
  }

  // Cargar todos los plugins existentes en el directorio para armar el grafo
  const { modules: allModules, loadErrors } = await loadAllPlugins(config);
  allManifests = Array.from(allModules.values()).map(m => m.manifest);

  const capsuleDirOf = (capsule: string) => path.join(config.pluginsDir, capsule);

  // Si se tocaron archivos compartidos, todas las cápsulas están potencialmente afectadas
  const capsulesToVerify =
    outOfCapsuleFiles.length > 0
      ? Array.from(new Set([...allModules.keys(), ...touchedCapsules]))
      : touchedCapsules;

  // FASE 4: Escaneo Estático de Imports Prohibidos
  for (const capsule of capsulesToVerify) {
    const violations = scanCapsuleImports(capsuleDirOf(capsule), config.allowedExternalPackages ?? []);
    if (violations.length > 0) {
      importViolations.push(...violations);
      reasons.add('ILLEGAL_CROSS_CAPSULE_IMPORT');
    }
  }

  // FASE 5: Detección de Mutación de Contrato (Manifest Diff)
  const baselineFromGit = options.baselineManifests === undefined;
  const gitBaselineAvailable = baselineFromGit && touchedCapsules.length > 0 && refExists(baseRef);
  if (baselineFromGit && touchedCapsules.length > 0 && !gitBaselineAvailable) {
    warnings.push(
      `Base ref '${baseRef}' could not be resolved: manifest diff (phase 5) was skipped.`
    );
  }

  for (const capsule of touchedCapsules) {
    const current = allModules.get(capsule)?.manifest;
    const capsuleExists = fs.existsSync(capsuleDirOf(capsule));

    let base: PluginManifest | undefined;
    let baseKnown = false; // ¿sabemos con certeza qué había en la rama base?
    if (!baselineFromGit) {
      base = options.baselineManifests![capsule];
      baseKnown = base !== undefined;
    } else if (gitBaselineAvailable) {
      const loaded = await loadManifestAtRef(config, capsule, baseRef);
      if (loaded.error) {
        warnings.push(`Baseline manifest of '${capsule}' at '${baseRef}' could not be loaded: ${loaded.error}`);
      } else {
        base = loaded.manifest;
        baseKnown = true;
      }
    }

    if (base) directlyAffected.add(base.capability);

    if (!capsuleExists) {
      // Cápsula eliminada: su contrato desaparece para quien dependa de ella
      contractMutated = true;
      reasons.add('CONTRACT_SCHEMA_MUTATED');
      warnings.push(`Capsule '${capsule}' was removed.`);
      continue;
    }
    if (!current) continue; // No cargable: lo reporta la fase 6

    if (!base) {
      if (baselineFromGit && baseKnown) {
        // Cápsula nueva: introduce un contrato que nadie revisó todavía
        contractMutated = true;
        reasons.add('CONTRACT_SCHEMA_MUTATED');
        warnings.push(`Capsule '${capsule}' is new (no manifest at '${baseRef}').`);
      }
      continue;
    }

    for (const reason of diffManifests(current, base)) {
      contractMutated = true;
      reasons.add(reason);
    }
  }

  // FASE 6: Ejecución Aislada de selfTest() y Resolución de Key Flows
  for (const capsule of capsulesToVerify) {
    const mod = allModules.get(capsule);
    if (!mod) {
      if (fs.existsSync(capsuleDirOf(capsule))) {
        reasons.add('SELFTEST_FAILED');
        warnings.push(
          `Capsule '${capsule}' has no loadable plugin: ${
            loadErrors.get(capsule) ?? `missing ${config.entryFileName}`
          }`
        );
      }
      continue;
    }

    directlyAffected.add(mod.manifest.capability);

    let report: SelfTestResult;
    try {
      report = await mod.selfTest();
    } catch (err) {
      report = {
        passed: false,
        assertionsRun: 0,
        durationMs: 0,
        details: [`selfTest() threw: ${err instanceof Error ? err.message : String(err)}`]
      };
    }
    selfTestReports[mod.manifest.id] = report;

    if (!report || report.passed !== true || report.durationMs > mod.manifest.budget.maxLatencyMs) {
      reasons.add('SELFTEST_FAILED');
    }
  }

  return finish();
}

function diffManifests(curr: PluginManifest, base: PluginManifest): ClassificationReason[] {
  const out: ClassificationReason[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const sortedKeys = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b)));

  if (
    curr.capability !== base.capability ||
    !same(sortedKeys(curr.inputSchema), sortedKeys(base.inputSchema)) ||
    !same(sortedKeys(curr.outputSchema), sortedKeys(base.outputSchema)) ||
    !same([...curr.dependsOn].sort(), [...base.dependsOn].sort())
  ) {
    out.push('CONTRACT_SCHEMA_MUTATED');
  }

  if (curr.permissions.some(p => !base.permissions.includes(p))) {
    out.push('PERMISSIONS_ESCALATED');
  }

  if (
    curr.budget.maxLatencyMs > base.budget.maxLatencyMs ||
    curr.budget.maxTokensPerCall > base.budget.maxTokensPerCall
  ) {
    out.push('BUDGET_REGRESSED');
  }
  return out;
}

function asPlugin(imported: Record<string, unknown>): GatekeeperPluginModule | string {
  const candidate = (imported.default ?? imported.plugin ?? imported) as Partial<GatekeeperPluginModule>;
  const m = candidate?.manifest;
  if (!m || typeof candidate.selfTest !== 'function') {
    return 'entry file does not export { manifest, selfTest() } (as default, `plugin`, or named exports)';
  }
  if (
    typeof m.id !== 'string' ||
    typeof m.capability !== 'string' ||
    !Array.isArray(m.dependsOn) ||
    !Array.isArray(m.permissions) ||
    typeof m.budget?.maxLatencyMs !== 'number' ||
    typeof m.budget?.maxTokensPerCall !== 'number'
  ) {
    return 'manifest is missing required fields (id, capability, dependsOn, permissions, budget)';
  }
  return candidate as GatekeeperPluginModule;
}

async function loadAllPlugins(config: GatekeeperConfig): Promise<{
  modules: Map<string, GatekeeperPluginModule>;
  loadErrors: Map<string, string>;
}> {
  const modules = new Map<string, GatekeeperPluginModule>();
  const loadErrors = new Map<string, string>();
  const absPluginsDir = path.resolve(process.cwd(), config.pluginsDir);
  if (!fs.existsSync(absPluginsDir)) return { modules, loadErrors };

  const entries = fs
    .readdirSync(absPluginsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const entryFile = path.join(absPluginsDir, entry.name, config.entryFileName);
    if (!fs.existsSync(entryFile)) continue;
    try {
      const plugin = asPlugin(await import(pathToFileURL(entryFile).href));
      if (typeof plugin === 'string') loadErrors.set(entry.name, plugin);
      else modules.set(entry.name, plugin);
    } catch (err) {
      loadErrors.set(entry.name, err instanceof Error ? err.message : String(err));
    }
  }
  return { modules, loadErrors };
}

let baselineCounter = 0;

/**
 * Carga el manifest de una cápsula tal como estaba en `ref`. El archivo de
 * entrada se materializa junto al actual (para que sus imports relativos
 * resuelvan igual), se importa y se borra.
 * `manifest === undefined` sin `error` significa que la cápsula no existía en `ref`.
 */
async function loadManifestAtRef(
  config: GatekeeperConfig,
  capsule: string,
  ref: string
): Promise<{ manifest?: PluginManifest; error?: string }> {
  const relEntry = `${normalizePath(config.pluginsDir).replace(/\/+$/, '')}/${capsule}/${config.entryFileName}`;
  const source = readFileAtRef(ref, relEntry);
  if (source === null) return {};

  const capsuleDir = path.resolve(process.cwd(), config.pluginsDir, capsule);
  const createdDir = !fs.existsSync(capsuleDir);
  const tmpFile = path.join(
    capsuleDir,
    `.gatekeeper-base-${process.pid}-${baselineCounter++}-${config.entryFileName}`
  );
  try {
    fs.mkdirSync(capsuleDir, { recursive: true });
    fs.writeFileSync(tmpFile, source, 'utf-8');
    const plugin = asPlugin(await import(pathToFileURL(tmpFile).href));
    return typeof plugin === 'string' ? { error: plugin } : { manifest: plugin.manifest };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.rmSync(tmpFile, { force: true });
    if (createdDir) fs.rmSync(capsuleDir, { recursive: true, force: true });
  }
}
