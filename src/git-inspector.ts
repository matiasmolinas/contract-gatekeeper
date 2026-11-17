// src/git-inspector.ts
import { execFileSync } from 'node:child_process';

// execFile (sin shell): los refs llegan por CLI y no deben poder inyectar comandos.
// `cwd`: repositorio donde correr git (por defecto el directorio actual).
function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
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

export function getChangedFilesFromGit(baseRef: string, headRef: string, cwd?: string): string[] {
  try {
    // --relative: rutas relativas al cwd, igual que config.pluginsDir
    return toLines(git(['diff', '--name-only', '--relative', `${baseRef}...${headRef}`], cwd));
  } catch (err) {
    // Con un repositorio explícito (replay) no hay working tree que mirar: el error sube
    if (cwd !== undefined) throw new Error(`git diff ${baseRef}...${headRef} failed: ${(err as Error).message}`);
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

/** Cambios sin commitear del working tree (modificados, staged y sin trackear). */
export function getWorkingTreeChanges(): string[] {
  try {
    return git(['status', '--porcelain', '--untracked-files=all'])
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

/** true si `ref` resuelve a un commit en el repositorio actual. */
export function refExists(ref: string, cwd?: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Archivos (rutas relativas al cwd) que existían bajo `dir` en `ref`. */
export function listFilesAtRef(ref: string, dir: string, cwd?: string): string[] {
  try {
    return git(['ls-tree', '-r', '--name-only', '-z', ref, '--', `./${dir.replace(/\\/g, '/')}/`], cwd)
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Contenido binario de un archivo (ruta relativa al cwd) en `ref`, o null si no existía. */
export function readBlobAtRef(ref: string, relativePath: string, cwd?: string): Buffer | null {
  try {
    return execFileSync('git', ['show', `${ref}:./${relativePath.replace(/\\/g, '/')}`], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024
    });
  } catch {
    return null;
  }
}

/** Ruta del cwd relativa a la raíz del repositorio (`git rev-parse --show-prefix`). */
export function repoPrefix(cwd?: string): string {
  return git(['rev-parse', '--show-prefix'], cwd).trim();
}

/**
 * Escribe en `targetDir` el árbol de `ref` bajo `prefix`, sin tocar el working
 * tree ni el índice (`git archive` + `tar`): solo lectura sobre el repositorio.
 */
export function materializeTree(ref: string, prefix: string, targetDir: string, cwd?: string): void {
  const treeish = prefix ? `${ref}:${prefix.replace(/\/+$/, '')}` : ref;
  const tar = execFileSync('git', ['archive', '--format=tar', treeish], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024
  });
  execFileSync('tar', ['-x', '-f', '-', '-C', targetDir], { input: tar, stdio: ['pipe', 'ignore', 'pipe'] });
}
