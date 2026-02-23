import sseService from '@/services/sse';

describe('SseService', () => {
  type EventListener = (...args: unknown[]) => unknown;
  let mockEventSource: any;
  let eventListeners: Record<string, EventListener>;
  let mockEventBus: any;
  let MockEventSourceCtor: any;
  let mockFetch: any;

  beforeEach(() => {
    vi.useFakeTimers();
    eventListeners = {};
    mockEventSource = {
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        eventListeners[event] = handler;
      }),
      close: vi.fn(),
      onerror: null as EventListener | null,
    };
    // biome-ignore lint/complexity/useArrowFunction: must be a function expression for `new EventSource()` constructor mock
    MockEventSourceCtor = vi.fn(function () {
      return mockEventSource;
    });
    vi.stubGlobal('EventSource', MockEventSourceCtor);
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
  });

  afterEach(() => {
    sseService.disconnect();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('creates EventSource on connect', () => {
    sseService.connect(mockEventBus);
    expect(MockEventSourceCtor).toHaveBeenCalledWith('/api/events/ui');
  });

  it('registers event listeners for dd:connected, dd:self-update, dd:scan-started, dd:scan-completed, and dd:heartbeat', () => {
    sseService.connect(mockEventBus);
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:connected',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:self-update',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:scan-started',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:scan-completed',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:heartbeat',
      expect.any(Function),
    );
  });

  it('emits sse:connected on dd:connected event', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:connected']();
    expect(mockEventBus.emit).toHaveBeenCalledWith('sse:connected');
  });

  it('emits self-update payload on dd:self-update event and acknowledges operation', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:self-update']({
      data: '{"opId":"op-123","requiresAck":true,"ackTimeoutMs":2000}',
      lastEventId: 'evt-1',
    });
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      'self-update',
      expect.objectContaining({
        opId: 'op-123',
        requiresAck: true,
        ackTimeoutMs: 2000,
      }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/events/ui/self-update/op-123/ack',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      }),
    );
  });

  it('handles heartbeat events without emitting additional bus events', () => {
    sseService.connect(mockEventBus);
    mockEventBus.emit.mockClear();

    eventListeners['dd:heartbeat']();

    expect(mockEventBus.emit).not.toHaveBeenCalled();
  });

  it('emits scan-started on dd:scan-started event', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:scan-started']();
    expect(mockEventBus.emit).toHaveBeenCalledWith('scan-started');
  });

  it('emits scan-completed on dd:scan-completed event', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:scan-completed']();
    expect(mockEventBus.emit).toHaveBeenCalledWith('scan-completed');
  });

  it('emits connection-lost on error when in self-update mode', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:self-update']({ data: '{"opId":"op-123"}' });
    mockEventBus.emit.mockClear();

    mockEventSource.onerror();
    expect(mockEventBus.emit).toHaveBeenCalledWith('connection-lost');
  });

  it('auto-reconnects on error in normal mode', () => {
    sseService.connect(mockEventBus);
    MockEventSourceCtor.mockClear();

    mockEventSource.onerror();
    expect(mockEventBus.emit).not.toHaveBeenCalledWith('connection-lost');

    vi.advanceTimersByTime(5000);
    expect(MockEventSourceCtor).toHaveBeenCalledWith('/api/events/ui');
  });

  it('clears pending reconnect timer before scheduling a new one', () => {
    sseService.connect(mockEventBus);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    mockEventSource.onerror();
    mockEventSource.onerror();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('closes EventSource on disconnect', () => {
    sseService.connect(mockEventBus);
    sseService.disconnect();
    expect(mockEventSource.close).toHaveBeenCalled();
  });

  it('does not reconnect after disconnect', () => {
    sseService.connect(mockEventBus);
    mockEventSource.onerror();
    sseService.disconnect();
    MockEventSourceCtor.mockClear();

    vi.advanceTimersByTime(10000);
    expect(MockEventSourceCtor).not.toHaveBeenCalled();
  });

  it('closes previous EventSource on multiple connect calls', () => {
    sseService.connect(mockEventBus);
    const firstSource = mockEventSource;

    const secondSource = {
      addEventListener: vi.fn(),
      close: vi.fn(),
      onerror: null as EventListener | null,
    };
    // biome-ignore lint/complexity/useArrowFunction: must be a function expression for `new EventSource()` constructor mock
    MockEventSourceCtor.mockImplementation(function () {
      return secondSource;
    });

    sseService.connect(mockEventBus);
    expect(firstSource.close).toHaveBeenCalled();
  });

  it('resets self-update mode on disconnect', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:self-update']({ data: '{"opId":"op-123"}' });
    sseService.disconnect();

    sseService.connect(mockEventBus);
    mockEventBus.emit.mockClear();
    MockEventSourceCtor.mockClear();

    mockEventSource.onerror();
    expect(mockEventBus.emit).not.toHaveBeenCalledWith('connection-lost');
    vi.advanceTimersByTime(5000);
    expect(MockEventSourceCtor).toHaveBeenCalled();
  });
});
