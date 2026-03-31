import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import * as configuration from '../../configuration/index.js';
import * as registry from '../../registry/index.js';
import * as storeContainer from '../../store/container.js';
import * as containerApi from './container.js';

const { mockLogger, mockLoggerChild } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockLoggerChild: vi.fn(() => mockLogger),
}));

vi.mock('../../log/index.js', () => ({
  default: { child: mockLoggerChild },
}));

vi.mock('../../store/container.js', () => ({
  getContainersRaw: vi.fn(),
  getContainer: vi.fn(),
  deleteContainer: vi.fn(),
}));

vi.mock('../../configuration/index.js', () => ({
  getServerConfiguration: vi.fn(),
}));

vi.mock('../../registry/index.js', () => ({
  getState: vi.fn(() => ({ watcher: {}, trigger: {} })),
}));

describe('agent API container', () => {
  let req;
  let res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { params: {} };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      sendStatus: vi.fn(),
    };
  });

  describe('getContainers', () => {
    test('should create a component-scoped logger during module initialization', async () => {
      vi.resetModules();
      mockLoggerChild.mockClear();

      await import('./container.js');

      expect(mockLoggerChild).toHaveBeenCalledWith({ component: 'agent-api-container' });
    });

    test('should return raw containers without redaction', () => {
      const containers = [{ id: 'c1' }, { id: 'c2' }];
      storeContainer.getContainersRaw.mockReturnValue(containers);
      containerApi.getContainers(req, res);
      expect(storeContainer.getContainersRaw).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(containers);
    });

    test('should strip LokiJS metadata from response containers', () => {
      const containers = [
        { id: 'c1', status: 'running', $loki: 123, meta: { revision: 0, created: 1000 } },
      ];
      storeContainer.getContainersRaw.mockReturnValue(containers);

      containerApi.getContainers(req, res);

      const responseContainers = res.json.mock.calls[0][0];
      expect(responseContainers).toEqual([{ id: 'c1', status: 'running' }]);
      expect(responseContainers[0]).not.toHaveProperty('$loki');
      expect(responseContainers[0]).not.toHaveProperty('meta');
    });
  });

  describe('getContainerLogs', () => {
    test('should avoid any-cast when reading watcher from registry state', () => {
      const source = fs.readFileSync(path.resolve(__dirname, './container.ts'), 'utf8');

      expect(source).not.toContain('(registry.getState() as any).watcher[watcherId]');
    });

    /** Build a Docker multiplexed stream buffer (8-byte header + payload). */
    function dockerStreamBuffer(text, stream = 1) {
      const payload = Buffer.from(text, 'utf-8');
      const header = Buffer.alloc(8);
      header[0] = stream;
      header.writeUInt32BE(payload.length, 4);
      return Buffer.concat([header, payload]);
    }

    test('should return 404 when container not found', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      req.params.id = 'c1';
      req.query = {};
      await containerApi.getContainerLogs(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('should return 500 when watcher not found', async () => {
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: {}, trigger: {} });
      req.params.id = 'c1';
      req.query = {};
      await containerApi.getContainerLogs(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('No watcher found'),
        }),
      );
    });

    test.each([
      ['string route param', 'c1'],
      ['array route param', ['c1']],
    ])('should return logs successfully for %s id', async (_label, routeId) => {
      const mockLogs = dockerStreamBuffer('log output');
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      req.params.id = routeId;
      req.query = {};

      await containerApi.getContainerLogs(req, res);

      expect(storeContainer.getContainer).toHaveBeenCalledWith('c1');
      expect(mockWatcher.dockerApi.getContainer).toHaveBeenCalledWith('my-container');
      expect(mockDockerContainer.logs).toHaveBeenCalledWith({
        stdout: true,
        stderr: true,
        tail: 100,
        since: 0,
        timestamps: true,
        follow: false,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ logs: 'log output' });
    });

    test('should concatenate multiple docker log frames without separators', async () => {
      const mockLogs = Buffer.concat([
        dockerStreamBuffer('line one\n'),
        dockerStreamBuffer('line two\n'),
      ]);
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      req.params.id = 'c1';
      req.query = {};

      await containerApi.getContainerLogs(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ logs: 'line one\nline two\n' });
    });

    test('should pass numeric tail and since query parameters to docker logs', async () => {
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(Buffer.alloc(0)) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      req.params.id = 'c1';
      req.query = { tail: '25', since: '1700000000' };

      await containerApi.getContainerLogs(req, res);

      expect(mockDockerContainer.logs).toHaveBeenCalledWith(
        expect.objectContaining({
          tail: 25,
          since: 1700000000,
        }),
      );
    });

    test('should return 500 when docker API fails', async () => {
      const mockDockerContainer = { logs: vi.fn().mockRejectedValue(new Error('docker error')) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      req.params.id = 'c1';
      req.query = {};
      await containerApi.getContainerLogs(req, res);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error fetching container logs for c1 (docker error)',
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error fetching container logs' });
    });

    test('should handle string response from docker logs', async () => {
      // Build a docker stream frame as a Buffer, then convert to string
      // to exercise the Buffer.isBuffer() === false branch in demuxDockerStream
      const payload = Buffer.from('string log output', 'utf-8');
      const header = Buffer.alloc(8);
      header[0] = 1; // stdout
      header.writeUInt32BE(payload.length, 4);
      const frame = Buffer.concat([header, payload]);
      // Pass as hex string that will be converted back via Buffer.from()
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(frame.toString('binary')) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      req.params.id = 'c1';
      req.query = {};
      await containerApi.getContainerLogs(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      // The demux should still extract something (the string gets converted to Buffer via Buffer.from)
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ logs: expect.any(String) }));
    });

    test('should handle truncated docker stream buffer', async () => {
      // Create a header claiming 1000 bytes but only provide 10
      const header = Buffer.alloc(8);
      header[0] = 1;
      header.writeUInt32BE(1000, 4); // claims 1000 bytes
      const partial = Buffer.from('short');
      const truncated = Buffer.concat([header, partial]); // only 5 bytes of payload
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(truncated) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      req.params.id = 'c1';
      req.query = {};
      await containerApi.getContainerLogs(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ logs: '' });
    });

    test('should pass timestamps=false when query param is false', async () => {
      const mockLogs = Buffer.alloc(0);
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      req.params.id = 'c1';
      req.query = { timestamps: 'false' };
      await containerApi.getContainerLogs(req, res);
      expect(mockDockerContainer.logs).toHaveBeenCalledWith(
        expect.objectContaining({ timestamps: false }),
      );
    });

    test('should default timestamps to true', async () => {
      const mockLogs = Buffer.alloc(0);
      const mockDockerContainer = { logs: vi.fn().mockResolvedValue(mockLogs) };
      const mockWatcher = {
        dockerApi: { getContainer: vi.fn().mockReturnValue(mockDockerContainer) },
      };
      storeContainer.getContainer.mockReturnValue({
        id: 'c1',
        name: 'my-container',
        watcher: 'local',
      });
      registry.getState.mockReturnValue({ watcher: { 'docker.local': mockWatcher }, trigger: {} });
      req.params.id = 'c1';
      req.query = {};
      await containerApi.getContainerLogs(req, res);
      expect(mockDockerContainer.logs).toHaveBeenCalledWith(
        expect.objectContaining({ timestamps: true }),
      );
    });
  });

  describe('deleteContainer', () => {
    test('should return 403 when delete feature is disabled', () => {
      configuration.getServerConfiguration.mockReturnValue({
        feature: { delete: false },
      });
      req.params.id = 'c1';
      containerApi.deleteContainer(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container deletion is disabled' });
    });

    test('should return 404 when container is not found', () => {
      configuration.getServerConfiguration.mockReturnValue({
        feature: { delete: true },
      });
      req.params.id = 'c1';
      storeContainer.getContainer.mockReturnValue(undefined);
      containerApi.deleteContainer(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test.each([
      ['string route param', 'c1'],
      ['array route param', ['c1']],
    ])('should delete container and return 204 for %s id', (_label, routeId) => {
      configuration.getServerConfiguration.mockReturnValue({
        feature: { delete: true },
      });
      req.params.id = routeId;
      storeContainer.getContainer.mockReturnValue({ id: 'c1' });

      containerApi.deleteContainer(req, res);
      expect(storeContainer.getContainer).toHaveBeenCalledWith('c1');
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });
  });
});
