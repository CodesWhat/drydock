var {
  mockRouter,
  mockRegisterSelfUpdateStarting,
  mockRegisterContainerAdded,
  mockRegisterContainerUpdated,
  mockRegisterContainerRemoved,
  mockRegisterUpdateOperationChanged,
  mockRegisterAgentConnected,
  mockRegisterAgentDisconnected,
  mockRegisterContainerUpdateApplied,
  mockRegisterContainerUpdateFailed,
  mockRegisterBatchUpdateCompleted,
  mockRandomUUID,
  mockRandomBytes,
  mockCreateHash,
  mockTimingSafeEqual,
  mockLoggerDebug,
  mockLoggerWarn,
  mockBootId,
  mockSseEventBuffer,
} = vi.hoisted(() => {
  let uuidCounter = 0;
  const bootId = 'test-boot-id';

  const bufferEvents: Array<{ id: string; event: string; data: unknown; timestamp: number }> = [];
  const mockSseEventBuffer = {
    push: vi.fn((id, event, data, timestamp) => {
      bufferEvents.push({ id, event, data, timestamp });
    }),
    replaySince: vi.fn((_lastEventId: string, _now: number) => ({
      kind: 'replay' as const,
      events: [] as Array<{ id: string; event: string; data: unknown; timestamp: number }>,
    })),
    evict: vi.fn(),
    _bufferEvents: bufferEvents,
    _reset() {
      bufferEvents.length = 0;
      mockSseEventBuffer.push.mockClear();
      mockSseEventBuffer.replaySince.mockClear();
      mockSseEventBuffer.evict.mockClear();
      mockSseEventBuffer.replaySince.mockImplementation((_lastEventId: string, _now: number) => ({
        kind: 'replay' as const,
        events: [] as Array<{ id: string; event: string; data: unknown; timestamp: number }>,
      }));
    },
  };

  return {
    mockRouter: { get: vi.fn(), post: vi.fn() },
    mockRegisterSelfUpdateStarting: vi.fn(),
    mockRegisterContainerAdded: vi.fn(),
    mockRegisterContainerUpdated: vi.fn(),
    mockRegisterContainerRemoved: vi.fn(),
    mockRegisterUpdateOperationChanged: vi.fn(),
    mockRegisterAgentConnected: vi.fn(),
    mockRegisterAgentDisconnected: vi.fn(),
    mockRegisterContainerUpdateApplied: vi.fn(),
    mockRegisterContainerUpdateFailed: vi.fn(),
    mockRegisterBatchUpdateCompleted: vi.fn(),
    mockRandomUUID: vi.fn(() => {
      uuidCounter += 1;
      return `uuid-${uuidCounter}`;
    }),
    mockRandomBytes: vi.fn((size: number) => Buffer.alloc(size, 0x42)),
    mockCreateHash: vi.fn(() => {
      const chunks: Buffer[] = [];
      const hash = {
        update: vi.fn((value: string | Buffer, encoding?: BufferEncoding) => {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value, encoding ?? 'utf8');
          chunks.push(chunk);
          return hash;
        }),
        digest: vi.fn((format?: BufferEncoding) => {
          const data = Buffer.concat(chunks);
          const digest = Buffer.alloc(32);
          for (let i = 0; i < data.length; i += 1) {
            digest[i % 32] ^= data[i];
          }
          return format === 'hex' ? digest.toString('hex') : digest;
        }),
      };
      return hash;
    }),
    mockTimingSafeEqual: vi.fn(
      (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right),
    ),
    mockLoggerDebug: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockBootId: bootId,
    mockSseEventBuffer,
  };
});

