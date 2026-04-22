import sseService from '@/services/sse';

describe('SseService', () => {
  type EventListener = (...args: unknown[]) => unknown;
  let mockEventSource: any;
  let eventListeners: Record<string, EventListener>;
  let mockEventBus: any;
  let MockEventSourceCtor: any;
  let mockFetch: any;
  const connectedPayload = {
    clientId: 'server-client-1',
    clientToken: 'server-token-1',
  };

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
    expect(MockEventSourceCtor).toHaveBeenCalledWith('/api/v1/events/ui');
  });

  it('registers event listeners for dd:connected, dd:self-update, container lifecycle events, update-operation changes, agent status events, dd:scan-started, dd:scan-completed, and dd:resync-required', () => {
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
      'dd:container-added',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:container-updated',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:container-removed',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:update-operation-changed',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:agent-connected',
      expect.any(Function),
    );
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith(
      'dd:agent-disconnected',
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
      'dd:resync-required',
      expect.any(Function),
    );
  });

  it('emits sse:connected on dd:connected event', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:connected']();
    expect(mockEventBus.emit).toHaveBeenCalledWith('sse:connected');
  });

  it('handles dd:connected with non-object JSON payload gracefully', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:connected']({ data: '"not-an-object"' });
    eventListeners['dd:self-update']({ data: '{"opId":"op-123"}' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles dd:connected with invalid JSON payload gracefully', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:connected']({ data: '{broken' });
    eventListeners['dd:self-update']({ data: '{"opId":"op-123"}' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('ignores non-string dd:connected credential fields', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:connected']({ data: '{"clientId":123,"clientToken":false}' });
    eventListeners['dd:self-update']({ data: '{"opId":"op-123"}' });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('emits self-update payload on dd:self-update event and acknowledges operation', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:connected']({ data: JSON.stringify(connectedPayload) });
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
      '/api/v1/events/ui/self-update/op-123/ack',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          clientId: connectedPayload.clientId,
          clientToken: connectedPayload.clientToken,
          lastEventId: 'evt-1',
        }),
      }),
    );
  });

  it('acknowledges self-update without lastEventId when not provided', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:connected']({ data: JSON.stringify(connectedPayload) });
    eventListeners['dd:self-update']({ data: '{"opId":"op-456"}' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/events/ui/self-update/op-456/ack',
      expect.objectContaining({
        body: JSON.stringify({
          clientId: connectedPayload.clientId,
          clientToken: connectedPayload.clientToken,
        }),
      }),
    );
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

  it('emits container-changed on container lifecycle events', () => {
    sseService.connect(mockEventBus);

    const samplePayload = { id: 'abc123', name: 'web-1', image: { name: 'nginx' } };

    // added
    mockEventBus.emit.mockClear();
    const addedEvent = new MessageEvent('dd:container-added', {
      data: JSON.stringify(samplePayload),
    });
    eventListeners['dd:container-added'](addedEvent);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-added', samplePayload);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', samplePayload);

    // updated
    mockEventBus.emit.mockClear();
    const updatedEvent = new MessageEvent('dd:container-updated', {
      data: JSON.stringify(samplePayload),
    });
    eventListeners['dd:container-updated'](updatedEvent);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-updated', samplePayload);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', samplePayload);

    // removed
    mockEventBus.emit.mockClear();
    const removedEvent = new MessageEvent('dd:container-removed', {
      data: JSON.stringify(samplePayload),
    });
    eventListeners['dd:container-removed'](removedEvent);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-removed', samplePayload);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', samplePayload);
  });

  it('emits container lifecycle events with undefined payload when event.data is missing', () => {
    sseService.connect(mockEventBus);

    mockEventBus.emit.mockClear();
    eventListeners['dd:container-added']({});
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-added', undefined);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', undefined);

    mockEventBus.emit.mockClear();
    eventListeners['dd:container-updated']({});
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-updated', undefined);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', undefined);

    mockEventBus.emit.mockClear();
    eventListeners['dd:container-removed']({});
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-removed', undefined);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', undefined);
  });

  it('emits container lifecycle events with undefined payload when event.data is malformed JSON', () => {
    sseService.connect(mockEventBus);

    const badEvent = new MessageEvent('dd:container-added', { data: '{bad json' });

    mockEventBus.emit.mockClear();
    eventListeners['dd:container-added'](badEvent);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-added', undefined);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', undefined);

    const badUpdatedEvent = new MessageEvent('dd:container-updated', { data: '{bad json' });
    mockEventBus.emit.mockClear();
    eventListeners['dd:container-updated'](badUpdatedEvent);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-updated', undefined);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', undefined);

    const badRemovedEvent = new MessageEvent('dd:container-removed', { data: '{bad json' });
    mockEventBus.emit.mockClear();
    eventListeners['dd:container-removed'](badRemovedEvent);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-removed', undefined);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', undefined);
  });

  it('emits container lifecycle events with undefined payload when event.data is a non-object JSON value', () => {
    sseService.connect(mockEventBus);

    const arrayEvent = new MessageEvent('dd:container-added', { data: '["not","an","object"]' });
    mockEventBus.emit.mockClear();
    eventListeners['dd:container-added'](arrayEvent);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-added', undefined);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', undefined);

    const stringEvent = new MessageEvent('dd:container-updated', { data: '"just-a-string"' });
    mockEventBus.emit.mockClear();
    eventListeners['dd:container-updated'](stringEvent);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-updated', undefined);
    expect(mockEventBus.emit).toHaveBeenCalledWith('container-changed', undefined);
  });

  it('emits only update-operation-changed on operation phase transitions, never container-changed', () => {
    sseService.connect(mockEventBus);

    eventListeners['dd:update-operation-changed']();

    expect(mockEventBus.emit).toHaveBeenCalledWith('update-operation-changed', undefined);
    expect(mockEventBus.emit).not.toHaveBeenCalledWith('container-changed');
  });

  it('parses operation payload from SSE event data', () => {
    sseService.connect(mockEventBus);

    const event = new MessageEvent('dd:update-operation-changed', {
      data: JSON.stringify({
        operationId: 'op-1',
        containerName: 'nginx',
        containerId: 'c1',
        newContainerId: 'c1-new',
        status: 'in-progress',
        phase: 'pulling',
      }),
    });
    eventListeners['dd:update-operation-changed'](event);

    expect(mockEventBus.emit).toHaveBeenCalledWith('update-operation-changed', {
      operationId: 'op-1',
      containerName: 'nginx',
      containerId: 'c1',
      newContainerId: 'c1-new',
      status: 'in-progress',
      phase: 'pulling',
    });
  });

  it('returns undefined for non-object operation payload', () => {
    sseService.connect(mockEventBus);
    const event = new MessageEvent('dd:update-operation-changed', { data: '"not-an-object"' });
    eventListeners['dd:update-operation-changed'](event);
    expect(mockEventBus.emit).toHaveBeenCalledWith('update-operation-changed', undefined);
  });

  it('returns undefined for operation payload missing status', () => {
    sseService.connect(mockEventBus);
    const event = new MessageEvent('dd:update-operation-changed', {
      data: JSON.stringify({ operationId: 'op-1' }),
    });
    eventListeners['dd:update-operation-changed'](event);
    expect(mockEventBus.emit).toHaveBeenCalledWith('update-operation-changed', undefined);
  });

  it('returns undefined for malformed JSON operation payload', () => {
    sseService.connect(mockEventBus);
    const event = new MessageEvent('dd:update-operation-changed', { data: '{bad json' });
    eventListeners['dd:update-operation-changed'](event);
    expect(mockEventBus.emit).toHaveBeenCalledWith('update-operation-changed', undefined);
  });

  it('coerces non-string optional fields to undefined in operation payload', () => {
    sseService.connect(mockEventBus);
    const event = new MessageEvent('dd:update-operation-changed', {
      data: JSON.stringify({
        operationId: 123,
        containerName: null,
        containerId: true,
        newContainerId: {},
        status: 'queued',
        phase: 42,
      }),
    });
    eventListeners['dd:update-operation-changed'](event);
    expect(mockEventBus.emit).toHaveBeenCalledWith('update-operation-changed', {
      operationId: undefined,
      containerName: undefined,
      containerId: undefined,
      newContainerId: undefined,
      status: 'queued',
      phase: undefined,
    });
  });

  it('emits agent-status-changed on agent lifecycle events', () => {
    sseService.connect(mockEventBus);

    eventListeners['dd:agent-connected']();
    expect(mockEventBus.emit).toHaveBeenCalledWith('agent-status-changed');

    eventListeners['dd:agent-disconnected']();
    expect(mockEventBus.emit).toHaveBeenCalledWith('agent-status-changed');
  });

  it('emits resync-required with boot-mismatch reason on dd:resync-required event', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:resync-required']({ data: '{"reason":"boot-mismatch"}' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('resync-required', { reason: 'boot-mismatch' });
  });

  it('emits resync-required with buffer-evicted reason on dd:resync-required event', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:resync-required']({ data: '{"reason":"buffer-evicted"}' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('resync-required', { reason: 'buffer-evicted' });
  });

  it('falls back to boot-mismatch for dd:resync-required with unknown reason', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:resync-required']({ data: '{"reason":"something-else"}' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('resync-required', { reason: 'boot-mismatch' });
  });

  it('falls back to boot-mismatch for dd:resync-required with non-object JSON', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:resync-required']({ data: '"not-an-object"' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('resync-required', { reason: 'boot-mismatch' });
  });

  it('falls back to boot-mismatch for dd:resync-required with invalid JSON', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:resync-required']({ data: '{broken' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('resync-required', { reason: 'boot-mismatch' });
  });

  it('falls back to boot-mismatch for dd:resync-required with falsy data', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:resync-required']({ data: null });
    expect(mockEventBus.emit).toHaveBeenCalledWith('resync-required', { reason: 'boot-mismatch' });
  });

  it('does not emit connection-lost or schedule reconnect on dd:resync-required', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:resync-required']({ data: '{"reason":"boot-mismatch"}' });
    expect(mockEventBus.emit).not.toHaveBeenCalledWith('connection-lost');
    vi.advanceTimersByTime(10000);
    // No reconnect should be triggered
    expect(MockEventSourceCtor).toHaveBeenCalledTimes(1);
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
    expect(MockEventSourceCtor).toHaveBeenCalledWith('/api/v1/events/ui');
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

  it('handles self-update with falsy rawData gracefully', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:self-update']({ data: null });
    expect(mockEventBus.emit).toHaveBeenCalledWith('self-update', {});
  });

  it('handles self-update with non-string rawData gracefully', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:self-update']({ data: 42 });
    expect(mockEventBus.emit).toHaveBeenCalledWith('self-update', {});
  });

  it('handles self-update with non-object JSON gracefully', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:self-update']({ data: '"just a string"' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('self-update', {});
  });

  it('handles self-update with invalid JSON gracefully', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:self-update']({ data: '{broken' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('self-update', {});
  });

  it('skips ACK when server connection credentials are missing', () => {
    sseService.connect(mockEventBus);
    eventListeners['dd:self-update']({ data: '{"opId":"op-123"}' });
    expect(mockFetch).not.toHaveBeenCalled();
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
