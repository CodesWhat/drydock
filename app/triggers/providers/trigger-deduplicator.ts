export interface DeduplicatorOptions {
  recentSeenAt: Map<string, number>;
  onceSeen: Set<string>;
  suppressionWindowMs: number;
  retentionMs: number;
}

export class Deduplicator {
  private readonly recentSeenAt: Map<string, number>;
  private readonly onceSeen: Set<string>;
  private readonly suppressionWindowMs: number;
  private readonly retentionMs: number;

  constructor(options: DeduplicatorOptions) {
    this.recentSeenAt = options.recentSeenAt;
    this.onceSeen = options.onceSeen;
    this.suppressionWindowMs = options.suppressionWindowMs;
    this.retentionMs = options.retentionMs;
  }

  shouldSuppressRecent(signature: string, now = Date.now()): boolean {
    const previousSeenAt = this.recentSeenAt.get(signature);
    this.recentSeenAt.set(signature, now);
    this.pruneRecent(now);

    return previousSeenAt !== undefined && now - previousSeenAt < this.suppressionWindowMs;
  }

  pruneRecent(now: number): void {
    const oldestAllowedTimestamp = now - this.retentionMs;
    for (const [signature, seenAt] of this.recentSeenAt.entries()) {
      if (seenAt < oldestAllowedTimestamp) {
        this.recentSeenAt.delete(signature);
      }
    }
  }

  markOnce(key: string): boolean {
    if (this.onceSeen.has(key)) {
      return false;
    }
    this.onceSeen.add(key);
    return true;
  }

  clearOnceByPrefix(prefix: string): void {
    for (const key of this.onceSeen) {
      if (key.startsWith(prefix)) {
        this.onceSeen.delete(key);
      }
    }
  }

  clear(): void {
    this.recentSeenAt.clear();
    this.onceSeen.clear();
  }
}
