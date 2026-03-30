import { describe, expect, test } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';
import {
  createLogHandlers,
  demuxDockerStream,
  isLocalDockerWatcherApi,
  parseContainerLogDownloadQuery,
} from './logs.js';

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
  });
});
