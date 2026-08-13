import { EventEmitter } from 'node:events';
import { describe, expect, test } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';
import {
  createLogHandlers,
  demuxDockerStream,
  isLocalDockerWatcherApi,
  parseContainerLogDownloadQuery,
} from './logs.js';

function createDockerLogFrame(payload: Buffer): Buffer {
  const frame = Buffer.alloc(8 + payload.length);
  frame[0] = 1;
  frame.writeUInt32BE(payload.length, 4);
  payload.copy(frame, 8);
  return frame;
}

function createStreamingLogHandler(dial: ReturnType<typeof vi.fn>) {
  const response = createMockResponse();
  const handlers = createLogHandlers({
    storeContainer: {
      getContainer: vi.fn(() => ({
        id: 'c1',
        name: 'streamed',
        watcher: 'local',
        status: 'running',
      })),
    },
    getAgent: vi.fn(() => undefined),
    getWatchers: vi.fn(() => ({
      'docker.local': {
        dockerApi: {
          getContainer: vi.fn(() => ({
            modem: { dial },
            logs: vi.fn(),
          })),
        },
      },
    })),
    getErrorMessage: vi.fn(() => 'stream error'),
  } as any);
  return {
    handle: () =>
      handlers.getContainerLogs(
        { params: { id: 'c1' }, query: {}, headers: {} } as any,
        response as any,
      ),
    response,
  };
}

