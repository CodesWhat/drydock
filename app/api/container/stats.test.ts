import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import logger from '../../log/index.js';
import { createStatsHandlers, createSummaryStatsHandlers } from './stats.js';

function createResponse() {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    writeHead: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    flushHeaders: vi.fn(),
    flush: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = handler;
    }),
    emit(event: string, ...args: unknown[]) {
      listeners[event]?.(...args);
    },
  };
}

function createRequest(overrides: Record<string, unknown> = {}) {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  return {
    params: {},
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = handler;
    }),
    emit(event: string, ...args: unknown[]) {
      listeners[event]?.(...args);
    },
    ...overrides,
  };
}

function createHarness() {
  const containersById = new Map([
    ['c1', { id: 'c1', name: 'web', status: 'running', watcher: 'local' }],
    ['c2', { id: 'c2', name: 'db', watcher: 'local' }],
  ]);
  const getContainer = vi.fn((id: string) => containersById.get(id));
  const watch = vi.fn(() => vi.fn());
  const touch = vi.fn();
  let subscriptionHandler: ((snapshot: unknown) => void) | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((_containerId: string, handler: (snapshot: unknown) => void) => {
    subscriptionHandler = handler;
    return unsubscribe;
  });
  const getLatest = vi.fn((id: string) =>
    id === 'c1'
      ? {
          containerId: 'c1',
          cpuPercent: 10,
        }
      : undefined,
  );
  const getHistory = vi.fn((id: string) =>
    id === 'c1' ? [{ containerId: 'c1', cpuPercent: 8 }] : [],
  );

  const handlers = createStatsHandlers({
    storeContainer: {
      getContainer,
    },
    statsCollector: {
      watch,
      touch,
      subscribe,
      getLatest,
      getHistory,
    },
  });

  return {
    handlers,
    getContainer,
    watch,
    touch,
    subscribe,
    getLatest,
    getHistory,
    unsubscribe,
    emitSnapshot(snapshot: unknown) {
      subscriptionHandler?.(snapshot);
    },
  };
}

