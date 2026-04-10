import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

vi.mock('axios');
vi.mock('node:fs', () => ({
  default: { readFileSync: vi.fn().mockReturnValue(Buffer.from('cert-data')) },
}));
const mockResolveConfiguredPath = vi.hoisted(() => vi.fn((path) => path));
vi.mock('../runtime/paths.js', () => ({
  resolveConfiguredPath: mockResolveConfiguredPath,
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock('../store/container.js', () => ({
  getContainers: vi.fn().mockReturnValue([]),
  getContainer: vi.fn(),
  insertContainer: vi.fn((c) => c),
  updateContainer: vi.fn((c) => c),
  deleteContainer: vi.fn(),
}));
vi.mock('../event/index.js', () => ({
  emitAgentConnected: vi.fn().mockResolvedValue(undefined),
  emitAgentDisconnected: vi.fn().mockResolvedValue(undefined),
  emitContainerReport: vi.fn(),
  emitContainerReports: vi.fn(),
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../registry/index.js', () => ({
  deregisterAgentComponents: vi.fn(),
  registerComponent: vi.fn(),
}));

import * as event from '../event/index.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import { AgentClient } from './AgentClient.js';

describe('AgentClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveConfiguredPath.mockImplementation((path) => path);
    vi.useFakeTimers();
    client = new AgentClient('test-agent', {
      host: 'localhost',
      port: 3001,
      secret: 'test-secret',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    test('should set name and config', () => {
      expect(client.name).toBe('test-agent');
      expect(client.config.host).toBe('localhost');
      expect(client.config.port).toBe(3001);
      expect(client.isConnected).toBe(false);
    });

    test('should build baseUrl with http when no certfile', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's',
      });
      expect(c.baseUrl).toBe('http://myhost:4000');
    });

    test('should build baseUrl with https when certfile is provided', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's',
        certfile: '/path/to/cert.pem',
        keyfile: '/path/to/key.pem',
        cafile: '/path/to/ca.pem',
      });
      expect(c.baseUrl).toBe('https://myhost:4000');
    });

    test('should build baseUrl with https when using port 443', () => {
      const c = new AgentClient('a', {
        host: 'agent.example.com',
        port: 443,
        secret: 's',
      });
      expect(c.baseUrl).toBe('https://agent.example.com');
    });

    test('should handle host that already starts with http', () => {
      // Intentionally using http:// to verify protocol-prefix detection logic
      const c = new AgentClient('a', {
        host: 'http://myhost',
        port: 4000,
        secret: 's',
      });
      expect(c.baseUrl).toBe('http://myhost:4000');
    });

    test('should default port to 3000 when not provided', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 0,
        secret: 's',
      });
      expect(c.baseUrl).toBe('http://myhost:3000');
    });

    test('should create https agent when certfile without cafile', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's',
        certfile: '/path/to/cert.pem',
      });
      expect(c.baseUrl).toBe('https://myhost:4000');
      expect(c.axiosOptions.httpsAgent).toBeDefined();
    });

    test('should create https agent when cafile provided without certfile', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's',
        cafile: '/path/to/ca.pem',
      });
      expect(c.baseUrl).toBe('https://myhost:4000');
      expect(c.axiosOptions.httpsAgent).toBeDefined();
    });

    test('should skip cert file read when resolved cert path is empty', () => {
      mockResolveConfiguredPath.mockImplementation((path, options) => {
        if (options?.label === 'a cert file') {
          return '';
        }
        return path;
      });

      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's',
        certfile: '/path/to/cert.pem',
      });

      expect(c.axiosOptions.httpsAgent).toBeDefined();
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    test('should throw when host uses an unsupported protocol', () => {
      expect(
        () =>
          new AgentClient('a', {
            host: 'httpx://myhost',
            port: 4000,
            secret: 's',
          }),
      ).toThrowError('Invalid agent URL protocol: httpx:');
    });

    test('should warn when secret is configured over plaintext http', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 4000,
        secret: 's',
      });

      expect(c.log.warn).toHaveBeenCalledWith(
        'Agent a is configured with a secret over insecure HTTP (http://myhost:4000). Configure HTTPS (certfile/cafile) to protect X-Dd-Agent-Secret.',
      );
    });
  });

  describe('init', () => {
    test('should call startSse', async () => {
      const spy = vi.spyOn(client, 'startSse').mockImplementation(() => {});
      await client.init();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('processContainer', () => {
    test('should await emitContainerReport before resolving', async () => {
      let resolveEmit;
      const emitPromise = new Promise<void>((resolve) => {
        resolveEmit = resolve;
      });
      event.emitContainerReport.mockReturnValueOnce(emitPromise);
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue({ id: 'c1', updateAvailable: true });

      let resolved = false;
      const processPromise = client.processContainer({ id: 'c1', name: 'test' });
      void processPromise.then(() => {
        resolved = true;
      });

      await Promise.resolve();

      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({
          container: expect.objectContaining({ id: 'c1' }),
          changed: true,
        }),
      );
      expect(resolved).toBe(false);

      resolveEmit();
      await processPromise;
      expect(resolved).toBe(true);
    });

    test('should insert new container and emit report with changed=true', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue({ id: 'c1', updateAvailable: false });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(container.agent).toBe('test-agent');
      expect(storeContainer.insertContainer).toHaveBeenCalledWith(container);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: true }),
      );
    });

    test('should update existing container and detect changes', async () => {
      const existing = {
        id: 'c1',
        resultChanged: vi.fn().mockReturnValue(true),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: true,
      });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(storeContainer.updateContainer).toHaveBeenCalledWith(container);
      expect(existing.resultChanged).toHaveBeenCalled();
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: true }),
      );
    });

    test('should set changed=false when result has not changed', async () => {
      const existing = {
        id: 'c1',
        resultChanged: vi.fn().mockReturnValue(false),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: true,
      });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: false }),
      );
    });

    test('should set changed=false when updateAvailable is false', async () => {
      const existing = {
        id: 'c1',
        resultChanged: vi.fn().mockReturnValue(true),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: false,
      });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: false }),
      );
    });

    test('should strip sensitive field from env entries before storing', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue({ id: 'c1' });
      const container = {
        id: 'c1',
        name: 'test',
        details: {
          ports: [],
          volumes: [],
          env: [
            { key: 'NORMAL', value: 'foo', sensitive: false },
            { key: 'API_KEY', value: '[REDACTED]', sensitive: true },
          ],
        },
      };
      await client.processContainer(container);
      expect(storeContainer.insertContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            env: [
              { key: 'NORMAL', value: 'foo' },
              { key: 'API_KEY', value: '[REDACTED]' },
            ],
          }),
        }),
      );
    });

    test('should handle existing container without resultChanged function', async () => {
      const existing = { id: 'c1' }; // no resultChanged
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: true,
      });
      const container = { id: 'c1', name: 'test' };
      await client.processContainer(container);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: false }),
      );
    });

    test('should ignore invalid ids when managing pending freshness state', () => {
      const internal = client as unknown as {
        markPendingFreshState: (containerId: unknown) => void;
        clearPendingFreshState: (containerId: unknown) => void;
        pendingFreshStateAfterRemoteUpdate: Set<string>;
      };

      internal.pendingFreshStateAfterRemoteUpdate.add('c1');
      internal.markPendingFreshState(undefined);
      internal.markPendingFreshState('');
      internal.clearPendingFreshState(undefined);
      internal.clearPendingFreshState('');

      expect([...internal.pendingFreshStateAfterRemoteUpdate]).toEqual(['c1']);
    });

    test('should preserve cleared updateAvailable for stale incremental events after remote update', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const existing = {
        id: 'c1',
        updateAvailable: false,
        resultChanged: vi.fn().mockReturnValue(true),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: false,
      });

      await client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update');
      await client.handleEvent('dd:container-updated', {
        id: 'c1',
        name: 'test',
        result: {
          digest: 'sha256:new',
        },
        updateAvailable: true,
      });

      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'c1',
          name: 'test',
          agent: 'test-agent',
          result: undefined,
          updateAvailable: false,
        }),
      );
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: false }),
      );
    });

    test('should clear stale update suppression after agent reports updateAvailable false', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const existing = {
        id: 'c1',
        updateAvailable: false,
        resultChanged: vi.fn().mockReturnValue(true),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer
        .mockReturnValueOnce({
          id: 'c1',
          updateAvailable: false,
        })
        .mockReturnValueOnce({
          id: 'c1',
          updateAvailable: true,
        });

      await client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update');
      await client.handleEvent('dd:container-updated', {
        id: 'c1',
        name: 'test',
        updateAvailable: false,
      });
      await client.handleEvent('dd:container-updated', {
        id: 'c1',
        name: 'test',
        updateAvailable: true,
      });

      expect(storeContainer.updateContainer).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          id: 'c1',
          name: 'test',
          agent: 'test-agent',
          updateAvailable: false,
        }),
      );
      expect(storeContainer.updateContainer).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: 'c1',
          name: 'test',
          agent: 'test-agent',
          updateAvailable: true,
        }),
      );
    });

    test('should accept authoritative watcher snapshot state after remote update suppression', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const existing = {
        id: 'c1',
        updateAvailable: false,
        resultChanged: vi.fn().mockReturnValue(true),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        watcher: 'local',
        updateAvailable: true,
      });
      storeContainer.getContainers.mockReturnValue([]);

      await client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update');
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1', name: 'test', watcher: 'local', updateAvailable: true }],
      });

      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'c1',
          name: 'test',
          watcher: 'local',
          agent: 'test-agent',
          updateAvailable: true,
        }),
      );
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({ changed: true }),
      );
    });
  });

  describe('processAuthoritativeContainers', () => {
    test('should await emitContainerReports before resolving', async () => {
      let resolveEmit;
      const emitPromise = new Promise<void>((resolve) => {
        resolveEmit = resolve;
      });
      event.emitContainerReports.mockReturnValueOnce(emitPromise);
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((container) => ({
        ...container,
        updateAvailable: true,
      }));

      const internal = client as unknown as {
        processAuthoritativeContainers: (
          containers: Array<Record<string, unknown>>,
        ) => Promise<unknown>;
      };

      let resolved = false;
      const processPromise = internal.processAuthoritativeContainers([{ id: 'c1', name: 'test' }]);
      void processPromise.then(() => {
        resolved = true;
      });

      await vi.waitFor(() =>
        expect(event.emitContainerReports).toHaveBeenCalledWith([
          expect.objectContaining({
            container: expect.objectContaining({ id: 'c1' }),
            changed: true,
          }),
        ]),
      );

      expect(event.emitContainerReports).toHaveBeenCalledWith([
        expect.objectContaining({
          container: expect.objectContaining({ id: 'c1' }),
          changed: true,
        }),
      ]);
      expect(resolved).toBe(false);

      resolveEmit();
      await processPromise;
      expect(resolved).toBe(true);
    });
  });

  describe('handshake', () => {
    test('should fetch containers, process them, and register components', async () => {
      const containers = [{ id: 'c1' }, { id: 'c2' }];
      axios.get
        .mockResolvedValueOnce({ data: containers }) // containers
        .mockResolvedValueOnce({ data: [{ type: 'docker', name: 'local', configuration: {} }] }) // watchers
        .mockResolvedValueOnce({ data: [{ type: 'docker', name: 'update', configuration: {} }] }); // triggers

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(storeContainer.insertContainer).toHaveBeenCalledTimes(2);
      expect(registry.deregisterAgentComponents).toHaveBeenCalledWith('test-agent');
      expect(registry.registerComponent).toHaveBeenCalledTimes(2);
      expect(registry.registerComponent).toHaveBeenCalledWith(
        expect.objectContaining({ componentPath: 'agent/components' }),
      );
      expect(client.isConnected).toBe(true);
    });

    test('should emit agent-connected when transitioning to connected state', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();

      expect(event.emitAgentConnected).toHaveBeenCalledWith({
        agentName: 'test-agent',
        reconnected: false,
      });
    });

    test('should emit batched container reports after handshake processing', async () => {
      axios.get
        .mockResolvedValueOnce({
          data: [
            { id: 'c1', name: 'one', watcher: 'local' },
            { id: 'c2', name: 'two', watcher: 'local' },
          ],
        })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((container) => ({
        ...container,
        updateAvailable: true,
      }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      expect(event.emitContainerReports).toHaveBeenCalledWith([
        expect.objectContaining({
          changed: true,
          container: expect.objectContaining({ id: 'c1', agent: 'test-agent' }),
        }),
        expect.objectContaining({
          changed: true,
          container: expect.objectContaining({ id: 'c2', agent: 'test-agent' }),
        }),
      ]);
    });

    test('should not emit agent-connected when already connected', async () => {
      client.isConnected = true;
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();

      expect(event.emitAgentConnected).not.toHaveBeenCalled();
    });

    test('should log debug when agent-connected emission fails', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      event.emitAgentConnected.mockRejectedValueOnce(new Error('emit failed'));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();
      await Promise.resolve();

      expect(event.emitAgentConnected).toHaveBeenCalledWith({
        agentName: 'test-agent',
        reconnected: false,
      });
      expect(client.log.debug).toHaveBeenCalledWith(
        'Failed to emit agent connected event (emit failed)',
      );
    });

    test('should emit agent-connected with reconnected=true after a prior disconnect', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();
      client.scheduleReconnect(1_000);
      clearTimeout((client as any).reconnectTimer);
      (client as any).reconnectTimer = null;

      await client.handshake();

      expect(event.emitAgentConnected).toHaveBeenNthCalledWith(1, {
        agentName: 'test-agent',
        reconnected: false,
      });
      expect(event.emitAgentConnected).toHaveBeenNthCalledWith(2, {
        agentName: 'test-agent',
        reconnected: true,
      });
    });

    test('should keep reconnected=false on the first successful handshake after startup retries', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainers.mockReturnValue([]);

      client.scheduleReconnect(1_000);
      clearTimeout((client as any).reconnectTimer);
      (client as any).reconnectTimer = null;

      await client.handshake();

      expect(event.emitAgentConnected).toHaveBeenCalledWith({
        agentName: 'test-agent',
        reconnected: false,
      });
    });

    test('should handle watcher fetch failure gracefully', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // containers
        .mockRejectedValueOnce(new Error('network error')) // watchers fail
        .mockResolvedValueOnce({ data: [] }); // triggers

      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();
      expect(client.isConnected).toBe(true);
    });

    test('should handle trigger fetch failure gracefully', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockRejectedValueOnce(new Error('network error'));

      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();
      expect(client.isConnected).toBe(true);
    });
  });

  describe('pruneOldContainers (tested via handshake)', () => {
    test('should prune containers not in agent response', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [{ id: 'c1' }] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([
        { id: 'c1', name: 'c1' },
        { id: 'c2', name: 'c2' },
      ]);

      await client.handshake();

      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c2');
    });

    test('should prune with watcher filter when watcher is specified', async () => {
      // This is tested through the watch method
      const reports = [{ container: { id: 'c1' } }];
      axios.post.mockResolvedValue({ data: reports });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([
        { id: 'c1', name: 'c1' },
        { id: 'c2', name: 'c2' },
      ]);

      await client.watch('docker', 'local');
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c2');
    });

    test('should use near-linear id lookups when pruning old containers', () => {
      let newIdReads = 0;
      let storeIdReads = 0;
      const newContainers = Array.from({ length: 30 }, (_, index) => {
        const container = {};
        Object.defineProperty(container, 'id', {
          enumerable: true,
          get: () => {
            newIdReads += 1;
            return `id-${index}`;
          },
        });
        return container;
      });
      const containersInStore = Array.from({ length: 30 }, (_, index) => {
        const container = { name: `container-${index}` };
        Object.defineProperty(container, 'id', {
          enumerable: true,
          get: () => {
            storeIdReads += 1;
            return `id-${index + 15}`;
          },
        });
        return container;
      });
      storeContainer.getContainers.mockReturnValue(containersInStore);

      client.pruneOldContainers(newContainers);

      expect(storeContainer.deleteContainer).toHaveBeenCalledTimes(15);
      expect(newIdReads).toBeLessThanOrEqual(80);
      expect(storeIdReads).toBeLessThanOrEqual(80);
    });
  });

  describe('scheduleReconnect', () => {
    test('should set isConnected to false and schedule reconnect', () => {
      client.isConnected = true;
      const spy = vi.spyOn(client, 'startSse').mockImplementation(() => {});
      client.scheduleReconnect(1000);
      expect(client.isConnected).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(spy).toHaveBeenCalled();
    });

    test('should not schedule duplicate reconnects', () => {
      const spy = vi.spyOn(client, 'startSse').mockImplementation(() => {});
      client.scheduleReconnect(1000);
      client.scheduleReconnect(1000); // second call should be ignored
      vi.advanceTimersByTime(1000);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    test('should emit agent-disconnect only on connected -> disconnected transition', () => {
      client.isConnected = true;
      client.scheduleReconnect(1000);
      expect(event.emitAgentDisconnected).toHaveBeenCalledWith({
        agentName: 'test-agent',
        reason: 'SSE connection lost',
      });
    });

    test('should not emit agent-disconnect when already disconnected', () => {
      client.isConnected = false;
      client.scheduleReconnect(1000);
      expect(event.emitAgentDisconnected).not.toHaveBeenCalled();
    });

    test('should log debug when agent-disconnect emission fails', async () => {
      event.emitAgentDisconnected.mockRejectedValueOnce(new Error('emit failed'));
      client.isConnected = true;

      client.scheduleReconnect(1000);
      await Promise.resolve();

      expect(event.emitAgentDisconnected).toHaveBeenCalledWith({
        agentName: 'test-agent',
        reason: 'SSE connection lost',
      });
      expect(client.log.debug).toHaveBeenCalledWith(
        'Failed to emit agent disconnected event (emit failed)',
      );
    });
  });

  describe('startSse', () => {
    test('should clear existing reconnect timer', () => {
      const spy = vi.spyOn(client, 'startSse');
      client.scheduleReconnect(5000);
      // Now startSse should clear the timer
      axios.mockResolvedValue({ data: new EventEmitter() });
      client.startSse();
      // The original scheduled call after timer should not fire a new startSse
      expect(spy).toHaveBeenCalled();
    });

    test('should establish SSE stream and handle data events', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      stream.emit('data', Buffer.from('data: {"type":"dd:ack","data":{"version":"1.0"}}\n\n'));

      await vi.waitFor(() => expect(handleSpy).toHaveBeenCalledWith('dd:ack', { version: '1.0' }));
    });

    test('should handle SSE data split across chunks', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      // Send message in two chunks
      stream.emit('data', Buffer.from('data: {"type":"dd:ac'));
      stream.emit('data', Buffer.from('k","data":{"version":"1.0"}}\n\n'));

      await vi.waitFor(() => expect(handleSpy).toHaveBeenCalledWith('dd:ack', { version: '1.0' }));
    });

    test('should process streamed container and watcher snapshot events in order', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const callOrder: string[] = [];
      let resolveFirstEvent;
      const firstEventHandled = new Promise<void>((resolve) => {
        resolveFirstEvent = resolve;
      });
      const handleSpy = vi
        .spyOn(client, 'handleEvent')
        .mockImplementationOnce(async (eventName) => {
          callOrder.push(`start:${eventName}`);
          await firstEventHandled;
          callOrder.push(`end:${eventName}`);
        })
        .mockImplementationOnce(async (eventName) => {
          callOrder.push(`run:${eventName}`);
        });

      stream.emit(
        'data',
        Buffer.from('data: {"type":"dd:container-updated","data":{"id":"c1"}}\n\n'),
      );
      await vi.waitFor(() => expect(handleSpy).toHaveBeenCalledTimes(1));

      stream.emit(
        'data',
        Buffer.from(
          'data: {"type":"dd:watcher-snapshot","data":{"watcher":{"name":"local"},"containers":[]}}\n\n',
        ),
      );
      await Promise.resolve();

      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['start:dd:container-updated']);

      resolveFirstEvent();
      await vi.waitFor(() => expect(handleSpy).toHaveBeenCalledTimes(2));

      expect(callOrder).toEqual([
        'start:dd:container-updated',
        'end:dd:container-updated',
        'run:dd:watcher-snapshot',
      ]);
      expect(handleSpy).toHaveBeenNthCalledWith(1, 'dd:container-updated', { id: 'c1' });
      expect(handleSpy).toHaveBeenNthCalledWith(2, 'dd:watcher-snapshot', {
        watcher: { name: 'local' },
        containers: [],
      });
    });

    test('should log and continue when streamed event handling fails', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });
      const unhandledRejectionSpy = vi.fn();
      const onUnhandledRejection = (error: unknown) => {
        unhandledRejectionSpy(error);
      };
      process.on('unhandledRejection', onUnhandledRejection);

      try {
        client.startSse();
        await vi.advanceTimersByTimeAsync(0);

        event.emitContainerReports.mockRejectedValueOnce(new Error('emit failed'));
        storeContainer.getContainer.mockReturnValue(undefined);
        storeContainer.insertContainer.mockImplementation((container) => ({
          ...container,
          updateAvailable: true,
        }));
        storeContainer.getContainers.mockReturnValue([]);
        const processSpy = vi.spyOn(client, 'processContainer');

        stream.emit(
          'data',
          Buffer.from(
            'data: {"type":"dd:watcher-snapshot","data":{"watcher":{"type":"docker","name":"local"},"containers":[{"id":"c1","name":"current","watcher":"local"}]}}\n\n',
          ),
        );
        stream.emit(
          'data',
          Buffer.from('data: {"type":"dd:container-updated","data":{"id":"c2","name":"next"}}\n\n'),
        );

        await vi.waitFor(() =>
          expect(client.log.error).toHaveBeenCalledWith(
            'Error handling SSE event dd:watcher-snapshot (emit failed)',
          ),
        );
        await vi.waitFor(() =>
          expect(processSpy).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'c2', name: 'next', agent: 'test-agent' }),
          ),
        );
        expect(unhandledRejectionSpy).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', onUnhandledRejection);
      }
    });

    test('should handle malformed JSON in SSE data', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      // Should not throw
      stream.emit('data', Buffer.from('data: {invalid json}\n\n'));
    });

    test('should skip SSE lines that do not start with data:', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      stream.emit('data', Buffer.from('event: test\nid: 123\n\n'));
      expect(handleSpy).not.toHaveBeenCalled();
    });

    test('should skip SSE data without type or data field', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      stream.emit('data', Buffer.from('data: {"noType":true}\n\n'));
      expect(handleSpy).not.toHaveBeenCalled();
    });

    test('should reconnect on stream error', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      const reconnectSpy = vi.spyOn(client, 'scheduleReconnect').mockImplementation(() => {});
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      stream.emit('error', new Error('connection lost'));
      expect(reconnectSpy).toHaveBeenCalledWith();
    });

    test('should reconnect on stream end', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      const reconnectSpy = vi.spyOn(client, 'scheduleReconnect').mockImplementation(() => {});
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      stream.emit('end');
      expect(reconnectSpy).toHaveBeenCalledWith();
    });

    test('should reconnect on connection failure', async () => {
      axios.mockRejectedValue(new Error('connection refused'));

      const reconnectSpy = vi.spyOn(client, 'scheduleReconnect').mockImplementation(() => {});
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      expect(reconnectSpy).toHaveBeenCalledWith();
    });

    test('should use exponential reconnect backoff and cap at 60 seconds', async () => {
      axios.mockRejectedValue(new Error('connection refused'));

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(4_000);
      await vi.advanceTimersByTimeAsync(8_000);
      await vi.advanceTimersByTimeAsync(16_000);
      await vi.advanceTimersByTimeAsync(32_000);
      await vi.advanceTimersByTimeAsync(60_000);

      const reconnectDelays = setTimeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .filter((delay): delay is number => typeof delay === 'number');

      expect(reconnectDelays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
    });
  });

  describe('handleEvent', () => {
    test('should cache runtime info and call handshake on dd:ack', async () => {
      const spy = vi.spyOn(client, 'handshake').mockResolvedValue(undefined);
      await client.handleEvent('dd:ack', {
        version: '1.0',
        os: 'linux',
        arch: 'x64',
        cpus: 8,
        memoryGb: 15.7,
        uptimeSeconds: 102,
        lastSeen: '2026-02-28T12:00:00.000Z',
      });
      expect(spy).toHaveBeenCalled();
      expect(client.info).toEqual({
        version: '1.0',
        os: 'linux',
        arch: 'x64',
        cpus: 8,
        memoryGb: 15.7,
        uptimeSeconds: 102,
        lastSeen: '2026-02-28T12:00:00.000Z',
      });
    });

    test('should preserve existing runtime info when dd:ack payload fields are invalid', async () => {
      client.info = {
        version: 'existing-version',
        os: 'existing-os',
        arch: 'existing-arch',
        cpus: 2,
        memoryGb: 4,
        uptimeSeconds: 10,
        lastSeen: '2026-02-28T12:00:00.000Z',
      };
      const spy = vi.spyOn(client, 'handshake').mockResolvedValue(undefined);

      await client.handleEvent('dd:ack', {
        version: 123,
        os: null,
        arch: {},
        cpus: 'NaN',
        memoryGb: 'NaN',
        uptimeSeconds: Infinity,
        lastSeen: '',
      });

      expect(spy).toHaveBeenCalled();
      expect(client.info.version).toBe('existing-version');
      expect(client.info.os).toBe('existing-os');
      expect(client.info.arch).toBe('existing-arch');
      expect(client.info.cpus).toBe(2);
      expect(client.info.memoryGb).toBe(4);
      expect(client.info.uptimeSeconds).toBe(10);
      expect(typeof client.info.lastSeen).toBe('string');
      expect(client.info.lastSeen).not.toBe('');
    });

    test('should log when handshake fails after dd:ack', async () => {
      const spy = vi.spyOn(client, 'handshake').mockRejectedValue(new Error('handshake failed'));

      await client.handleEvent('dd:ack', { version: '1.0' });
      await Promise.resolve();

      expect(spy).toHaveBeenCalled();
      expect(client.log.error).toHaveBeenCalledWith(
        'Handshake failed after dd:ack: handshake failed',
      );
    });

    test('should process container on dd:container-added', async () => {
      const spy = vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      const container = { id: 'c1', name: 'test' };
      await client.handleEvent('dd:container-added', container);
      expect(spy).toHaveBeenCalledWith(container);
    });

    test('should process container on dd:container-updated', async () => {
      const spy = vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      const container = { id: 'c1', name: 'test' };
      await client.handleEvent('dd:container-updated', container);
      expect(spy).toHaveBeenCalledWith(container);
    });

    test('should delete container on dd:container-removed', async () => {
      await client.handleEvent('dd:container-removed', { id: 'c1' });
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
    });

    test('should emit update-applied when agent sends dd:update-applied', async () => {
      await client.handleEvent('dd:update-applied', 'local_nginx');

      expect(event.emitContainerUpdateApplied).toHaveBeenCalledWith('local_nginx');
    });

    test('should emit update-applied payload with agent context when agent sends object payload', async () => {
      await client.handleEvent('dd:update-applied', {
        containerName: 'local_nginx',
        container: {
          id: 'c1',
          name: 'nginx',
          watcher: 'local',
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'major' },
        },
      });

      expect(event.emitContainerUpdateApplied).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        container: expect.objectContaining({
          id: 'c1',
          name: 'nginx',
          watcher: 'local',
          agent: 'test-agent',
        }),
      });
    });

    test('should ignore update-applied when data is an empty string', async () => {
      await client.handleEvent('dd:update-applied', '');

      expect(event.emitContainerUpdateApplied).not.toHaveBeenCalled();
    });

    test('should emit update-failed when agent sends dd:update-failed', async () => {
      await client.handleEvent('dd:update-failed', {
        containerName: 'local_nginx',
        error: 'compose pull failed',
      });

      expect(event.emitContainerUpdateFailed).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        error: 'compose pull failed',
      });
    });

    test('should ignore invalid update-failed payloads from agents', async () => {
      await client.handleEvent('dd:update-failed', null);
      await client.handleEvent('dd:update-failed', {
        containerName: '',
        error: 'compose pull failed',
      });
      await client.handleEvent('dd:update-failed', {
        containerName: 'local_nginx',
        error: '',
      });

      expect(event.emitContainerUpdateFailed).not.toHaveBeenCalled();
    });

    test('should emit security-alert when agent sends dd:security-alert', async () => {
      await client.handleEvent('dd:security-alert', {
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: 'blocked',
        blockingCount: 1,
      });

      expect(event.emitSecurityAlert).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: 'blocked',
        blockingCount: 1,
      });
    });

    test('should include parsed security alert summaries from agents', async () => {
      await client.handleEvent('dd:security-alert', {
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: 'blocked',
        blockingCount: 1,
        summary: {
          unknown: 0,
          low: 0,
          medium: 0,
          high: 0,
          critical: 1,
        },
      });

      expect(event.emitSecurityAlert).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: 'blocked',
        blockingCount: 1,
        summary: {
          unknown: 0,
          low: 0,
          medium: 0,
          high: 0,
          critical: 1,
        },
      });
    });

    test('should ignore invalid security-alert payloads from agents', async () => {
      await client.handleEvent('dd:security-alert', null);
      await client.handleEvent('dd:security-alert', {
        containerName: 'local_nginx',
        details: '',
      });

      expect(event.emitSecurityAlert).not.toHaveBeenCalled();
    });

    test('should omit invalid security alert summary metadata from agents', async () => {
      await client.handleEvent('dd:security-alert', {
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: '',
        summary: {
          unknown: 0,
          low: 0,
          medium: 0,
          high: 'invalid',
          critical: 1,
        },
      });

      expect(event.emitSecurityAlert).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
      });
    });

    test('should reconcile watcher snapshot by processing current containers and pruning missing ones', async () => {
      const processSpy = vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      const containersInStore = [
        { id: 'c1', name: 'current', watcher: 'local', agent: 'test-agent' },
        { id: 'c2', name: 'stale-old', watcher: 'local', agent: 'test-agent' },
        { id: 'c3', name: 'other-watcher', watcher: 'remote', agent: 'test-agent' },
      ];
      storeContainer.getContainers.mockImplementation((query = {}) =>
        containersInStore.filter(
          (container) =>
            (!query.agent || container.agent === query.agent) &&
            (!query.watcher || container.watcher === query.watcher),
        ),
      );

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1', name: 'current', watcher: 'local' }],
      });

      expect(processSpy).toHaveBeenCalledWith({ id: 'c1', name: 'current', watcher: 'local' });
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c2');
      expect(storeContainer.deleteContainer).not.toHaveBeenCalledWith('c3');
    });

    test('should emit batched container reports for watcher snapshots', async () => {
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((container) => ({
        ...container,
        updateAvailable: true,
      }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [
          { id: 'c1', name: 'current', watcher: 'local' },
          { id: 'c2', name: 'next', watcher: 'local' },
        ],
      });

      expect(event.emitContainerReports).toHaveBeenCalledWith([
        expect.objectContaining({
          changed: true,
          container: expect.objectContaining({ id: 'c1', agent: 'test-agent' }),
        }),
        expect.objectContaining({
          changed: true,
          container: expect.objectContaining({ id: 'c2', agent: 'test-agent' }),
        }),
      ]);
    });

    test('should prune all containers for a watcher when a watcher snapshot is empty', async () => {
      const containersInStore = [
        { id: 'c1', name: 'stale-1', watcher: 'local', agent: 'test-agent' },
        { id: 'c2', name: 'stale-2', watcher: 'local', agent: 'test-agent' },
        { id: 'c3', name: 'other-watcher', watcher: 'remote', agent: 'test-agent' },
      ];
      storeContainer.getContainers.mockImplementation((query = {}) =>
        containersInStore.filter(
          (container) =>
            (!query.agent || container.agent === query.agent) &&
            (!query.watcher || container.watcher === query.watcher),
        ),
      );

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [],
      });

      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c2');
      expect(storeContainer.deleteContainer).not.toHaveBeenCalledWith('c3');
    });

    test('should ignore invalid watcher snapshot payloads without pruning', async () => {
      const processSpy = vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 42 },
        containers: { id: 'c1' },
      });

      expect(processSpy).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
      expect(storeContainer.getContainers).not.toHaveBeenCalled();
    });

    test('should ignore unknown event types', async () => {
      const processSpy = vi.spyOn(client, 'processContainer');
      await client.handleEvent('dd:unknown', {});
      expect(processSpy).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
    });
  });

  describe('runRemoteTrigger', () => {
    test('should post to remote trigger endpoint', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = { id: 'c1' };
      await client.runRemoteTrigger(container, 'docker', 'update');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/triggers/docker/update'),
        container,
        expect.any(Object),
      );
    });

    test('should throw on failure', async () => {
      axios.post.mockRejectedValue(new Error('trigger failed'));
      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toThrow(
        'trigger failed',
      );
    });

    test('should stringify non-object remote trigger failures', async () => {
      axios.post.mockRejectedValue('trigger failed as string');

      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toThrow(
        'trigger failed as string',
      );
    });

    test('should fall back to generic error message when remote payload is not an object', async () => {
      axios.post.mockRejectedValue({
        message: 'Request failed with status code 500',
        response: {
          status: 500,
          data: 'unexpected response shape',
        },
      });

      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toThrow(
        'Request failed with status code 500',
      );
    });

    test('should fall back to transport error message when remote payload has no error field', async () => {
      axios.post.mockRejectedValue({
        message: 'Request failed with status code 500',
        response: {
          status: 500,
          data: {
            details: {
              reason: 'No watcher found',
            },
          },
        },
      });

      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toThrow(
        'Request failed with status code 500',
      );
    });

    test('should rethrow original error preserving response for proxy forwarding', async () => {
      const axiosError = {
        message: 'Request failed with status code 500',
        response: {
          status: 500,
          data: {
            error: 'Error when running trigger docker.update',
            details: {
              reason: 'No watcher found for container c1 (docker.default)',
            },
          },
        },
      };
      axios.post.mockRejectedValue(axiosError);

      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toBe(
        axiosError,
      );
      // Original error is rethrown with response intact for proxy forwarding
      expect(axiosError.response.status).toBe(500);
      expect(axiosError.response.data.details.reason).toBe(
        'No watcher found for container c1 (docker.default)',
      );
    });

    test('should rethrow original error when details lack reason field', async () => {
      const axiosError = {
        message: 'Request failed with status code 500',
        response: {
          status: 500,
          data: {
            error: 'Error when running trigger docker.update',
            details: { info: 'missing reason field' },
          },
        },
      };
      axios.post.mockRejectedValue(axiosError);

      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toBe(
        axiosError,
      );
    });

    test('should encode path segments to prevent SSRF', async () => {
      axios.post.mockResolvedValue({ data: {} });
      await client.runRemoteTrigger({ id: 'c1' }, '../admin', '../../etc/passwd');
      const url = axios.post.mock.calls[0][0];
      expect(url).not.toContain('/../');
      expect(url).toContain(encodeURIComponent('../admin'));
      expect(url).toContain(encodeURIComponent('../../etc/passwd'));
    });
  });

  describe('runRemoteTriggerBatch', () => {
    test('should post to remote batch trigger endpoint', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const containers = [{ id: 'c1' }, { id: 'c2' }];
      await client.runRemoteTriggerBatch(containers, 'docker', 'update');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/triggers/docker/update/batch'),
        containers,
        expect.any(Object),
      );
    });

    test('should not preserve stale updateAvailable after non-update batch triggers', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const existing = {
        id: 'c1',
        updateAvailable: false,
        resultChanged: vi.fn().mockReturnValue(true),
      };
      storeContainer.getContainer.mockReturnValue(existing);
      storeContainer.updateContainer.mockReturnValue({
        id: 'c1',
        updateAvailable: true,
      });

      await client.runRemoteTriggerBatch([{ id: 'c1' }], 'mock', 'notify');
      await client.handleEvent('dd:container-updated', {
        id: 'c1',
        name: 'test',
        updateAvailable: true,
      });

      expect(storeContainer.updateContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'c1',
          name: 'test',
          agent: 'test-agent',
          updateAvailable: true,
        }),
      );
    });

    test('should throw on failure', async () => {
      axios.post.mockRejectedValue(new Error('batch failed'));
      await expect(client.runRemoteTriggerBatch([], 'docker', 'update')).rejects.toThrow(
        'batch failed',
      );
    });
  });

  describe('deleteContainer', () => {
    test('should delete container on agent', async () => {
      axios.delete.mockResolvedValue({ data: {} });
      await client.deleteContainer('c1');
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining('/api/containers/c1'),
        expect.any(Object),
      );
    });

    test('should throw on failure', async () => {
      axios.delete.mockRejectedValue(new Error('delete failed'));
      await expect(client.deleteContainer('c1')).rejects.toThrow('delete failed');
    });

    test('should encode containerId to prevent SSRF', async () => {
      axios.delete.mockResolvedValue({ data: {} });
      await client.deleteContainer('../../etc/passwd');
      const url = axios.delete.mock.calls[0][0];
      expect(url).not.toContain('/../');
      expect(url).toContain(encodeURIComponent('../../etc/passwd'));
    });
  });

  describe('watch', () => {
    test('should post to watcher endpoint and process reports', async () => {
      const reports = [{ container: { id: 'c1' } }, { container: { id: 'c2' } }];
      axios.post.mockResolvedValue({ data: reports });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([]);

      const result = await client.watch('docker', 'local');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/watchers/docker/local'),
        {},
        expect.any(Object),
      );
      expect(result).toBe(reports);
    });

    test('should throw on failure', async () => {
      axios.post.mockRejectedValue(new Error('watch failed'));
      await expect(client.watch('docker', 'local')).rejects.toThrow('watch failed');
    });
  });

  describe('getWatcher', () => {
    test('should fetch watcher detail from the agent', async () => {
      axios.get.mockResolvedValue({
        data: {
          id: 'docker.local',
          type: 'docker',
          name: 'local',
          configuration: { cron: '0 * * * *' },
          metadata: { nextRunAt: '2026-04-09T13:00:00.000Z' },
        },
      });

      const result = await client.getWatcher('docker', 'local');

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/watchers/docker/local'),
        expect.any(Object),
      );
      expect(result).toEqual({
        id: 'docker.local',
        type: 'docker',
        name: 'local',
        configuration: { cron: '0 * * * *' },
        metadata: { nextRunAt: '2026-04-09T13:00:00.000Z' },
      });
    });

    test('should throw when fetching watcher detail fails', async () => {
      axios.get.mockRejectedValue(new Error('watcher fetch failed'));

      await expect(client.getWatcher('docker', 'local')).rejects.toThrow('watcher fetch failed');
    });
  });

  describe('watchContainer', () => {
    test('should post to watcher container endpoint and process report', async () => {
      const report = { container: { id: 'c1' } };
      axios.post.mockResolvedValue({ data: report });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));

      const container = { id: 'c1', name: 'test' };
      const result = await client.watchContainer('docker', 'local', container);
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/watchers/docker/local/container/c1'),
        {},
        expect.any(Object),
      );
      expect(result).toBe(report);
    });

    test('should throw on failure', async () => {
      axios.post.mockRejectedValue(new Error('watch failed'));
      await expect(
        client.watchContainer('docker', 'local', { id: 'c1', name: 'test' }),
      ).rejects.toThrow('watch failed');
    });
  });

  describe('getLogEntries', () => {
    test('should fetch log entries with all params', async () => {
      axios.get.mockResolvedValue({ data: [{ msg: 'test' }] });
      const result = await client.getLogEntries({
        level: 'error',
        component: 'docker',
        tail: 100,
        since: 12345,
      });
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining(
          '/api/log/entries?level=error&component=docker&tail=100&since=12345',
        ),
        expect.any(Object),
      );
      expect(result).toEqual([{ msg: 'test' }]);
    });

    test('should fetch log entries with no params', async () => {
      axios.get.mockResolvedValue({ data: [] });
      const result = await client.getLogEntries();
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/log\/entries$/),
        expect.any(Object),
      );
      expect(result).toEqual([]);
    });

    test('should throw on failure', async () => {
      axios.get.mockRejectedValue(new Error('log fetch failed'));
      await expect(client.getLogEntries()).rejects.toThrow('log fetch failed');
    });
  });

  describe('getContainerLogs', () => {
    test('should fetch container logs with correct params', async () => {
      axios.get.mockResolvedValue({ data: { logs: 'hello world' } });
      const result = await client.getContainerLogs('c1', { tail: 100, since: 0, timestamps: true });
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/containers/c1/logs?tail=100&since=0&timestamps=true'),
        expect.any(Object),
      );
      expect(result).toEqual({ logs: 'hello world' });
    });

    test('should throw on failure', async () => {
      axios.get.mockRejectedValue(new Error('logs failed'));
      await expect(
        client.getContainerLogs('c1', { tail: 100, since: 0, timestamps: true }),
      ).rejects.toThrow('logs failed');
    });

    test('should encode containerId to prevent path traversal', async () => {
      axios.get.mockResolvedValue({ data: { logs: '' } });
      await client.getContainerLogs('../../etc/passwd', { tail: 100, since: 0, timestamps: true });
      const url = axios.get.mock.calls[0][0];
      expect(url).toContain(encodeURIComponent('../../etc/passwd'));
    });
  });
});
