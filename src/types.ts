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
 * Un flujo de usuario con lo que un runner de navegador necesita para caminarlo:
 * dónde empieza y cómo se ve "terminado". Sin atar la config a ninguna herramienta.
 */
export interface KeyFlowConfig {
  capabilities: string[];                // Capabilities que intervienen en el flujo
  entryUrl?: string;                     // Dónde empieza, ej: "/checkout"
  done?: string;                         // Cómo se ve terminado, ej: "Order confirmation is visible"
}

/** Forma corta (solo las capabilities) o forma completa. */
export type KeyFlowDefinition = string[] | KeyFlowConfig;

/** Un flujo afectado, tal como lo recibe un runner. */
export interface AffectedKeyFlow {
  name: string;
  capabilities: string[];
  entryUrl?: string;
  done?: string;
}

/**
 * Configuración declarativa del repositorio (`gatekeeper.config.json`).
 */
export interface GatekeeperConfig {
  pluginsDir: string;                    // Ej: "examples/plugins" o "src/plugins"
  entryFileName: string;                 // Ej: "index.ts"
  allowedExternalPackages: string[];     // Paquetes npm permitidos sin escalar, ej: ["cordis", "koffi"]
  keyFlows: Record<string, KeyFlowDefinition>; // NombreDelKeyFlow -> capabilities, o { capabilities, entryUrl, done }
  // Globs (relativos a la raíz) que identifican archivos de test. Por defecto: **/*.test.ts y **/*.spec.ts

  testFilePatterns?: string[];
  /**
   * Dueños explícitos de archivos que no son código: cápsula -> glob (relativo a la
   * cápsula) -> tests (relativos a la cápsula) que los leen. Ej: fixtures, JSON.
   */
  extraInputs?: Record<string, Record<string, string[]>>;
  /**
   * Presupuesto opcional de crecimiento de tests. Si un cambio agrega más líneas
   * netas de test que `maxNetTestLinesPerChange` sin una línea
   * `gatekeeper-test-budget: <motivo>` en algún commit del rango, se agrega
   * TEST_BUDGET_EXCEEDED: sube humanReviewLoad, no cambia el veredicto.
   */
  testBudget?: { maxNetTestLinesPerChange: number };
}

export interface TestBudgetReport {
  maxNetTestLinesPerChange: number;
  netTestLines: number | null;           // null si no se pudo medir
  justification: string | null;          // Texto de `gatekeeper-test-budget: …`, si hay
  exceeded: boolean;
}

/** Por qué un test quedó seleccionado. */
export type SelectedTestReason = 'changed-test' | 'owner' | 'import-consumer' | 'fallback-all';

export interface SelectedTest {
  file: string;                          // Ruta relativa a la raíz del repo
  reason: SelectedTestReason;
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
  | 'CAPABILITY_LOCKED_BY_ANOTHER_AGENT'
  | 'TEST_BUDGET_EXCEEDED';

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
  affectedKeyFlows: string[];            // Nombres de los flujos que ShipGuarde / Playwright debe correr
  affectedKeyFlowDetails: AffectedKeyFlow[]; // Los mismos flujos con su entryUrl y done, cuando la config los declara
  selfTestReports: Record<string, SelfTestResult>;
  importViolations: ImportViolation[];   // Detalle de cada ILLEGAL_CROSS_CAPSULE_IMPORT
  selectedTests: SelectedTest[];         // Tests a correr para este cambio, cada uno con su motivo
  selectionNotes: string[];              // Por qué la selección se amplió a todos los tests (fallback-all)
  testBudget: TestBudgetReport | null;   // null si la config no declara testBudget
  warnings: string[];                    // Fases omitidas o cápsulas que no se pudieron cargar
  totalVerificationTimeMs: number;
}