describe('api/container/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test('returns latest snapshot and history for a container', () => {
    const harness = createHarness();
    const req = createRequest({
      params: { id: 'c1' },
    });
    const res = createResponse();

    harness.handlers.getContainerStats(req as any, res as any);

    expect(harness.touch).toHaveBeenCalledWith('c1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: { containerId: 'c1', cpuPercent: 10 },
      history: [{ containerId: 'c1', cpuPercent: 8 }],
    });
  });

  test('returns 404 when container does not exist', () => {
    const harness = createHarness();
    const req = createRequest({
      params: { id: 'missing' },
    });
    const res = createResponse();

    harness.handlers.getContainerStats(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
  });

  test('returns null stats when no latest snapshot is available yet', () => {
    const harness = createHarness();
    const req = createRequest({
      params: { id: 'c2' },
    });
    const res = createResponse();

    harness.handlers.getContainerStats(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: null,
      history: [],
    });
  });

  test('streams container stats over SSE with heartbeat and cleans up on disconnect', async () => {
    const harness = createHarness();
    const req = createRequest({
      params: { id: 'c1' },
    });
    const res = createResponse();
    const releaseWatch = vi.fn();
    harness.watch.mockReturnValue(releaseWatch);

    harness.handlers.streamContainerStats(req as any, res as any);

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    expect(harness.watch).toHaveBeenCalledWith('c1');
    expect(harness.subscribe).toHaveBeenCalledWith('c1', expect.any(Function));
    expect(res.write).toHaveBeenCalledWith(
      `event: dd:container-stats\ndata: ${JSON.stringify({
        containerId: 'c1',
        cpuPercent: 10,
      })}\n\n`,
    );

    harness.emitSnapshot({ containerId: 'c1', cpuPercent: 22 });
    expect(res.write).toHaveBeenCalledWith(
      `event: dd:container-stats\ndata: ${JSON.stringify({
        containerId: 'c1',
        cpuPercent: 22,
      })}\n\n`,
    );

    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.write).toHaveBeenCalledWith('event: dd:heartbeat\ndata: {}\n\n');

    req.emit('close');
    req.emit('aborted');
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(releaseWatch).toHaveBeenCalledTimes(1);
  });

  test('streams container stats without an initial event when no snapshot exists yet', () => {
    const harness = createHarness();
    const req = createRequest({
      params: { id: 'c2' },
    });
    const res = createResponse();

    harness.handlers.streamContainerStats(req as any, res as any);

    expect(harness.watch).toHaveBeenCalledWith('c2');
    expect(harness.subscribe).toHaveBeenCalledWith('c2', expect.any(Function));
    expect(res.write).not.toHaveBeenCalledWith(expect.stringContaining('dd:container-stats'));
  });

  test('cleanup continues when unsubscribe throws', () => {
    const harness = createHarness();
    const req = createRequest({ params: { id: 'c1' } });
    const res = createResponse();
    const releaseWatch = vi.fn();
    harness.watch.mockReturnValue(releaseWatch);
    harness.unsubscribe.mockImplementation(() => {
      throw new Error('unsubscribe boom');
    });

    harness.handlers.streamContainerStats(req as any, res as any);
    req.emit('close');

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(releaseWatch).toHaveBeenCalledOnce();
  });

  test('cleanup logs debug messages when cleanup steps throw', () => {
    const harness = createHarness();
    const req = createRequest({ params: { id: 'c1' } });
    const res = createResponse();
    const debug = vi.fn();
    const childSpy = vi.spyOn(logger, 'child').mockReturnValue({ debug } as any);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {
      throw new Error('clear interval boom');
    });
    const releaseWatch = vi.fn(() => {
      throw new Error('release watch boom');
    });
    harness.watch.mockReturnValue(releaseWatch);
    harness.unsubscribe.mockImplementation(() => {
      throw new Error('unsubscribe boom');
    });

    try {
      harness.handlers.streamContainerStats(req as any, res as any);
      req.emit('close');
    } finally {
      clearIntervalSpy.mockRestore();
      childSpy.mockRestore();
    }

    expect(debug).toHaveBeenCalledTimes(3);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clear stats stream heartbeat interval for c1'),
    );
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to unsubscribe stats stream listener for c1'),
    );
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to release stats stream watch for c1'),
    );
  });

  test('returns 404 when trying to stream a missing container', () => {
    const harness = createHarness();
    const req = createRequest({
      params: { id: 'missing' },
    });
    const res = createResponse();

    harness.handlers.streamContainerStats(req as any, res as any);

    expect(harness.watch).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
  });
});

