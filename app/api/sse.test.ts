var {
  mockRouter,
  mockRegisterSelfUpdateStarting,
  mockRegisterContainerAdded,
  mockRegisterContainerUpdated,
  mockRegisterContainerRemoved,
  mockRegisterAgentConnected,
  mockRegisterAgentDisconnected,
} = vi.hoisted(() => ({
  mockRouter: { get: vi.fn(), post: vi.fn() },
  mockRegisterSelfUpdateStarting: vi.fn(),
  mockRegisterContainerAdded: vi.fn(),
  mockRegisterContainerUpdated: vi.fn(),
  mockRegisterContainerRemoved: vi.fn(),
  mockRegisterAgentConnected: vi.fn(),
  mockRegisterAgentDisconnected: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
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
    flush: vi.fn(),
    flushHeaders: vi.fn(),
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
    // Clear clients and connection tracking between tests
    sseRouter._clients.clear();
    sseRouter._activeSseClientsByToken.clear();
    sseRouter._activeSseClientsByResponse.clear();
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
        clientsAtEmit: 1,
        eligibleClientTokens: new Set<string>(['known-token']),
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
