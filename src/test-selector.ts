// src/test-selector.ts
// Qué tests de una cápsula hay que correr para un cambio. La regla de fondo es
// la misma que la del resto del gatekeeper: lo que no se puede determinar
// amplía la selección, nunca la achica.
import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import type { GatekeeperConfig, SelectedTest, SelectedTestReason } from './types.js';
import { importsOf } from './import-scanner.js';

export const DEFAULT_TEST_FILE_PATTERNS = ['**/*.test.ts', '**/*.spec.ts'];

const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts']
};
const TEST_DIRS = ['test', 'tests', '__tests__'];
const PRIORITY: SelectedTestReason[] = ['changed-test', 'owner', 'import-consumer', 'fallback-all'];

/** Glob mínimo: `**` cruza directorios, `*` y `?` no. Siempre sobre rutas con `/`. */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** Errores de `testFilePatterns` y `extraInputs`; vacío si son válidos o no están. */
export function selectionConfigErrors(config: GatekeeperConfig): string[] {
  const errors: string[] = [];
  const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string' && s.length > 0);
  if (config.testFilePatterns !== undefined && !isStrings(config.testFilePatterns)) {
    errors.push('testFilePatterns: se esperaba un arreglo de globs');
  }
  const extra: unknown = config.extraInputs;
  if (extra !== undefined) {
    if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
      errors.push('extraInputs: se esperaba un objeto { cápsula: { glob: [tests] } }');
    } else {
      for (const [capsule, rules] of Object.entries(extra as Record<string, unknown>)) {
        if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
          errors.push(`extraInputs.${capsule}: se esperaba un objeto { glob: [tests] }`);
          continue;
        }
        for (const [glob, tests] of Object.entries(rules as Record<string, unknown>)) {
          if (!isStrings(tests)) errors.push(`extraInputs.${capsule}["${glob}"]: se esperaba un arreglo de tests`);
        }
      }
    }
  }
  return errors;
}

export function testMatcher(config: GatekeeperConfig): (file: string) => boolean {
  const patterns = (config.testFilePatterns ?? DEFAULT_TEST_FILE_PATTERNS).map(globToRegExp);
  return file => patterns.some(re => re.test(file));
}

const toPosix = (p: string) => p.replace(/\\/g, '/');

/** Archivos bajo `dir` (relativos al cwd), sin node_modules ni carpetas ocultas. */
function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(toPosix(path.relative(process.cwd(), full)));
  }
  return out.sort();
}

/** Nombre sin `.test`/`.spec` ni extensión: `lib/e96.js` y `test/e96.test.js` dan `e96`. */
const stemOf = (file: string) => path.posix.basename(file).replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '');

/** Candidatos a los que puede resolver un import relativo. */
function candidatesFor(fromFile: string, spec: string): string[] {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const out = [base];
  const ext = path.posix.extname(base);
  for (const swap of JS_TO_TS[ext] ?? []) out.push(base.slice(0, -ext.length) + swap);
  for (const e of RESOLVE_EXTENSIONS) out.push(base + e, `${base}/index${e}`);
  return out;
}

export interface SelectionResult {
  selectedTests: SelectedTest[];
  notes: string[];
}

/**
 * Selección de tests para los archivos cambiados. Dentro de cada cápsula tocada:
 * - `changed-test`: el test mismo cambió;
 * - `owner`: test con el mismo nombre base que el archivo, en su carpeta, en una
 *   carpeta test/tests/__tests__ junto a él o en la raíz de la cápsula; o el test
 *   que `extraInputs` declara dueño de un archivo que no es código;
 * - `import-consumer`: test que importa el archivo, directa o transitivamente;
 * - `fallback-all`: todos los tests de la cápsula, cuando algo no se pudo determinar.
 * Un archivo fuera de toda cápsula amplía a todos los tests del repositorio.
 */
export function selectTests(
  config: GatekeeperConfig,
  touchedFiles: string[],
  pluginsDir: string
): SelectionResult {
  const isTest = testMatcher(config);
  const byCapsule = new Map<string, string[]>();
  const outside: string[] = [];
  for (const file of touchedFiles) {
    const rest = file.startsWith(`${pluginsDir}/`) ? file.slice(pluginsDir.length + 1) : '';
    const slash = rest.indexOf('/');
    if (slash > 0) {
      const capsule = rest.slice(0, slash);
      if (!byCapsule.has(capsule)) byCapsule.set(capsule, []);
      byCapsule.get(capsule)!.push(file);
    } else {
      outside.push(file);
    }
  }

  const picked = new Map<string, SelectedTestReason>();
  const pick = (file: string, reason: SelectedTestReason) => {
    const current = picked.get(file);
    if (!current || PRIORITY.indexOf(reason) < PRIORITY.indexOf(current)) picked.set(file, reason);
  };
  const notes: string[] = [];

  for (const file of touchedFiles) if (isTest(file) && fs.existsSync(file)) pick(file, 'changed-test');

  if (outside.length > 0) {
    notes.push(
      `Files outside every capsule changed (${outside.slice(0, 3).join(', ')}${outside.length > 3 ? ', …' : ''}): their dependents are not tracked, so every test in the repository is selected.`
    );
    for (const file of walk('.')) if (isTest(file)) pick(file, 'fallback-all');
  }

  for (const [capsule, changed] of byCapsule) {
    const capsuleDir = `${pluginsDir}/${capsule}`;
    const result = selectInCapsule(config, capsule, capsuleDir, changed, isTest);
    for (const t of result.selectedTests) pick(t.file, t.reason);
    notes.push(...result.notes);
  }

  return {
    selectedTests: Array.from(picked, ([file, reason]) => ({ file, reason })).sort((a, b) => a.file.localeCompare(b.file)),
    notes
  };
}

