var {
  mockRouter,
  mockRegisterSelfUpdateStarting,
  mockRegisterContainerAdded,
  mockRegisterContainerUpdated,
  mockRegisterContainerRemoved,
  mockRegisterAgentConnected,
  mockRegisterAgentDisconnected,
  mockRandomUUID,
  mockCreateHash,
  mockTimingSafeEqual,
  mockLoggerDebug,
  mockLoggerWarn,
} = vi.hoisted(() => {
  let uuidCounter = 0;
  return {
    mockRouter: { get: vi.fn(), post: vi.fn() },
    mockRegisterSelfUpdateStarting: vi.fn(),
    mockRegisterContainerAdded: vi.fn(),
    mockRegisterContainerUpdated: vi.fn(),
    mockRegisterContainerRemoved: vi.fn(),
    mockRegisterAgentConnected: vi.fn(),
    mockRegisterAgentDisconnected: vi.fn(),
    mockRandomUUID: vi.fn(() => {
      uuidCounter += 1;
      return `uuid-${uuidCounter}`;
    }),
    mockCreateHash: vi.fn(() => {
      const chunks: Buffer[] = [];
      const hash = {
        update: vi.fn((value: string, encoding?: BufferEncoding) => {
          chunks.push(Buffer.from(value, encoding ?? 'utf8'));
          return hash;
        }),
        digest: vi.fn(() => {
          const data = Buffer.concat(chunks);
          const digest = Buffer.alloc(32);
          for (let i = 0; i < data.length; i += 1) {
            digest[i % 32] ^= data[i];
          }
          return digest;
        }),
      };
      return hash;
    }),
    mockTimingSafeEqual: vi.fn(
      (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right),
    ),
    mockLoggerDebug: vi.fn(),
    mockLoggerWarn: vi.fn(),
  };
});

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('node:crypto', () => ({
  randomUUID: mockRandomUUID,
  createHash: mockCreateHash,
  timingSafeEqual: mockTimingSafeEqual,
}));

