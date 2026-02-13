var { mockRouter, mockRegisterSelfUpdateStarting } = vi.hoisted(() => ({
  mockRouter: { get: vi.fn() },
  mockRegisterSelfUpdateStarting: vi.fn(),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('../event/index', () => ({
  registerSelfUpdateStarting: mockRegisterSelfUpdateStarting,
}));

vi.mock('../log', () => ({
  default: { child: vi.fn(() => ({ debug: vi.fn() })) },
}));

import * as sseRouter from './sse.js';

function getHandler() {
  sseRouter.init();
  var call = mockRouter.get.mock.calls.find((c) => c[0] === '/');
  return call[1];
}

function createSSEResponse() {
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
  };
}

function createSSERequest() {
  var listeners = {};
  return {
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    _listeners: listeners,
  };
}

describe('SSE Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Clear clients set between tests
    sseRouter._clients.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('init', () => {
    test('should register GET route on /', () => {
      sseRouter.init();
      expect(mockRouter.get).toHaveBeenCalledWith('/', expect.any(Function));
    });

    test('should register self-update event handler', () => {
      sseRouter.init();
      expect(mockRegisterSelfUpdateStarting).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('eventsHandler', () => {
    test('should set correct SSE headers', () => {
      var handler = getHandler();
      var req = createSSERequest();
      var res = createSSEResponse();

      handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
    });

    test('should send initial dd:connected event', () => {
      var handler = getHandler();
      var req = createSSERequest();
      var res = createSSEResponse();

      handler(req, res);

      expect(res.write).toHaveBeenCalledWith('event: dd:connected\ndata: {}\n\n');
    });

    test('should add client to clients set', () => {
      var handler = getHandler();
      var req = createSSERequest();
      var res = createSSEResponse();

      handler(req, res);

      expect(sseRouter._clients.has(res)).toBe(true);
      expect(sseRouter._clients.size).toBe(1);
    });

    test('should remove client on connection close', () => {
      var handler = getHandler();
      var req = createSSERequest();
      var res = createSSEResponse();

      handler(req, res);
      expect(sseRouter._clients.size).toBe(1);

      // Simulate client disconnect
      req._listeners.close();

      expect(sseRouter._clients.size).toBe(0);
      expect(sseRouter._clients.has(res)).toBe(false);
    });

    test('should set up heartbeat interval', () => {
      var handler = getHandler();
      var req = createSSERequest();
      var res = createSSEResponse();

      handler(req, res);

      // Clear the initial write call
      res.write.mockClear();

      // Advance 15s to trigger heartbeat
      vi.advanceTimersByTime(15000);

      expect(res.write).toHaveBeenCalledWith('event: dd:heartbeat\ndata: {}\n\n');
    });

    test('should clear heartbeat interval on disconnect', () => {
      var handler = getHandler();
      var req = createSSERequest();
      var res = createSSEResponse();

      handler(req, res);
      res.write.mockClear();

      // Simulate disconnect
      req._listeners.close();

      // Advance time — no more heartbeats should fire
      vi.advanceTimersByTime(30000);
      expect(res.write).not.toHaveBeenCalled();
    });
  });

  describe('broadcastSelfUpdate', () => {
    test('should send dd:self-update to all connected clients', () => {
      var res1 = createSSEResponse();
      var res2 = createSSEResponse();
      sseRouter._clients.add(res1);
      sseRouter._clients.add(res2);

      sseRouter._broadcastSelfUpdate();

      expect(res1.write).toHaveBeenCalledWith('event: dd:self-update\ndata: {}\n\n');
      expect(res2.write).toHaveBeenCalledWith('event: dd:self-update\ndata: {}\n\n');
    });

    test('should handle empty client set', () => {
      // No clients connected — should not throw
      expect(() => sseRouter._broadcastSelfUpdate()).not.toThrow();
    });

    test('should be triggered when self-update event fires', () => {
      sseRouter.init();
      // The registerSelfUpdateStarting callback should call broadcastSelfUpdate
      var registeredCallback = mockRegisterSelfUpdateStarting.mock.calls[0][0];

      var res = createSSEResponse();
      sseRouter._clients.add(res);

      registeredCallback();

      expect(res.write).toHaveBeenCalledWith('event: dd:self-update\ndata: {}\n\n');
    });
  });
});
