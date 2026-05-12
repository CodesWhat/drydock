export interface DigestBufferLog {
  debug(message: string): void;
  warn(message: string): void;
}

type DigestBufferNumberOption = number | (() => number);

export interface DigestBufferOptions<TEntry> {
  name: string;
  entries: Map<string, TEntry>;
  timestamps: Map<string, number>;
  retentionMs: DigestBufferNumberOption;
  maxEntries: DigestBufferNumberOption;
  log: DigestBufferLog;
}

export class DigestBuffer<TEntry> {
  private readonly name: string;
  private readonly entries: Map<string, TEntry>;
  private readonly timestamps: Map<string, number>;
  private readonly retentionMs: () => number;
  private readonly maxEntries: () => number;
  private readonly log: DigestBufferLog;

  constructor(options: DigestBufferOptions<TEntry>) {
    this.name = options.name;
    this.entries = options.entries;
    this.timestamps = options.timestamps;
    this.retentionMs = DigestBuffer.resolveNumberOption(options.retentionMs);
    this.maxEntries = DigestBuffer.resolveNumberOption(options.maxEntries);
    this.log = options.log;
  }

  private static resolveNumberOption(option: DigestBufferNumberOption): () => number {
    return typeof option === 'function' ? option : () => option;
  }

  static deleteEntry<TEntry>(
    entries: Map<string, TEntry>,
    timestamps: Map<string, number>,
    key: string,
  ): boolean {
    const deleted = entries.delete(key);
    timestamps.delete(key);
    return deleted;
  }

  delete(key: string): boolean {
    return DigestBuffer.deleteEntry(this.entries, this.timestamps, key);
  }

  set(key: string, entry: TEntry, now = Date.now()): void {
    this.pruneStale(now);
    this.entries.set(key, entry);
    this.timestamps.set(key, now);
    this.enforceLimit();
  }

  prune(now = Date.now()): void {
    this.pruneStale(now);
    this.enforceLimit();
  }

  pruneStale(now: number): void {
    const retentionMs = this.retentionMs();
    if (retentionMs <= 0) {
      return;
    }

    const oldestAllowedTimestamp = now - retentionMs;
    for (const key of this.entries.keys()) {
      const updatedAt = this.timestamps.get(key);
      if (updatedAt === undefined) {
        this.timestamps.set(key, now);
        continue;
      }

      if (updatedAt < oldestAllowedTimestamp) {
        this.delete(key);
        this.log.debug(`Evicted stale ${this.name} entry ${key}`);
      }
    }
  }

  enforceLimit(): void {
    const maxEntries = this.maxEntries();
    if (maxEntries <= 0) {
      this.entries.clear();
      this.timestamps.clear();
      return;
    }

    while (this.entries.size > maxEntries) {
      let oldestKey: string | undefined;
      let oldestUpdatedAt = Number.POSITIVE_INFINITY;

      for (const key of this.entries.keys()) {
        const updatedAt = this.timestamps.get(key) ?? 0;
        if (updatedAt < oldestUpdatedAt) {
          oldestUpdatedAt = updatedAt;
          oldestKey = key;
        }
      }

      if (!oldestKey) {
        break;
      }

      this.delete(oldestKey);
      this.log.warn(
        `Evicted oldest ${this.name} entry ${oldestKey} after reaching the ${maxEntries}-entry limit`,
      );
    }
  }
}
