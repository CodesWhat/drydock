/**
 * Counting semaphore with FIFO acquisition order.
 *
 * `acquire()` returns a release function. Hold the release until the critical
 * section is complete, then call it to wake the next waiter.
 *
 * permits=0 means no callers can ever acquire (they wait forever). Use a
 * positive permits value. Zero is accepted by the constructor but callers
 * will block indefinitely until released externally — this is not a useful
 * production configuration; prefer omitting the global cap (unlimited) or
 * setting permits ≥ 1.
 */
export class Semaphore {
  private _available: number;
  private readonly _waiters: Array<() => void> = [];

  constructor(permits: number) {
    if (!Number.isInteger(permits) || permits < 0) {
      throw new RangeError(`Semaphore permits must be a non-negative integer (got ${permits})`);
    }
    this._available = permits;
  }

  async acquire(): Promise<() => void> {
    if (this._available > 0) {
      this._available--;
      return this._makeRelease();
    }

    await new Promise<void>((resolve) => {
      this._waiters.push(resolve);
    });
    // A waiter is woken by release(), which already decrements _available for
    // the next slot. We do not decrement here because release() does it inline
    // by not incrementing back when it wakes a waiter.
    return this._makeRelease();
  }

  available(): number {
    return this._available;
  }

  pending(): number {
    return this._waiters.length;
  }

  private _makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this._waiters.shift();
      if (next) {
        // Hand the permit directly to the next waiter without changing _available.
        next();
      } else {
        this._available++;
      }
    };
  }
}

/**
 * FIFO lock manager keyed by string. Multiple keys can be acquired atomically:
 * keys are sorted before acquisition so concurrent callers requesting
 * overlapping key sets cannot deadlock.
 *
 * Used to serialise concurrent update operations on the same container or
 * compose project while letting unrelated updates proceed in parallel.
 */
export class LockManager {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly heldKeys = new Set<string>();
  private readonly waitersByKey = new Map<string, number>();

  async withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    const sorted = Array.from(new Set(keys)).sort();
    const releases: Array<() => void> = [];
    try {
      for (const key of sorted) {
        releases.push(await this.acquire(key));
      }
      return await fn();
    } finally {
      for (let i = releases.length - 1; i >= 0; i--) {
        releases[i]();
      }
    }
  }

  held(): string[] {
    return [...this.heldKeys].sort();
  }

  pending(): Array<{ key: string; waiters: number }> {
    const out: Array<{ key: string; waiters: number }> = [];
    for (const [key, waiters] of this.waitersByKey) {
      out.push({ key, waiters });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  }

  isHeld(key: string): boolean {
    return this.heldKeys.has(key);
  }

  private async acquire(key: string): Promise<() => void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = () => {
        this.heldKeys.delete(key);
        if (this.tails.get(key) === next) {
          this.tails.delete(key);
        }
        resolve();
      };
    });
    this.tails.set(key, next);

    this.incrementWaiters(key);
    try {
      await prev;
    } finally {
      this.decrementWaiters(key);
    }
    this.heldKeys.add(key);
    return release;
  }

  private incrementWaiters(key: string): void {
    this.waitersByKey.set(key, (this.waitersByKey.get(key) ?? 0) + 1);
  }

  private decrementWaiters(key: string): void {
    const next = (this.waitersByKey.get(key) ?? 0) - 1;
    if (next <= 0) {
      this.waitersByKey.delete(key);
    } else {
      this.waitersByKey.set(key, next);
    }
  }
}
