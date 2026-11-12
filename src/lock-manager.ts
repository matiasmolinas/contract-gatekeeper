// src/lock-manager.ts
import fs from 'node:fs';
import path from 'node:path';

export interface CapabilityLock {
  capsule: string;
  agentId: string;
  acquiredAt: string;
}

function lockFilePath(): string {
  return path.resolve(process.cwd(), '.gatekeeper-locks.json');
}

export function readLocks(): Record<string, CapabilityLock> {
  const file = lockFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocks(locks: Record<string, CapabilityLock>): void {
  const file = lockFilePath();
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(locks, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/**
 * Exclusión mutua entre procesos: sin esto, dos agentes que piden el mismo
 * bloqueo a la vez leen el archivo vacío y ambos creen haberlo adquirido.
 */
function withMutex<T>(fn: () => T): T {
  const mutex = `${lockFilePath()}.lock`;
  const deadline = Date.now() + 3000;
  let fd: number;
  for (;;) {
    try {
      fd = fs.openSync(mutex, 'wx');
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        // Mutex huérfano de un proceso que murió a mitad de la operación
        if (Date.now() - fs.statSync(mutex).mtimeMs > 5000) {
          fs.rmSync(mutex, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`No se pudo obtener el mutex de bloqueos (${mutex}).`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(mutex, { force: true });
  }
}

export function acquireLock(capsule: string, agentId: string): { ok: boolean; holder?: string } {
  return withMutex(() => {
    const locks = readLocks();
    const existing = locks[capsule];
    if (existing && existing.agentId !== agentId) {
      return { ok: false, holder: existing.agentId };
    }
    locks[capsule] = { capsule, agentId, acquiredAt: new Date().toISOString() };
    writeLocks(locks);
    return { ok: true };
  });
}

export function releaseLock(capsule: string, agentId: string): boolean {
  return withMutex(() => {
    const locks = readLocks();
    if (locks[capsule]?.agentId === agentId) {
      delete locks[capsule];
      writeLocks(locks);
      return true;
    }
    return false;
  });
}

/** Agente (distinto de `agentId`) que tiene bloqueada la cápsula, si lo hay. */
export function checkContention(capsule: string, agentId?: string): CapabilityLock | undefined {
  const lock = readLocks()[capsule];
  return lock && lock.agentId !== agentId ? lock : undefined;
}
