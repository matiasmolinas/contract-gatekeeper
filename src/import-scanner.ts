// src/import-scanner.ts
import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import type { ImportViolation } from './types.js';

export type { ImportViolation } from './types.js';

interface FoundImport {
  spec: string;
  typeOnly: boolean;       // `import type … from` / `export type … from`: se borra siempre al compilar
  inlineTypeOnly: boolean; // `import { type A } from`: puede quedar como import en runtime
  interpolated: boolean;   // template literal con `${…}`: `spec` es solo el prefijo estático
}

// Especificador entre comillas simples, dobles o backticks
const SPEC = '(?<q>[\'"`])(?<spec>[^\'"`\\n]+)\\k<q>';

const IMPORT_PATTERNS: RegExp[] = [
  // import x from '...', import { a, b } from '...', import * as ns from '...' (multilínea)
  new RegExp(`\\bimport\\s+(?<type>type\\s+)?(?<clause>[\\w$*\\s,{}]+?)\\s*from\\s*${SPEC}`, 'g'),
  // export { a } from '...', export * from '...', export * as ns from '...'
  new RegExp(
    `\\bexport\\s+(?<type>type\\s+)?(?:\\*(?:\\s+as\\s+[\\w$]+)?|(?<clause>\\{[^}]*\\}))\\s*from\\s*${SPEC}`,
    'g'
  ),
  // import '...'  (side-effect)
  new RegExp(`\\bimport\\s*${SPEC}`, 'g'),
  // import('...')  (dinámico)
  new RegExp(`\\bimport\\s*\\(\\s*${SPEC}`, 'g'),
  // require('...')
  new RegExp(`\\brequire\\s*\\(\\s*${SPEC}`, 'g')
];

/**
 * Recorre el fuente una sola vez y devuelve:
 * - `text`: el código sin comentarios, con strings y template literals intactos
 *   (un `//` dentro de un string no es un comentario y no debe esconder un
 *   import que venga después en la misma línea);
 * - `mask`: lo mismo, pero con el contenido de los strings en blanco, para
 *   saber si una palabra clave está en código o dentro de un literal.
 * Ambos tienen la misma longitud.
 */
function lex(source: string): { text: string; mask: string } {
  const n = source.length;
  const braceDepth: number[] = []; // una entrada por cada `${` abierto
  let text = '';
  let mask = '';
  let i = 0;
  const code = (s: string) => {
    text += s;
    mask += s;
  };
  const literal = (s: string) => {
    text += s;
    mask += s.replace(/[^\n]/g, ' ');
  };

  // Consume el cuerpo de un template literal hasta su cierre o hasta un `${`
  const readTemplate = () => {
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        literal(source.slice(i, i + 2));
        i += 2;
      } else if (c === '`') {
        code(c);
        i++;
        return;
      } else if (c === '$' && source[i + 1] === '{') {
        code('${');
        i += 2;
        braceDepth.push(0);
        return;
      } else {
        literal(c);
        i++;
      }
    }
  };

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      code(' ' + source.slice(i, stop).replace(/[^\n]/g, ''));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      code(c);
      i++;
      while (i < n) {
        const e = source[i];
        if (e === '\\') {
          literal(source.slice(i, i + 2));
          i += 2;
          continue;
        }
        if (e === '\n') break; // string sin cerrar: el daño no pasa de esta línea
        i++;
        if (e === c) {
          code(e);
          break;
        }
        literal(e);
      }
      continue;
    }
    if (c === '`') {
      code(c);
      i++;
      readTemplate();
      continue;
    }
    if (braceDepth.length > 0) {
      const top = braceDepth.length - 1;
      if (c === '{') {
        braceDepth[top]++;
      } else if (c === '}') {
        if (braceDepth[top] === 0) {
          braceDepth.pop();
          code(c);
          i++;
          readTemplate();
          continue;
        }
        braceDepth[top]--;
      }
    }
    code(c);
    i++;
  }
  return { text, mask };
}

/** Código sin comentarios, con los strings intactos. */
export function stripComments(source: string): string {
  return lex(source).text;
}

function isInlineTypeOnlyClause(clause: string | undefined): boolean {
  const braces = clause?.match(/^\s*\{([^}]*)\}\s*$/);
  if (!braces) return false;
  const specifiers = braces[1].split(',').map(s => s.trim()).filter(Boolean);
  return specifiers.length > 0 && specifiers.every(s => /^type\s/.test(s));
}