function selectInCapsule(
  config: GatekeeperConfig,
  capsule: string,
  capsuleDir: string,
  changed: string[],
  isTest: (file: string) => boolean
): SelectionResult {
  const files = walk(capsuleDir);
  const tests = files.filter(isTest);
  const selected = new Map<string, SelectedTestReason>();
  const unknown: string[] = [];
  const entry = `${capsuleDir}/${config.entryFileName}`;

  // Grafo de imports dentro de la cápsula, invertido: archivo -> quién lo importa
  const known = new Set([...files, ...changed]);
  const importers = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    if (!importers.has(to)) importers.set(to, new Set());
    importers.get(to)!.add(from);
  };
  for (const file of files.filter(f => CODE_FILE.test(f))) {
    let source: string;
    try {
      source = fs.readFileSync(file, 'utf-8');
    } catch (err) {
      unknown.push(`${file} could not be read (${(err as Error).message})`);
      continue;
    }
    let parsed: { specs: string[]; opaque: boolean };
    try {
      parsed = importsOf(source);
    } catch (err) {
      unknown.push(`${file} could not be parsed (${(err as Error).message})`);
      continue;
    }
    if (parsed.opaque) unknown.push(`${file} has a dynamic import whose target cannot be read from the source`);
    for (const spec of parsed.specs) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        for (const target of candidatesFor(file, spec)) if (known.has(target)) addEdge(file, target);
      } else if (!spec.startsWith('node:') && !isBuiltin(spec) && spec.startsWith('#')) {
        // Import de subruta del paquete (p. ej. un registro de capacidades): puede
        // terminar cargando el archivo de entrada de la cápsula sin un import visible.
        if (file !== entry) addEdge(file, entry);
      }
    }
  }

  const rules = Object.entries(config.extraInputs?.[capsule] ?? {}).map(
    ([glob, owners]) => [globToRegExp(glob), owners] as const
  );

  for (const file of changed) {
    if (isTest(file)) continue; // ya elegido como changed-test
    const rel = file.slice(capsuleDir.length + 1);
    let covered = false;

    for (const [re, owners] of rules) {
      if (!re.test(rel)) continue;
      covered = true;
      for (const owner of owners) {
        const target = `${capsuleDir}/${owner}`;
        if (fs.existsSync(target)) selected.set(target, 'owner');
        else unknown.push(`extraInputs.${capsule} names '${owner}', which does not exist`);
      }
    }

    if (!CODE_FILE.test(file)) {
      if (!covered) unknown.push(`${file} is not code and no extraInputs rule names its tests`);
      continue;
    }

    // Dueños por nombre
    const stem = stemOf(file);
    const dir = path.posix.dirname(file);
    const parent = path.posix.dirname(dir);
    const ownerDirs = new Set([
      dir,
      ...TEST_DIRS.map(d => `${dir}/${d}`),
      ...TEST_DIRS.map(d => `${parent}/${d}`),
      ...TEST_DIRS.map(d => `${capsuleDir}/${d}`)
    ]);
    for (const test of tests) {
      if (ownerDirs.has(path.posix.dirname(test)) && stemOf(test) === stem) {
        selected.set(test, 'owner');
        covered = true;
      }
    }

    // Consumidores: recorrido inverso del grafo
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const importer of importers.get(current) ?? []) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        queue.push(importer);
        if (isTest(importer)) {
          if (!selected.has(importer)) selected.set(importer, 'import-consumer');
          covered = true;
        }
      }
    }

    if (!covered && tests.length > 0) unknown.push(`${file} is not reached by any test of the capsule`);
  }

  if (unknown.length > 0) {
    return {
      selectedTests: tests.map(file => ({ file, reason: 'fallback-all' as const })),
      notes: [`Capsule '${capsule}': every test is selected because ${unknown.join('; ')}.`]
    };
  }
  return { selectedTests: Array.from(selected, ([file, reason]) => ({ file, reason })), notes: [] };
}
