// src/types.ts

export type ExecutionMode = 'agentic' | 'deterministic-js' | 'deterministic-wasm' | 'deterministic-mojo' | 'composite';

export interface PluginBudget {
  maxLatencyMs: number;
  maxTokensPerCall: number;
}

/**
 * La "Capability Card" (~86 tokens) que define la frontera inmutable del módulo.
 */
export interface PluginManifest {
  id: string;                            // Identificador único, ej: "plugin-support-studio"
  capability: string;                    // Capacidad expuesta, ej: "support.ticket.triage"
  version: string;                       // SemVer, ej: "1.0.0"
  mode: ExecutionMode;
  dependsOn: string[];                   // Lista de capabilities que este plugin consume
  permissions: string[];                 // Ej: ["fs:read", "http:route:/support-studio/*"]
  inputSchema: Record<string, string>;   // Esquema clave-tipo de entrada
  outputSchema: Record<string, string>;  // Esquema clave-tipo de salida
  budget: PluginBudget;
}

export interface SelfTestResult {
  passed: boolean;
  assertionsRun: number;
  durationMs: number;
  details: string[];
}

export interface HealthResult {
  healthy: boolean;
  avgLatencyMs: number;
  tokensConsumed: number;
}

/**
 * Interfaz que debe exportar cada archivo de entrada de un plugin (`index.ts`).
 */
export interface GatekeeperPluginModule {
  manifest: PluginManifest;
  selfTest(): Promise<SelfTestResult>;
  healthCheck?(): Promise<HealthResult>;
  execute?(input: unknown): Promise<unknown>;
}

/**
 * Configuración declarativa del repositorio (`gatekeeper.config.json`).
 */
export interface GatekeeperConfig {
  pluginsDir: string;                    // Ej: "examples/plugins" o "src/plugins"
  entryFileName: string;                 // Ej: "index.ts"
  allowedExternalPackages: string[];     // Paquetes npm permitidos sin escalar, ej: ["cordis", "koffi"]
  keyFlows: Record<string, string[]>;    // Mapa: NombreDelKeyFlow -> Lista de capabilities que intervienen
}

export type VerdictStatus = 'FAST_TRACK' | 'ESCALATE_TO_E2E' | 'REJECTED';

export type ClassificationReason =
  | 'STRICT_CAPSULE_INTERNAL_CHANGE'
  | 'NO_FILES_CHANGED'
  | 'SHARED_BOUNDARY_TOUCHED'
  | 'MULTIPLE_CAPSULES_TOUCHED'
  | 'CONTRACT_SCHEMA_MUTATED'
  | 'PERMISSIONS_ESCALATED'
  | 'BUDGET_REGRESSED'
  | 'ILLEGAL_CROSS_CAPSULE_IMPORT'
  | 'SELFTEST_FAILED'
  | 'CAPABILITY_LOCKED_BY_ANOTHER_AGENT';

export type HumanReviewLoad = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface ImportViolation {
  file: string;
  importedPath: string;
  reason: string;
}

/**
 * Salida determinista del Gatekeeper (impresa en consola y vía `--json`).
 */
export interface GatekeeperVerdict {
  timestamp: string;
  baseRef: string;
  headRef: string;
  verdict: VerdictStatus;
  reasons: ClassificationReason[];
  humanReviewLoad: HumanReviewLoad;
  touchedFiles: string[];
  touchedCapsules: string[];
  outOfCapsuleFiles: string[];
  contractMutated: boolean;
  affectedCapabilities: string[];
  affectedKeyFlows: string[];            // Lista exacta de flujos que ShipGuarde / Playwright debe correr
  selfTestReports: Record<string, SelfTestResult>;
  importViolations: ImportViolation[];   // Detalle de cada ILLEGAL_CROSS_CAPSULE_IMPORT
  warnings: string[];                    // Fases omitidas o cápsulas que no se pudieron cargar
  totalVerificationTimeMs: number;
}