vi.mock('./sse-event-buffer.js', () => ({
  bootId: mockBootId,
  SseEventBuffer: class {
    push(...args) {
      mockSseEventBuffer.push(...args);
    }
    replaySince(...args) {
      return mockSseEventBuffer.replaySince(...args);
    }
    evict(...args) {
      return mockSseEventBuffer.evict(...args);
    }
  },
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('node:crypto', () => ({
  randomUUID: mockRandomUUID,
  randomBytes: mockRandomBytes,
  createHash: mockCreateHash,
  timingSafeEqual: mockTimingSafeEqual,
}));

vi.mock('../event/index', () => ({
  registerSelfUpdateStarting: mockRegisterSelfUpdateStarting,
  registerContainerAdded: mockRegisterContainerAdded,
  registerContainerUpdated: mockRegisterContainerUpdated,
  registerContainerRemoved: mockRegisterContainerRemoved,
  registerUpdateOperationChanged: mockRegisterUpdateOperationChanged,
  registerAgentConnected: mockRegisterAgentConnected,
  registerAgentDisconnected: mockRegisterAgentDisconnected,
  registerContainerUpdateApplied: mockRegisterContainerUpdateApplied,
  registerContainerUpdateFailed: mockRegisterContainerUpdateFailed,
  registerBatchUpdateCompleted: mockRegisterBatchUpdateCompleted,
  getContainerUpdateAppliedEventContainerName: (payload: unknown) => {
    if (typeof payload === 'string') return payload || undefined;
    if (!payload || typeof payload !== 'object') return undefined;
    const name = (payload as { containerName?: unknown }).containerName;
    return typeof name === 'string' && name !== '' ? name : undefined;
  },
}));

vi.mock('./sse-container-enrichment.js', () => ({
  enrichContainerLifecyclePayloadWithEligibility: (payload) => payload,
}));

vi.mock('../log', () => ({
  default: {
    child: vi.fn(() => ({
      debug: mockLoggerDebug,
      warn: mockLoggerWarn,
    })),
  },
}));

import * as sseRouter from './sse.js';

function createSSEResponse() {
  const listeners = {};
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    flush: vi.fn(),
    flushHeaders: vi.fn(),
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    once: vi.fn((event, handler) => {
      listeners[event] = (...args) => {
        delete listeners[event];
        handler(...args);
      };
    }),
    off: vi.fn((event, handler) => {
      if (listeners[event] === handler) {
        delete listeners[event];
      }
    }),
    _listeners: listeners,
  };
}

function createSSERequest(ip = '127.0.0.1', sessionID = `session-${ip}`) {
  const listeners = {};
  return {
    ip,
    sessionID,
    headers: {} as Record<string, string>,
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    once: vi.fn((event, handler) => {
      listeners[event] = (...args) => {
        delete listeners[event];
        handler(...args);
      };
    }),
    _listeners: listeners,
  };
}

function parseSseEventPayload(res, eventName) {
  const call = res.write.mock.calls.find(([payload]) => {
    if (typeof payload !== 'string') return false;
    return (
      payload.startsWith(`event: ${eventName}\n`) || payload.includes(`\nevent: ${eventName}\n`)
    );
  });
  if (!call) {
    throw new Error(`Missing SSE event ${eventName}`);
  }
  const dataSection = call[0].split('\ndata: ')[1];
  if (!dataSection) {
    return {};
  }
  return JSON.parse(dataSection.trim());
}

function connectSseClient(handler, ip = '127.0.0.1') {
  const req = createSSERequest(ip);
  const res = createSSEResponse();
  handler(req, res);
  const connectedPayload = parseSseEventPayload(res, 'dd:connected');
  return {
    req,
    res,
    clientId: connectedPayload.clientId,
    clientToken: connectedPayload.clientToken,
  };
}

describe('SSE lifecycle event handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.DD_SSE_DEBUG_LOG_IP;
    sseRouter._resetInitializationStateForTests();
    sseRouter._resetEventCounterForTests();
    mockSseEventBuffer._reset();
    sseRouter._clients.clear();
    sseRouter._activeSseClientRegistry.clear();
    sseRouter._connectionsPerIp.clear();
    sseRouter._connectionsPerSession.clear();
    sseRouter._clearPendingSelfUpdateAcks();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DD_SSE_DEBUG_LOG_IP;
  });

  describe('init registers lifecycle event handlers', () => {
    test('registers registerContainerUpdateApplied on init', () => {
      sseRouter.init();
      expect(mockRegisterContainerUpdateApplied).toHaveBeenCalledTimes(1);
      expect(mockRegisterContainerUpdateApplied).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ order: expect.any(Number) }),
      );
    });

    test('registers registerContainerUpdateFailed on init', () => {
      sseRouter.init();
      expect(mockRegisterContainerUpdateFailed).toHaveBeenCalledTimes(1);
      expect(mockRegisterContainerUpdateFailed).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ order: expect.any(Number) }),
      );
    });

    test('registers registerBatchUpdateCompleted on init', () => {
      sseRouter.init();
      expect(mockRegisterBatchUpdateCompleted).toHaveBeenCalledTimes(1);
      expect(mockRegisterBatchUpdateCompleted).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ order: expect.any(Number) }),
      );
    });

    test('registers update-applied handler with high order so trigger notifications run first', () => {
      sseRouter.init();
      const [, options] = mockRegisterContainerUpdateApplied.mock.calls[0];
      expect(options.order).toBeGreaterThanOrEqual(900);
    });

    test('registers update-failed handler with high order so trigger notifications run first', () => {
      sseRouter.init();
      const [, options] = mockRegisterContainerUpdateFailed.mock.calls[0];
      expect(options.order).toBeGreaterThanOrEqual(900);
    });

    test('registers batch-update-completed handler with high order', () => {
      sseRouter.init();
      const [, options] = mockRegisterBatchUpdateCompleted.mock.calls[0];
      expect(options.order).toBeGreaterThanOrEqual(900);
    });

    test('does not register lifecycle handlers more than once on double-init', () => {
      sseRouter.init();
      sseRouter.init();
      expect(mockRegisterContainerUpdateApplied).toHaveBeenCalledTimes(1);
      expect(mockRegisterContainerUpdateFailed).toHaveBeenCalledTimes(1);
      expect(mockRegisterBatchUpdateCompleted).toHaveBeenCalledTimes(1);
    });

    test('deregisters update-applied handler when reset is called', () => {
      const deregisterApplied = vi.fn();
      mockRegisterContainerUpdateApplied.mockReturnValueOnce(deregisterApplied);

      sseRouter.init();
      sseRouter._resetInitializationStateForTests();

      expect(deregisterApplied).toHaveBeenCalledTimes(1);
    });

    test('deregisters update-failed handler when reset is called', () => {
      const deregisterFailed = vi.fn();
      mockRegisterContainerUpdateFailed.mockReturnValueOnce(deregisterFailed);

      sseRouter.init();
      sseRouter._resetInitializationStateForTests();

      expect(deregisterFailed).toHaveBeenCalledTimes(1);
    });

    test('deregisters batch-update-completed handler when reset is called', () => {
      const deregisterBatch = vi.fn();
      mockRegisterBatchUpdateCompleted.mockReturnValueOnce(deregisterBatch);

      sseRouter.init();
      sseRouter._resetInitializationStateForTests();

      expect(deregisterBatch).toHaveBeenCalledTimes(1);
    });

    test('deregisters update-applied handler on process SIGTERM', () => {
      const deregisterApplied = vi.fn();
      mockRegisterContainerUpdateApplied.mockReturnValueOnce(deregisterApplied);

      sseRouter.init();
      process.emit('SIGTERM');

      expect(deregisterApplied).toHaveBeenCalledTimes(1);
    });

    test('deregisters update-failed handler on process SIGTERM', () => {
      const deregisterFailed = vi.fn();
      mockRegisterContainerUpdateFailed.mockReturnValueOnce(deregisterFailed);

      sseRouter.init();
      process.emit('SIGTERM');

      expect(deregisterFailed).toHaveBeenCalledTimes(1);
    });

    test('deregisters batch-update-completed handler on process SIGTERM', () => {
      const deregisterBatch = vi.fn();
      mockRegisterBatchUpdateCompleted.mockReturnValueOnce(deregisterBatch);

      sseRouter.init();
      process.emit('SIGTERM');

      expect(deregisterBatch).toHaveBeenCalledTimes(1);
    });
  });

  describe('dd:update-applied broadcast', () => {
    test('dd:update-applied is in the allowed event name set', () => {
      const res = createSSEResponse();
      sseRouter._clients.add(res);

      sseRouter._broadcastContainerEvent('dd:update-applied', { operationId: 'op-1' });

      expect(mockLoggerWarn).not.toHaveBeenCalled();
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('dd:update-applied'));
    });

    test('update-applied handler broadcasts correct payload shape to connected clients', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      onUpdateApplied({
        containerName: 'nginx',
        operationId: 'op-abc',
        batchId: 'batch-xyz',
        container: {
          id: 'container-123',
          name: 'nginx',
          image: {
            name: 'nginx:latest',
            serviceImage: 'nginx:latest',
            tag: { value: 'latest' },
            digest: 'sha256:new',
          },
        },
      });

      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('dd:update-applied'));
      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(payload).toMatchObject({
        operationId: 'op-abc',
        containerId: 'container-123',
        containerName: 'nginx',
        batchId: 'batch-xyz',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    test('update-applied handler preserves top-level containerId from canonical operation events', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      onUpdateApplied({
        containerName: 'nginx',
        operationId: 'op-canonical',
        containerId: 'container-from-operation-store',
        batchId: 'batch-canonical',
      } as any);

      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(payload).toMatchObject({
        operationId: 'op-canonical',
        containerId: 'container-from-operation-store',
        containerName: 'nginx',
        batchId: 'batch-canonical',
      });
    });

    test('update-applied handler includes imageName from container when available', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      onUpdateApplied({
        containerName: 'myapp',
        operationId: 'op-1',
        container: {
          id: 'c-1',
          name: 'myapp',
          image: {
            name: 'myapp:1.2.3',
            serviceImage: 'myapp:1.2.3',
            tag: { value: '1.2.3' },
          },
        },
      });

      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(payload.imageName).toBeDefined();
    });

    test('update-applied handler uses null for missing digest fields', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      onUpdateApplied({
        containerName: 'nginx',
        operationId: 'op-1',
        container: {
          id: 'c-1',
          name: 'nginx',
          image: { name: 'nginx:latest', serviceImage: 'nginx:latest' },
        },
      });

      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(Object.hasOwn(payload, 'previousDigest')).toBe(true);
      expect(Object.hasOwn(payload, 'newDigest')).toBe(true);
    });

    test('update-applied handler handles string payload (legacy) by emitting with containerName only', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      // String form is a legacy path — should not throw
      onUpdateApplied('nginx');

      // The handler may broadcast with what it has (containerName from string) or skip.
      // Either way it must not throw.
      expect(res).toBeDefined();
    });

    test('update-applied handler broadcasts with stable SSE event id', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      res.write.mockClear();
      mockSseEventBuffer._reset();

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      onUpdateApplied({
        containerName: 'nginx',
        operationId: 'op-1',
        container: {
          id: 'c-1',
          name: 'nginx',
          image: { name: 'nginx:latest', serviceImage: 'nginx:latest' },
        },
      });

      const writes = res.write.mock.calls.map(([v]) => v);
      const eventWrite = writes.find((v) => v.includes('dd:update-applied'));
      expect(eventWrite).toMatch(/^id: test-boot-id:\d+\n/);
    });

    test('update-applied uses empty operationId when operationId is absent from payload', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      // payload is an object but operationId is intentionally omitted
      onUpdateApplied({
        containerName: 'nginx',
        container: {
          id: 'c-1',
          name: 'nginx',
          image: { name: 'nginx:latest', serviceImage: 'nginx:latest' },
        },
      } as any);

      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(payload.operationId).toBe('');
    });

    test('update-applied sets container to undefined when payload object has no container key', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      // payload is an object without a container property
      onUpdateApplied({ containerName: 'nginx', operationId: 'op-no-container' } as any);

      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(payload.operationId).toBe('op-no-container');
      expect(payload.containerId).toBe('');
      expect(payload.imageName).toBeUndefined();
    });

    test('update-applied sets imageName to undefined when container has no image', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      onUpdateApplied({
        containerName: 'nginx',
        operationId: 'op-no-image',
        container: { id: 'c-1', name: 'nginx' },
      } as any);

      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(payload.imageName).toBeUndefined();
      expect(payload.newDigest).toBeNull();
    });

    test('update-applied sets imageName to undefined when container.image.name is not a string', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      onUpdateApplied({
        containerName: 'nginx',
        operationId: 'op-bad-name',
        container: {
          id: 'c-1',
          name: 'nginx',
          image: { name: 42, serviceImage: 'nginx:latest' },
        },
      } as any);

      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(payload.imageName).toBeUndefined();
    });

    test('update-applied uses empty containerName when payload object has no containerName field', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateApplied = mockRegisterContainerUpdateApplied.mock.calls.at(-1)[0];
      // No containerName field — getContainerUpdateAppliedEventContainerName returns undefined,
      // triggering the ?? '' fallback on line 406.
      onUpdateApplied({ operationId: 'op-no-cname' } as any);

      const payload = parseSseEventPayload(res, 'dd:update-applied');
      expect(payload.containerName).toBe('');
      expect(payload.operationId).toBe('op-no-cname');
    });
  });

  describe('dd:update-failed broadcast', () => {
    test('dd:update-failed is in the allowed event name set', () => {
      const res = createSSEResponse();
      sseRouter._clients.add(res);

      sseRouter._broadcastContainerEvent('dd:update-failed', { operationId: 'op-1' });

      expect(mockLoggerWarn).not.toHaveBeenCalled();
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('dd:update-failed'));
    });

    test('update-failed handler broadcasts correct payload shape to connected clients', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateFailed = mockRegisterContainerUpdateFailed.mock.calls.at(-1)[0];
      onUpdateFailed({
        containerName: 'nginx',
        operationId: 'op-fail-1',
        error: 'pull access denied',
        phase: 'pull',
        batchId: 'batch-xyz',
        containerId: 'c-fail-1',
      });

      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('dd:update-failed'));
      const payload = parseSseEventPayload(res, 'dd:update-failed');
      expect(payload).toMatchObject({
        operationId: 'op-fail-1',
        containerId: 'c-fail-1',
        containerName: 'nginx',
        error: 'pull access denied',
        phase: 'pull',
        batchId: 'batch-xyz',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    test('update-failed handler redacts registry credentials before broadcasting', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateFailed = mockRegisterContainerUpdateFailed.mock.calls.at(-1)[0];
      onUpdateFailed({
        containerName: 'nginx',
        operationId: 'op-fail-redact',
        error: 'registry denied: Authorization: Bearer registry-token X-Registry-Auth=super-secret',
      });

      const payload = parseSseEventPayload(res, 'dd:update-failed');
      expect(payload.error).toContain('Authorization: Bearer [REDACTED]');
      expect(payload.error).toContain('X-Registry-Auth=[REDACTED]');
      expect(payload.error).not.toContain('registry-token');
      expect(payload.error).not.toContain('super-secret');
    });

    test('update-failed handler includes rollback reason when present', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateFailed = mockRegisterContainerUpdateFailed.mock.calls.at(-1)[0];
      onUpdateFailed({
        containerName: 'nginx',
        operationId: 'op-fail-rollback',
        error: 'health gate failed',
        rollbackReason: 'container became unhealthy',
      });

      const payload = parseSseEventPayload(res, 'dd:update-failed');
      expect(payload.rollbackReason).toBe('container became unhealthy');
    });

    test('update-failed handler includes empty string phase when phase is missing', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateFailed = mockRegisterContainerUpdateFailed.mock.calls.at(-1)[0];
      onUpdateFailed({
        containerName: 'nginx',
        operationId: 'op-fail-2',
        error: 'some error',
      });

      const payload = parseSseEventPayload(res, 'dd:update-failed');
      expect(Object.hasOwn(payload, 'phase')).toBe(true);
    });

    test('update-failed handler broadcasts with stable SSE event id', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      res.write.mockClear();

      const onUpdateFailed = mockRegisterContainerUpdateFailed.mock.calls.at(-1)[0];
      onUpdateFailed({
        containerName: 'nginx',
        operationId: 'op-fail-1',
        error: 'timeout',
      });

      const writes = res.write.mock.calls.map(([v]) => v);
      const eventWrite = writes.find((v) => v.includes('dd:update-failed'));
      expect(eventWrite).toMatch(/^id: test-boot-id:\d+\n/);
    });

    test('update-failed uses empty string operationId when operationId is undefined', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateFailed = mockRegisterContainerUpdateFailed.mock.calls.at(-1)[0];
      onUpdateFailed({
        containerName: 'nginx',
        error: 'image not found',
      } as any);

      const payload = parseSseEventPayload(res, 'dd:update-failed');
      expect(payload.operationId).toBe('');
    });

    test('update-failed uses empty string containerId when containerId is undefined', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onUpdateFailed = mockRegisterContainerUpdateFailed.mock.calls.at(-1)[0];
      onUpdateFailed({
        containerName: 'nginx',
        operationId: 'op-fail-no-container',
        error: 'image not found',
      } as any);

      const payload = parseSseEventPayload(res, 'dd:update-failed');
      expect(payload.containerId).toBe('');
    });
  });

  describe('dd:batch-update-completed broadcast', () => {
    test('dd:batch-update-completed is in the allowed event name set', () => {
      const res = createSSEResponse();
      sseRouter._clients.add(res);

      sseRouter._broadcastContainerEvent('dd:batch-update-completed', { batchId: 'b-1' });

      expect(mockLoggerWarn).not.toHaveBeenCalled();
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('dd:batch-update-completed'));
    });

    test('batch-update-completed handler broadcasts payload as-is to connected clients', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);

      const onBatchCompleted = mockRegisterBatchUpdateCompleted.mock.calls.at(-1)[0];
      const batchPayload = {
        batchId: 'batch-1',
        total: 2,
        succeeded: 2,
        failed: 0,
        durationMs: 5000,
        items: [
          { operationId: 'op-1', containerId: 'c-1', containerName: 'nginx', status: 'succeeded' },
          { operationId: 'op-2', containerId: 'c-2', containerName: 'redis', status: 'succeeded' },
        ],
        timestamp: '2026-04-28T00:00:00.000Z',
      };
      onBatchCompleted(batchPayload);

      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('dd:batch-update-completed'));
      const payload = parseSseEventPayload(res, 'dd:batch-update-completed');
      expect(payload).toMatchObject({
        batchId: 'batch-1',
        total: 2,
        succeeded: 2,
        failed: 0,
        durationMs: 5000,
        items: expect.arrayContaining([
          expect.objectContaining({ operationId: 'op-1', status: 'succeeded' }),
          expect.objectContaining({ operationId: 'op-2', status: 'succeeded' }),
        ]),
        timestamp: '2026-04-28T00:00:00.000Z',
      });
    });

    test('batch-update-completed handler broadcasts with stable SSE event id', () => {
      sseRouter.init();
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      res.write.mockClear();

      const onBatchCompleted = mockRegisterBatchUpdateCompleted.mock.calls.at(-1)[0];
      onBatchCompleted({
        batchId: 'b-1',
        total: 1,
        succeeded: 1,
        failed: 0,
        durationMs: 100,
        items: [],
        timestamp: new Date().toISOString(),
      });

      const writes = res.write.mock.calls.map(([v]) => v);
      const eventWrite = writes.find((v) => v.includes('dd:batch-update-completed'));
      expect(eventWrite).toMatch(/^id: test-boot-id:\d+\n/);
    });
  });
});

function getHandler() {
  sseRouter.init();
  const call = mockRouter.get.mock.calls.find((c) => c[0] === '/');
  return call[1];
}