describe('api/container/stats — summary handlers', () => {
  const emptySummary = {
    timestamp: '2026-01-01T00:00:00.000Z',
    watchedCount: 0,
    avgCpuPercent: 0,
    totalMemoryUsageBytes: 0,
    totalMemoryLimitBytes: 0,
    totalMemoryPercent: 0,
    topCpu: [],
    topMemory: [],
  };

  function createSummaryHarness() {
    let subscriptionListener: ((summary: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((listener: (summary: unknown) => void) => {
      subscriptionListener = listener;
      return unsubscribe;
    });
    const getCurrent = vi.fn(() => emptySummary);

    const aggregator = { getCurrent, subscribe, start: vi.fn(), stop: vi.fn() };
    const handlers = createSummaryStatsHandlers({ aggregator });

    return {
      handlers,
      aggregator,
      getCurrent,
      subscribe,
      unsubscribe,
      emitSummary(summary: unknown) {
        subscriptionListener?.(summary);
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test('GET summary returns current aggregator state with status 200', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.getStatsSummary(req as any, res as any);

    expect(harness.getCurrent).toHaveBeenCalledOnce();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: emptySummary });
  });

  test('SSE stream sets correct headers', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.streamStatsSummary(req as any, res as any);

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });

  test('SSE stream writes initial snapshot on connect', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.streamStatsSummary(req as any, res as any);

    expect(res.write).toHaveBeenCalledWith(
      `event: dd:stats-summary\ndata: ${JSON.stringify(emptySummary)}\n\n`,
    );
    expect(res.flush).toHaveBeenCalled();
  });

  test('SSE stream writes subsequent snapshots when subscriber fires', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();
    const updatedSummary = { ...emptySummary, watchedCount: 2, avgCpuPercent: 42 };

    harness.handlers.streamStatsSummary(req as any, res as any);

    harness.emitSummary(updatedSummary);

    expect(res.write).toHaveBeenCalledWith(
      `event: dd:stats-summary\ndata: ${JSON.stringify(updatedSummary)}\n\n`,
    );
  });

  test('SSE stream writes heartbeat at interval', async () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.streamStatsSummary(req as any, res as any);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(res.write).toHaveBeenCalledWith('event: dd:heartbeat\ndata: {}\n\n');
  });

  test('SSE stream sweeps destroyed responses and unsubscribes stale listeners', async () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse() as ReturnType<typeof createResponse> & { destroyed?: boolean };

    harness.handlers.streamStatsSummary(req as any, res as any);

    res.destroyed = true;
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(harness.unsubscribe).toHaveBeenCalledOnce();

    const writeCallCountAfterSweep = (res.write as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect((res.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      writeCallCountAfterSweep,
    );
  });

  test('SSE stale sweep handles writable-ended responses while active clients remain', async () => {
    const harness = createSummaryHarness();
    const firstReq = createRequest();
    const secondReq = createRequest();
    const firstRes = createResponse() as ReturnType<typeof createResponse> & {
      writableEnded?: boolean;
    };
    const secondRes = createResponse();

    harness.handlers.streamStatsSummary(firstReq as any, firstRes as any);
    harness.handlers.streamStatsSummary(secondReq as any, secondRes as any);

    firstRes.writableEnded = true;
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(harness.unsubscribe).toHaveBeenCalledOnce();

    const secondWriteCountAfterSweep = (secondRes.write as ReturnType<typeof vi.fn>).mock.calls
      .length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect((secondRes.write as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      secondWriteCountAfterSweep,
    );
  });

  test('cleanup on req.close unsubscribes and clears heartbeat', async () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.streamStatsSummary(req as any, res as any);

    req.emit('close');

    // Verify unsubscribed
    expect(harness.unsubscribe).toHaveBeenCalledOnce();

    // Verify heartbeat was cleared (advancing time should not write another heartbeat)
    const writeCallCountAfterClose = (res.write as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect((res.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      writeCallCountAfterClose,
    );
  });

  test('cleanup is idempotent — second call does not double-unsubscribe', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.streamStatsSummary(req as any, res as any);

    req.emit('close');
    req.emit('close');
    req.emit('aborted');

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  test('cleanup fires on res.close', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.streamStatsSummary(req as any, res as any);

    res.emit('close');

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  test('cleanup fires on res.error', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.streamStatsSummary(req as any, res as any);

    res.emit('error');

    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  test('cleanup continues when unsubscribe throws', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();
    harness.unsubscribe.mockImplementation(() => {
      throw new Error('unsubscribe boom');
    });

    harness.handlers.streamStatsSummary(req as any, res as any);
    req.emit('close');

    // Should not throw and unsubscribe was still attempted
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  test('cleanup logs debug messages when cleanup steps throw', () => {
    const harness = createSummaryHarness();
    const req = createRequest();
    const res = createResponse();
    const debug = vi.fn();
    const childSpy = vi.spyOn(logger, 'child').mockReturnValue({ debug } as any);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {
      throw new Error('clear interval boom');
    });
    harness.unsubscribe.mockImplementation(() => {
      throw new Error('unsubscribe boom');
    });

    try {
      harness.handlers.streamStatsSummary(req as any, res as any);
      req.emit('close');
    } finally {
      clearIntervalSpy.mockRestore();
      childSpy.mockRestore();
    }

    expect(debug).toHaveBeenCalledTimes(2);
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clear stats summary stream heartbeat interval'),
    );
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining('Failed to unsubscribe stats summary stream listener'),
    );
  });
});
