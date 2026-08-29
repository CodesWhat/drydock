import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import * as configuration from '../../configuration/index.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import { createIdentityAwareUpgradeRateLimitKeyResolver } from '../ws-upgrade-utils.js';
import {
  attachContainerLogStreamWebSocketServer,
  createContainerLogStreamGateway,
  createDockerLogFrameDemuxer,
  createDockerLogMessageDecoder,
  parseContainerLogStreamQuery,
} from './log-stream.js';

function dockerFrame(payload: string, streamType = 1): Buffer {
  const payloadBuffer = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(payloadBuffer.length, 4);
  return Buffer.concat([header, payloadBuffer]);
}

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

describe('api/container/log-stream', () => {
  describe('parseContainerLogStreamQuery', () => {
    test('uses expected defaults', () => {
      const query = parseContainerLogStreamQuery(new URLSearchParams());
      expect(query).toEqual({
        stdout: true,
        stderr: true,
        tail: 100,
        since: 0,
        follow: true,
      });
    });

    test('parses booleans, integers, and ISO timestamps', () => {
      const query = parseContainerLogStreamQuery(
        new URLSearchParams({
          stdout: 'false',
          stderr: 'true',
          tail: '50',
          since: '2026-01-01T00:00:00.000Z',
          follow: 'false',
        }),
      );
      expect(query).toEqual({
        stdout: false,
        stderr: true,
        tail: 50,
        since: 1767225600,
        follow: false,
      });
    });

    test('parses numeric since timestamps', () => {
      const query = parseContainerLogStreamQuery(
        new URLSearchParams({
          since: '1700000000',
        }),
      );
      expect(query).toEqual({
        stdout: true,
        stderr: true,
        tail: 100,
        since: 1700000000,
        follow: true,
      });
    });

    test('falls back when numeric since overflows finite bounds', () => {
      const query = parseContainerLogStreamQuery(
        new URLSearchParams({
          since: '9'.repeat(400),
        }),
      );
      expect(query.since).toBe(0);
    });

    test('falls back on invalid values', () => {
      const query = parseContainerLogStreamQuery(
        new URLSearchParams({
          stdout: 'maybe',
          stderr: 'nope',
          tail: '-10',
          since: 'invalid-date',
          follow: 'perhaps',
        }),
      );
      expect(query).toEqual({
        stdout: true,
        stderr: true,
        tail: 100,
        since: 0,
        follow: true,
      });
    });

    test('bounds the requested tail for initial stream history', () => {
      const query = parseContainerLogStreamQuery(new URLSearchParams({ tail: '999999999' }));
      expect(query.tail).toBe(10_000);
    });
  });

  describe('docker stream decoding', () => {
    test('demultiplexes multiplexed stdout/stderr frames across chunk boundaries', () => {
      const demuxer = createDockerLogFrameDemuxer();
      const mixed = Buffer.concat([
        dockerFrame('2026-01-01T00:00:00.000000000Z first line\n', 1),
        dockerFrame('2026-01-01T00:00:01.000000000Z error line\n', 2),
      ]);

      const chunkA = mixed.subarray(0, 10);
      const chunkB = mixed.subarray(10);

      expect(demuxer.push(chunkA)).toEqual([]);
      expect(demuxer.push(chunkB)).toEqual([
        {
          type: 'stdout',
          payload: '2026-01-01T00:00:00.000000000Z first line\n',
        },
        {
          type: 'stderr',
          payload: '2026-01-01T00:00:01.000000000Z error line\n',
        },
      ]);
    });

    test('ignores unknown stream types', () => {
      const demuxer = createDockerLogFrameDemuxer();
      const unknownFrame = dockerFrame('ignored payload\n', 3);
      expect(demuxer.push(unknownFrame)).toEqual([]);
    });

    test('converts payloads to typed ts/line messages and flushes trailing partial lines', () => {
      const decoder = createDockerLogMessageDecoder();

      expect(
        decoder.push({
          type: 'stdout',
          payload: '2026-01-01T00:00:00.000000000Z hello\n2026-01-01T00:00:01.000000000Z wo',
        }),
      ).toEqual([
        {
          type: 'stdout',
          ts: '2026-01-01T00:00:00.000000000Z',
          line: 'hello',
        },
      ]);

      expect(
        decoder.push({
          type: 'stdout',
          payload: 'rld\n',
        }),
      ).toEqual([
        {
          type: 'stdout',
          ts: '2026-01-01T00:00:01.000000000Z',
          line: 'world',
        },
      ]);

      expect(decoder.flush()).toEqual([]);
    });

    test('flushes remaining stderr line and normalizes CRLF line endings', () => {
      const decoder = createDockerLogMessageDecoder();
      expect(
        decoder.push({
          type: 'stderr',
          payload: '2026-01-01T00:00:00.000000000Z error happened\r\nincomplete',
        }),
      ).toEqual([
        {
          type: 'stderr',
          ts: '2026-01-01T00:00:00.000000000Z',
          line: 'error happened',
        },
      ]);
      expect(decoder.flush()).toEqual([
        {
          type: 'stderr',
          ts: '',
          line: 'incomplete',
        },
      ]);
    });

    test('flush trims trailing carriage returns from partial lines', () => {
      const decoder = createDockerLogMessageDecoder();
      decoder.push({
        type: 'stdout',
        payload: 'partial line with carriage\r',
      });
      expect(decoder.flush()).toEqual([
        {
          type: 'stdout',
          ts: 'partial',
          line: 'line with carriage',
        },
      ]);
    });

    test('defaults trailing partial to empty when split pop returns undefined', () => {
      const decoder = createDockerLogMessageDecoder();
      const popSpy = vi.spyOn(Array.prototype, 'pop').mockReturnValueOnce(undefined as never);
      try {
        expect(
          decoder.push({
            type: 'stdout',
            payload: '',
          }),
        ).toEqual([
          {
            type: 'stdout',
            ts: '',
            line: '',
          },
        ]);
      } finally {
        popSpy.mockRestore();
      }
    });
  });

  describe('createContainerLogStreamGateway', () => {
    test('returns 404 for non-log-stream upgrade routes', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
        webSocketServer: {
          handleUpgrade: vi.fn(),
        },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/not-logs') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    });

    test('silently returns when upgrade url is missing or malformed', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
      });

      const socketWithoutUrl = createUpgradeSocket();
      await gateway.handleUpgrade(
        { socket: { remoteAddress: '127.0.0.1' } } as any,
        socketWithoutUrl as any,
        Buffer.alloc(0),
      );
      expect(socketWithoutUrl.write).not.toHaveBeenCalled();

      const socketWithDecodeError = createUpgradeSocket();
      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/%E0%A4%A/logs/stream') as any,
        socketWithDecodeError as any,
        Buffer.alloc(0),
      );
      expect(socketWithDecodeError.write).not.toHaveBeenCalled();

      const socketWithInvalidUrl = createUpgradeSocket();
      await gateway.handleUpgrade(
        { url: 'http://[::1', socket: { remoteAddress: '127.0.0.1' } } as any,
        socketWithInvalidUrl as any,
        Buffer.alloc(0),
      );
      expect(socketWithInvalidUrl.write).not.toHaveBeenCalled();
    });

    test('returns 403 when Origin header does not match Host', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
        webSocketServer: { handleUpgrade: vi.fn() },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        {
          url: '/api/v1/containers/c1/logs/stream',
          headers: { origin: 'https://evil.com', host: 'localhost:3000' },
          socket: { remoteAddress: '127.0.0.1' },
        } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    test('rejects when trust proxy is off and X-Forwarded-Host is forged to match origin', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
        webSocketServer: { handleUpgrade: vi.fn() },
        serverConfiguration: { trustproxy: false },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        {
          url: '/api/v1/containers/c1/logs/stream',
          headers: {
            origin: 'https://attacker.com',
            host: 'localhost:3000',
            'x-forwarded-host': 'attacker.com',
          },
          socket: { remoteAddress: '127.0.0.1' },
        } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('403 Forbidden'));
    });

    test('allows when trust proxy is on and X-Forwarded-Host matches https Origin', async () => {
      const authenticatingMiddleware = (
        req: any,
        _res: unknown,
        next: (error?: unknown) => void,
      ) => {
        req.session = { passport: { user: '{"username":"alice"}' } };
        req.sessionID = 'session-1';
        next();
      };
      const mockHandleUpgrade = vi.fn(
        (_req: unknown, _socket: unknown, _head: unknown, callback: (ws: unknown) => void) => {
          const ws = {
            on: vi.fn(),
            off: vi.fn(),
            send: vi.fn(),
            close: vi.fn(),
          };
          callback(ws);
        },
      );
      const container = {
        id: 'c1',
        name: 'c1',
        status: 'stopped',
        watcher: 'local',
      };
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => container as any),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: authenticatingMiddleware,
        webSocketServer: { handleUpgrade: mockHandleUpgrade },
        serverConfiguration: { trustproxy: 1 },
        isRateLimited: vi.fn(() => false),
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        {
          url: '/api/v1/containers/c1/logs/stream',
          headers: {
            origin: 'https://drydock.example.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com',
            'x-forwarded-proto': 'https',
          },
          socket: { remoteAddress: '127.0.0.1' },
        } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalledWith(expect.stringContaining('403'));
      expect(mockHandleUpgrade).toHaveBeenCalledTimes(1);
    });

    test('takes first entry from comma-separated X-Forwarded-Host list', async () => {
      const authenticatingMiddleware = (
        req: any,
        _res: unknown,
        next: (error?: unknown) => void,
      ) => {
        req.session = { passport: { user: '{"username":"alice"}' } };
        req.sessionID = 'session-1';
        next();
      };
      const mockHandleUpgrade = vi.fn(
        (_req: unknown, _socket: unknown, _head: unknown, callback: (ws: unknown) => void) => {
          const ws = {
            on: vi.fn(),
            off: vi.fn(),
            send: vi.fn(),
            close: vi.fn(),
          };
          callback(ws);
        },
      );
      const container = {
        id: 'c1',
        name: 'c1',
        status: 'stopped',
        watcher: 'local',
      };
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => container as any),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: authenticatingMiddleware,
        webSocketServer: { handleUpgrade: mockHandleUpgrade },
        serverConfiguration: { trustproxy: 1 },
        isRateLimited: vi.fn(() => false),
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        {
          url: '/api/v1/containers/c1/logs/stream',
          headers: {
            origin: 'https://drydock.example.com',
            host: '10.0.0.1:3000',
            'x-forwarded-host': 'drydock.example.com, other.example.com',
            'x-forwarded-proto': 'https, http',
          },
          socket: { remoteAddress: '127.0.0.1' },
        } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalledWith(expect.stringContaining('403'));
      expect(mockHandleUpgrade).toHaveBeenCalledTimes(1);
    });

    test('falls back to raw Host when trust proxy is on but X-Forwarded-Host is absent', async () => {
      const authenticatingMiddleware = (
        req: any,
        _res: unknown,
        next: (error?: unknown) => void,
      ) => {
        req.session = { passport: { user: '{"username":"alice"}' } };
        req.sessionID = 'session-1';
        next();
      };
      const mockHandleUpgrade = vi.fn(
        (_req: unknown, _socket: unknown, _head: unknown, callback: (ws: unknown) => void) => {
          const ws = {
            on: vi.fn(),
            off: vi.fn(),
            send: vi.fn(),
            close: vi.fn(),
          };
          callback(ws);
        },
      );
      const container = {
        id: 'c1',
        name: 'c1',
        status: 'stopped',
        watcher: 'local',
      };
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => container as any),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: authenticatingMiddleware,
        webSocketServer: { handleUpgrade: mockHandleUpgrade },
        serverConfiguration: { trustproxy: 1 },
        isRateLimited: vi.fn(() => false),
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        {
          url: '/api/v1/containers/c1/logs/stream',
          headers: {
            origin: 'http://localhost:3000',
            host: 'localhost:3000',
            'x-forwarded-proto': 'http',
          },
          socket: { remoteAddress: '127.0.0.1' },
        } as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalledWith(expect.stringContaining('403'));
      expect(mockHandleUpgrade).toHaveBeenCalledTimes(1);
    });

    test('returns 503 when session middleware is not configured', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: undefined,
        webSocketServer: {
          handleUpgrade: vi.fn(),
        },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(
        expect.stringContaining('503 Session middleware unavailable'),
      );
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    test('returns 401 when session middleware fails', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(new Error('session failed')),
        webSocketServer: {
          handleUpgrade: vi.fn(),
        },
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    test('rejects upgrades when rate limited', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn(),
        },
        isRateLimited: vi.fn(() => true),
      });
      const socket = createUpgradeSocket();

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('429 Too Many Requests'));
      expect(socket.destroy).toHaveBeenCalledTimes(1);
    });

    test('uses ip:unknown rate-limit key when remote address is unavailable', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: any, _res: unknown, next: (error?: unknown) => void) => next(),
        webSocketServer: {
          handleUpgrade: vi.fn(),
        },
        isRateLimited: vi.fn(() => false),
      });
      const socket = createUpgradeSocket();
      await gateway.handleUpgrade(
        { url: '/api/v1/containers/c1/logs/stream', headers: {}, socket: {} } as any,
        socket as any,
        Buffer.alloc(0),
      );
      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
    });

    test('uses ip:unknown rate-limit key when remote address is blank', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: any, _res: unknown, next: (error?: unknown) => void) => next(),
        webSocketServer: {
          handleUpgrade: vi.fn(),
        },
        isRateLimited: vi.fn(() => false),
      });
      const socket = createUpgradeSocket();
      await gateway.handleUpgrade(
        {
          url: '/api/v1/containers/c1/logs/stream',
          headers: {},
          socket: { remoteAddress: '   ' },
        } as any,
        socket as any,
        Buffer.alloc(0),
      );
      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
    });

    test('rejects unauthenticated upgrades', async () => {
      const mockWebSocketServer = {
        handleUpgrade: vi.fn(),
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
        webSocketServer: mockWebSocketServer,
        isRateLimited: vi.fn(() => false),
      });

      const socket = createUpgradeSocket();
      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
      expect(socket.destroy).toHaveBeenCalledTimes(1);
      expect(mockWebSocketServer.handleUpgrade).not.toHaveBeenCalled();
    });

    test('accepts passport-less upgrades when anonymous authentication is active', async () => {
      const isAnonymousAuthenticationActiveSpy = vi
        .spyOn(registry, 'isAnonymousAuthenticationActive')
        .mockReturnValue(true);
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn(() => {
        ws.emit('close');
      });

      const mockWebSocketServer = {
        handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
          callback(ws),
        ),
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => undefined),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
        webSocketServer: mockWebSocketServer,
        isRateLimited: vi.fn(() => false),
      });

      const socket = createUpgradeSocket();
      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
      expect(mockWebSocketServer.handleUpgrade).toHaveBeenCalled();
      expect(ws.close).toHaveBeenCalledWith(4004, 'Container not found');

      isAnonymousAuthenticationActiveSpy.mockRestore();
    });

    test('rejects unauthenticated upgrades when anonymous authentication is not active', async () => {
      const isAnonymousAuthenticationActiveSpy = vi
        .spyOn(registry, 'isAnonymousAuthenticationActive')
        .mockReturnValue(false);
      const mockWebSocketServer = {
        handleUpgrade: vi.fn(),
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
        webSocketServer: mockWebSocketServer,
        isRateLimited: vi.fn(() => false),
      });

      const socket = createUpgradeSocket();
      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
      expect(mockWebSocketServer.handleUpgrade).not.toHaveBeenCalled();

      isAnonymousAuthenticationActiveSpy.mockRestore();
    });

    test('keys rate limiting by IP for anonymous-authenticated upgrades, not by session', async () => {
      const isAnonymousAuthenticationActiveSpy = vi
        .spyOn(registry, 'isAnonymousAuthenticationActive')
        .mockReturnValue(true);
      const capturedRateLimitKeys: string[] = [];
      const mockWebSocketServer = {
        handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
          callback({ on: vi.fn(), off: vi.fn(), send: vi.fn(), close: vi.fn() }),
        ),
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => undefined),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
        webSocketServer: mockWebSocketServer,
        isRateLimited: (key: string) => {
          capturedRateLimitKeys.push(key);
          return false;
        },
        getRateLimitKey: createIdentityAwareUpgradeRateLimitKeyResolver({
          ratelimit: { identitykeying: true },
        }),
      });

      const socket = createUpgradeSocket();
      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
      expect(capturedRateLimitKeys).toEqual(['ip:127.0.0.1']);

      isAnonymousAuthenticationActiveSpy.mockRestore();
    });

    test('keeps session-keyed rate limiting for passport-authenticated upgrades', async () => {
      const authenticatingMiddleware = (
        req: any,
        _res: unknown,
        next: (error?: unknown) => void,
      ) => {
        req.session = { passport: { user: '{"username":"alice"}' } };
        req.sessionID = 'session-1';
        next();
      };
      const capturedRateLimitKeys: string[] = [];
      const mockWebSocketServer = {
        handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
          callback({ on: vi.fn(), off: vi.fn(), send: vi.fn(), close: vi.fn() }),
        ),
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => undefined),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: authenticatingMiddleware,
        webSocketServer: mockWebSocketServer,
        isRateLimited: (key: string) => {
          capturedRateLimitKeys.push(key);
          return false;
        },
        getRateLimitKey: createIdentityAwareUpgradeRateLimitKeyResolver({
          ratelimit: { identitykeying: true },
        }),
      });

      const socket = createUpgradeSocket();
      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
      expect(capturedRateLimitKeys).toEqual(['session:session-1']);
    });

    test('closes websocket with 4004 when container is missing', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn(() => {
        ws.emit('close');
      });

      const mockWebSocketServer = {
        handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
          callback(ws),
        ),
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => undefined),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: mockWebSocketServer,
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/missing/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      expect(ws.close).toHaveBeenCalledWith(4004, 'Container not found');
    });

    test('closes websocket with 4001 when container is not running', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn(() => {
        ws.emit('close');
      });

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'exited',
        })),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      expect(ws.close).toHaveBeenCalledWith(4001, 'Container not running');
    });

    test('closes websocket when watcher is unavailable', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      expect(ws.close).toHaveBeenCalledWith(1011, 'Watcher not available');
    });

    test('closes websocket when docker logs cannot be opened', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockRejectedValue(new Error('docker down')),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      expect(ws.close).toHaveBeenCalledWith(1011, expect.stringContaining('Unable to open logs'));
    });

    test('does not crash the process when docker logs cannot be opened and the error is long', async () => {
      // Reproduces the real `ws` WebSocket#close() throw semantics: `sender.close()`
      // throws a synchronous RangeError when the close reason exceeds 123 UTF-8
      // bytes (see node_modules/ws/lib/sender.js). A `vi.fn()` double that silently
      // accepts any reason would never exercise this and would hide the crash.
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn((_code: number, reason: string) => {
        if (Buffer.byteLength(reason, 'utf8') > 123) {
          throw new RangeError('The message must not be greater than 123 bytes');
        }
      });

      const mockDockerContainer = {
        logs: vi.fn().mockRejectedValue(new Error(`docker down: ${'x'.repeat(200)}`)),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      const unhandledRejections: unknown[] = [];
      const onUnhandledRejection = (reason: unknown) => {
        unhandledRejections.push(reason);
      };
      process.on('unhandledRejection', onUnhandledRejection);

      try {
        await gateway.handleUpgrade(
          createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
          createUpgradeSocket() as any,
          Buffer.alloc(0),
        );

        // Node only fires 'unhandledRejection' after the current microtask
        // queue drains; yield to a macrotask so a genuinely unhandled
        // rejection has a chance to surface before we assert on it.
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off('unhandledRejection', onUnhandledRejection);
      }

      expect(ws.close).toHaveBeenCalledTimes(1);
      const reason = String(ws.close.mock.calls[0]?.[1]);
      expect(Buffer.byteLength(reason, 'utf8')).toBeLessThanOrEqual(123);
      expect(reason).toContain('Unable to open logs');
      expect(unhandledRejections).toEqual([]);
    });

    test('streams one-shot non-readable log payloads and closes cleanly', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerFrame('2026-01-01T00:00:00.000000000Z hello\n', 1)),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream?follow=false') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        type: 'stdout',
        ts: '2026-01-01T00:00:00.000000000Z',
        displayTs: expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u),
        line: 'hello',
      });
      expect(ws.close).toHaveBeenCalledWith(1000, 'Stream complete');
    });

    test('does not throw when send fails on one-shot non-readable payload', async () => {
      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn(() => {
        throw new Error('WebSocket is not open');
      });
      ws.close = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerFrame('2026-01-01T00:00:00.000000000Z hello\n', 1)),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream?follow=false') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      // send threw but no unhandled exception; close is NOT called because send failed
      expect(ws.close).not.toHaveBeenCalled();
    });

    test('cleans up docker stream when send throws during streaming', async () => {
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerStream),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      // Make send throw to simulate a closed socket
      ws.send = vi.fn(() => {
        throw new Error('WebSocket is not open');
      });

      dockerStream.emit('data', dockerFrame('2026-01-01T00:00:00.000000000Z hello\n', 1));

      // cleanup should have been called — docker stream destroyed
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('stops emitting queued log lines after websocket buffer overflow', async () => {
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerStream),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        bufferedAmount: number;
      };
      ws.bufferedAmount = 0;
      ws.send = vi.fn(() => {
        ws.bufferedAmount += 512;
        if (ws.bufferedAmount > 700) {
          throw new Error('WebSocket buffer overflow');
        }
      });
      ws.close = vi.fn();

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      dockerStream.emit(
        'data',
        dockerFrame(
          `${[
            '2026-01-01T00:00:00.000000000Z first',
            '2026-01-01T00:00:01.000000000Z second',
            '2026-01-01T00:00:02.000000000Z third',
          ].join('\n')}\n`,
          1,
        ),
      );
      dockerStream.emit('data', dockerFrame('2026-01-01T00:00:03.000000000Z after-cleanup\n', 1));

      expect(ws.send).toHaveBeenCalledTimes(2);
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('evicts a slow local viewer before sending more Docker log data', async () => {
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();
      const ws = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 2 * 1024 * 1024,
      });
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': {
            dockerApi: {
              getContainer: vi.fn(() => ({ logs: vi.fn().mockResolvedValue(dockerStream) })),
            },
          },
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      dockerStream.emit('data', dockerFrame('2026-01-01T00:00:00.000000000Z too slow\n'));

      expect(ws.close).toHaveBeenCalledWith(1013, 'Log viewer is too slow');
      expect(ws.send).not.toHaveBeenCalled();
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('evicts a local viewer before sending a single oversized serialized message', async () => {
      const dockerStream = Object.assign(new EventEmitter(), { destroy: vi.fn() });
      const ws = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': {
            dockerApi: {
              getContainer: vi.fn(() => ({ logs: vi.fn().mockResolvedValue(dockerStream) })),
            },
          },
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      dockerStream.emit(
        'data',
        dockerFrame(`2026-01-01T00:00:00.000000000Z ${'x'.repeat(1024 * 1024)}\n`),
      );

      expect(ws.close).toHaveBeenCalledWith(1013, 'Log viewer is too slow');
      expect(ws.send).not.toHaveBeenCalled();
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('does not throw when close fails during stream end', async () => {
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerStream),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn(() => {
        throw new Error('WebSocket is not open');
      });

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      // stream ends, close throws — should not cause unhandled exception
      dockerStream.emit('end');

      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('closes websocket with stream error and destroys docker stream', async () => {
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerStream),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      dockerStream.emit('error', new Error('stream boom'));

      expect(ws.close).toHaveBeenCalledWith(1011, expect.stringContaining('Log stream error'));
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('keeps a live docker stream error within the WebSocket close-reason limit', async () => {
      // Same bug class as the "cannot be opened" path above: this call site was
      // already wrapped in try/catch, so it could not crash the process, but it
      // interpolated an unbounded error message with no truncation. A close
      // reason over 123 UTF-8 bytes made the real `ws` close() throw, which the
      // try/catch swallowed — silently dropping the close frame instead of
      // sending a truncated, still-useful one.
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerStream),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn((_code: number, reason: string) => {
        if (Buffer.byteLength(reason, 'utf8') > 123) {
          throw new RangeError('The message must not be greater than 123 bytes');
        }
      });

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      expect(() => dockerStream.emit('error', new Error('x'.repeat(500)))).not.toThrow();

      expect(ws.close).toHaveBeenCalledTimes(1);
      const reason = String(ws.close.mock.calls[0]?.[1]);
      expect(Buffer.byteLength(reason, 'utf8')).toBeLessThanOrEqual(123);
      expect(reason).toContain('Log stream error');
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('cleans up docker stream when websocket emits error', async () => {
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerStream),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      ws.emit('error', new Error('ws boom'));
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('closes websocket when stream ends naturally', async () => {
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerStream),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn(() => {
        ws.emit('close');
      });

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
            callback(ws),
          ),
        },
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      dockerStream.emit(
        'data',
        dockerFrame('2026-01-01T00:00:00.000000000Z hello from stream\n', 1),
      );
      dockerStream.emit('end');

      expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({
        type: 'stdout',
        ts: '2026-01-01T00:00:00.000000000Z',
        displayTs: expect.stringMatching(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]$/u),
        line: 'hello from stream',
      });
      expect(ws.close).toHaveBeenCalledWith(1000, 'Stream ended');
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('destroys docker log stream when websocket disconnects', async () => {
      const dockerStream = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      dockerStream.destroy = vi.fn();

      const mockDockerContainer = {
        logs: vi.fn().mockResolvedValue(dockerStream),
      };
      const mockWatcher = {
        dockerApi: {
          getContainer: vi.fn(() => mockDockerContainer),
        },
      };

      const ws = new EventEmitter() as EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      ws.send = vi.fn();
      ws.close = vi.fn();

      const mockWebSocketServer = {
        handleUpgrade: vi.fn((_req, _socket, _head, callback: (socket: unknown) => void) =>
          callback(ws),
        ),
      };

      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(() => ({
          id: 'c1',
          name: 'my-container',
          watcher: 'local',
          status: 'running',
        })),
        getWatchers: vi.fn(() => ({
          'docker.local': mockWatcher,
        })),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-1';
          next();
        },
        webSocketServer: mockWebSocketServer,
        isRateLimited: vi.fn(() => false),
      });

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/logs/stream?tail=42&follow=true') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      expect(mockDockerContainer.logs).toHaveBeenCalledWith({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 42,
        since: 0,
        timestamps: true,
      });

      ws.emit('close');
      expect(dockerStream.destroy).toHaveBeenCalledTimes(1);
    });

    test('does not write an error response when socket is already destroyed', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
          next(),
      });
      const socket = createUpgradeSocket();
      socket.destroyed = true;

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/c1/not-logs') as any,
        socket as any,
        Buffer.alloc(0),
      );

      expect(socket.write).not.toHaveBeenCalled();
      expect(socket.destroy).not.toHaveBeenCalled();
    });

    test('applies default fixed-window rate limiter', async () => {
      const gateway = createContainerLogStreamGateway({
        getContainer: vi.fn(),
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (_req: any, _res: unknown, next: (error?: unknown) => void) => next(),
      });

      const request = {
        url: '/api/v1/containers/c1/logs/stream',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      for (let index = 0; index < 1000; index += 1) {
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
  });

  describe('edge-agent container log streams', () => {
    function createAuthenticatedEdgeGateway(
      streamContainerLogs: ReturnType<typeof vi.fn>,
      viewer: EventEmitter & {
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        bufferedAmount: number;
      },
      agentResolver:
        | (() => { edgeAdapter?: { streamContainerLogs: ReturnType<typeof vi.fn> } } | undefined)
        | null = () => ({
        edgeAdapter: { streamContainerLogs },
      }),
    ) {
      const dependencies = {
        getContainer: vi.fn(() => ({
          id: 'edge-container',
          name: 'edge-container',
          status: 'running',
          watcher: 'docker',
          agent: 'edge-agent',
        })) as any,
        getWatchers: vi.fn(() => ({})),
        sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
          req.session = { passport: { user: '{"username":"alice"}' } };
          req.sessionID = 'session-edge';
          next();
        },
        webSocketServer: {
          handleUpgrade: vi.fn(
            (
              _request: unknown,
              _socket: unknown,
              _head: unknown,
              callback: (webSocket: unknown) => void,
            ) => callback(viewer),
          ),
        },
        isRateLimited: vi.fn(() => false),
      } as any;
      if (agentResolver !== null) {
        dependencies.getAgent = vi.fn(agentResolver);
      }
      return createContainerLogStreamGateway(dependencies);
    }

    test('forwards correlated dd chunks from an edge agent to the authenticated viewer', async () => {
      let handlers:
        | {
            onChunk: (chunk: { stream: 'stdout' | 'stderr'; logs: string }) => void;
            onEnd: (reason?: string) => void;
            onError: (error: Error) => void;
          }
        | undefined;
      const cancel = vi.fn();
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: undefined as unknown as number,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest(
          '/api/v1/containers/edge-container/logs/stream?tail=25&since=42&follow=true',
        ) as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      expect(streamContainerLogs).toHaveBeenCalledWith(
        'edge-container',
        { tail: 25, since: 42, follow: true, timestamps: true },
        expect.any(Object),
      );
      handlers?.onChunk({
        stream: 'stderr',
        logs: '2026-07-28T18:00:00.000000000Z warning\n',
      });
      handlers?.onEnd('eof');
      await handling;

      const message = JSON.parse(String(viewer.send.mock.calls[0]?.[0])) as {
        type: string;
        ts: string;
        line: string;
      };
      expect(message).toMatchObject({
        type: 'stderr',
        ts: '2026-07-28T18:00:00.000000000Z',
        line: 'warning',
      });
      expect(viewer.close).toHaveBeenCalledWith(1000, 'Stream ended');
      expect(cancel).not.toHaveBeenCalled();
    });

    test('cancels the agent stream when the downstream viewer disconnects', async () => {
      const cancel = vi.fn();
      const streamContainerLogs = vi.fn(() => ({ cancel }));
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      viewer.emit('close');
      await handling;

      expect(cancel).toHaveBeenCalledTimes(1);
    });

    test('evicts a slow viewer before its websocket buffer can grow without bound', async () => {
      let handlers:
        | {
            onChunk: (chunk: { stream: 'stdout' | 'stderr'; logs: string }) => void;
          }
        | undefined;
      const cancel = vi.fn();
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 2 * 1024 * 1024,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      handlers?.onChunk({ stream: 'stdout', logs: 'too slow\n' });
      await handling;

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(viewer.close).toHaveBeenCalledWith(1013, 'Log viewer is too slow');
      expect(viewer.send).not.toHaveBeenCalled();
    });

    test('evicts an edge viewer before sending a single oversized serialized message', async () => {
      let handlers:
        | {
            onChunk: (chunk: { stream: 'stdout' | 'stderr'; logs: string }) => void;
          }
        | undefined;
      const cancel = vi.fn();
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      handlers?.onChunk({ stream: 'stdout', logs: `${'x'.repeat(1024 * 1024)}\n` });
      await handling;

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(viewer.close).toHaveBeenCalledWith(1013, 'Log viewer is too slow');
      expect(viewer.send).not.toHaveBeenCalled();
    });

    test('keeps an edge stream error within the WebSocket close-reason limit', async () => {
      let handlers:
        | {
            onError: (error: Error) => void;
          }
        | undefined;
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel: vi.fn() };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn((_code: number, reason: string) => {
          if (Buffer.byteLength(reason, 'utf8') > 123) {
            throw new RangeError('WebSocket close reason exceeds 123 bytes');
          }
        }),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      expect(() => handlers?.onError(new Error('x'.repeat(500)))).not.toThrow();
      await handling;

      const reason = String(viewer.close.mock.calls[0]?.[1]);
      expect(Buffer.byteLength(reason, 'utf8')).toBeLessThanOrEqual(123);
      expect(reason).toContain('Log stream error');
    });

    test.each([
      {
        resolver: () => undefined,
        label: 'configured resolver',
      },
      {
        resolver: null,
        label: 'default resolver',
      },
    ])('closes when the edge agent is unavailable through the $label', async ({ resolver }) => {
      const streamContainerLogs = vi.fn();
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer, resolver);

      await gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );

      expect(viewer.close).toHaveBeenCalledWith(1011, 'Edge agent not available');
      expect(streamContainerLogs).not.toHaveBeenCalled();
    });

    test('cancels when sending a decoded chunk to the viewer throws', async () => {
      let handlers:
        | {
            onChunk: (chunk: { stream: 'stdout' | 'stderr'; logs: string }) => void;
            onEnd: () => void;
            onError: (error: Error) => void;
          }
        | undefined;
      const cancel = vi.fn();
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(() => {
          throw new Error('viewer closed during send');
        }),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      handlers?.onChunk({
        stream: 'stdout',
        logs: '2026-07-28T18:00:00.000000000Z line\n',
      });
      handlers?.onChunk({ stream: 'stdout', logs: 'ignored after cleanup\n' });
      handlers?.onEnd();
      handlers?.onError(new Error('ignored after cleanup'));
      viewer.emit('close');
      await handling;

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(viewer.close).not.toHaveBeenCalled();
    });

    test('cleans up once when sending a flushed partial line throws', async () => {
      let handlers:
        | {
            onChunk: (chunk: { stream: 'stdout' | 'stderr'; logs: string }) => void;
            onEnd: () => void;
          }
        | undefined;
      const cancel = vi.fn();
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(() => {
          throw new Error('viewer closed during flush');
        }),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      handlers?.onChunk({ stream: 'stdout', logs: 'partial without newline' });
      handlers?.onEnd();
      await handling;

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(viewer.close).not.toHaveBeenCalled();
    });

    test('cancels on a downstream viewer error and ignores later agent callbacks', async () => {
      let handlers:
        | {
            onChunk: (chunk: { stream: 'stdout' | 'stderr'; logs: string }) => void;
            onEnd: () => void;
            onError: (error: Error) => void;
          }
        | undefined;
      const cancel = vi.fn();
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      viewer.emit('error', new Error('viewer failed'));
      handlers?.onChunk({ stream: 'stdout', logs: 'ignored\n' });
      handlers?.onEnd();
      handlers?.onError(new Error('ignored'));
      viewer.emit('close');
      await handling;

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(viewer.send).not.toHaveBeenCalled();
      expect(viewer.close).not.toHaveBeenCalled();
    });

    test('filters disabled stdout and stderr streams before sending', async () => {
      let handlers:
        | {
            onChunk: (chunk: { stream: 'stdout' | 'stderr'; logs: string }) => void;
            onEnd: () => void;
          }
        | undefined;
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel: vi.fn() };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest(
          '/api/v1/containers/edge-container/logs/stream?stdout=false&stderr=false',
        ) as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      handlers?.onChunk({ stream: 'stdout', logs: 'stdout ignored\n' });
      handlers?.onChunk({ stream: 'stderr', logs: 'stderr ignored\n' });
      handlers?.onEnd();
      await handling;

      expect(viewer.send).not.toHaveBeenCalled();
      expect(viewer.close).toHaveBeenCalledWith(1000, 'Stream ended');
    });

    test('uses an untruncated close reason for a short stream error', async () => {
      let handlers: { onError: (error: Error) => void } | undefined;
      const streamContainerLogs = vi.fn(
        (
          _containerId: string,
          _options: Record<string, unknown>,
          nextHandlers: NonNullable<typeof handlers>,
        ) => {
          handlers = nextHandlers;
          return { cancel: vi.fn() };
        },
      );
      const viewer = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        close: vi.fn(),
        bufferedAmount: 0,
      });
      const gateway = createAuthenticatedEdgeGateway(streamContainerLogs, viewer);
      const handling = gateway.handleUpgrade(
        createUpgradeRequest('/api/v1/containers/edge-container/logs/stream') as any,
        createUpgradeSocket() as any,
        Buffer.alloc(0),
      );
      await vi.waitFor(() => expect(streamContainerLogs).toHaveBeenCalledTimes(1));

      handlers?.onError(new Error('short'));
      await handling;

      expect(viewer.close).toHaveBeenCalledWith(1011, 'Log stream error (short)');
    });
  });

  describe('attachContainerLogStreamWebSocketServer', () => {
    test('uses default ip-based key resolver when identity-aware keying is disabled', async () => {
      const webSocketUpgradeSpy = vi
        .spyOn(WebSocketServer.prototype, 'handleUpgrade')
        .mockImplementation((_request, _socket, _head, callback) => {
          const ws = new EventEmitter() as EventEmitter & {
            send: ReturnType<typeof vi.fn>;
            close: ReturnType<typeof vi.fn>;
          };
          ws.send = vi.fn();
          ws.close = vi.fn(() => {
            ws.emit('close');
          });
          callback(ws as any);
        });
      const getStateSpy = vi.spyOn(registry, 'getState').mockReturnValue({
        watcher: {
          'docker.local': {
            dockerApi: {
              getContainer: vi.fn(() => ({
                logs: vi
                  .fn()
                  .mockResolvedValue(dockerFrame('2026-01-01T00:00:00.000000000Z hello\n', 1)),
              })),
            },
          },
        },
      } as any);
      const getContainerSpy = vi.spyOn(storeContainer, 'getContainer').mockReturnValue({
        id: 'c1',
        name: 'default-key-container',
        watcher: 'local',
        status: 'running',
      } as any);
      const listeners: Array<(request: unknown, socket: unknown, head: Buffer) => void> = [];
      const isRateLimited = vi.fn(() => false);
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
        attachContainerLogStreamWebSocketServer({
          server: server as any,
          sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
            req.session = { passport: { user: '{"username":"alice"}' } };
            req.sessionID = 'session-1';
            next();
          },
          serverConfiguration: {
            ratelimit: { identitykeying: false },
          },
          isRateLimited,
        });

        const socket = createUpgradeSocket();
        listeners[0](
          createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
          socket as any,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
        expect(isRateLimited).toHaveBeenCalledWith('ip:127.0.0.1');
        expect(webSocketUpgradeSpy).toHaveBeenCalledOnce();
      } finally {
        webSocketUpgradeSpy.mockRestore();
        getStateSpy.mockRestore();
        getContainerSpy.mockRestore();
      }
    });

    test('registers an upgrade listener', async () => {
      const getStateSpy = vi.spyOn(registry, 'getState').mockReturnValue({ watcher: {} } as any);
      const getContainerSpy = vi.spyOn(storeContainer, 'getContainer').mockReturnValue(undefined);
      const upgradeListeners: Array<(request: unknown, socket: unknown, head: Buffer) => void> = [];
      const server = {
        on: vi.fn(
          (
            _event: 'upgrade',
            listener: (request: unknown, socket: unknown, head: Buffer) => void,
          ) => {
            upgradeListeners.push(listener);
          },
        ),
      };

      try {
        const gateway = attachContainerLogStreamWebSocketServer({
          server: server as any,
          sessionMiddleware: (_req: any, _res: unknown, next: (error?: unknown) => void) => next(),
          serverConfiguration: {
            ratelimit: { identitykeying: true },
          },
        });

        expect(gateway).toBeDefined();
        expect(server.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
        expect(upgradeListeners).toHaveLength(1);
        const socket = createUpgradeSocket();
        (upgradeListeners[0] as any)(
          createUpgradeRequest('/api/v1/containers/c1/not-logs') as any,
          socket,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
        expect(socket.write).not.toHaveBeenCalled();
      } finally {
        getStateSpy.mockRestore();
        getContainerSpy.mockRestore();
      }
    });

    test('falls back to ip key when identity-aware key generator returns an empty key', async () => {
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
      const getStateSpy = vi.spyOn(registry, 'getState').mockReturnValue({
        watcher: {
          'docker.local': {
            dockerApi: {
              getContainer: vi.fn(() => ({
                logs: vi
                  .fn()
                  .mockResolvedValue(dockerFrame('2026-01-01T00:00:00.000000000Z hello\n', 1)),
              })),
            },
          },
        },
      } as any);
      const getContainerSpy = vi.spyOn(storeContainer, 'getContainer').mockReturnValue({
        id: 'c1',
        name: 'fallback-container',
        watcher: 'local',
        status: 'running',
      } as any);
      const listeners: Array<(request: unknown, socket: unknown, head: Buffer) => void> = [];
      const isRateLimited = vi.fn(() => false);
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
        attachContainerLogStreamWebSocketServer({
          server: server as any,
          sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
            req.session = { passport: { user: '{}' } };
            next();
          },
          serverConfiguration: {
            ratelimit: { identitykeying: true },
          },
          isRateLimited,
        });

        const socket = createUpgradeSocket();
        listeners[0](
          createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
          socket as any,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
        expect(isRateLimited).toHaveBeenCalledWith('ip:127.0.0.1');
        expect(webSocketUpgradeSpy).toHaveBeenCalledOnce();
      } finally {
        webSocketUpgradeSpy.mockRestore();
        getStateSpy.mockRestore();
        getContainerSpy.mockRestore();
      }
    });

    test('uses generated identity-aware keys when available', async () => {
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
      const getStateSpy = vi.spyOn(registry, 'getState').mockReturnValue({
        watcher: {
          'docker.local': {
            dockerApi: {
              getContainer: vi.fn(() => ({
                logs: vi
                  .fn()
                  .mockResolvedValue(dockerFrame('2026-01-01T00:00:00.000000000Z hello\n', 1)),
              })),
            },
          },
        },
      } as any);
      const getContainerSpy = vi.spyOn(storeContainer, 'getContainer').mockReturnValue({
        id: 'c1',
        name: 'identity-key-container',
        watcher: 'local',
        status: 'running',
      } as any);
      const listeners: Array<(request: unknown, socket: unknown, head: Buffer) => void> = [];
      const isRateLimited = vi.fn(() => false);
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
        attachContainerLogStreamWebSocketServer({
          server: server as any,
          sessionMiddleware: (req: any, _res: unknown, next: (error?: unknown) => void) => {
            req.session = { passport: { user: '{"username":"alice"}' } };
            req.sessionID = 'session-identity';
            next();
          },
          serverConfiguration: {
            ratelimit: { identitykeying: true },
          },
          isRateLimited,
        });

        const socket = createUpgradeSocket();
        listeners[0](
          createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
          socket as any,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
        expect(isRateLimited).toHaveBeenCalledWith('session:session-identity');
        expect(webSocketUpgradeSpy).toHaveBeenCalledOnce();
      } finally {
        webSocketUpgradeSpy.mockRestore();
        getStateSpy.mockRestore();
        getContainerSpy.mockRestore();
      }
    });

    test('uses getServerConfiguration when serverConfiguration is omitted', async () => {
      const serverConfigurationSpy = vi
        .spyOn(configuration, 'getServerConfiguration')
        .mockReturnValue({ ratelimit: { identitykeying: false } } as any);
      const server = {
        on: vi.fn(),
      };

      try {
        attachContainerLogStreamWebSocketServer({
          server: server as any,
          sessionMiddleware: (_req: any, _res: unknown, next: (error?: unknown) => void) => next(),
        });

        expect(serverConfigurationSpy).toHaveBeenCalled();
        expect(server.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
      } finally {
        serverConfigurationSpy.mockRestore();
      }
    });
  });
});
