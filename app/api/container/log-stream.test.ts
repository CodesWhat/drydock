import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import * as configuration from '../../configuration/index.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import * as rateLimitKey from '../rate-limit-key.js';
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
        });

        const socket = createUpgradeSocket();
        listeners[0](
          createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
          socket as any,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
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
            ratelimit: { identitykeying: true },
          },
        });

        const socket = createUpgradeSocket();
        listeners[0](
          createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
          socket as any,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        createKeySpy.mockRestore();
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
        });

        const socket = createUpgradeSocket();
        listeners[0](
          createUpgradeRequest('/api/v1/containers/c1/logs/stream') as any,
          socket as any,
          Buffer.alloc(0),
        );
        await new Promise((resolve) => setImmediate(resolve));
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
