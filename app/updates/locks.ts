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
    const next = (this.waitersByKey.get(key) as number) - 1;
    if (next <= 0) {
      this.waitersByKey.delete(key);
    } else {
      this.waitersByKey.set(key, next);
    }
  }
}
