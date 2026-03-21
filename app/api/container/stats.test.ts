import { beforeEach, describe, expect, test, vi } from 'vitest';
import logger from '../../log/index.js';
import { createStatsHandlers } from './stats.js';

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
  const getContainers = vi.fn(() => [...containersById.values()]);
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
      getContainers,
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
    getContainers,
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

  test('returns summary stats for all containers', () => {
    const harness = createHarness();
    const req = createRequest();
    const res = createResponse();

    harness.handlers.getAllContainerStats(req as any, res as any);

    expect(harness.touch).toHaveBeenCalledWith('c1');
    expect(harness.touch).toHaveBeenCalledWith('c2');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'c1',
          name: 'web',
          status: 'running',
          watcher: 'local',
          agent: undefined,
          stats: { containerId: 'c1', cpuPercent: 10 },
        },
        {
          id: 'c2',
          name: 'db',
          status: undefined,
          watcher: 'local',
          agent: undefined,
          stats: null,
        },
      ],
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
