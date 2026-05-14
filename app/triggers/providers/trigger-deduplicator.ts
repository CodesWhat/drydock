export interface RecentSignatureSuppressorOptions {
  seenAt: Map<string, number>;
  suppressionWindowMs: number;
  retentionMs: number;
}

export class RecentSignatureSuppressor {
  private readonly seenAt: Map<string, number>;
  private readonly suppressionWindowMs: number;
  private readonly retentionMs: number;

  constructor(options: RecentSignatureSuppressorOptions) {
    this.seenAt = options.seenAt;
    this.suppressionWindowMs = options.suppressionWindowMs;
    this.retentionMs = options.retentionMs;
  }

  shouldSuppress(signature: string, now = Date.now()): boolean {
    const previousSeenAt = this.seenAt.get(signature);
    this.seenAt.set(signature, now);
    this.prune(now);

    return previousSeenAt !== undefined && now - previousSeenAt < this.suppressionWindowMs;
  }

  prune(now: number): void {
    const oldestAllowedTimestamp = now - this.retentionMs;
    for (const [signature, seenAt] of this.seenAt.entries()) {
      if (seenAt < oldestAllowedTimestamp) {
        this.seenAt.delete(signature);
      }
    }
  }

  clear(): void {
    this.seenAt.clear();
  }
}

export interface OneShotKeyTrackerOptions {
  seenKeys: Set<string>;
}

/**
 * Tracks one-shot keys that should emit at most once until explicitly reset.
 *
 * Keys do not expire by time. The only selective eviction path is
 * `clearByPrefix()`, which callers use when the underlying container/update
 * state changes and the one-shot transition may be emitted again.
 */
export class OneShotKeyTracker {
  private readonly seenKeys: Set<string>;

  constructor(options: OneShotKeyTrackerOptions) {
    this.seenKeys = options.seenKeys;
  }

  markOnce(key: string): boolean {
    if (this.seenKeys.has(key)) {
      return false;
    }
    this.seenKeys.add(key);
    return true;
  }

  clearByPrefix(prefix: string): void {
    for (const key of this.seenKeys) {
      if (key.startsWith(prefix)) {
        this.seenKeys.delete(key);
      }
    }
  }

  clear(): void {
    this.seenKeys.clear();
  }
}
