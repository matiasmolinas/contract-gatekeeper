// src/git-inspector.ts
import { execFileSync } from 'node:child_process';

// execFile (sin shell): los refs llegan por CLI y no deben poder inyectar comandos.
function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024
  });
}

function toLines(output: string): string[] {
  return output
    .split('\n')
    .map(line => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

export function getChangedFilesFromGit(baseRef: string, headRef: string): string[] {
  try {
    // --relative: rutas relativas al cwd, igual que config.pluginsDir
    return toLines(git(['diff', '--name-only', '--relative', `${baseRef}...${headRef}`]));
  } catch {
    // Si aún no hay commits en una rama separada, compara working tree contra HEAD
    try {
      const output = git(['status', '--porcelain', '--untracked-files=all']);
      return output
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const entry = line.slice(3).trim();
          const renamed = entry.split(' -> ');
          return (renamed[renamed.length - 1] ?? entry).replace(/^"|"$/g, '').replace(/\\/g, '/');
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

/** true si `ref` resuelve a un commit en el repositorio actual. */
export function refExists(ref: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Archivos (rutas relativas al cwd) que existían bajo `dir` en `ref`. */
export function listFilesAtRef(ref: string, dir: string): string[] {
  try {
    return git(['ls-tree', '-r', '--name-only', '-z', ref, '--', `./${dir.replace(/\\/g, '/')}/`])
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Contenido binario de un archivo (ruta relativa al cwd) en `ref`, o null si no existía. */
export function readBlobAtRef(ref: string, relativePath: string): Buffer | null {
  try {
    return execFileSync('git', ['show', `${ref}:./${relativePath.replace(/\\/g, '/')}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024
    });
  } catch {
    return null;
  }
}
