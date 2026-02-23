var { mockRouter, mockRegisterSelfUpdateStarting } = vi.hoisted(() => ({
  mockRouter: { get: vi.fn(), post: vi.fn() },
  mockRegisterSelfUpdateStarting: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('../event/index', () => ({
  registerSelfUpdateStarting: mockRegisterSelfUpdateStarting,
}));

vi.mock('../log', () => ({
  default: { child: vi.fn(() => ({ debug: vi.fn(), warn: vi.fn() })) },
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
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
  };
}

function createSSERequest(ip = '127.0.0.1') {
  const listeners = {};
  return {
    ip,
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

describe('SSE Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Clear clients and connection tracking between tests
    sseRouter._clients.clear();
    sseRouter._connectionsPerIp.clear();
    sseRouter._clearPendingSelfUpdateAcks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('init', () => {
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
  });

  describe('eventsHandler', () => {
    test('should set correct SSE headers', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
    });

    test('should send initial dd:connected event', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);

      expect(res.write).toHaveBeenCalledWith('event: dd:connected\ndata: {}\n\n');
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

    test('should set up heartbeat interval', () => {
      const handler = getHandler();
      const req = createSSERequest();
      const res = createSSEResponse();

      handler(req, res);

      // Clear the initial write call
      res.write.mockClear();

      // Advance 15s to trigger heartbeat
      vi.advanceTimersByTime(15000);

      expect(res.write).toHaveBeenCalledWith('event: dd:heartbeat\ndata: {}\n\n');
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

      // Simulate disconnect
      req._listeners.close();
      expect(sseRouter._connectionsPerIp.has(ip)).toBe(false);
    });

    test('should use unknown key when request ip is missing', () => {
      const handler = getHandler();
      const req = createSSERequest(null);
      const res = createSSEResponse();

      handler(req, res);

      expect(sseRouter._connectionsPerIp.get('unknown')).toBe(1);
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
  });

  describe('broadcastSelfUpdate', () => {
    test('should send dd:self-update to all connected clients', () => {
      const res1 = createSSEResponse();
      const res2 = createSSEResponse();
      sseRouter._clients.add(res1);
      sseRouter._clients.add(res2);

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
      sseRouter.init();
      // The registerSelfUpdateStarting callback should call broadcastSelfUpdate
      const registeredCallback = mockRegisterSelfUpdateStarting.mock.calls[0][0];

      const res = createSSEResponse();
      sseRouter._clients.add(res);

      await registeredCallback({ opId: 'op-3' });

      expect(res.write).toHaveBeenCalledWith(
        expect.stringContaining('event: dd:self-update\ndata: {"opId":"op-3"'),
      );
    });

    test('should wait for ack when requiresAck is true', async () => {
      const res = createSSEResponse();
      sseRouter._clients.add(res);

      const broadcastPromise = sseRouter._broadcastSelfUpdate({
        opId: 'op-ack-1',
        requiresAck: true,
        ackTimeoutMs: 1000,
      });

      expect(sseRouter._pendingSelfUpdateAcks.has('op-ack-1')).toBe(true);

      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'op-ack-1' },
        body: { clientId: 'client-1' },
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
      const res = createSSEResponse();
      sseRouter._clients.add(res);

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
  });

  describe('acknowledgeSelfUpdate', () => {
    test('should return ignored for unknown operation', () => {
      const ackHandler = getAckHandler();
      const req = {
        params: { operationId: 'unknown-op' },
        body: { clientId: 'client-1' },
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
});