vi.mock('../event/index', () => ({
  registerSelfUpdateStarting: mockRegisterSelfUpdateStarting,
  registerContainerAdded: mockRegisterContainerAdded,
  registerContainerUpdated: mockRegisterContainerUpdated,
  registerContainerRemoved: mockRegisterContainerRemoved,
  registerAgentConnected: mockRegisterAgentConnected,
  registerAgentDisconnected: mockRegisterAgentDisconnected,
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

function getHandler() {
  sseRouter.init();
  const call = mockRouter.get.mock.calls.find((c) => c[0] === '/');
  return call[1];
}

function getAckHandler() {
  sseRouter.init();
  const call = mockRouter.post.mock.calls.find((c) => c[0] === '/self-update/:operationId/ack');
  return call[1];
}

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
    _listeners: listeners,
  };
}

function createSSERequest(ip = '127.0.0.1', sessionID = `session-${ip}`) {
  const listeners = {};
  return {
    ip,
    sessionID,
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    _listeners: listeners,
  };
}

function createJsonResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function hashClientToken(token: string): Buffer {
  const hash = mockCreateHash();
  hash.update(token, 'utf8');
  return hash.digest();
}

function hashClientTokens(tokens: string[]): Buffer[] {
  return tokens.map((token) => hashClientToken(token));
}

function parseSseEventPayload(res, eventName) {
  const call = res.write.mock.calls.find(
    ([payload]) => typeof payload === 'string' && payload.startsWith(`event: ${eventName}\n`),
  );
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

describe('SSE Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sseRouter._resetInitializationStateForTests();
    // Clear clients and connection tracking between tests
    sseRouter._clients.clear();
    sseRouter._activeSseClientRegistry.clear();
    sseRouter._connectionsPerIp.clear();
    sseRouter._connectionsPerSession.clear();
    sseRouter._clearPendingSelfUpdateAcks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('init', () => {
    test('should not register routes or event handlers more than once', () => {
      sseRouter.init();
      sseRouter.init();

      expect(mockRouter.get).toHaveBeenCalledTimes(1);
      expect(mockRouter.post).toHaveBeenCalledTimes(1);
      expect(mockRegisterSelfUpdateStarting).toHaveBeenCalledTimes(1);
      expect(mockRegisterContainerAdded).toHaveBeenCalledTimes(1);
      expect(mockRegisterContainerUpdated).toHaveBeenCalledTimes(1);
      expect(mockRegisterContainerRemoved).toHaveBeenCalledTimes(1);
      expect(mockRegisterAgentConnected).toHaveBeenCalledTimes(1);
      expect(mockRegisterAgentDisconnected).toHaveBeenCalledTimes(1);
    });

    test('should deregister existing event listeners when reset runs before reinit', () => {
      const deregisterSelfUpdateStarting = vi.fn();
      const deregisterContainerAdded = vi.fn();
      const deregisterContainerUpdated = vi.fn();
      const deregisterContainerRemoved = vi.fn();
      const deregisterAgentConnected = vi.fn();
      const deregisterAgentDisconnected = vi.fn();

      mockRegisterSelfUpdateStarting.mockReturnValueOnce(deregisterSelfUpdateStarting);
      mockRegisterContainerAdded.mockReturnValueOnce(deregisterContainerAdded);
      mockRegisterContainerUpdated.mockReturnValueOnce(deregisterContainerUpdated);
      mockRegisterContainerRemoved.mockReturnValueOnce(deregisterContainerRemoved);
      mockRegisterAgentConnected.mockReturnValueOnce(deregisterAgentConnected);
      mockRegisterAgentDisconnected.mockReturnValueOnce(deregisterAgentDisconnected);

      sseRouter.init();
      sseRouter._resetInitializationStateForTests();
      sseRouter.init();

      expect(deregisterSelfUpdateStarting).toHaveBeenCalledTimes(1);
      expect(deregisterContainerAdded).toHaveBeenCalledTimes(1);
      expect(deregisterContainerUpdated).toHaveBeenCalledTimes(1);
      expect(deregisterContainerRemoved).toHaveBeenCalledTimes(1);
      expect(deregisterAgentConnected).toHaveBeenCalledTimes(1);
      expect(deregisterAgentDisconnected).toHaveBeenCalledTimes(1);

      expect(mockRegisterSelfUpdateStarting).toHaveBeenCalledTimes(2);
      expect(mockRegisterContainerAdded).toHaveBeenCalledTimes(2);
      expect(mockRegisterContainerUpdated).toHaveBeenCalledTimes(2);
      expect(mockRegisterContainerRemoved).toHaveBeenCalledTimes(2);
      expect(mockRegisterAgentConnected).toHaveBeenCalledTimes(2);
      expect(mockRegisterAgentDisconnected).toHaveBeenCalledTimes(2);
    });

    test('should deregister event listeners on process shutdown signal', () => {
      const deregisterSelfUpdateStarting = vi.fn();
      const deregisterContainerAdded = vi.fn();
      const deregisterContainerUpdated = vi.fn();
      const deregisterContainerRemoved = vi.fn();
      const deregisterAgentConnected = vi.fn();
      const deregisterAgentDisconnected = vi.fn();

      mockRegisterSelfUpdateStarting.mockReturnValueOnce(deregisterSelfUpdateStarting);
      mockRegisterContainerAdded.mockReturnValueOnce(deregisterContainerAdded);
      mockRegisterContainerUpdated.mockReturnValueOnce(deregisterContainerUpdated);
      mockRegisterContainerRemoved.mockReturnValueOnce(deregisterContainerRemoved);
      mockRegisterAgentConnected.mockReturnValueOnce(deregisterAgentConnected);
      mockRegisterAgentDisconnected.mockReturnValueOnce(deregisterAgentDisconnected);

      sseRouter.init();
      process.emit('SIGTERM');

      expect(deregisterSelfUpdateStarting).toHaveBeenCalledTimes(1);
      expect(deregisterContainerAdded).toHaveBeenCalledTimes(1);
      expect(deregisterContainerUpdated).toHaveBeenCalledTimes(1);
      expect(deregisterContainerRemoved).toHaveBeenCalledTimes(1);
      expect(deregisterAgentConnected).toHaveBeenCalledTimes(1);
      expect(deregisterAgentDisconnected).toHaveBeenCalledTimes(1);
    });

    test('should register GET route on /', () => {
      sseRouter.init();
      expect(mockRouter.get).toHaveBeenCalledWith('/', expect.any(Function));
    });

    test('should register POST route for self-update acknowledgments', () => {
      sseRouter.init();
      expect(mockRouter.post).toHaveBeenCalledWith(
        '/self-update/:operationId/ack',
        expect.any(Function),
      );
    });

    test('should register self-update event handler', () => {
      sseRouter.init();
      expect(mockRegisterSelfUpdateStarting).toHaveBeenCalledWith(expect.any(Function));
    });

    test('should register container lifecycle event handlers', () => {
      sseRouter.init();
      expect(mockRegisterContainerAdded).toHaveBeenCalledWith(expect.any(Function));
      expect(mockRegisterContainerUpdated).toHaveBeenCalledWith(expect.any(Function));
      expect(mockRegisterContainerRemoved).toHaveBeenCalledWith(expect.any(Function));
    });

    test('should register agent connection lifecycle event handlers', () => {
      sseRouter.init();
      expect(mockRegisterAgentConnected).toHaveBeenCalledWith(expect.any(Function));
      expect(mockRegisterAgentDisconnected).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('eventsHandler', () => {
    test('should expose heartbeat interval constant', () => {
      expect(sseRouter._SSE_HEARTBEAT_INTERVAL_MS).toBe(15000);
    });

    test('should set correct SSE headers', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });

    test('should send initial dd:connected event', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('event: dd:connected\ndata: {"clientId":"'),
      );
      const connectedPayload = parseSseEventPayload(res, 'dd:connected');
      expect(connectedPayload).toEqual(
        expect.objectContaining({
          clientId: expect.any(String),
          clientToken: expect.any(String),
        }),
      );
      expect(res.flushHeaders).toHaveBeenCalledTimes(1);
      expect(res.flush).toHaveBeenCalledTimes(1);
    });

    test('should add client to clients set', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);

      expect(sseRouter._clients.has(res)).toBe(true);
      expect(sseRouter._clients.size).toBe(1);
    });

    test('should remove client on connection close', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);
      expect(sseRouter._clients.size).toBe(1);

      // Simulate client disconnect
      req._listeners.close();

      expect(sseRouter._clients.size).toBe(0);
      expect(sseRouter._clients.has(res)).toBe(false);
    });

    test('should remove client tracking on request abort', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);
      expect(sseRouter._clients.has(res)).toBe(true);
      expect(sseRouter._activeSseClientRegistry.hasByResponse(res)).toBe(true);
      expect(sseRouter._activeSseClientRegistry.sizeByToken()).toBe(1);
      expect(sseRouter._connectionsPerIp.get('127.0.0.1')).toBe(1);

      // Simulate abrupt client-side abort
      req._listeners.aborted();

      expect(sseRouter._clients.has(res)).toBe(false);
      expect(sseRouter._activeSseClientRegistry.hasByResponse(res)).toBe(false);
      expect(sseRouter._activeSseClientRegistry.sizeByToken()).toBe(0);
      expect(sseRouter._connectionsPerIp.has('127.0.0.1')).toBe(false);
    });

    test('should remove client tracking on response close', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);
      expect(sseRouter._clients.has(res)).toBe(true);

      // Simulate abrupt socket close on the response stream
      res._listeners.close();

      expect(sseRouter._clients.has(res)).toBe(false);
      expect(sseRouter._activeSseClientRegistry.hasByResponse(res)).toBe(false);
      expect(sseRouter._activeSseClientRegistry.sizeByToken()).toBe(0);
      expect(sseRouter._connectionsPerIp.has('127.0.0.1')).toBe(false);
    });

    test('should set up heartbeat interval', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);

      // Clear the initial write call
      res.write.mockClear();

      // Advance 15s to trigger heartbeat
      vi.advanceTimersByTime(sseRouter._SSE_HEARTBEAT_INTERVAL_MS);

      expect(res.write).toHaveBeenCalledWith('event: dd:heartbeat\ndata: {}\n\n');
    });

    test('should use one shared heartbeat interval and clear it when the last client disconnects', () => {
      const handler = getHandler();
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      const firstClient = connectSseClient(handler, '10.0.0.1');
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      const secondClient = connectSseClient(handler, '10.0.0.2');
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      clearIntervalSpy.mockClear();

      firstClient.req._listeners.close();
      expect(clearIntervalSpy).not.toHaveBeenCalled();

      secondClient.req._listeners.close();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    });

    test('should clear heartbeat interval on disconnect', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);
      res.write.mockClear();

      // Simulate disconnect
      req._listeners.close();

      // Advance time — no more heartbeats should fire
      vi.advanceTimersByTime(30000);
      expect(res.write).not.toHaveBeenCalled();
    });

    test('should periodically sweep stale client and pending ack map entries', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const activeClient = sseRouter._activeSseClientRegistry.getByResponse(res);

      expect(activeClient).toBeDefined();
      expect(sseRouter._activeSseClientRegistry.sizeByToken()).toBe(1);

      // Simulate orphaned entries that were not cleaned up by connection events.
      sseRouter._clients.delete(res);
      (activeClient as any).connectedAtMs = Date.now() - 60 * 60 * 1000;
      sseRouter._pendingSelfUpdateAcks.set('op-stale-sweep', {
        operationId: 'op-stale-sweep',
        requiresAck: true,
        ackTimeoutMs: 1000,
        clientsAtEmit: 1,
        eligibleClientTokens: [],
        ackedClientIds: new Set<string>(),
        resolved: false,
        createdAtMs: Date.now() - 60 * 60 * 1000,
      } as any);

      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(sseRouter._activeSseClientRegistry.sizeByResponse()).toBe(0);
      expect(sseRouter._activeSseClientRegistry.sizeByToken()).toBe(0);
      expect(sseRouter._pendingSelfUpdateAcks.has('op-stale-sweep')).toBe(false);
    });

    test('should sweep stale entries by response index only', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const activeClient = sseRouter._activeSseClientRegistry.getByResponse(res);

      expect(activeClient).toBeDefined();
      expect(sseRouter._activeSseClientRegistry.sizeByTokenHash()).toBe(1);

      // Simulate map drift where only the token-hash map retained the client.
      // Sweep should only consider response-indexed clients.
      sseRouter._clients.delete(res);
      sseRouter._activeSseClientRegistry.simulateTokenHashOnlyDrift(res);
      (activeClient as any).connectedAtMs = Date.now() - 60 * 60 * 1000;

      sseRouter._sweepStaleSseState(Date.now());

      expect(sseRouter._activeSseClientRegistry.sizeByTokenHash()).toBe(1);
    });

    test('should drop stale client when response is writableEnded', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const activeClient = sseRouter._activeSseClientRegistry.getByResponse(res);
      (activeClient as any).connectedAtMs = Date.now() - 60 * 60 * 1000;
      (res as any).writableEnded = true;

      sseRouter._sweepStaleSseState(Date.now());

      expect(sseRouter._activeSseClientRegistry.hasByResponse(res)).toBe(false);
      expect(sseRouter._clients.has(res)).toBe(false);
    });

    test('should drop stale client when response is writableFinished', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const activeClient = sseRouter._activeSseClientRegistry.getByResponse(res);
      (activeClient as any).connectedAtMs = Date.now() - 60 * 60 * 1000;
      (res as any).writableFinished = true;

      sseRouter._sweepStaleSseState(Date.now());

      expect(sseRouter._activeSseClientRegistry.hasByResponse(res)).toBe(false);
    });

    test('should drop stale client when response is destroyed', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const activeClient = sseRouter._activeSseClientRegistry.getByResponse(res);
      (activeClient as any).connectedAtMs = Date.now() - 60 * 60 * 1000;
      (res as any).destroyed = true;

      sseRouter._sweepStaleSseState(Date.now());

      expect(sseRouter._activeSseClientRegistry.hasByResponse(res)).toBe(false);
    });

    test('should drop closed responses immediately regardless of entry age', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const activeClient = sseRouter._activeSseClientRegistry.getByResponse(res);

      (activeClient as any).connectedAtMs = Date.now() - 1000;
      (res as any).writableEnded = true;

      sseRouter._sweepStaleSseState(Date.now());

      expect(sseRouter._activeSseClientRegistry.hasByResponse(res)).toBe(false);
      expect(sseRouter._clients.has(res)).toBe(false);
    });

    test('should keep active open responses that are not stale', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const activeClient = sseRouter._activeSseClientRegistry.getByResponse(res);

      expect(activeClient).toBeDefined();
      (activeClient as any).connectedAtMs = Date.now() - 1000;

      sseRouter._sweepStaleSseState(Date.now());

      expect(sseRouter._activeSseClientRegistry.hasByResponse(res)).toBe(true);
      expect(sseRouter._clients.has(res)).toBe(true);
    });
  });

  describe('per-IP connection limits', () => {
    test('should reject connections exceeding the per-IP limit', () => {
      const handler = getHandler();
      const ip = '192.168.1.1';

      // Fill up to the limit
      for (let i = 0; i < sseRouter._MAX_CONNECTIONS_PER_IP; i++) {
        const req = createSSERequest(ip);
        const res = createSSEResponse();
        handler(req, res);
      }

      // Next connection from the same IP should be rejected
      const rejectedReq = createSSERequest(ip);
      const rejectedRes = {
        ...createSSEResponse(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      handler(rejectedReq, rejectedRes);

      expect(rejectedRes.status).toHaveBeenCalledWith(429);
      expect(rejectedRes.json).toHaveBeenCalledWith({ message: 'Too many SSE connections' });
    });

    test('should allow connections from different IPs independently', () => {
      const handler = getHandler();

      // Fill up one IP
      for (let i = 0; i < sseRouter._MAX_CONNECTIONS_PER_IP; i++) {
        handler(createSSERequest('10.0.0.1'), createSSEResponse());
      }

      // Another IP should still be allowed
      const req = createSSERequest('10.0.0.2');
      const res = createSSEResponse();
      handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });

    test('should decrement counter when client disconnects', () => {
      const handler = getHandler();
      const ip = '192.168.1.1';
      const req = createSSERequest(ip);
      const res = createSSEResponse();

      handler(req, res);
      expect(sseRouter._connectionsPerIp.get(ip)).toBe(1);
      expect(sseRouter._connectionsPerSession.get(`session-${ip}`)).toBe(1);

      // Simulate disconnect
      req._listeners.close();
      expect(sseRouter._connectionsPerIp.has(ip)).toBe(false);
      expect(sseRouter._connectionsPerSession.has(`session-${ip}`)).toBe(false);
    });

    test('should use unknown key when request ip is missing', () => {
      const handler = getHandler();
      const req = createSSERequest(null);
      const res = createSSEResponse();

      handler(req, res);

      expect(sseRouter._connectionsPerIp.get('unknown')).toBe(1);
      req._listeners.close();
    });

    test('should fallback session tracking key to ip when sessionID is missing', () => {
      const handler = getHandler();
      const req = createSSERequest('203.0.113.1', '');
      const res = createSSEResponse();

      handler(req, res);

      expect(sseRouter._connectionsPerSession.get('ip:203.0.113.1')).toBe(1);
      req._listeners.close();
    });

    test('should safely close when ip counter has already been removed', () => {
      const handler = getHandler();
      const ip = '192.168.1.1';
      const req = createSSERequest(ip);
      const res = createSSEResponse();

      handler(req, res);
      sseRouter._connectionsPerIp.delete(ip);

      expect(() => req._listeners.close()).not.toThrow();
      expect(sseRouter._connectionsPerIp.has(ip)).toBe(false);
    });

    test('should make cleanup idempotent when close is emitted multiple times', () => {
      const handler = getHandler();
      const req = createSSERequest('192.168.2.5');
      const res = createSSEResponse();

      handler(req, res);

      expect(() => {
        req._listeners.close();
        req._listeners.close();
      }).not.toThrow();
      expect(sseRouter._connectionsPerIp.has('192.168.2.5')).toBe(false);
    });

    test('should remove client from set when registry entry is already gone', () => {
      const handler = getHandler();
      const req = createSSERequest('198.51.100.9');
      const res = createSSEResponse();

      handler(req, res);
      expect(sseRouter._clients.has(res)).toBe(true);

      // Simulate inconsistent state where the registry no longer has this response.
      sseRouter._activeSseClientRegistry.clear();
      req._listeners.close();

      expect(sseRouter._clients.has(res)).toBe(false);
      expect(sseRouter._connectionsPerIp.has('198.51.100.9')).toBe(false);
    });

    test('should allow new connection after disconnect frees a slot', () => {
      const handler = getHandler();
      const ip = '192.168.1.1';
      const requests = [];

      // Fill up to the limit
      for (let i = 0; i < sseRouter._MAX_CONNECTIONS_PER_IP; i++) {
        const req = createSSERequest(ip);
        const res = createSSEResponse();
        handler(req, res);
        requests.push(req);
      }

      // Disconnect one
      requests[0]._listeners.close();

      // New connection should now be accepted
      const newReq = createSSERequest(ip);
      const newRes = createSSEResponse();
      handler(newReq, newRes);

      expect(newRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });

    test('should enforce session limit even when request ip changes', () => {
      const handler = getHandler();
      const sessionID = 'shared-session';

      for (let i = 0; i < sseRouter._MAX_CONNECTIONS_PER_SESSION; i++) {
        handler(createSSERequest(`10.0.0.${i + 1}`, sessionID), createSSEResponse());
      }

      const rejectedRes = {
        ...createSSEResponse(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      handler(createSSERequest('203.0.113.11', sessionID), rejectedRes);

      expect(rejectedRes.status).toHaveBeenCalledWith(429);
      expect(rejectedRes.json).toHaveBeenCalledWith({ message: 'Too many SSE connections' });
    });
  });

  describe('broadcastSelfUpdate', () => {
    test('should send dd:self-update to all connected clients', () => {
      const handler = getHandler();
      const { res: res1 } = connectSseClient(handler, '10.0.0.1');
      const { res: res2 } = connectSseClient(handler, '10.0.0.2');

      sseRouter._broadcastSelfUpdate({
        opId: 'op-1',
      });

      expect(res1.write).toHaveBeenCalledWith(
        expect.stringContaining('event: dd:self-update\ndata: {"opId":"op-1"'),
      );
      expect(res2.write).toHaveBeenCalledWith(
        expect.stringContaining('event: dd:self-update\ndata: {"opId":"op-1"'),
      );
    });

    test('should handle empty client set', () => {
      // No clients connected — should not throw
      expect(() => sseRouter._broadcastSelfUpdate({ opId: 'op-2' })).not.toThrow();
    });

    test('should be triggered when self-update event fires', async () => {
      const handler = getHandler();
      // The registerSelfUpdateStarting callback should call broadcastSelfUpdate
      const registeredCallback = mockRegisterSelfUpdateStarting.mock.calls.at(-1)[0];

      const { res } = connectSseClient(handler);

      await registeredCallback({ opId: 'op-3' });

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('event: dd:self-update\ndata: {"opId":"op-3"'),
      );
    });

    test('should wait for ack when requiresAck is true', async () => {
      const handler = getHandler();
      const { clientId, clientToken } = connectSseClient(handler);

      const broadcastPromise = sseRouter._broadcastSelfUpdate({
        opId: 'op-ack-1',
        requiresAck: true,
        ackTimeoutMs: 1000,
      });

      expect(sseRouter._pendingSelfUpdateAcks.has('op-ack-1')).toBe(true);

      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-ack-1' },
        body: { clientId, clientToken },
      };
      const jsonRes = createJsonResponse();
      ackHandler(req, jsonRes);

      await broadcastPromise;

      expect(jsonRes.status).toHaveBeenCalledWith(202);
      expect(jsonRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'accepted',
          operationId: 'op-ack-1',
        }),
      );
      expect(sseRouter._pendingSelfUpdateAcks.has('op-ack-1')).toBe(false);
    });

    test('should unblock on ack timeout', async () => {
      const handler = getHandler();
      connectSseClient(handler);

      const broadcastPromise = sseRouter._broadcastSelfUpdate({
        opId: 'op-ack-timeout',
        requiresAck: true,
        ackTimeoutMs: 500,
      });
      expect(sseRouter._pendingSelfUpdateAcks.has('op-ack-timeout')).toBe(true);

      vi.advanceTimersByTime(500);
      await broadcastPromise;

      expect(sseRouter._pendingSelfUpdateAcks.has('op-ack-timeout')).toBe(false);
    });

    test('should reject fabricated ACK client credentials and keep pending ACK active', async () => {
      const handler = getHandler();
      connectSseClient(handler);

      const broadcastPromise = sseRouter._broadcastSelfUpdate({
        opId: 'op-ack-invalid',
        requiresAck: true,
        ackTimeoutMs: 1000,
      });
      expect(sseRouter._pendingSelfUpdateAcks.has('op-ack-invalid')).toBe(true);

      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-ack-invalid' },
        body: { clientId: 'fabricated-client', clientToken: 'fabricated-token' },
      };
      const jsonRes = createJsonResponse();
      ackHandler(req, jsonRes);

      expect(jsonRes.status).toHaveBeenCalledWith(403);
      expect(jsonRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rejected',
          operationId: 'op-ack-invalid',
        }),
      );
      expect(sseRouter._pendingSelfUpdateAcks.has('op-ack-invalid')).toBe(true);

      vi.advanceTimersByTime(1000);
      await broadcastPromise;
      expect(sseRouter._pendingSelfUpdateAcks.has('op-ack-invalid')).toBe(false);
    });
  });

  describe('acknowledgeSelfUpdate', () => {
    test('should avoid rehashing each eligible token during ACK lookup', () => {
      const handler = getHandler();
      const connectedClients = Array.from({ length: 25 }, (_, index) =>
        connectSseClient(handler, `10.1.0.${index + 1}`),
      );
      const targetClient = connectedClients[connectedClients.length - 1];
      const eligibleClientTokens = connectedClients.map((client) => client.clientToken);

      sseRouter._pendingSelfUpdateAcks.set('op-efficient-lookup', {
        operationId: 'op-efficient-lookup',
        requiresAck: true,
        ackTimeoutMs: 1000,
        createdAtMs: Date.now(),
        clientsAtEmit: connectedClients.length,
        eligibleClientTokens: hashClientTokens(eligibleClientTokens),
        ackedClientIds: new Set<string>(),
        resolved: false,
      });
      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-efficient-lookup' },
        body: { clientId: targetClient.clientId, clientToken: targetClient.clientToken },
      };
      const jsonRes = createJsonResponse();

      mockCreateHash.mockClear();
      ackHandler(req, jsonRes);

      expect(jsonRes.status).toHaveBeenCalledWith(202);
      expect(mockCreateHash).toHaveBeenCalledTimes(2);
    });

    test('should use timing-safe comparison for client tokens', () => {
      const handler = getHandler();
      const { clientId, clientToken } = connectSseClient(handler);
      sseRouter._pendingSelfUpdateAcks.set('op-timing-safe', {
        operationId: 'op-timing-safe',
        requiresAck: true,
        ackTimeoutMs: 1000,
        createdAtMs: Date.now(),
        clientsAtEmit: 1,
        eligibleClientTokens: hashClientTokens(['different-token']),
        ackedClientIds: new Set<string>(),
        resolved: false,
      });
      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-timing-safe' },
        body: { clientId, clientToken },
      };
      const jsonRes = createJsonResponse();

      ackHandler(req, jsonRes);

      expect(jsonRes.status).toHaveBeenCalledWith(403);
      expect(jsonRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rejected',
          reason: 'client-not-bound-to-operation',
        }),
      );
      expect(mockTimingSafeEqual).toHaveBeenCalled();
    });

    test('should return ignored for unknown operation', () => {
      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'unknown-op' },
        body: { clientId: 'client-1', clientToken: 'token-1' },
      };
      const jsonRes = createJsonResponse();

      ackHandler(req, jsonRes);

      expect(jsonRes.status).toHaveBeenCalledWith(202);
      expect(jsonRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ignored',
          operationId: 'unknown-op',
        }),
      );
    });

    test('should validate missing clientId', () => {
      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-1' },
        body: {},
      };
      const jsonRes = createJsonResponse();

      ackHandler(req, jsonRes);

      expect(jsonRes.status).toHaveBeenCalledWith(400);
      expect(jsonRes.json).toHaveBeenCalledWith({ error: 'clientId is required' });
    });

    test('should validate missing clientToken', () => {
      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-1' },
        body: { clientId: 'client-1' },
      };
      const jsonRes = createJsonResponse();

      ackHandler(req, jsonRes);

      expect(jsonRes.status).toHaveBeenCalledWith(400);
      expect(jsonRes.json).toHaveBeenCalledWith({ error: 'clientToken is required' });
    });

    test('should reject ACK from unknown client token', () => {
      const handler = getHandler();
      const { clientId } = connectSseClient(handler);
      sseRouter._pendingSelfUpdateAcks.set('op-unknown-client', {
        operationId: 'op-unknown-client',
        requiresAck: true,
        ackTimeoutMs: 1000,
        createdAtMs: Date.now(),
        clientsAtEmit: 1,
        eligibleClientTokens: hashClientTokens(['known-token']),
        ackedClientIds: new Set<string>(),
        resolved: false,
      });
      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-unknown-client' },
        body: { clientId, clientToken: 'unknown-token' },
      };
      const jsonRes = createJsonResponse();

      ackHandler(req, jsonRes);

      expect(jsonRes.status).toHaveBeenCalledWith(403);
      expect(jsonRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rejected',
          reason: 'invalid-or-expired-client-token',
        }),
      );
      expect(sseRouter._pendingSelfUpdateAcks.has('op-unknown-client')).toBe(true);
    });

    test('should perform a timing-safe compare even when client token is unknown', () => {
      const handler = getHandler();
      const { clientId } = connectSseClient(handler);
      sseRouter._pendingSelfUpdateAcks.set('op-constant-time', {
        operationId: 'op-constant-time',
        requiresAck: true,
        ackTimeoutMs: 1000,
        createdAtMs: Date.now(),
        clientsAtEmit: 1,
        eligibleClientTokens: hashClientTokens(['known-token']),
        ackedClientIds: new Set<string>(),
        resolved: false,
      });
      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-constant-time' },
        body: { clientId, clientToken: 'unknown-token' },
      };
      const jsonRes = createJsonResponse();

      ackHandler(req, jsonRes);

      expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
      expect(jsonRes.status).toHaveBeenCalledWith(403);
      expect(jsonRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rejected',
          reason: 'invalid-or-expired-client-token',
        }),
      );
    });
  });

  describe('broadcastScanStarted', () => {
    test('should send dd:scan-started to all connected clients', () => {
      const res1 = createSSEResponse();
      const res2 = createSSEResponse();
      sseRouter._clients.add(res1);
      sseRouter._clients.add(res2);

      sseRouter._broadcastScanStarted('container-1');

      const expected = 'event: dd:scan-started\ndata: {"containerId":"container-1"}\n\n';
      expect(res1.write).toHaveBeenCalledWith(expected);
      expect(res2.write).toHaveBeenCalledWith(expected);
    });

    test('should handle empty client set', () => {
      expect(() => sseRouter._broadcastScanStarted('container-1')).not.toThrow();
    });
  });

  describe('broadcastScanCompleted', () => {
    test('should send dd:scan-completed to all connected clients', () => {
      const res1 = createSSEResponse();
      const res2 = createSSEResponse();
      sseRouter._clients.add(res1);
      sseRouter._clients.add(res2);

      sseRouter._broadcastScanCompleted('container-1', 'success');

      const expected =
        'event: dd:scan-completed\ndata: {"containerId":"container-1","status":"success"}\n\n';
      expect(res1.write).toHaveBeenCalledWith(expected);
      expect(res2.write).toHaveBeenCalledWith(expected);
    });

    test('should handle empty client set', () => {
      expect(() => sseRouter._broadcastScanCompleted('container-1', 'error')).not.toThrow();
    });

    test('should include error status', () => {
      const res = createSSEResponse();
      sseRouter._clients.add(res);

      sseRouter._broadcastScanCompleted('container-1', 'error');

      const expected =
        'event: dd:scan-completed\ndata: {"containerId":"container-1","status":"error"}\n\n';
      expect(res.write).toHaveBeenCalledWith(expected);
    });
  });

  describe('container lifecycle broadcasts', () => {
    test('should broadcast dd:container-added when container-added event fires', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const onContainerAdded = mockRegisterContainerAdded.mock.calls.at(-1)[0];

      onContainerAdded({ id: 'container-1', name: 'nginx' });

      expect(res.write).toHaveBeenCalledWith(
        'event: dd:container-added\ndata: {"id":"container-1","name":"nginx"}\n\n',
      );
    });

    test('should broadcast dd:container-updated when container-updated event fires', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const onContainerUpdated = mockRegisterContainerUpdated.mock.calls.at(-1)[0];

      onContainerUpdated({ id: 'container-1', name: 'nginx' });

      expect(res.write).toHaveBeenCalledWith(
        'event: dd:container-updated\ndata: {"id":"container-1","name":"nginx"}\n\n',
      );
    });

    test('should broadcast dd:container-removed when container-removed event fires', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const onContainerRemoved = mockRegisterContainerRemoved.mock.calls.at(-1)[0];

      onContainerRemoved({ id: 'container-1' });

      expect(res.write).toHaveBeenCalledWith(
        'event: dd:container-removed\ndata: {"id":"container-1"}\n\n',
      );
    });

    test('should serialize null payloads as empty objects', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const onContainerAdded = mockRegisterContainerAdded.mock.calls.at(-1)[0];

      onContainerAdded(null);

      expect(res.write).toHaveBeenCalledWith('event: dd:container-added\ndata: {}\n\n');
    });

    test('should drop invalid event names before writing to the SSE stream', () => {
      const res = createSSEResponse();
      sseRouter._clients.add(res);

      sseRouter._broadcastContainerEvent('dd:container-added\ndata: injected', {
        id: 'container-1',
      });

      expect(res.write).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('Dropping invalid SSE container event name: dd:container-added'),
      );
    });
  });

  describe('agent lifecycle broadcasts', () => {
    test('should broadcast dd:agent-connected when agent-connected event fires', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const onAgentConnected = mockRegisterAgentConnected.mock.calls.at(-1)[0];

      onAgentConnected({ agentName: 'edge-1' });

      expect(res.write).toHaveBeenCalledWith(
        'event: dd:agent-connected\ndata: {"agentName":"edge-1"}\n\n',
      );
    });

    test('should broadcast dd:agent-disconnected when agent-disconnected event fires', () => {
      const handler = getHandler();
      const { res } = connectSseClient(handler);
      const onAgentDisconnected = mockRegisterAgentDisconnected.mock.calls.at(-1)[0];

      onAgentDisconnected({ agentName: 'edge-1', reason: 'SSE connection lost' });

      expect(res.write).toHaveBeenCalledWith(
        'event: dd:agent-disconnected\ndata: {"agentName":"edge-1","reason":"SSE connection lost"}\n\n',
      );
    });
  });
});
