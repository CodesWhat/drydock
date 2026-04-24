import {
  connectContainerStatsStream,
  getAllContainerStats,
  getContainerStats,
} from '@/services/stats';

interface MockEventSource {
  addEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onerror: ((event: Event) => void) | null;
  emit: (event: string, payload?: unknown) => void;
}

describe('stats service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches a container snapshot and history', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          containerId: 'c1',
          cpuPercent: 12,
          memoryUsageBytes: 100,
          memoryLimitBytes: 200,
          memoryPercent: 50,
          networkRxBytes: 10,
          networkTxBytes: 11,
          blockReadBytes: 12,
          blockWriteBytes: 13,
          timestamp: '2026-03-14T10:00:00.000Z',
        },
        history: [],
      }),
    });

    const result = await getContainerStats('c1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/containers/c1/stats', {
      credentials: 'include',
    });
    expect(result.data?.containerId).toBe('c1');
    expect(result.history).toEqual([]);
  });

  it('throws when container stats request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Nope' });

    await expect(getContainerStats('c1')).rejects.toThrow('Failed to get container stats: Nope');
  });

  it('normalizes malformed container stats snapshots and history entries', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          containerId: 'c1',
          cpuPercent: 'bad',
          memoryUsageBytes: 100,
          memoryLimitBytes: 200,
          memoryPercent: 50,
          networkRxBytes: 10,
          networkTxBytes: 11,
          blockReadBytes: 12,
          blockWriteBytes: 13,
          timestamp: '2026-03-14T10:00:00.000Z',
        },
        history: [
          'invalid-history-entry',
          {
            containerId: 'c1',
            cpuPercent: 10,
            memoryUsageBytes: 100,
            memoryLimitBytes: 200,
            memoryPercent: 50,
            networkRxBytes: 10,
            networkTxBytes: 11,
            blockReadBytes: 12,
            blockWriteBytes: 13,
            timestamp: '2026-03-14T09:59:00.000Z',
          },
        ],
      }),
    });

    const result = await getContainerStats('c1');

    expect(result.data).toBeNull();
    expect(result.history).toEqual([
      expect.objectContaining({
        containerId: 'c1',
        cpuPercent: 10,
      }),
    ]);
  });

  it('returns an empty history when history is missing or not an array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: null,
        history: 'not-an-array',
      }),
    });

    const result = await getContainerStats('c1');

    expect(result).toEqual({
      data: null,
      history: [],
    });
  });

  it('returns null data when required snapshot identity fields are missing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          containerId: 'c1',
          cpuPercent: 12,
          memoryUsageBytes: 100,
          memoryLimitBytes: 200,
          memoryPercent: 50,
          networkRxBytes: 10,
          networkTxBytes: 11,
          blockReadBytes: 12,
          blockWriteBytes: 13,
        },
        history: [],
      }),
    });

    const result = await getContainerStats('c1');

    expect(result.data).toBeNull();
  });

  it('returns null data for snapshots with an empty container id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          containerId: '',
          cpuPercent: 12,
          memoryUsageBytes: 100,
          memoryLimitBytes: 200,
          memoryPercent: 50,
          networkRxBytes: 10,
          networkTxBytes: 11,
          blockReadBytes: 12,
          blockWriteBytes: 13,
          timestamp: '2026-03-14T10:00:00.000Z',
        },
        history: [],
      }),
    });

    const result = await getContainerStats('c1');

    expect(result.data).toBeNull();
  });

  it('falls back to an empty envelope when the response payload is not an object', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => 'not-an-object',
    });

    const result = await getContainerStats('c1');

    expect(result).toEqual({
      data: null,
      history: [],
    });
  });

  it('fetches all container stats summary', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'c1',
            name: 'web',
            status: 'running',
            watcher: 'local',
            stats: {
              containerId: 'c1',
              cpuPercent: 8,
              memoryUsageBytes: 100,
              memoryLimitBytes: 200,
              memoryPercent: 50,
              networkRxBytes: 10,
              networkTxBytes: 11,
              blockReadBytes: 12,
              blockWriteBytes: 13,
              timestamp: '2026-03-14T10:00:00.000Z',
            },
          },
        ],
      }),
    });

    const result = await getAllContainerStats();

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/containers/stats', {
      credentials: 'include',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('web');
  });

  it('passes ?touch=false when called with { touch: false }', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await getAllContainerStats({ touch: false });

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/containers/stats?touch=false', {
      credentials: 'include',
    });
  });

  it('does not append query string when called with { touch: true } or no options', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await getAllContainerStats();
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/containers/stats', {
      credentials: 'include',
    });

    mockFetch.mockClear();

    await getAllContainerStats({ touch: true });
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/containers/stats', {
      credentials: 'include',
    });
  });

  it('filters malformed summary items while keeping well-formed rows', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          null,
          { id: 42, name: 'bad-id' },
          { id: 'missing-name' },
          {
            id: 'c0',
            name: 'cache',
            status: 123,
            watcher: false,
            agent: 'edge',
            stats: null,
          },
          {
            id: 'c1',
            name: 'web',
            status: 'running',
            watcher: 'local',
            stats: {
              containerId: 'c1',
              cpuPercent: 8,
              memoryUsageBytes: 100,
              memoryLimitBytes: 200,
              memoryPercent: 50,
              networkRxBytes: 10,
              networkTxBytes: 11,
              blockReadBytes: 12,
              blockWriteBytes: 13,
              timestamp: '2026-03-14T10:00:00.000Z',
            },
          },
        ],
      }),
    });

    const result = await getAllContainerStats();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'c0',
        name: 'cache',
        status: undefined,
        watcher: undefined,
        agent: 'edge',
        stats: null,
      }),
      expect.objectContaining({
        id: 'c1',
        name: 'web',
      }),
    ]);
  });

  it('throws when all-container stats request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, statusText: 'Nope' });

    await expect(getAllContainerStats()).rejects.toThrow('Failed to get container stats: Nope');
  });

  describe('connectContainerStatsStream', () => {
    let eventSources: MockEventSource[];
    let EventSourceMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      eventSources = [];
      EventSourceMock = vi.fn(function (this: unknown, _url: string) {
        const listeners: Record<string, (payload?: unknown) => void> = {};
        const source: MockEventSource = {
          addEventListener: vi.fn((event: string, handler: (payload?: unknown) => void) => {
            listeners[event] = handler;
          }),
          close: vi.fn(),
          onerror: null,
          emit(event: string, payload?: unknown) {
            listeners[event]?.(payload);
          },
        };
        eventSources.push(source);
        return source;
      });
      vi.stubGlobal('EventSource', EventSourceMock);
    });

    it('connects to the container stats SSE endpoint and emits parsed snapshots', () => {
      const onOpen = vi.fn();
      const onSnapshot = vi.fn();
      const onHeartbeat = vi.fn();

      const controller = connectContainerStatsStream('container 1', {
        onOpen,
        onSnapshot,
        onHeartbeat,
      });

      expect(EventSourceMock).toHaveBeenCalledWith('/api/v1/containers/container%201/stats/stream');

      const source = eventSources[0];
      source.emit('open');
      source.emit('dd:container-stats', {
        data: JSON.stringify({
          containerId: 'container 1',
          cpuPercent: 45,
          memoryUsageBytes: 1024,
          memoryLimitBytes: 2048,
          memoryPercent: 50,
          networkRxBytes: 100,
          networkTxBytes: 200,
          blockReadBytes: 300,
          blockWriteBytes: 400,
          timestamp: '2026-03-14T10:00:00.000Z',
        }),
      });
      source.emit('dd:heartbeat', {});

      expect(onSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          containerId: 'container 1',
          cpuPercent: 45,
        }),
      );
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onHeartbeat).toHaveBeenCalledTimes(1);

      source.emit('dd:container-stats', { data: '{broken' });
      source.emit('dd:container-stats', { data: 42 });
      expect(onSnapshot).toHaveBeenCalledTimes(1);

      controller.disconnect();
    });

    it('reconnects after stream errors and supports pause/resume', () => {
      const onError = vi.fn();
      const controller = connectContainerStatsStream(
        'c1',
        {
          onError,
        },
        { reconnectDelayMs: 1500 },
      );

      controller.resume();

      const firstSource = eventSources[0];
      firstSource.onerror?.(new Event('error'));
      expect(onError).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1499);
      expect(EventSourceMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(EventSourceMock).toHaveBeenCalledTimes(2);

      controller.pause();
      expect(controller.isPaused()).toBe(true);
      expect(eventSources[1].close).toHaveBeenCalled();

      eventSources[1].onerror?.(new Event('error'));
      vi.advanceTimersByTime(2000);
      expect(EventSourceMock).toHaveBeenCalledTimes(2);

      controller.resume();
      expect(controller.isPaused()).toBe(false);
      expect(EventSourceMock).toHaveBeenCalledTimes(3);

      controller.disconnect();
      expect(eventSources[2].close).toHaveBeenCalled();

      controller.pause();
      controller.resume();
      controller.disconnect();
    });

    it('does not reconnect after disconnect', () => {
      const controller = connectContainerStatsStream('c1', undefined, { reconnectDelayMs: 1000 });
      const firstSource = eventSources[0];

      firstSource.onerror?.(new Event('error'));
      controller.disconnect();

      vi.advanceTimersByTime(2000);
      expect(EventSourceMock).toHaveBeenCalledTimes(1);
    });
  });
});
