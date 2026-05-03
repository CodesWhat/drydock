const { debugSpy, warnSpy } = vi.hoisted(() => ({
  debugSpy: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: () => ({
      info: vi.fn(),
      warn: warnSpy,
      debug: debugSpy,
      error: vi.fn(),
    }),
  },
}));

const {
  mockFindReadyForDelivery,
  mockMarkOutboxEntryAttempted,
  mockMarkOutboxEntryDelivered,
  mockPurgeTerminalOutboxEntriesOlderThan,
} = vi.hoisted(() => ({
  mockFindReadyForDelivery: vi.fn(),
  mockMarkOutboxEntryAttempted: vi.fn(),
  mockMarkOutboxEntryDelivered: vi.fn(),
  mockPurgeTerminalOutboxEntriesOlderThan: vi.fn(),
}));

vi.mock('../store/notification-outbox.js', () => ({
  findReadyForDelivery: mockFindReadyForDelivery,
  markOutboxEntryAttempted: mockMarkOutboxEntryAttempted,
  markOutboxEntryDelivered: mockMarkOutboxEntryDelivered,
  purgeTerminalOutboxEntriesOlderThan: mockPurgeTerminalOutboxEntriesOlderThan,
}));

import type { NotificationOutboxEntry } from '../model/notification-outbox.js';
import {
  getOutboxWorker,
  OutboxWorker,
  startOutboxWorker,
  stopOutboxWorker,
} from './outbox-worker.js';

