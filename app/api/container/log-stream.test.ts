import { EventEmitter } from 'node:events';
import {
  attachContainerLogStreamWebSocketServer,
  createContainerLogStreamGateway,
  createDockerLogFrameDemuxer,
  createDockerLogMessageDecoder,
  parseContainerLogStreamQuery,
} from './log-stream.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';

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

      expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('404 Not Found'));
      expect(socket.destroy).toHaveBeenCalledTimes(1);
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

    test('closes websocket with 4004 when container is missing', async () => {
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
      ws.close = vi.fn();

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

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'stdout',
          ts: '2026-01-01T00:00:00.000000000Z',
          line: 'hello',
        }),
      );
      expect(ws.close).toHaveBeenCalledWith(1000, 'Stream complete');
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
        dockerFrame('2026-01-01T00:00:00.000000000Z hello from stream\n', 1),
      );
      dockerStream.emit('end');

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'stdout',
          ts: '2026-01-01T00:00:00.000000000Z',
          line: 'hello from stream',
        }),
      );
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
  });

  describe('attachContainerLogStreamWebSocketServer', () => {
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
        expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('404 Not Found'));
      } finally {
        getStateSpy.mockRestore();
        getContainerSpy.mockRestore();
      }
    });
  });
});
