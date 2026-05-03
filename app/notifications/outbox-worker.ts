import log from '../log/index.js';
import type { NotificationOutboxEntry } from '../model/notification-outbox.js';
import {
  findReadyForDelivery,
  markOutboxEntryAttempted,
  markOutboxEntryDelivered,
  purgeTerminalOutboxEntriesOlderThan,
} from '../store/notification-outbox.js';

export type OutboxDeliveryHandler = (entry: NotificationOutboxEntry) => Promise<void>;

export interface OutboxWorkerOptions {
  deliver: OutboxDeliveryHandler;
  intervalMs?: number;
  ttlMs?: number;
  purgeEveryDrains?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
  maxDrainConcurrency?: number;
  randomFn?: () => number;
  nowFn?: () => Date;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PURGE_EVERY_DRAINS = 12;
const DEFAULT_BASE_BACKOFF_MS = 30_000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_JITTER_MS = 5_000;
const DEFAULT_MAX_DRAIN_CONCURRENCY = 10;

const workerLog = log.child({ component: 'notifications.outbox-worker' });

interface ResolvedOptions {
  deliver: OutboxDeliveryHandler;
  intervalMs: number;
  ttlMs: number;
  purgeEveryDrains: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  jitterMs: number;
  maxDrainConcurrency: number;
  randomFn: () => number;
  nowFn: () => Date;
}

class DrainSemaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) {
      return this.runNow(task);
    }

    return new Promise((resolve) => {
      this.waiting.push(() => resolve(this.runNow(task)));
    });
  }

  private runNow<T>(task: () => Promise<T>): Promise<T> {
    this.active += 1;
    return Promise.resolve()
      .then(task)
      .finally(() => {
        this.release();
      });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) {
      next();
    }
  }
}

function resolveMaxDrainConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_DRAIN_CONCURRENCY;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Drains the notification outbox on a fixed interval. Each ready entry is
 * passed to `deliver` under `maxDrainConcurrency`; success marks it delivered,
 * failure schedules a retry with exponential backoff + jitter and (after
 * maxAttempts) transitions the entry to dead-letter via the store.
 */
export class OutboxWorker {
  private readonly inflight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private drainsSincePurge = 0;
  private readonly options: ResolvedOptions;

  constructor(opts: OutboxWorkerOptions) {
    this.options = {
      deliver: opts.deliver,
      intervalMs: opts.intervalMs ?? DEFAULT_INTERVAL_MS,
      ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
      purgeEveryDrains: opts.purgeEveryDrains ?? DEFAULT_PURGE_EVERY_DRAINS,
      baseBackoffMs: opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
      maxBackoffMs: opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
      jitterMs: opts.jitterMs ?? DEFAULT_JITTER_MS,
      maxDrainConcurrency: resolveMaxDrainConcurrency(opts.maxDrainConcurrency),
      randomFn: opts.randomFn ?? Math.random,
      nowFn: opts.nowFn ?? (() => new Date()),
    };
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.drain();
    }, this.options.intervalMs);
    void this.drain();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.inflight.clear();
  }

  isRunning(): boolean {
    return this.timer !== undefined;
  }

  async drain(): Promise<void> {
    const nowIso = this.options.nowFn().toISOString();
    const ready = findReadyForDelivery(nowIso);
    const dispatches: Promise<void>[] = [];
    const semaphore = new DrainSemaphore(this.options.maxDrainConcurrency);
    for (const entry of ready) {
      if (entry.status !== 'pending') {
        continue;
      }
      if (this.inflight.has(entry.id)) {
        continue;
      }
      this.inflight.add(entry.id);
      dispatches.push(
        semaphore
          .run(() => this.dispatch(entry))
          .finally(() => {
            this.inflight.delete(entry.id);
          }),
      );
    }
    this.drainsSincePurge += 1;
    if (this.drainsSincePurge >= this.options.purgeEveryDrains) {
      this.drainsSincePurge = 0;
      this.purgeTerminal();
    }
    await Promise.all(dispatches);
  }

  private async dispatch(entry: NotificationOutboxEntry): Promise<void> {
    try {
      await this.options.deliver(entry);
      markOutboxEntryDelivered(entry.id);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const nextAttempt = entry.attempts + 1;
      const nextAttemptAt = this.computeNextAttemptAt(nextAttempt);
      const result = markOutboxEntryAttempted(entry.id, {
        error: errorMessage,
        nextAttemptAt,
      });
      if (result?.status === 'dead-letter') {
        workerLog.warn(
          `Outbox ${entry.id} (event=${entry.eventName} trigger=${entry.triggerId}) → dead-letter after ${result.attempts} attempts: ${errorMessage}`,
        );
      } else {
        workerLog.debug(
          `Outbox ${entry.id} (event=${entry.eventName} trigger=${entry.triggerId}) attempt ${nextAttempt} failed: ${errorMessage}; retry at ${nextAttemptAt}`,
        );
      }
    }
  }

  private computeNextAttemptAt(attemptNumber: number): string {
    const exp = Math.min(
      this.options.baseBackoffMs * 2 ** (attemptNumber - 1),
      this.options.maxBackoffMs,
    );
    const jitter = this.options.randomFn() * this.options.jitterMs;
    const target = this.options.nowFn().getTime() + exp + jitter;
    return new Date(target).toISOString();
  }

  private purgeTerminal(): void {
    const cutoff = new Date(this.options.nowFn().getTime() - this.options.ttlMs).toISOString();
    const removed = purgeTerminalOutboxEntriesOlderThan(cutoff);
    if (removed > 0) {
      workerLog.debug(`Purged ${removed} terminal outbox entries older than ${cutoff}`);
    }
  }
}

let singleton: OutboxWorker | undefined;

export function startOutboxWorker(opts: OutboxWorkerOptions): OutboxWorker {
  if (singleton) {
    return singleton;
  }
  singleton = new OutboxWorker(opts);
  singleton.start();
  return singleton;
}

export function stopOutboxWorker(): void {
  if (singleton) {
    singleton.stop();
    singleton = undefined;
  }
}

export function getOutboxWorker(): OutboxWorker | undefined {
  return singleton;
}
