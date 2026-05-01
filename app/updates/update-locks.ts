import { LockManager, Semaphore } from './locks.js';

export interface ContainerLockReference {
  name: string;
  watcher: string;
}

/**
 * Parse DD_UPDATE_MAX_CONCURRENT from the environment.
 *
 * Returns `null` when the variable is absent, empty, or "0" (unlimited).
 * Returns a positive integer when a valid cap is set.
 * Throws a descriptive Error for invalid values (negative, non-integer, etc.)
 * so the process fails fast at startup rather than silently ignoring
 * operator intent.
 */
export function parseMaxConcurrent(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '' || raw.trim() === '0') {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`DD_UPDATE_MAX_CONCURRENT must be a non-negative integer (got "${raw}")`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`DD_UPDATE_MAX_CONCURRENT must be a non-negative integer (got "${raw}")`);
  }
  // parsed === 0 covered by the trim check above, so parsed >= 1 here.
  return parsed;
}

const updateLockManager = new LockManager();

const _maxConcurrent = parseMaxConcurrent(process.env.DD_UPDATE_MAX_CONCURRENT);
const globalSemaphore: Semaphore | null =
  _maxConcurrent !== null ? new Semaphore(_maxConcurrent) : null;

export async function withContainerUpdateLocks<T>(
  keys: readonly string[],
  fn: () => Promise<T>,
  options?: { bypassGlobalCap?: boolean },
): Promise<T> {
  if (globalSemaphore === null || options?.bypassGlobalCap === true) {
    return updateLockManager.withLocks(keys, fn);
  }

  const releaseSemaphore = await globalSemaphore.acquire();
  try {
    return await updateLockManager.withLocks(keys, fn);
  } finally {
    releaseSemaphore();
  }
}

export function buildContainerLockKey(container: ContainerLockReference): string {
  return `container:${container.watcher}:${container.name}`;
}

export function buildComposeProjectLockKey(
  container: ContainerLockReference,
  composeProject: string,
): string {
  return `compose:${container.watcher}:${composeProject}`;
}

export interface UpdateLockSnapshot {
  held: string[];
  pending: Array<{ key: string; waiters: number }>;
  semaphore?: {
    available: number;
    pending: number;
  };
}

export function getUpdateLockSnapshot(): UpdateLockSnapshot {
  const snap: UpdateLockSnapshot = {
    held: updateLockManager.held(),
    pending: updateLockManager.pending(),
  };
  if (globalSemaphore !== null) {
    snap.semaphore = {
      available: globalSemaphore.available(),
      pending: globalSemaphore.pending(),
    };
  }
  return snap;
}