describe('api/container/logs', () => {
  describe('isLocalDockerWatcherApi', () => {
    test('returns false for non-object values', () => {
      expect(isLocalDockerWatcherApi(undefined)).toBe(false);
      expect(isLocalDockerWatcherApi(null)).toBe(false);
      expect(isLocalDockerWatcherApi('docker.local')).toBe(false);
      expect(isLocalDockerWatcherApi(42)).toBe(false);
    });

    test('returns false when dockerApi is missing', () => {
      expect(isLocalDockerWatcherApi({})).toBe(false);
      expect(isLocalDockerWatcherApi({ dockerApi: undefined })).toBe(false);
    });

    test('returns false when dockerApi.getContainer is not a function', () => {
      expect(isLocalDockerWatcherApi({ dockerApi: {} })).toBe(false);
      expect(isLocalDockerWatcherApi({ dockerApi: { getContainer: 'nope' } })).toBe(false);
    });

    test('returns true when dockerApi.getContainer is a function', () => {
      const watcher = {
        dockerApi: {
          getContainer: () => ({ logs: async () => '' }),
        },
      };

      expect(isLocalDockerWatcherApi(watcher)).toBe(true);
    });
  });

  describe('parseContainerLogDownloadQuery', () => {
    test('returns expected defaults', () => {
      expect(parseContainerLogDownloadQuery({} as any)).toEqual({
        stdout: true,
        stderr: true,
        tail: 1000,
        since: 0,
        timestamps: true,
      });
    });

    test('parses boolean, integer, and ISO timestamp query params', () => {
      expect(
        parseContainerLogDownloadQuery({
          stdout: 'false',
          stderr: ['true'],
          tail: '250',
          since: '2026-01-01T00:00:00.000Z',
        } as any),
      ).toEqual({
        stdout: false,
        stderr: true,
        tail: 250,
        since: 1767225600,
        timestamps: true,
      });
    });

    test('falls back to default since when timestamp parsing fails', () => {
      expect(
        parseContainerLogDownloadQuery({
          since: 'not-a-time',
        } as any),
      ).toEqual({
        stdout: true,
        stderr: true,
        tail: 1000,
        since: 0,
        timestamps: true,
      });
    });

    test('uses first array value for since query param', () => {
      expect(
        parseContainerLogDownloadQuery({
          since: ['1700000000', '1700000001'],
        } as any),
      ).toEqual({
        stdout: true,
        stderr: true,
        tail: 1000,
        since: 1700000000,
        timestamps: true,
      });
    });

    test('falls back when numeric since overflows finite bounds', () => {
      expect(
        parseContainerLogDownloadQuery({
          since: '9'.repeat(400),
        } as any),
      ).toEqual({
        stdout: true,
        stderr: true,
        tail: 1000,
        since: 0,
        timestamps: true,
      });
    });

    test('bounds tail to prevent unbounded log downloads', () => {
      expect(parseContainerLogDownloadQuery({ tail: '-1' } as any).tail).toBe(0);
      expect(parseContainerLogDownloadQuery({ tail: '999999999' } as any).tail).toBe(10_000);
    });
  });

  describe('demuxDockerStream', () => {
    test('joins complete multiplexed frames', () => {
      const payloadA = Buffer.from('line a\n', 'utf8');
      const payloadB = Buffer.from('line b\n', 'utf8');
      const headerA = Buffer.alloc(8);
      const headerB = Buffer.alloc(8);
      headerA[0] = 1;
      headerB[0] = 2;
      headerA.writeUInt32BE(payloadA.length, 4);
      headerB.writeUInt32BE(payloadB.length, 4);

      const buffer = Buffer.concat([headerA, payloadA, headerB, payloadB]);
      expect(demuxDockerStream(buffer)).toBe('line a\nline b\n');
    });

    test('ignores truncated trailing frames', () => {
      const payload = Buffer.from('line a\n', 'utf8');
      const header = Buffer.alloc(8);
      header[0] = 1;
      header.writeUInt32BE(100, 4);
      const truncated = Buffer.concat([header, payload]);
      expect(demuxDockerStream(truncated)).toBe('');
    });
  });

  describe('agent payload normalization', () => {
    test('supports agent payloads returned as plain string', async () => {
      const handlers = createLogHandlers({
        storeContainer: {
          getContainer: vi.fn(() => ({
            id: 'c1',
            name: 'test',
            watcher: 'local',
            status: 'running',
            agent: 'remote',
          })),
        },
        getAgent: vi.fn(() => ({
          getContainerLogs: vi.fn().mockResolvedValue('string logs'),
        })),
        getWatchers: vi.fn(() => ({})),
        getErrorMessage: vi.fn(() => 'error'),
      } as any);

      const res = createMockResponse();
      await handlers.getContainerLogs(
        {
          params: { id: 'c1' },
          query: {},
          headers: {},
        } as any,
        res as any,
      );

      expect(res.send).toHaveBeenCalledWith('string logs');
    });

    test('falls back to empty payload when agent response is not recognized', async () => {
      const handlers = createLogHandlers({
        storeContainer: {
          getContainer: vi.fn(() => ({
            id: 'c1',
            name: 'test',
            watcher: 'local',
            status: 'running',
            agent: 'remote',
          })),
        },
        getAgent: vi.fn(() => ({
          getContainerLogs: vi.fn().mockResolvedValue({}),
        })),
        getWatchers: vi.fn(() => ({})),
        getErrorMessage: vi.fn(() => 'error'),
      } as any);

      const res = createMockResponse();
      await handlers.getContainerLogs(
        {
          params: { id: 'c1' },
          query: {},
          headers: {},
        } as any,
        res as any,
      );

      expect(res.send).toHaveBeenCalledWith('');
    });

    test('falls back to empty payload when agent response is null', async () => {
      const handlers = createLogHandlers({
        storeContainer: {
          getContainer: vi.fn(() => ({
            id: 'c1',
            name: 'test',
            watcher: 'local',
            status: 'running',
            agent: 'remote',
          })),
        },
        getAgent: vi.fn(() => ({
          getContainerLogs: vi.fn().mockResolvedValue(null),
        })),
        getWatchers: vi.fn(() => ({})),
        getErrorMessage: vi.fn(() => 'error'),
      } as any);

      const res = createMockResponse();
      await handlers.getContainerLogs(
        {
          params: { id: 'c1' },
          query: {},
          headers: {},
        } as any,
        res as any,
      );

      expect(res.send).toHaveBeenCalledWith('');
    });

    test('rejects an agent log response above the download byte limit', async () => {
      const handlers = createLogHandlers({
        storeContainer: {
          getContainer: vi.fn(() => ({
            id: 'c1',
            name: 'test',
            watcher: 'remote',
            status: 'running',
            agent: 'edge',
          })),
        },
        getAgent: vi.fn(() => ({
          getContainerLogs: vi.fn().mockResolvedValue('x'.repeat(16 * 1024 * 1024 + 1)),
        })),
        getWatchers: vi.fn(() => ({})),
        getErrorMessage: vi.fn(() => 'error'),
      } as any);
      const res = createMockResponse();

      await handlers.getContainerLogs(
        { params: { id: 'c1' }, query: {}, headers: {} } as any,
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container log download exceeds 16 MiB' });
      expect(res.send).not.toHaveBeenCalled();
    });
  });

  describe('download response headers', () => {
    test('supports array-form accept-encoding headers and empty container names', async () => {
      const handlers = createLogHandlers({
        storeContainer: {
          getContainer: vi.fn(() => ({
            id: 'c1',
            name: '',
            watcher: 'local',
            status: 'running',
          })),
        },
        getAgent: vi.fn(() => undefined),
        getWatchers: vi.fn(() => ({
          'docker.local': {
            dockerApi: {
              getContainer: vi.fn(() => ({
                logs: vi.fn().mockResolvedValue(Buffer.alloc(0)),
              })),
            },
          },
        })),
        getErrorMessage: vi.fn(() => 'error'),
      } as any);

      const res = createMockResponse();
      await handlers.getContainerLogs(
        {
          params: { id: 'c1' },
          query: {},
          headers: { 'accept-encoding': ['br', 'gzip'] },
        } as any,
        res as any,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="container-logs.txt.gz"',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Content-Encoding', 'gzip');
      expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    });

    test('rejects a local Docker response above the download byte limit before compression', async () => {
      const handlers = createLogHandlers({
        storeContainer: {
          getContainer: vi.fn(() => ({
            id: 'c1',
            name: 'noisy',
            watcher: 'local',
            status: 'running',
          })),
        },
        getAgent: vi.fn(() => undefined),
        getWatchers: vi.fn(() => ({
          'docker.local': {
            dockerApi: {
              getContainer: vi.fn(() => ({
                logs: vi.fn().mockResolvedValue(Buffer.alloc(16 * 1024 * 1024 + 1)),
              })),
            },
          },
        })),
        getErrorMessage: vi.fn(() => 'error'),
      } as any);
      const res = createMockResponse();

      await handlers.getContainerLogs(
        {
          params: { id: 'c1' },
          query: {},
          headers: { 'accept-encoding': 'gzip' },
        } as any,
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container log download exceeds 16 MiB' });
      expect(res.send).not.toHaveBeenCalled();
    });

    test('destroys the local Docker stream as soon as the download byte limit is exceeded', async () => {
      const dockerStream = Object.assign(new EventEmitter(), { destroy: vi.fn() });
      const dial = vi.fn((options, callback) => callback(null, dockerStream));
      const logs = vi.fn();
      const handlers = createLogHandlers({
        storeContainer: {
          getContainer: vi.fn(() => ({
            id: 'c1',
            name: 'noisy/name',
            watcher: 'local',
            status: 'running',
          })),
        },
        getAgent: vi.fn(() => undefined),
        getWatchers: vi.fn(() => ({
          'docker.local': {
            dockerApi: {
              getContainer: vi.fn(() => ({
                id: 'noisy',
                modem: { dial },
                logs,
              })),
            },
          },
        })),
        getErrorMessage: vi.fn(() => 'error'),
      } as any);
      const res = createMockResponse();

      const handling = handlers.getContainerLogs(
        { params: { id: 'c1' }, query: {}, headers: {} } as any,
        res as any,
      );
      await vi.waitFor(() => expect(dial).toHaveBeenCalledTimes(1));
      dockerStream.emit('data', Buffer.alloc(8 * 1024 * 1024));
      dockerStream.emit('data', Buffer.alloc(8 * 1024 * 1024));
      dockerStream.emit('data', Buffer.alloc(1));
      dockerStream.emit('data', Buffer.from('ignored'));
      dockerStream.emit('error', new Error('ignored after overflow'));
      dockerStream.emit('end');
      await handling;

      expect(dial).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/containers/noisy%2Fname/logs?',
          method: 'GET',
          isStream: true,
          options: expect.objectContaining({ follow: false }),
        }),
        expect.any(Function),
      );
      expect(dockerStream.destroy).toHaveBeenCalledOnce();
      expect(logs).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.send).not.toHaveBeenCalled();
    });

    test('downloads a completed bounded local Docker stream', async () => {
      const dockerStream = new EventEmitter();
      const dial = vi.fn((_options, callback) => callback(null, dockerStream));
      const { handle, response } = createStreamingLogHandler(dial);

      const handling = handle();
      await vi.waitFor(() => expect(dial).toHaveBeenCalledTimes(1));
      dockerStream.emit(
        'data',
        new Uint8Array(createDockerLogFrame(Buffer.from('streamed line\n', 'utf8'))),
      );
      dockerStream.emit('end');
      dockerStream.emit('close');
      await handling;

      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.send).toHaveBeenCalledWith('streamed line\n');
    });

    test('handles an error from a bounded local Docker stream', async () => {
      const dockerStream = new EventEmitter();
      const dial = vi.fn((_options, callback) => callback(null, dockerStream));
      const { handle, response } = createStreamingLogHandler(dial);

      const handling = handle();
      await vi.waitFor(() => expect(dial).toHaveBeenCalledTimes(1));
      dockerStream.emit('error', new Error('stream failed'));
      await handling;

      expect(response.status).toHaveBeenCalledWith(500);
    });

    test('rejects when a bounded local Docker stream closes before completion', async () => {
      const dockerStream = new EventEmitter();
      const dial = vi.fn((_options, callback) => callback(null, dockerStream));
      const { handle, response } = createStreamingLogHandler(dial);

      const handling = handle();
      await vi.waitFor(() => expect(dial).toHaveBeenCalledTimes(1));
      dockerStream.emit('close');

      await vi.waitFor(() => expect(response.status).toHaveBeenCalledWith(500), { timeout: 100 });
      await handling;
    });

    test('destroys and rejects a stalled bounded local Docker stream', async () => {
      vi.useFakeTimers();
      const previousTimeout = process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
      process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = '100';
      try {
        const dockerStream = Object.assign(new EventEmitter(), { destroy: vi.fn() });
        const dial = vi.fn((_options, callback) => callback(null, dockerStream));
        const { handle, response } = createStreamingLogHandler(dial);

        const handling = handle();
        await vi.waitFor(() => expect(dial).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(100);

        expect(dockerStream.destroy).toHaveBeenCalledOnce();
        expect(response.status).toHaveBeenCalledWith(500);
        await handling;
      } finally {
        if (previousTimeout === undefined) {
          delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
        } else {
          process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = previousTimeout;
        }
        vi.useRealTimers();
      }
    });

    test('handles a Docker modem dial error', async () => {
      const { handle, response } = createStreamingLogHandler(
        vi.fn((_options, callback) => callback(new Error('dial failed'))),
      );

      await handle();

      expect(response.status).toHaveBeenCalledWith(500);
    });

    test.each([null, 'not a stream', {}])(
      'rejects an invalid Docker modem stream response %#',
      async (invalidStream) => {
        const { handle, response } = createStreamingLogHandler(
          vi.fn((_options, callback) => callback(null, invalidStream)),
        );

        await handle();

        expect(response.status).toHaveBeenCalledWith(500);
      },
    );
  });
});