function makeEntry(overrides: Partial<NotificationOutboxEntry> = {}): NotificationOutboxEntry {
  return {
    id: 'entry-1',
    eventName: 'container.update',
    payload: {},
    triggerId: 'trigger-a',
    attempts: 0,
    maxAttempts: 5,
    nextAttemptAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('OutboxWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFindReadyForDelivery.mockReturnValue([]);
    mockPurgeTerminalOutboxEntriesOlderThan.mockReturnValue(0);
    // stop singleton between tests
    stopOutboxWorker();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopOutboxWorker();
  });

  // ── 1. constructor defaults ────────────────────────────────────────────────
  describe('constructor', () => {
    test('applies option defaults when none are supplied', () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      const w = new OutboxWorker({ deliver });
      // Accessing via isRunning() to verify the worker is usable without crash
      expect(w.isRunning()).toBe(false);
    });

    test('custom options override defaults', () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      const nowFn = () => new Date('2026-04-01T00:00:00.000Z');
      const w = new OutboxWorker({
        deliver,
        intervalMs: 1000,
        ttlMs: 60_000,
        purgeEveryDrains: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 500,
        jitterMs: 50,
        randomFn: () => 0,
        nowFn,
      });
      expect(w.isRunning()).toBe(false);
    });
  });

  // ── 2. start() — schedules interval and drains immediately ─────────────────
  describe('start()', () => {
    test('sets isRunning() to true and drains immediately', async () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      mockFindReadyForDelivery.mockReturnValue([]);

      const w = new OutboxWorker({ deliver, intervalMs: 10_000 });
      w.start();

      expect(w.isRunning()).toBe(true);
      expect(mockFindReadyForDelivery).toHaveBeenCalledTimes(1);
      expect(deliver).not.toHaveBeenCalled();
    });

    test('interval fires drain repeatedly', async () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      mockFindReadyForDelivery.mockReturnValue([]);

      const w = new OutboxWorker({ deliver, intervalMs: 1_000 });
      w.start();

      vi.advanceTimersByTime(3_000);

      // 1 immediate + 3 interval ticks
      expect(mockFindReadyForDelivery.mock.calls.length).toBeGreaterThanOrEqual(4);
      w.stop();
    });

    // ── 3. start() is idempotent ──────────────────────────────────────────────
    test('calling start() twice does not double-schedule', async () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      mockFindReadyForDelivery.mockReturnValue([]);

      const w = new OutboxWorker({ deliver, intervalMs: 1_000 });
      w.start();
      w.start(); // second call should be a no-op

      vi.advanceTimersByTime(1_000);

      // Only 1 immediate drain + 1 interval tick = 2 total
      expect(mockFindReadyForDelivery).toHaveBeenCalledTimes(2);
      w.stop();
    });
  });

  // ── 4. stop() clears the interval ─────────────────────────────────────────
  describe('stop()', () => {
    test('sets isRunning() to false and prevents further drains', async () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      mockFindReadyForDelivery.mockReturnValue([]);

      const w = new OutboxWorker({ deliver, intervalMs: 1_000 });
      w.start();

      w.stop();
      expect(w.isRunning()).toBe(false);

      const callsBefore = mockFindReadyForDelivery.mock.calls.length;
      vi.advanceTimersByTime(5_000);
      expect(mockFindReadyForDelivery.mock.calls.length).toBe(callsBefore);
    });

    // ── 5. stop() when not running is a no-op ─────────────────────────────
    test('stop() when not running is a no-op', () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      const w = new OutboxWorker({ deliver });
      expect(() => w.stop()).not.toThrow();
      expect(w.isRunning()).toBe(false);
    });
  });

  // ── 6. drain() calls findReadyForDelivery with nowFn output ───────────────
  test('drain() calls findReadyForDelivery with nowFn ISO string', async () => {
    const fixedDate = new Date('2026-04-01T12:00:00.000Z');
    const deliver = vi.fn().mockResolvedValue(undefined);
    const w = new OutboxWorker({ deliver, nowFn: () => fixedDate });

    await w.drain();

    expect(mockFindReadyForDelivery).toHaveBeenCalledWith('2026-04-01T12:00:00.000Z');
  });

  // ── 7. drain() skips inflight entries ────────────────────────────────────
  test('drain() skips an entry whose id is already inflight', async () => {
    let resolveDeliver!: () => void;
    const inflightPromise = new Promise<void>((resolve) => {
      resolveDeliver = resolve;
    });
    const deliver = vi.fn().mockReturnValueOnce(inflightPromise);

    const entry = makeEntry({ id: 'slow-entry' });
    mockFindReadyForDelivery.mockReturnValue([entry]);

    const w = new OutboxWorker({ deliver });

    // First drain — entry goes inflight
    const drain1 = w.drain();

    // Second drain — same entry is still inflight; deliver should NOT be called again
    await w.drain();

    expect(deliver).toHaveBeenCalledTimes(1);

    // Resolve the inflight dispatch and verify success path settles
    resolveDeliver();
    await drain1;

    expect(mockMarkOutboxEntryDelivered).toHaveBeenCalledWith('slow-entry');
  });

  test('stop() releases inflight ids so a restarted worker can retry a still-pending entry', async () => {
    let resolveDeliver!: () => void;
    const inflightPromise = new Promise<void>((resolve) => {
      resolveDeliver = resolve;
    });
    const deliver = vi.fn().mockReturnValueOnce(inflightPromise).mockResolvedValue(undefined);

    const entry = makeEntry({ id: 'restart-entry' });
    mockFindReadyForDelivery.mockReturnValueOnce([]).mockReturnValue([entry]);

    const firstWorker = startOutboxWorker({ deliver, intervalMs: 1_000 });
    expect(firstWorker.isRunning()).toBe(true);
    expect(deliver).not.toHaveBeenCalled();

    const firstDrain = firstWorker.drain();
    expect(deliver).toHaveBeenCalledTimes(1);

    stopOutboxWorker();
    expect(firstWorker.isRunning()).toBe(false);

    const secondWorker = startOutboxWorker({ deliver, intervalMs: 1_000 });
    expect(secondWorker).not.toBe(firstWorker);
    expect(secondWorker.isRunning()).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(2);

    resolveDeliver();
    await firstDrain;

    expect(mockMarkOutboxEntryDelivered).toHaveBeenCalledWith('restart-entry');
  });

  // ── 8. successful delivery calls markOutboxEntryDelivered ────────────────
  test('successful deliver() calls markOutboxEntryDelivered(id)', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const entry = makeEntry();
    mockFindReadyForDelivery.mockReturnValue([entry]);

    const w = new OutboxWorker({ deliver });
    await w.drain();

    expect(mockMarkOutboxEntryDelivered).toHaveBeenCalledWith('entry-1');
    expect(mockMarkOutboxEntryAttempted).not.toHaveBeenCalled();
  });

  // ── 9. failed delivery calls markOutboxEntryAttempted with backoff ────────
  describe('failed delivery backoff', () => {
    test('backoff = base * 2^(attempt-1) with no jitter (randomFn=0)', async () => {
      const deliver = vi.fn().mockRejectedValue(new Error('network error'));
      const entry = makeEntry({ attempts: 0 });

      const fixedNow = new Date('2026-04-01T00:00:00.000Z');
      const baseBackoffMs = 1_000;

      mockFindReadyForDelivery.mockReturnValue([entry]);
      mockMarkOutboxEntryAttempted.mockReturnValue({ ...entry, status: 'pending', attempts: 1 });

      const w = new OutboxWorker({
        deliver,
        baseBackoffMs,
        maxBackoffMs: 60_000,
        jitterMs: 500,
        randomFn: () => 0, // no jitter
        nowFn: () => fixedNow,
      });

      await w.drain();

      // attempt 1 → base * 2^0 = 1000ms after fixedNow
      const expectedNextAttemptAt = new Date(
        fixedNow.getTime() + baseBackoffMs * 2 ** 0,
      ).toISOString();

      expect(mockMarkOutboxEntryAttempted).toHaveBeenCalledWith('entry-1', {
        error: 'network error',
        nextAttemptAt: expectedNextAttemptAt,
      });
    });

    test('backoff increases exponentially on subsequent attempts', async () => {
      const deliver = vi.fn().mockRejectedValue(new Error('fail'));
      // entry.attempts=2 → nextAttempt = 3 → base * 2^2
      const entry = makeEntry({ attempts: 2 });

      const fixedNow = new Date('2026-04-01T00:00:00.000Z');
      const baseBackoffMs = 1_000;

      mockFindReadyForDelivery.mockReturnValue([entry]);
      mockMarkOutboxEntryAttempted.mockReturnValue({ ...entry, status: 'pending', attempts: 3 });

      const w = new OutboxWorker({
        deliver,
        baseBackoffMs,
        maxBackoffMs: 60_000,
        jitterMs: 0,
        randomFn: () => 0,
        nowFn: () => fixedNow,
      });

      await w.drain();

      const expectedNextAttemptAt = new Date(
        fixedNow.getTime() + baseBackoffMs * 2 ** 2,
      ).toISOString();

      expect(mockMarkOutboxEntryAttempted).toHaveBeenCalledWith('entry-1', {
        error: 'fail',
        nextAttemptAt: expectedNextAttemptAt,
      });
    });

    // ── 10. backoff capped at maxBackoffMs ───────────────────────────────
    test('backoff is capped at maxBackoffMs', async () => {
      const deliver = vi.fn().mockRejectedValue(new Error('fail'));
      // high attempt count → base * 2^20 exceeds any sane cap
      const entry = makeEntry({ attempts: 20 });

      const fixedNow = new Date('2026-04-01T00:00:00.000Z');
      const maxBackoffMs = 300_000; // 5 min

      mockFindReadyForDelivery.mockReturnValue([entry]);
      mockMarkOutboxEntryAttempted.mockReturnValue({ ...entry, status: 'pending', attempts: 21 });

      const w = new OutboxWorker({
        deliver,
        baseBackoffMs: 1_000,
        maxBackoffMs,
        jitterMs: 0,
        randomFn: () => 0,
        nowFn: () => fixedNow,
      });

      await w.drain();

      const expectedNextAttemptAt = new Date(fixedNow.getTime() + maxBackoffMs).toISOString();

      expect(mockMarkOutboxEntryAttempted).toHaveBeenCalledWith('entry-1', {
        error: 'fail',
        nextAttemptAt: expectedNextAttemptAt,
      });
    });
  });

  // ── 11. dead-letter status logs warn ──────────────────────────────────────
  test('logs warn when markOutboxEntryAttempted returns dead-letter status', async () => {
    const deliver = vi.fn().mockRejectedValue(new Error('fatal'));
    const entry = makeEntry({ attempts: 4 });

    mockFindReadyForDelivery.mockReturnValue([entry]);
    mockMarkOutboxEntryAttempted.mockReturnValue({
      ...entry,
      attempts: 5,
      status: 'dead-letter',
      failedAt: '2026-04-01T00:00:01.000Z',
    });

    const w = new OutboxWorker({
      deliver,
      randomFn: () => 0,
      jitterMs: 0,
    });

    await w.drain();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dead-letter'));
    expect(debugSpy).not.toHaveBeenCalledWith(expect.stringContaining('attempt'));
  });

  // ── 12. non-dead-letter failure logs debug ────────────────────────────────
  test('logs debug when entry is still pending after failed attempt', async () => {
    const deliver = vi.fn().mockRejectedValue(new Error('transient'));
    const entry = makeEntry({ attempts: 0 });

    mockFindReadyForDelivery.mockReturnValue([entry]);
    mockMarkOutboxEntryAttempted.mockReturnValue({
      ...entry,
      attempts: 1,
      status: 'pending',
    });

    const w = new OutboxWorker({
      deliver,
      randomFn: () => 0,
      jitterMs: 0,
    });

    await w.drain();

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('attempt'));
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // ── 13. non-Error thrown value is stringified ─────────────────────────────
  test('non-Error thrown value is converted via String()', async () => {
    const deliver = vi.fn().mockRejectedValue('plain string error');
    const entry = makeEntry();

    mockFindReadyForDelivery.mockReturnValue([entry]);
    mockMarkOutboxEntryAttempted.mockReturnValue({ ...entry, status: 'pending', attempts: 1 });

    const w = new OutboxWorker({ deliver, randomFn: () => 0, jitterMs: 0 });

    await w.drain();

    expect(mockMarkOutboxEntryAttempted).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ error: 'plain string error' }),
    );
  });

  // ── 14. purge triggered every purgeEveryDrains drains ─────────────────────
  describe('purgeTerminal', () => {
    test('purges after purgeEveryDrains drains with correct cutoff', async () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      mockFindReadyForDelivery.mockReturnValue([]);
      mockPurgeTerminalOutboxEntriesOlderThan.mockReturnValue(0);

      const fixedNow = new Date('2026-04-01T00:00:00.000Z');
      const ttlMs = 7 * 24 * 60 * 60 * 1000; // 7 days
      const purgeEveryDrains = 3;

      const w = new OutboxWorker({
        deliver,
        ttlMs,
        purgeEveryDrains,
        nowFn: () => fixedNow,
      });

      // 2 drains — no purge yet
      await w.drain();
      await w.drain();
      expect(mockPurgeTerminalOutboxEntriesOlderThan).not.toHaveBeenCalled();

      // 3rd drain — purge fires
      await w.drain();

      const expectedCutoff = new Date(fixedNow.getTime() - ttlMs).toISOString();
      expect(mockPurgeTerminalOutboxEntriesOlderThan).toHaveBeenCalledWith(expectedCutoff);
    });

    test('purge resets counter and fires again after another purgeEveryDrains', async () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      mockFindReadyForDelivery.mockReturnValue([]);
      mockPurgeTerminalOutboxEntriesOlderThan.mockReturnValue(0);

      const w = new OutboxWorker({ deliver, purgeEveryDrains: 2 });

      await w.drain();
      await w.drain(); // purge 1
      await w.drain();
      await w.drain(); // purge 2

      expect(mockPurgeTerminalOutboxEntriesOlderThan).toHaveBeenCalledTimes(2);
    });

    // ── 15. purge only logs debug when removed count > 0 ─────────────────
    test('logs debug only when purge removes entries', async () => {
      const deliver = vi.fn().mockResolvedValue(undefined);
      mockFindReadyForDelivery.mockReturnValue([]);

      const w = new OutboxWorker({ deliver, purgeEveryDrains: 1 });

      // removed = 0 → no debug log for purge
      mockPurgeTerminalOutboxEntriesOlderThan.mockReturnValue(0);
      debugSpy.mockClear();
      await w.drain();
      expect(debugSpy).not.toHaveBeenCalled();

      // removed = 3 → debug log
      mockPurgeTerminalOutboxEntriesOlderThan.mockReturnValue(3);
      debugSpy.mockClear();
      await w.drain();
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Purged 3'));
    });
  });
});

