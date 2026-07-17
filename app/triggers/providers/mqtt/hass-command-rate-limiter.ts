export interface HassCommandRateLimiterOptions {
  minIntervalMs: number;
  maxTrackedKeys?: number; // default 10_000, mirrors HASS_CONTAINER_STATE_TOPIC_TRACK_LIMIT
  now?: () => number; // default Date.now
}

export class HassCommandRateLimiter {
  private readonly minIntervalMs: number;
  private readonly maxTrackedKeys: number;
  private readonly now: () => number;
  private readonly lastAcceptedAtByKey = new Map<string, number>();

  constructor({
    minIntervalMs,
    maxTrackedKeys = 10_000,
    now = () => Date.now(),
  }: HassCommandRateLimiterOptions) {
    this.minIntervalMs = minIntervalMs;
    this.maxTrackedKeys = maxTrackedKeys;
    this.now = now;
  }

  /**
   * Returns true (and records acceptance) if `key` may proceed now. The
   * timestamp is recorded synchronously, before the caller does anything
   * async — this is what closes the QoS1 duplicate-delivery race: two
   * messages for the same container arriving back-to-back before the first
   * `requestContainerUpdate` call resolves must not both pass.
   */
  tryConsume(key: string): boolean {
    const nowMs = this.now();
    const lastAcceptedAt = this.lastAcceptedAtByKey.get(key);
    if (lastAcceptedAt !== undefined && nowMs - lastAcceptedAt < this.minIntervalMs) {
      return false;
    }
    this.lastAcceptedAtByKey.delete(key); // re-insert for FIFO recency ordering
    this.lastAcceptedAtByKey.set(key, nowMs);
    this.enforceLimit();
    return true;
  }

  private enforceLimit(): void {
    const overBy = this.lastAcceptedAtByKey.size - this.maxTrackedKeys;
    if (overBy <= 0) return;
    let removed = 0;
    for (const trackedKey of this.lastAcceptedAtByKey.keys()) {
      this.lastAcceptedAtByKey.delete(trackedKey);
      removed += 1;
      if (removed >= overBy) break;
    }
  }

  clear(): void {
    this.lastAcceptedAtByKey.clear();
  }
}
