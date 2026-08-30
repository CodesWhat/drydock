import { parseEnvNonNegativeInteger } from '../util/parse.js';
import { LockManager, Semaphore } from './lock-primitives.js';

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
  const parsed = parseEnvNonNegativeInteger(raw, 'DD_UPDATE_MAX_CONCURRENT');
  if (parsed === undefined || parsed === 0) {
    return null;
  }
  return parsed;
}

const updateLockManager = new LockManager();

interface UpdateLifecycleGateWaiter {
  exclusive: boolean;
  resolve: (release: () => void) => void;
}

/**
 * Fair shared/exclusive gate for complete update lifecycles.
 *
 * Regular updates share the gate and can still run concurrently. A self-update
 * takes it exclusively, so it waits for active work to drain and later regular
 * updates queue behind it. Arrival order is preserved at the first waiter,
 * preventing either side from starving the other.
 */
class UpdateLifecycleGate {
  private activeShared = 0;

  private exclusiveActive = false;

  private readonly waiters: UpdateLifecycleGateWaiter[] = [];

  async withAccess<T>(
    exclusive: boolean,
    fn: () => Promise<T>,
    retainExclusiveOnResult?: (result: T) => boolean,
  ): Promise<T> {
    const release = await this.acquire(exclusive);
    let retainExclusive = false;
    try {
      const result = await fn();
      retainExclusive =
        exclusive && retainExclusiveOnResult !== undefined && retainExclusiveOnResult(result);
      return result;
    } finally {
      if (!retainExclusive) {
        release();
      }
    }
  }

  private acquire(exclusive: boolean): Promise<() => void> {
    if (this.canAcquireImmediately(exclusive)) {
      this.markAcquired(exclusive);
      return Promise.resolve(this.makeRelease(exclusive));
    }

    return new Promise<() => void>((resolve) => {
      this.waiters.push({ exclusive, resolve });
    });
  }

  private canAcquireImmediately(exclusive: boolean): boolean {
    if (this.waiters.length > 0 || this.exclusiveActive) {
      return false;
    }
    return !exclusive || this.activeShared === 0;
  }

  private markAcquired(exclusive: boolean): void {
    if (exclusive) {
      this.exclusiveActive = true;
    } else {
      this.activeShared++;
    }
  }

  private makeRelease(exclusive: boolean): () => void {
    return () => {
      if (exclusive) {
        this.exclusiveActive = false;
      } else {
        this.activeShared--;
      }
      this.drain();
    };
  }

  private drain(): void {
    if (this.exclusiveActive || this.activeShared > 0) {
      return;
    }

    const first = this.waiters.shift();
    if (!first) {
      return;
    }

    this.markAcquired(first.exclusive);
    first.resolve(this.makeRelease(first.exclusive));
    if (first.exclusive) {
      return;
    }

    while (this.waiters[0]?.exclusive === false) {
      const shared = this.waiters.shift()!;
      this.markAcquired(false);
      shared.resolve(this.makeRelease(false));
    }
  }
}

const updateLifecycleGate = new UpdateLifecycleGate();

const _maxConcurrent = parseMaxConcurrent(process.env.DD_UPDATE_MAX_CONCURRENT);
const globalSemaphore: Semaphore | null =
  _maxConcurrent !== null ? new Semaphore(_maxConcurrent) : null;

/**
 * Whether a global concurrency cap is configured. When false, every accepted
 * update runs as soon as it is dispatched — no queue exists, so callers can
 * skip emitting the transient `queued` state to the UI.
 */
export function hasUpdateConcurrencyCap(): boolean {
  return globalSemaphore !== null;
}

export async function withContainerUpdateLocks<T>(
  keys: readonly string[],
  fn: () => Promise<T>,
  options?: {
    bypassGlobalCap?: boolean;
    exclusive?: boolean;
    retainExclusiveOnResult?: (result: T) => boolean;
  },
): Promise<T> {
  return updateLifecycleGate.withAccess(
    options?.exclusive === true,
    async () => {
      if (globalSemaphore === null || options?.bypassGlobalCap === true) {
        return updateLockManager.withLocks(keys, fn);
      }

      const releaseSemaphore = await globalSemaphore.acquire();
      try {
        return await updateLockManager.withLocks(keys, fn);
      } finally {
        releaseSemaphore();
      }
    },
    options?.retainExclusiveOnResult,
  );
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