// ── Singleton helpers ───────────────────────────────────────────────────────
describe('singleton helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFindReadyForDelivery.mockReturnValue([]);
    mockPurgeTerminalOutboxEntriesOlderThan.mockReturnValue(0);
    stopOutboxWorker();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopOutboxWorker();
  });

  // ── 16. startOutboxWorker returns a started worker ────────────────────────
  test('startOutboxWorker returns a running OutboxWorker', () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const worker = startOutboxWorker({ deliver });

    expect(worker).toBeInstanceOf(OutboxWorker);
    expect(worker.isRunning()).toBe(true);
  });

  // ── 17. startOutboxWorker is a singleton ──────────────────────────────────
  test('calling startOutboxWorker twice returns the same instance', () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const w1 = startOutboxWorker({ deliver });
    const w2 = startOutboxWorker({ deliver });

    expect(w1).toBe(w2);
  });

  // ── 18. getOutboxWorker returns the started instance ─────────────────────
  test('getOutboxWorker returns the worker after startOutboxWorker', () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const worker = startOutboxWorker({ deliver });

    expect(getOutboxWorker()).toBe(worker);
  });

  test('getOutboxWorker returns undefined before any worker is started', () => {
    expect(getOutboxWorker()).toBeUndefined();
  });

  // ── 19. stopOutboxWorker clears the singleton ─────────────────────────────
  test('stopOutboxWorker stops and clears the singleton', () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const worker = startOutboxWorker({ deliver });
    expect(worker.isRunning()).toBe(true);

    stopOutboxWorker();

    expect(getOutboxWorker()).toBeUndefined();
    expect(worker.isRunning()).toBe(false);
  });

  // ── 20. stopOutboxWorker when no worker is a no-op ───────────────────────
  test('stopOutboxWorker when no worker is running is a no-op', () => {
    expect(() => stopOutboxWorker()).not.toThrow();
    expect(getOutboxWorker()).toBeUndefined();
  });
});