function findImports(source: string): FoundImport[] {
  const { text: code, mask } = lex(source);
  const found: FoundImport[] = [];
  for (const regex of IMPORT_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      // La palabra clave tiene que estar en código: `['import', 'export']` no es un import
      if (mask[match.index] === ' ') continue;
      const groups = match.groups ?? {};
      let spec = groups.spec;
      if (!spec) continue;

      const interpolationAt = groups.q === '`' ? spec.indexOf('${') : -1;
      const interpolated = interpolationAt !== -1;
      if (interpolated) spec = spec.slice(0, interpolationAt);

      const typeOnly = Boolean(groups.type);
      found.push({
        spec,
        typeOnly,
        inlineTypeOnly: !typeOnly && isInlineTypeOnlyClause(groups.clause),
        interpolated
      });
    }
  }
  return found;
}

/**
 * Imports de un archivo para la selección de tests. `opaque` es true cuando hay
 * un `import(…)` o `require(…)` cuyo destino no se puede leer del fuente
 * (variable o template literal con interpolación): desde ese archivo podría
 * cargarse cualquier otro.
 */
export function importsOf(source: string): { specs: string[]; opaque: boolean } {
  const found = findImports(source);
  let opaque = found.some(f => f.interpolated);
  const { text, mask } = lex(source);
  const call = /\b(?:import|require)\s*\(\s*/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(mask)) !== null) {
    const next = text[match.index + match[0].length];
    if (next !== "'" && next !== '"' && next !== '`') opaque = true;
  }
  return { specs: found.map(f => f.spec), opaque };
}

function isInside(target: string, dir: string): boolean {
  return target === dir || target.startsWith(dir + path.sep);
}

export function scanCapsuleImports(
  capsuleDir: string,
  allowedExternalPackages: string[]
): ImportViolation[] {
  const violations: ImportViolation[] = [];
  const absCapsuleDir = path.resolve(capsuleDir);

  if (!fs.existsSync(absCapsuleDir)) return violations;

  for (const file of getAllCodeFiles(absCapsuleDir)) {
    const content = fs.readFileSync(file, 'utf-8');
    const relFile = path.relative(process.cwd(), file).replace(/\\/g, '/');

    for (const { spec, typeOnly, inlineTypeOnly, interpolated } of findImports(content)) {
      // `import type` se borra al compilar: no crea acoplamiento en runtime
      // (así un plugin puede tipar su contrato contra los tipos del gatekeeper).
      if (typeOnly) continue;

      // `import { type A } from` NO es equivalente: con verbatimModuleSyntax o el
      // type-stripping nativo de Node queda `import {} from`, que sí carga el módulo.
      const hint = inlineTypeOnly ? ' — type-only: use `import type { … }` instead' : '';

      if (interpolated) {
        // import(`../x/${name}.js`): solo se puede juzgar el directorio estático del prefijo
        const lastSlash = spec.lastIndexOf('/');
        if (!spec.startsWith('.') || lastSlash === -1) continue;
        const staticDir = path.resolve(path.dirname(file), spec.slice(0, lastSlash + 1));
        if (!isInside(staticDir, absCapsuleDir)) {
          violations.push({
            file: relFile,
            importedPath: `${spec}\${…}`,
            reason: `Template-literal import escapes plugin capsule boundary (${capsuleDir})`
          });
        }
        continue;
      }

      if (spec.startsWith('.') || path.isAbsolute(spec)) {
        // Import relativo/absoluto: al resolverse no puede salir de absCapsuleDir
        const resolved = path.resolve(path.dirname(file), spec);
        if (!isInside(resolved, absCapsuleDir)) {
          violations.push({
            file: relFile,
            importedPath: spec,
            reason: `Relative import escapes plugin capsule boundary (${capsuleDir})${hint}`
          });
        }
      } else {
        // Paquete externo o builtin
        const isAllowed =
          spec.startsWith('node:') ||
          isBuiltin(spec) ||
          allowedExternalPackages.some(pkg => spec === pkg || spec.startsWith(`${pkg}/`));
        if (!isAllowed) {
          violations.push({
            file: relFile,
            importedPath: spec,
            reason: `Undeclared external package import '${spec}' not in allowedExternalPackages${hint}`
          });
        }
      }
    }
  }

  return violations;
}

function getAllCodeFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.gatekeeper-base-')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllCodeFiles(fullPath));
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}
