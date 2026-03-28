import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import * as configuration from '../configuration/index.js';
import {
  attachSystemLogStreamWebSocketServer,
  createSystemLogStreamGateway,
  parseSystemLogStreamQuery,
} from './log-stream.js';
import * as rateLimitKey from './rate-limit-key.js';

function createUpgradeSocket() {
  return {
    destroyed: false,
    write: vi.fn(),
    destroy: vi.fn(function destroy() {
      this.destroyed = true;
    }),
  };
}

function createUpgradeRequest(url: string) {
  return {
    url,
    headers: {},
    socket: {
      remoteAddress: '127.0.0.1',
    },
  };
}

function makeEntry(overrides = {}) {
  return {
    timestamp: Date.now(),
    level: 'info',
    component: 'drydock',
    msg: 'test message',
    ...overrides,
  };
}

function authenticatingSessionMiddleware(req: any, _res: unknown, next: (error?: unknown) => void) {
  req.session = { passport: { user: '{"username":"alice"}' } };
  req.sessionID = 'session-1';
  next();
}

describe('api/log-stream', () => {
  describe('parseSystemLogStreamQuery', () => {
    test('uses expected defaults', () => {
      const query = parseSystemLogStreamQuery(new URLSearchParams());
      expect(query).toEqual({
        level: undefined,
        component: undefined,
        tail: 100,
      });
    });

    test('parses level and component filters', () => {
      const query = parseSystemLogStreamQuery(
        new URLSearchParams({ level: 'warn', component: 'api', tail: '50' }),
      );
      expect(query).toEqual({
        level: 'warn',
        component: 'api',
        tail: 50,
      });
    });

    test('treats level=all as undefined', () => {
      const query = parseSystemLogStreamQuery(new URLSearchParams({ level: 'all' }));
      expect(query.level).toBeUndefined();
    });

    test('treats empty component as undefined', () => {
      const query = parseSystemLogStreamQuery(new URLSearchParams({ component: '' }));
      expect(query.component).toBeUndefined();
    });

    test('falls back on invalid tail values', () => {
      const query = parseSystemLogStreamQuery(new URLSearchParams({ tail: '-5' }));
      expect(query.tail).toBe(100);

      const query2 = parseSystemLogStreamQuery(new URLSearchParams({ tail: 'abc' }));
      expect(query2.tail).toBe(100);
    });
  });

  describe('createSystemLogStreamGateway', () => {
    test('silently returns for non-log-stream upgrade routes', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: { handleUpgrade: vi.fn() },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    });

    test('silently returns when url is missing', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        { socket: { remoteAddress: '127.0.0.1' } } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalled();
    });

    test('silently returns when url is malformed', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        { url: 'http://[::1', socket: { remoteAddress: '127.0.0.1' } } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalled();
    });

    test('returns 403 when Origin header does not match Host', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: { handleUpgrade: vi.fn() },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        {
          url: '/api/v1/log/stream',
          headers: { origin: 'https://evil.com', host: 'localhost:3000' },
          socket: { remoteAddress: '127.0.0.1' },
        } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    test('allows upgrade when Origin matches Host', async () => {
      const mockHandleUpgrade = vi.fn(
        (_req: unknown, _socket: unknown, _head: unknown, callback: (ws: unknown) => void) => {
          const closeListeners: Array<() => void> = [];
          const ws = {
            on: vi.fn((event: string, listener: () => void) => {
              if (event === 'close') closeListeners.push(listener);
            }),
            off: vi.fn(),
            send: vi.fn(),
            close: vi.fn(),
          };
          callback(ws);
          for (const listener of closeListeners) listener();
        },
      );
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: { handleUpgrade: mockHandleUpgrade },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        {
          url: '/api/v1/log/stream',
          headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
          socket: { remoteAddress: '127.0.0.1' },
        } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalledWith(expect.stringContaining('403'));
      expect(mockHandleUpgrade).toHaveBeenCalledTimes(1);
    });

    test('returns 503 when session middleware is not configured', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: undefined,
        webSocketServer: { handleUpgrade: vi.fn() },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(
        expect.stringContaining('503 Session middleware unavailable'),
      );
    });

    test('returns 401 when session middleware fails', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(new Error('session failed')),
        webSocketServer: { handleUpgrade: vi.fn() },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
    });

    test('rejects upgrades when rate limited', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: { handleUpgrade: vi.fn() },
        isRateLimited: vi.fn(() => true),
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('429 Too Many Requests'));
    });

    test('rejects unauthenticated upgrades', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
        webSocketServer: { handleUpgrade: vi.fn() },
        isRateLimited: vi.fn(() => false),
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
    });

    test('does not write error when socket is already destroyed', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
      });
      const socket = createUpgradeSocket();
      socket.destroyed = true;

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/not-log-stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalled();
    });

    test('matches deprecated unversioned path /api/log/stream', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => []),
        subscribeToEntries: vi.fn(() => () => {}),
      });

      const upgradePromise = gateway.handleUpgrade(
        createUpgradeRequest('/api/log/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      await new Promise((resolve) => setImmediate(resolve));
      expect(ws.send).not.toHaveBeenCalled();
      ws.emit('close');
      await upgradePromise;
    });

    test('sends backfill entries on connect', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const backfillEntries = [makeEntry({ msg: 'backfill-1' }), makeEntry({ msg: 'backfill-2' })];

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => backfillEntries),
        subscribeToEntries: vi.fn(() => () => {}),
      });

      const upgradePromise = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream?tail=50') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      await new Promise((resolve) => setImmediate(resolve));
      expect(ws.send).toHaveBeenCalledTimes(2);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify(backfillEntries[0]));
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify(backfillEntries[1]));
      ws.emit('close');
      await upgradePromise;
    });

    test('does not reject upgrade when websocket backfill send overflows its buffer', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        bufferedAmount: number;
      };
      ws.bufferedAmount = 0;
      ws.close = vi.fn();
      ws.send = vi.fn(() => {
        ws.bufferedAmount += 512;
        if (ws.bufferedAmount > 700) {
          throw new Error('WebSocket buffer overflow');
        }
      });

      const subscribeToEntries = vi.fn(() => vi.fn());
      const backfillEntries = [makeEntry({ msg: 'backfill-1' }), makeEntry({ msg: 'backfill-2' })];

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => backfillEntries),
        subscribeToEntries,
      });

      await expect(
        gateway.handleUpgrade(
          createUpgradeRequest('/api/v1/log/stream?tail=50') as any,
          createUpgradeSocket() as any,
          Buffer.alloc(0),
        ),
      ).resolves.toBeUndefined();

      expect(ws.send).toHaveBeenCalledTimes(2);
      expect(subscribeToEntries).not.toHaveBeenCalled();
    });

    test('streams live entries that match filters', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      let capturedListener: ((entry: any) => void) | undefined;
      const subscribeToEntries = vi.fn((listener: (entry: any) => void) => {
        capturedListener = listener;
        return () => {
          capturedListener = undefined;
        };
      });

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => []),
        subscribeToEntries,
      });

      const upgradePromise = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream?level=warn') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      await new Promise((resolve) => setImmediate(resolve));
      expect(capturedListener).toBeDefined();

      const warnEntry = makeEntry({ level: 'warn', msg: 'should-pass' });
      const debugEntry = makeEntry({ level: 'debug', msg: 'should-filter' });

      capturedListener!(warnEntry);
      capturedListener!(debugEntry);

      // backfill sends 0, warn should be sent, debug should be filtered
      expect(ws.send).toHaveBeenCalledTimes(1);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify(warnEntry));
      ws.emit('close');
      await upgradePromise;
    });

    test('streams live entries that match component filter', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      let capturedListener: ((entry: any) => void) | undefined;
      const subscribeToEntries = vi.fn((listener: (entry: any) => void) => {
        capturedListener = listener;
        return () => {
          capturedListener = undefined;
        };
      });

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => []),
        subscribeToEntries,
      });

      const upgradePromise = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream?component=api') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      await new Promise((resolve) => setImmediate(resolve));
      capturedListener!(makeEntry({ component: 'api-server', msg: 'match' }));
      capturedListener!(makeEntry({ component: 'watcher', msg: 'no-match' }));

      expect(ws.send).toHaveBeenCalledTimes(1);
      ws.emit('close');
      await upgradePromise;
    });

    test('unsubscribes on websocket close', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const unsubscribeFn = vi.fn();
      const subscribeToEntries = vi.fn(() => unsubscribeFn);

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => []),
        subscribeToEntries,
      });

      const upgradePromise = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      await new Promise((resolve) => setImmediate(resolve));
      ws.emit('close');
      await upgradePromise;
      expect(unsubscribeFn).toHaveBeenCalledTimes(1);

      // Second close should not call unsubscribe again (idempotent cleanup)
      ws.emit('close');
      expect(unsubscribeFn).toHaveBeenCalledTimes(1);
    });

    test('unsubscribes on websocket error', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const unsubscribeFn = vi.fn();
      const subscribeToEntries = vi.fn(() => unsubscribeFn);

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => []),
        subscribeToEntries,
      });

      const upgradePromise = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      await new Promise((resolve) => setImmediate(resolve));
      ws.emit('error', new Error('ws boom'));
      await upgradePromise;
      expect(unsubscribeFn).toHaveBeenCalledTimes(1);
    });

    test('cleanup remains idempotent when close/error fire multiple times', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();
      // Keep listeners registered so repeated events re-enter cleanup.
      ws.off = vi.fn();

      const unsubscribeFn = vi.fn();
      const subscribeToEntries = vi.fn(() => unsubscribeFn);

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => []),
        subscribeToEntries,
      });

      const upgradePromise = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      await new Promise((resolve) => setImmediate(resolve));
      ws.emit('close');
      ws.emit('error', new Error('late error'));
      await upgradePromise;

      expect(unsubscribeFn).toHaveBeenCalledTimes(1);
    });

    test('unsubscribes when send throws on a closed socket', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      let capturedListener: ((entry: any) => void) | undefined;
      const unsubscribeFn = vi.fn();
      const subscribeToEntries = vi.fn((listener: (entry: any) => void) => {
        capturedListener = listener;
        return unsubscribeFn;
      });

      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: authenticatingSessionMiddleware,
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
        getBackfillEntries: vi.fn(() => []),
        subscribeToEntries,
      });

      const upgradePromise = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/log/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      await new Promise((resolve) => setImmediate(resolve));

      // Simulate socket closing then a late entry arriving
      ws.send = vi.fn(() => {
        throw new Error('WebSocket is not open');
      });

      capturedListener!(makeEntry({ level: 'info', msg: 'late message' }));
      await upgradePromise;

      expect(unsubscribeFn).toHaveBeenCalledTimes(1);
    });

    test('applies default fixed-window rate limiter', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: (_req: any, _res: unknown, next: (error?: unknown) => void) => next(),
      });

      const request = {
        url: '/api/v1/log/stream',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      for (let i = 0; i < 1000; i++) {
        const socket = createUpgradeSocket();
        await gateway.handleUpgrade(request, socket as any, Buffer.alloc(0));
        expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
      }

      const rateLimitedSocket = createUpgradeSocket();
      await gateway.handleUpgrade(request, rateLimitedSocket as any, Buffer.alloc(0));
      expect(rateLimitedSocket.write).toHaveBeenCalledWith(
        expect.stringContaining('429 Too Many Requests'),
      );
    });

    test('uses ip:unknown rate-limit key when remote address is unavailable', async () => {
      const gateway = createSystemLogStreamGateway({
        sessionMiddleware: (_req: any, _res: unknown, next: (error?: unknown) => void) => next(),
        isRateLimited: vi.fn(() => false),
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        { url: '/api/v1/log/stream', headers: {}, socket: {} } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
    });
  });

  describe('attachSystemLogStreamWebSocketServer', () => {
    test('registers an upgrade listener', () => {
      const server = { on: vi.fn() };

      const gateway = attachSystemLogStreamWebSocketServer({
        server: server as any,
        sessionMiddleware: authenticatingSessionMiddleware,
        serverConfiguration: { ratelimit: { identitykeying: false } },
      });

      expect(gateway).toBeDefined();
      expect(server.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
    });

    test('delegates upgrade events to the gateway', async () => {
      const listeners: Array<(request: unknown, socket: unknown, head: Buffer) => void> = [];
      const server = {
        on: vi.fn(
          (
            _event: 'upgrade',
            listener: (request: unknown, socket: unknown, head: Buffer) => void,
          ) => {
            listeners.push(listener);
          },
        ),
      };

      attachSystemLogStreamWebSocketServer({
        server: server as any,
        sessionMiddleware: authenticatingSessionMiddleware,
        serverConfiguration: { ratelimit: { identitykeying: false } },
      });

      const socket = createUpgradeSocket();
      listeners[0](createUpgradeRequest('/api/v1/log/not-stream') as any, socket, Buffer.alloc(0));
      await new Promise((resolve) => setImmediate(resolve));

      expect(socket.write).not.toHaveBeenCalled();
    });

    test('uses getServerConfiguration when serverConfiguration is omitted', () => {
      const serverConfigurationSpy = vi
        .spyOn(configuration, 'getServerConfiguration')
        .mockReturnValue({ ratelimit: { identitykeying: false } } as any);
      const server = { on: vi.fn() };

      try {
        attachSystemLogStreamWebSocketServer({
          server: server as any,
          sessionMiddleware: authenticatingSessionMiddleware,
        });

        expect(serverConfigurationSpy).toHaveBeenCalled();
        expect(server.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
      } finally {
        serverConfigurationSpy.mockRestore();
      }
    });

    test('uses identity-aware key resolver when enabled', async () => {
      const webSocketUpgradeSpy = vi
        .spyOn(WebSocketServer.prototype, 'handleUpgrade')
        .mockImplementation((_request, _socket, _head, callback) => {
          const ws = new EventEmitter() as EventEmitter & {
            send: ReturnType<typeof vi.fn>;
            close: ReturnType<typeof vi.fn>;
          };
          ws.send = vi.fn();
          ws.close = vi.fn();
          callback(ws as any);
        });
      const listeners: Array<(request: unknown, socket: unknown, head: Buffer) => void> = [];
      const server = {
        on: vi.fn(
          (
            _event: 'upgrade',
            listener: (request: unknown, socket: unknown, head: Buffer) => void,
          ) => {
            listeners.push(listener);
          },
        ),
      };

      try {
        attachSystemLogStreamWebSocketServer({
          server: server as any,
          sessionMiddleware: authenticatingSessionMiddleware,
          serverConfiguration: { ratelimit: { identitykeying: true } },
        });

        const socket = createUpgradeSocket();
        listeners[0](
          createUpgradeRequest('/api/v1/log/stream') as any,
          socket as any,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        webSocketUpgradeSpy.mockRestore();
      }
    });

    test('falls back to ip key when identity-aware key generator returns empty', async () => {
      const createKeySpy = vi
        .spyOn(rateLimitKey, 'createAuthenticatedRouteRateLimitKeyGenerator')
        .mockReturnValue(() => '' as any);
      const webSocketUpgradeSpy = vi
        .spyOn(WebSocketServer.prototype, 'handleUpgrade')
        .mockImplementation((_request, _socket, _head, callback) => {
          const ws = new EventEmitter() as EventEmitter & {
            send: ReturnType<typeof vi.fn>;
            close: ReturnType<typeof vi.fn>;
          };
          ws.send = vi.fn();
          ws.close = vi.fn();
          callback(ws as any);
        });
      const listeners: Array<(request: unknown, socket: unknown, head: Buffer) => void> = [];
      const server = {
        on: vi.fn(
          (
            _event: 'upgrade',
            listener: (request: unknown, socket: unknown, head: Buffer) => void,
          ) => {
            listeners.push(listener);
          },
        ),
      };

      try {
        attachSystemLogStreamWebSocketServer({
          server: server as any,
          sessionMiddleware: authenticatingSessionMiddleware,
          serverConfiguration: { ratelimit: { identitykeying: true } },
        });

        const socket = createUpgradeSocket();
        listeners[0](
          createUpgradeRequest('/api/v1/log/stream') as any,
          socket as any,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        createKeySpy.mockRestore();
        webSocketUpgradeSpy.mockRestore();
      }
    });
  });
});
