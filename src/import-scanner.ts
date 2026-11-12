// src/import-scanner.ts
import fs from 'node:fs';
import path from 'node:path';
import { isBuiltin } from 'node:module';
import type { ImportViolation } from './types.js';

export type { ImportViolation } from './types.js';

interface FoundImport {
  spec: string;
  typeOnly: boolean;
}

const IMPORT_PATTERNS: { regex: RegExp; typeGroup?: number; specGroup: number }[] = [
  // import x from '...', import { a, b } from '...', import * as ns from '...' (multilínea)
  { regex: /\bimport\s+(type\s+)?[\w$*\s,{}]+?\s*from\s*['"]([^'"]+)['"]/g, typeGroup: 1, specGroup: 2 },
  // export { a } from '...', export * from '...', export * as ns from '...'
  {
    regex: /\bexport\s+(type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
    typeGroup: 1,
    specGroup: 2
  },
  // import '...'  (side-effect)
  { regex: /\bimport\s*['"]([^'"]+)['"]/g, specGroup: 1 },
  // import('...')  (dinámico con literal)
  { regex: /\bimport\s*\(\s*['"]([^'"]+)['"]/g, specGroup: 1 },
  // require('...')
  { regex: /\brequire\s*\(\s*['"]([^'"]+)['"]/g, specGroup: 1 }
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

function findImports(source: string): FoundImport[] {
  const code = stripComments(source);
  const found: FoundImport[] = [];
  for (const { regex, typeGroup, specGroup } of IMPORT_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      const spec = match[specGroup];
      if (!spec) continue;
      found.push({ spec, typeOnly: typeGroup !== undefined && Boolean(match[typeGroup]) });
    }
  }
  return found;
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

    for (const { spec, typeOnly } of findImports(content)) {
      // `import type` se borra al compilar: no crea acoplamiento en runtime
      // (así un plugin puede tipar su contrato contra los tipos del gatekeeper).
      if (typeOnly) continue;

      if (spec.startsWith('.') || path.isAbsolute(spec)) {
        // Import relativo/absoluto: al resolverse no puede salir de absCapsuleDir
        const resolved = path.resolve(path.dirname(file), spec);
        if (!isInside(resolved, absCapsuleDir)) {
          violations.push({
            file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
            importedPath: spec,
            reason: `Relative import escapes plugin capsule boundary (${capsuleDir})`
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
            file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
            importedPath: spec,
            reason: `Undeclared external package import '${spec}' not in allowedExternalPackages`
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
