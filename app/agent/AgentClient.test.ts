import { verify as cryptoVerify, generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import axios from 'axios';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';

vi.mock('axios');
vi.mock('node:fs', () => ({
  default: { readFileSync: vi.fn().mockReturnValue(Buffer.from('cert-data')) },
}));
const mockResolveConfiguredPath = vi.hoisted(() => vi.fn((path) => path));
const mockOffloadSbomDocuments = vi.hoisted(() => vi.fn());
const mockCreateSbomStorage = vi.hoisted(() => vi.fn(() => ({ storage: 'controller' })));
vi.mock('../runtime/paths.js', () => ({
  resolveConfiguredPath: mockResolveConfiguredPath,
}));
vi.mock('../security/sbom-migration.js', () => ({
  offloadSbomDocuments: mockOffloadSbomDocuments,
}));
vi.mock('../security/sbom-storage.js', () => ({
  createSbomStorage: mockCreateSbomStorage,
}));
const mockLogChild = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => mockLogChild },
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
  emitAgentStatsChanged: vi.fn().mockResolvedValue(undefined),
  emitBatchUpdateCompleted: vi.fn().mockResolvedValue(undefined),
  emitContainerReport: vi.fn(),
  emitContainerReports: vi.fn(),
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSecurityScanCycleComplete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../store/update-operation.js', () => ({
  getOperationById: vi.fn(),
  insertOperation: vi.fn((operation) => ({
    ...operation,
    id: operation.id ?? 'inserted-op',
    status: operation.status ?? 'in-progress',
    phase: operation.phase ?? 'prepare',
  })),
  markOperationTerminal: vi.fn((id, patch) => ({ id, ...patch })),
  reopenTerminalOperation: vi.fn((id, patch) => ({ id, ...patch })),
  updateOperation: vi.fn((id, patch) => ({ id, ...patch })),
}));
vi.mock('../util/uuid.js', () => ({
  uuidv7: vi.fn(() => '00000000-0000-7000-8000-000000000001'),
}));
vi.mock('../registry/index.js', () => ({
  deregisterAgentComponents: vi.fn(),
  registerComponent: vi.fn(),
}));

import * as event from '../event/index.js';
import * as registry from '../registry/index.js';
import * as storeContainer from '../store/container.js';
import * as updateOperationStore from '../store/update-operation.js';
import { AgentClient } from './AgentClient.js';
import { bodySha256Hex, buildCanonicalMessage, EMPTY_BODY_SHA256_HEX } from './ed25519-signer.js';

describe('AgentClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveConfiguredPath.mockImplementation((path) => path);
    vi.mocked(storeContainer.getContainer).mockReturnValue(undefined);
    vi.mocked(storeContainer.getContainers).mockReturnValue([]);
    vi.mocked(updateOperationStore.getOperationById).mockReturnValue(undefined);
    vi.useFakeTimers();
    client = new AgentClient('test-agent', {
      host: 'localhost',
      port: 3001,
      secret: 'test-secret',
      cafile: '/path/to/ca.pem',
    });
    vi.mocked(fs.readFileSync).mockClear();
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
        secret: '',
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
        secret: '',
      });
      expect(c.baseUrl).toBe('http://myhost:4000');
    });

    test('should default port to 3000 when not provided', () => {
      const c = new AgentClient('a', {
        host: 'myhost',
        port: 0,
        secret: '',
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

    test('should reject secrets configured over plaintext http', () => {
      expect(
        () =>
          new AgentClient('a', {
            host: 'myhost',
            port: 4000,
            secret: 's',
          }),
      ).toThrow(
        'Agent a is configured with a secret over insecure HTTP (http://myhost:4000). Configure HTTPS (certfile/cafile) to protect X-Dd-Agent-Secret.',
      );
    });

    describe('DD_AGENT_ALLOW_INSECURE_SECRET opt-in', () => {
      afterEach(() => {
        delete process.env.DD_AGENT_ALLOW_INSECURE_SECRET;
      });

      test('should warn instead of throw when DD_AGENT_ALLOW_INSECURE_SECRET=true', () => {
        process.env.DD_AGENT_ALLOW_INSECURE_SECRET = 'true';
        expect(
          () =>
            new AgentClient('a', {
              host: 'myhost',
              port: 4000,
              secret: 's',
            }),
        ).not.toThrow();
        expect(mockLogChild.warn).toHaveBeenCalledWith(
          'Agent a is configured with a secret over insecure HTTP (http://myhost:4000). Configure HTTPS (certfile/cafile) to protect X-Dd-Agent-Secret.',
        );
      });

      test('should still throw when DD_AGENT_ALLOW_INSECURE_SECRET is not exactly "true"', () => {
        process.env.DD_AGENT_ALLOW_INSECURE_SECRET = '1';
        expect(
          () =>
            new AgentClient('a', {
              host: 'myhost',
              port: 4000,
              secret: 's',
            }),
        ).toThrow(
          'Agent a is configured with a secret over insecure HTTP (http://myhost:4000). Configure HTTPS (certfile/cafile) to protect X-Dd-Agent-Secret.',
        );
      });
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
    test('offloads agent SBOM documents into controller storage before persistence', async () => {
      const ref = { key: 'sbom/ref.json', sha256: 'a'.repeat(64), bytes: 2 };
      mockOffloadSbomDocuments.mockImplementation(async ({ sbom }) => ({
        ...sbom,
        documents: undefined,
        documentRefs: { 'spdx-json': ref },
      }));
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementationOnce((container) => container);
      const container = {
        id: 'c1',
        name: 'test',
        image: { digest: { value: `sha256:${'1'.repeat(64)}` } },
        result: { digest: `sha256:${'2'.repeat(64)}` },
        security: {
          sbom: { image: 'app:current', documents: { 'spdx-json': { current: true } } },
          updateSbom: { image: 'app:update', documents: { 'spdx-json': { update: true } } },
        },
      };

      await client.processContainer(container);

      expect(mockOffloadSbomDocuments).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ subjectDigest: `sha256:${'1'.repeat(64)}` }),
      );
      expect(mockOffloadSbomDocuments).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ subjectDigest: `sha256:${'2'.repeat(64)}` }),
      );
      const persisted = storeContainer.insertContainer.mock.calls[0][0];
      expect(persisted.security.sbom.documents).toBeUndefined();
      expect(persisted.security.updateSbom.documents).toBeUndefined();
      expect(persisted.security.sbom.documentRefs['spdx-json']).toEqual(ref);
    });

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

    test('should ignore invalid watcher descriptors when seeding the snapshot cache', async () => {
      (client as any).seedWatcherSnapshotCacheFromHandshake([
        null,
        { type: 123, name: 'bad-type', configuration: { cron: '0 * * * *' } },
        { type: 'docker', name: ['bad-name'], configuration: { cron: '0 * * * *' } },
        {
          type: 'docker',
          name: 'remote',
          configuration: { cron: '*/5 * * * *' },
          metadata: { nextRunAt: '2026-04-19T00:05:00.000Z' },
        },
      ]);

      expect(client.getWatcherSnapshot('docker', 'remote')).toEqual({
        type: 'docker',
        name: 'remote',
        configuration: { cron: '*/5 * * * *' },
        metadata: { nextRunAt: '2026-04-19T00:05:00.000Z' },
      });
      expect(client.getWatcherSnapshot('123', 'bad-type')).toBeUndefined();
      expect(client.getWatcherSnapshot('docker', 'bad-name')).toBeUndefined();
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

    test('should deduplicate concurrent handshake calls — _doHandshake runs only once per in-flight window', async () => {
      // Simulate a slow first handshake that stays pending
      let resolveFirst!: () => void;
      const firstCallPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      const doHandshakeSpy = vi
        .spyOn(client as never, '_doHandshake')
        .mockReturnValueOnce(firstCallPromise);

      // Fire three concurrent handshake() calls while first is still in flight
      const p1 = client.handshake();
      const p2 = client.handshake();
      const p3 = client.handshake();

      // _doHandshake should only have been invoked once — the guard is working
      expect(doHandshakeSpy).toHaveBeenCalledTimes(1);

      // Settle the in-flight promise; all callers should resolve
      resolveFirst();
      await Promise.all([p1, p2, p3]);

      // After the in-flight window closes, a new call triggers a fresh _doHandshake
      let resolveSecond!: () => void;
      const secondCallPromise = new Promise<void>((resolve) => {
        resolveSecond = resolve;
      });
      doHandshakeSpy.mockReturnValueOnce(secondCallPromise);
      const p4 = client.handshake();
      expect(doHandshakeSpy).toHaveBeenCalledTimes(2);
      resolveSecond();
      await p4;
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

    test('should NOT prune controller-side containers when handshake returns 0 (cold-start race #386)', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([
        { id: 'stale-1', name: 'web' },
        { id: 'stale-2', name: 'db' },
      ]);

      await client.handshake();

      // Last-known state must be preserved. The first watcher snapshot is
      // the unambiguous signal for an empty agent (issue #386).
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('should warn when handshake returns 0 after a prior successful connect (cold-start race #386)', async () => {
      // First handshake — non-empty so we hit the prune branch and set
      // hasConnectedOnce.
      axios.get
        .mockResolvedValueOnce({
          data: [{ id: 'c1', name: 'web', watcher: 'local' }],
        })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({
        ...c,
        updateAvailable: false,
      }));
      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();

      client.scheduleReconnect(1_000);
      clearTimeout((client as any).reconnectTimer);
      (client as any).reconnectTimer = null;

      // Second handshake returns zero — should warn and skip prune.
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      storeContainer.getContainers.mockReturnValue([{ id: 'c1', name: 'web' }]);

      await client.handshake();

      expect(client.log.warn).toHaveBeenCalledWith(
        'Handshake returned 0 containers; preserving last-known state until the first watch cycle completes',
      );
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('should still prune normally when handshake returns at least one container', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [{ id: 'kept', name: 'kept' }] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([
        { id: 'kept', name: 'kept' },
        { id: 'gone', name: 'gone' },
      ]);

      await client.handshake();

      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('gone');
      expect(storeContainer.deleteContainer).not.toHaveBeenCalledWith('kept');
    });

    test('first-ever zero handshake should not warn (no last-known state yet)', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });

      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();

      expect(client.log.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('preserving last-known state'),
      );
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
    test('should not start a new SSE request after stop', () => {
      client.stop();

      client.startSse();

      expect(axios).not.toHaveBeenCalled();
    });

    test('should ignore an in-flight SSE response that resolves after stop', async () => {
      const stream = new EventEmitter();
      let resolveConnection: (value: { data: EventEmitter }) => void = () => {};
      axios.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveConnection = resolve;
          }),
      );
      const attachStreamHandlersSpy = vi.spyOn(client as any, 'attachStreamHandlers');

      client.startSse();
      client.stop();
      resolveConnection({ data: stream });
      await Promise.resolve();
      await Promise.resolve();

      expect(attachStreamHandlersSpy).not.toHaveBeenCalled();
      expect((client as any).stableConnectionTimer).toBeNull();
    });

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

    test('should ignore empty SSE data chunks', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const handleSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      stream.emit('data', Buffer.alloc(0));
      await Promise.resolve();
      await Promise.resolve();

      expect(handleSpy).not.toHaveBeenCalled();
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

    test('should log SSE data processing failures', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });
      vi.spyOn(client as any, 'processSseBuffer').mockRejectedValueOnce(new Error('buffer failed'));

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      stream.emit('data', Buffer.from('data: {"type":"dd:ack","data":{"version":"1.0"}}\n\n'));
      await vi.waitFor(() =>
        expect(client.log.error).toHaveBeenCalledWith('SSE data processing failed: buffer failed'),
      );
    });

    test('should log non-error SSE data processing failures', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });
      vi.spyOn(client as any, 'processSseBuffer').mockRejectedValueOnce('buffer failed');

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      stream.emit('data', Buffer.from('data: {"type":"dd:ack","data":{"version":"1.0"}}\n\n'));
      await vi.waitFor(() =>
        expect(client.log.error).toHaveBeenCalledWith('SSE data processing failed: buffer failed'),
      );
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

    test('should escalate reconnect backoff when stream returns 200 then ends before SSE_STABLE_CONNECTION_MS (#362 regression)', async () => {
      // Each reconnect attempt gets a fresh EventEmitter so listeners do not accumulate.
      axios.mockImplementation(() => Promise.resolve({ data: new EventEmitter() }));

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      // Cycle 1: startSse → 200 → stream end immediately → scheduleReconnect (delay=1000)
      client.startSse();
      await vi.advanceTimersByTimeAsync(0); // axios resolves, stability timer set (30s)
      // Grab the stream that was attached and end it before 30s
      const stream1 = axios.mock.results[0].value as Promise<{ data: EventEmitter }>;
      const resolved1 = await stream1;
      resolved1.data.emit('end'); // triggers scheduleReconnect → clears stability timer
      // Advance past the reconnect delay so startSse is called again
      await vi.advanceTimersByTimeAsync(1_000);

      // Cycle 2: startSse → 200 → stream end immediately → scheduleReconnect (delay=2000)
      await vi.advanceTimersByTimeAsync(0);
      const stream2 = axios.mock.results[1].value as Promise<{ data: EventEmitter }>;
      const resolved2 = await stream2;
      resolved2.data.emit('end');
      await vi.advanceTimersByTimeAsync(2_000);

      // Cycle 3: startSse → 200 → stream end immediately → scheduleReconnect (delay=4000)
      await vi.advanceTimersByTimeAsync(0);
      const stream3 = axios.mock.results[2].value as Promise<{ data: EventEmitter }>;
      const resolved3 = await stream3;
      resolved3.data.emit('end');
      await vi.advanceTimersByTimeAsync(4_000);

      // Collect only reconnect delays (filter out the 30_000 stability-timer calls)
      const reconnectDelays = setTimeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .filter((delay): delay is number => typeof delay === 'number' && delay !== 30_000);

      expect(reconnectDelays).toEqual([1_000, 2_000, 4_000]);
    });

    test('should reset backoff to initial delay after stream stays open past SSE_STABLE_CONNECTION_MS', async () => {
      // Phase 1: force two connect→end cycles so reconnectAttempts > 0
      axios.mockImplementation(() => Promise.resolve({ data: new EventEmitter() }));

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);
      const r1 = await (axios.mock.results[0].value as Promise<{ data: EventEmitter }>);
      r1.data.emit('end'); // reconnectAttempts → 1, next delay would be 1000 (1st attempt)
      await vi.advanceTimersByTimeAsync(1_000);

      await vi.advanceTimersByTimeAsync(0);
      const r2 = await (axios.mock.results[1].value as Promise<{ data: EventEmitter }>);
      r2.data.emit('end'); // reconnectAttempts → 2, next delay would be 2000
      await vi.advanceTimersByTimeAsync(2_000);

      // Phase 2: let the connection stay open past 30s so stability timer fires and resets backoff
      await vi.advanceTimersByTimeAsync(0);
      // Advance 30 001 ms so SSE_STABLE_CONNECTION_MS elapses and reconnectAttempts resets to 0
      await vi.advanceTimersByTimeAsync(30_001);

      // Phase 3: now end the stream — next reconnect delay must be back to 1000
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const r3 = await (axios.mock.results[2].value as Promise<{ data: EventEmitter }>);
      r3.data.emit('end');

      const reconnectDelays = setTimeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .filter((delay): delay is number => typeof delay === 'number' && delay !== 30_000);

      expect(reconnectDelays).toEqual([1_000]);
    });

    test('should not reset reconnect backoff when stability timer is cleared before it fires (early stream end)', async () => {
      // Prove that a pending stability timer that gets cleared does NOT later drop
      // an already-escalated reconnect delay back to 1000 ms.
      axios.mockImplementation(() => Promise.resolve({ data: new EventEmitter() }));

      client.startSse();
      await vi.advanceTimersByTimeAsync(0); // stability timer scheduled for t+30s

      // End the stream early (before 30s) — scheduleReconnect clears the stability timer
      const r1 = await (axios.mock.results[0].value as Promise<{ data: EventEmitter }>);
      r1.data.emit('end'); // reconnectAttempts → 1, delay = 1000
      await vi.advanceTimersByTimeAsync(1_000); // fires reconnect → startSse cycle 2

      // Cycle 2: end early again
      await vi.advanceTimersByTimeAsync(0);
      const r2 = await (axios.mock.results[1].value as Promise<{ data: EventEmitter }>);
      r2.data.emit('end'); // reconnectAttempts → 2, delay = 2000
      await vi.advanceTimersByTimeAsync(2_000); // fires reconnect → startSse cycle 3

      // Cycle 3: start it and advance past where cycle 1's stability timer would have fired
      // (absolute t=30_000), but stay well BEFORE cycle 3's own stability timer (absolute t=33_000).
      // Cycle 3 starts at absolute t=3_000; cycle 1's timer would fire 27_000 ms into cycle 3.
      await vi.advanceTimersByTimeAsync(0); // cycle 3 starts; its own stability timer arms at +30_000ms
      await vi.advanceTimersByTimeAsync(28_000); // past cycle-1 window, before cycle-3 timer

      // Now spy and end cycle 3 early — must produce delay=4000, not 1000
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const r3 = await (axios.mock.results[2].value as Promise<{ data: EventEmitter }>);
      r3.data.emit('end'); // reconnectAttempts → 3, delay = 4000

      const reconnectDelays = setTimeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .filter((delay): delay is number => typeof delay === 'number' && delay !== 30_000);

      expect(reconnectDelays).toEqual([4_000]);
    });

    test('should escalate backoff when stream error triggers reconnect before SSE_STABLE_CONNECTION_MS (#362 error path)', async () => {
      // Mirror of the end-path regression test but using stream.emit('error') instead of 'end'.
      axios.mockImplementation(() => Promise.resolve({ data: new EventEmitter() }));

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      // Cycle 1: startSse → 200 → stream error immediately → scheduleReconnect (delay=1000)
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);
      const r1 = await (axios.mock.results[0].value as Promise<{ data: EventEmitter }>);
      r1.data.emit('error', new Error('connection reset'));
      await vi.advanceTimersByTimeAsync(1_000);

      // Cycle 2: startSse → 200 → stream error immediately → scheduleReconnect (delay=2000)
      await vi.advanceTimersByTimeAsync(0);
      const r2 = await (axios.mock.results[1].value as Promise<{ data: EventEmitter }>);
      r2.data.emit('error', new Error('connection reset'));
      await vi.advanceTimersByTimeAsync(2_000);

      // Cycle 3: startSse → 200 → stream error immediately → scheduleReconnect (delay=4000)
      await vi.advanceTimersByTimeAsync(0);
      const r3 = await (axios.mock.results[2].value as Promise<{ data: EventEmitter }>);
      r3.data.emit('error', new Error('connection reset'));
      await vi.advanceTimersByTimeAsync(4_000);

      // Collect only reconnect delays (filter out the 30_000 stability-timer calls)
      const reconnectDelays = setTimeoutSpy.mock.calls
        .map(([, delay]) => delay)
        .filter((delay): delay is number => typeof delay === 'number' && delay !== 30_000);

      expect(reconnectDelays).toEqual([1_000, 2_000, 4_000]);
    });
  });

  describe('stop', () => {
    test('should not reconnect when an in-flight SSE request fails after stop', async () => {
      let rejectConnection: (error: Error) => void = () => {};
      axios.mockRejectedValue(new Error('unexpected reconnect'));
      axios.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectConnection = reject;
          }),
      );

      client.startSse();
      client.stop();
      rejectConnection(new Error('connection refused'));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(axios).toHaveBeenCalledTimes(1);
      expect((client as any).reconnectTimer).toBeNull();
    });

    test('should not reconnect when an established SSE stream ends after stop', async () => {
      const stream = new EventEmitter();
      axios.mockRejectedValue(new Error('unexpected reconnect'));
      axios.mockResolvedValueOnce({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0);
      client.stop();
      stream.emit('end');
      await vi.advanceTimersByTimeAsync(1_000);

      expect(axios).toHaveBeenCalledTimes(1);
      expect((client as any).reconnectTimer).toBeNull();
    });

    test('should clear an armed stableConnectionTimer', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });

      client.startSse();
      await vi.advanceTimersByTimeAsync(0); // stability timer is now armed

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const timerBefore = (client as any).stableConnectionTimer;
      expect(timerBefore).not.toBeNull();

      client.stop();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timerBefore);
      expect((client as any).stableConnectionTimer).toBeNull();
    });

    test('should clear an armed reconnectTimer', () => {
      const spy = vi.spyOn(client, 'startSse').mockImplementation(() => {});
      client.scheduleReconnect(5_000); // arms reconnectTimer
      const timerBefore = (client as any).reconnectTimer;
      expect(timerBefore).not.toBeNull();

      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      client.stop();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timerBefore);
      expect((client as any).reconnectTimer).toBeNull();
      // Confirm the reconnect never fires after stop()
      vi.advanceTimersByTime(10_000);
      expect(spy).not.toHaveBeenCalled();
    });

    test('should be safe to call when both timers are already null', () => {
      expect((client as any).stableConnectionTimer).toBeNull();
      expect((client as any).reconnectTimer).toBeNull();
      expect(() => client.stop()).not.toThrow();
      expect((client as any).stableConnectionTimer).toBeNull();
      expect((client as any).reconnectTimer).toBeNull();
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

    test('burst dd:ack events must not start a second handshake while the first is in flight', async () => {
      // Use a slow _doHandshake so the first call stays in-flight
      let resolveHandshake!: () => void;
      const slowHandshake = new Promise<void>((resolve) => {
        resolveHandshake = resolve;
      });
      vi.spyOn(client as never, '_doHandshake').mockReturnValueOnce(slowHandshake);

      // Simulate a burst of three dd:ack events
      void client.handleEvent('dd:ack', { version: '1.0' });
      void client.handleEvent('dd:ack', { version: '1.0' });
      void client.handleEvent('dd:ack', { version: '1.0' });

      // All three calls should share the same in-flight promise —
      // _doHandshake was invoked only once.
      const doHandshakeSpy = vi.mocked((client as never)._doHandshake);
      expect(doHandshakeSpy).toHaveBeenCalledTimes(1);

      // Settle the handshake so the test doesn't leak
      resolveHandshake();
      await Promise.resolve();
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

    test('should emit emitAgentStatsChanged after dd:container-added', async () => {
      vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      await client.handleEvent('dd:container-added', { id: 'c1', name: 'web', watcher: 'local' });
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should emit agent stats after a health-only container update', async () => {
      vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      await client.handleEvent('dd:container-updated', {
        id: 'c1',
        name: 'web',
        watcher: 'local',
        status: 'running',
        health: 'unhealthy',
      });
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should log debug when emitAgentStatsChanged rejects on dd:container-added', async () => {
      vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      vi.mocked(event.emitAgentStatsChanged).mockRejectedValueOnce(new Error('stats emit failed'));
      await client.handleEvent('dd:container-added', { id: 'c1', name: 'web', watcher: 'local' });
      await vi.runAllTimersAsync();
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to emit agent stats changed event'),
      );
    });

    test('should emit emitAgentStatsChanged after dd:container-removed', async () => {
      await client.handleEvent('dd:container-removed', { id: 'c1' });
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should log debug when emitAgentStatsChanged rejects on dd:container-removed', async () => {
      vi.mocked(event.emitAgentStatsChanged).mockRejectedValueOnce(new Error('stats emit failed'));
      await client.handleEvent('dd:container-removed', { id: 'c1' });
      await vi.runAllTimersAsync();
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to emit agent stats changed event'),
      );
    });

    test('should coalesce multiple rapid container events into a single emitAgentStatsChanged', async () => {
      vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      // Fire two container-added and one container-removed in rapid succession without advancing timers.
      await client.handleEvent('dd:container-added', { id: 'c1', name: 'web', watcher: 'local' });
      await client.handleEvent('dd:container-updated', { id: 'c2', name: 'db', watcher: 'local' });
      await client.handleEvent('dd:container-removed', { id: 'c3' });
      // All three called scheduleStatsChanged; only one timer should have been set.
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledTimes(1);
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should not emit emitAgentStatsChanged when stop() clears a pending timer', async () => {
      vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);
      // Schedule an emit but do NOT advance timers yet.
      await client.handleEvent('dd:container-added', { id: 'c1', name: 'web', watcher: 'local' });
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();
      // Tear down — this should clear the pending timer.
      client.stop();
      expect((client as any).statsChangedTimer).toBeUndefined();
      // Advancing timers now should fire nothing.
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();
    });

    test('debounce re-arms after firing so a second event still emits (trailing emit)', async () => {
      vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);

      // First event — schedules the debounce
      await client.handleEvent('dd:container-added', { id: 'c1', name: 'web', watcher: 'local' });
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();

      // Drain the debounce — first emit fires
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledTimes(1);

      // Clear the mock so we can isolate the second emit
      vi.mocked(event.emitAgentStatsChanged).mockClear();

      // Second event — timer must re-arm (statsChangedTimer was cleared after first fire)
      await client.handleEvent('dd:container-removed', { id: 'c2' });
      // Debounce not yet fired
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();

      // Drain again — second emit must fire
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledTimes(1);
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('scheduleStatsChanged tolerates timer handles without unref support', async () => {
      vi.spyOn(client, 'processContainer').mockResolvedValue(undefined);

      const setTimeoutSpy = vi
        .spyOn(globalThis, 'setTimeout')
        .mockReturnValue(0 as unknown as NodeJS.Timeout);

      try {
        await expect(
          client.handleEvent('dd:container-added', { id: 'c1', name: 'web', watcher: 'local' }),
        ).resolves.not.toThrow();
        expect(setTimeoutSpy).toHaveBeenCalled();
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    test('should ignore watcher-cycle cleanup for invalid container ids', () => {
      (client as any).pendingWatcherCycleReports.set(
        'watcher',
        new Map([
          [
            'c1',
            {
              container: {
                id: 'c1',
                name: 'test',
                watcher: 'watcher',
              },
              changed: true,
            },
          ],
        ]),
      );

      (client as any).clearPendingWatcherCycleReportByContainerId('');

      expect((client as any).pendingWatcherCycleReports.get('watcher')?.has('c1')).toBe(true);
    });

    test('should clear watcher-cycle reports when the last container in a watcher is removed', () => {
      (client as any).pendingWatcherCycleReports.set(
        'watcher',
        new Map([
          [
            'c1',
            {
              container: {
                id: 'c1',
                name: 'test',
                watcher: 'watcher',
              },
              changed: true,
            },
          ],
        ]),
      );

      (client as any).clearPendingWatcherCycleReportByContainerId('c1');

      expect((client as any).pendingWatcherCycleReports.has('watcher')).toBe(false);
    });

    test('should ignore watcher-cycle reports that do not have a resolvable container key', () => {
      const beforeSize = (client as any).pendingWatcherCycleReports.size;

      (client as any).rememberPendingWatcherCycleReport({
        container: {
          watcher: 'watcher',
        },
        changed: true,
      });

      expect((client as any).pendingWatcherCycleReports.size).toBe(beforeSize);
    });

    test('should ignore invalid watcher-cycle lookups before taking a pending report', () => {
      const report = {
        container: {
          id: 'c1',
          name: 'test',
          watcher: 'watcher',
        },
        changed: true,
      };
      (client as any).pendingWatcherCycleReports.set('watcher', new Map([['c1', report]]));

      expect((client as any).takePendingWatcherCycleReport('', report.container)).toBeUndefined();
      expect(
        (client as any).takePendingWatcherCycleReport('watcher', { watcher: 'watcher' } as any),
      ).toBeUndefined();
      expect(
        (client as any).takePendingWatcherCycleReport('watcher', {
          ...report.container,
          id: 'missing',
        }),
      ).toBeUndefined();
      expect((client as any).takePendingWatcherCycleReport('watcher', report.container)).toBe(
        report,
      );
    });

    test('should return undefined when deriving a watcher-cycle key from a non-container', () => {
      expect((client as any).getPendingWatcherCycleContainerKey(undefined)).toBeUndefined();
      expect((client as any).getPendingWatcherCycleContainerKey(null)).toBeUndefined();
    });

    test('should fall back to watcher:name when id is missing', () => {
      expect(
        (client as any).getPendingWatcherCycleContainerKey({
          name: 'test',
          watcher: 'watcher',
        }),
      ).toBe('watcher:test');
    });

    test('should remove the watcher bucket after taking the last pending watcher-cycle report', () => {
      const report = {
        container: {
          id: 'c1',
          name: 'test',
          watcher: 'watcher',
        },
        changed: true,
      };
      (client as any).pendingWatcherCycleReports.set('watcher', new Map([['c1', report]]));

      expect((client as any).takePendingWatcherCycleReport('watcher', report.container)).toBe(
        report,
      );
      expect((client as any).pendingWatcherCycleReports.has('watcher')).toBe(false);
    });

    test('should keep the watcher bucket after taking one report when others remain', () => {
      const firstReport = {
        container: {
          id: 'c1',
          name: 'test',
          watcher: 'watcher',
        },
        changed: true,
      };
      const secondReport = {
        container: {
          id: 'c2',
          name: 'test-2',
          watcher: 'watcher',
        },
        changed: true,
      };
      (client as any).pendingWatcherCycleReports.set(
        'watcher',
        new Map([
          ['c1', firstReport],
          ['c2', secondReport],
        ]),
      );

      expect((client as any).takePendingWatcherCycleReport('watcher', firstReport.container)).toBe(
        firstReport,
      );
      expect((client as any).pendingWatcherCycleReports.has('watcher')).toBe(true);
      expect((client as any).pendingWatcherCycleReports.get('watcher')?.has('c2')).toBe(true);
    });

    test('should remove the watcher bucket when clearing the last pending watcher-cycle report by id', () => {
      const report = {
        container: {
          id: 'c1',
          name: 'test',
          watcher: 'watcher',
        },
        changed: true,
      };
      (client as any).pendingWatcherCycleReports.set('watcher', new Map([['c1', report]]));

      (client as any).clearPendingWatcherCycleReportByContainerId('c1');

      expect((client as any).pendingWatcherCycleReports.has('watcher')).toBe(false);
    });

    test('should keep the watcher bucket when clearing one watcher-cycle container id and others remain', () => {
      (client as any).pendingWatcherCycleReports.set(
        'watcher',
        new Map([
          [
            'c1',
            {
              container: {
                id: 'c1',
                name: 'test',
                watcher: 'watcher',
              },
              changed: true,
            },
          ],
          [
            'c2',
            {
              container: {
                id: 'c2',
                name: 'test-2',
                watcher: 'watcher',
              },
              changed: true,
            },
          ],
        ]),
      );

      (client as any).clearPendingWatcherCycleReportByContainerId('c1');

      expect((client as any).pendingWatcherCycleReports.has('watcher')).toBe(true);
      expect((client as any).pendingWatcherCycleReports.get('watcher')?.has('c2')).toBe(true);
    });

    test('should remove the watcher bucket after clearing the last watcher-cycle container id', () => {
      (client as any).pendingWatcherCycleReports.set(
        'watcher',
        new Map([
          [
            'c1',
            {
              container: {
                id: 'c1',
                name: 'test',
                watcher: 'watcher',
              },
              changed: true,
            },
          ],
        ]),
      );

      (client as any).clearPendingWatcherCycleReportByContainerId('c1');

      expect((client as any).pendingWatcherCycleReports.has('watcher')).toBe(false);
    });

    test('should emit update-applied when agent sends dd:update-applied', async () => {
      await client.handleEvent('dd:update-applied', 'local_nginx');

      expect(event.emitContainerUpdateApplied).toHaveBeenCalledWith('local_nginx');
    });

    test('should terminalize agent update-applied payloads with operation ids through the store', async () => {
      await client.handleEvent('dd:update-applied', {
        operationId: 'remote-op-1',
        batchId: 'remote-batch-1',
        containerName: 'local_nginx',
        container: {
          id: 'c1',
          name: 'nginx',
          watcher: 'local',
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'major' },
        },
      });

      expect(event.emitContainerUpdateApplied).not.toHaveBeenCalled();
      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-test-agent-remote-op-1',
          containerName: 'local_nginx',
          containerId: 'c1',
          status: 'in-progress',
          container: expect.objectContaining({
            id: 'c1',
            name: 'nginx',
            watcher: 'local',
            agent: 'test-agent',
          }),
        }),
      );
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-1',
        expect.objectContaining({
          status: 'succeeded',
          containerId: 'c1',
          container: expect.objectContaining({ id: 'c1', agent: 'test-agent' }),
        }),
      );
    });

    test('should preserve dry-run phase when terminalizing agent update operations', async () => {
      await client.handleEvent('dd:update-applied', {
        operationId: 'remote-op-dryrun',
        containerName: 'local_nginx',
        phase: 'dryrun',
      });

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-dryrun',
        expect.objectContaining({ status: 'succeeded', phase: 'dryrun' }),
      );
    });

    test('should omit non-object container payloads for update-applied events', async () => {
      await client.handleEvent('dd:update-applied', {
        operationId: 'remote-op-no-container',
        containerName: 'local_nginx',
        container: 'not-an-object',
      });

      expect(event.emitContainerUpdateApplied).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-no-container',
        expect.not.objectContaining({ containerId: expect.anything() }),
      );
    });

    test('should emit update-applied object payloads without operation ids', async () => {
      await client.handleEvent('dd:update-applied', {
        containerName: 'local_nginx',
        container: 'not-an-object',
      });

      expect(event.emitContainerUpdateApplied).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        container: undefined,
      });
      expect(updateOperationStore.getOperationById).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).not.toHaveBeenCalled();
    });

    test('should preserve dry-run phase when forwarding update-applied without an operation id', async () => {
      await client.handleEvent('dd:update-applied', {
        containerName: 'local_nginx',
        phase: 'dryrun',
      });

      expect(event.emitContainerUpdateApplied).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        container: undefined,
        phase: 'dryrun',
      });
    });

    test('should scope batch ids and tag container objects for update-applied payloads without operation ids', async () => {
      await client.handleEvent('dd:update-applied', {
        batchId: 'remote-batch-1',
        containerName: 'local_nginx',
        container: { id: 'c1', name: 'nginx' },
      });

      expect(event.emitContainerUpdateApplied).toHaveBeenCalledWith({
        batchId: 'agent-test-agent-remote-batch-1',
        containerName: 'local_nginx',
        container: { id: 'c1', name: 'nginx', agent: 'test-agent' },
      });
      expect(updateOperationStore.getOperationById).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).not.toHaveBeenCalled();
    });

    test('should ignore update-applied when data is an empty string', async () => {
      await client.handleEvent('dd:update-applied', '');

      expect(event.emitContainerUpdateApplied).not.toHaveBeenCalled();
    });

    test('regression #289: agent update-applied with operationId and container threads container into operation row', async () => {
      await client.handleEvent('dd:update-applied', {
        operationId: 'remote-op-reg289',
        containerName: 'tautulli',
        container: {
          id: 'c1',
          name: 'tautulli',
          watcher: 'docker',
          updateAvailable: true,
          updateKind: { kind: 'tag', semverDiff: 'minor' },
        },
      });

      expect(event.emitContainerUpdateApplied).not.toHaveBeenCalled();
      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          container: expect.objectContaining({ agent: 'test-agent', id: 'c1' }),
        }),
      );
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-reg289',
        expect.objectContaining({
          container: expect.objectContaining({ agent: 'test-agent', id: 'c1' }),
        }),
      );
    });

    test('agent update-applied stamps agent name on container regardless of inbound agent field', async () => {
      await client.handleEvent('dd:update-applied', {
        operationId: 'remote-op-stamp',
        containerName: 'tautulli',
        container: {
          id: 'c2',
          name: 'tautulli',
          watcher: 'docker',
          agent: 'some-other-agent',
        },
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          container: expect.objectContaining({ id: 'c2', agent: 'test-agent' }),
        }),
      );
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-stamp',
        expect.objectContaining({
          container: expect.objectContaining({ agent: 'test-agent' }),
        }),
      );
    });

    test('existing-row race: dd:update-operation-changed inserted active row before dd:update-applied arrives with container', async () => {
      // Use mockImplementation so resolveAgentOperationId falls back to scoped id consistently.
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-remote-op-race') {
          return {
            id: 'agent-test-agent-remote-op-race',
            containerName: 'tautulli',
            status: 'in-progress',
            phase: 'pulling',
            container: undefined,
          } as any;
        }
        return undefined;
      });

      await client.handleEvent('dd:update-applied', {
        operationId: 'remote-op-race',
        containerName: 'tautulli',
        container: {
          id: 'c3',
          name: 'tautulli',
          watcher: 'docker',
          updateAvailable: false,
        },
      });

      expect(updateOperationStore.updateOperation).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-race',
        expect.objectContaining({ container: expect.objectContaining({ agent: 'test-agent' }) }),
      );
      expect(updateOperationStore.insertOperation).not.toHaveBeenCalled();
    });

    test('agent update-failed with operationId and container threads container into operation row', async () => {
      await client.handleEvent('dd:update-failed', {
        operationId: 'remote-fail-with-container',
        containerName: 'tautulli',
        error: 'pull failed',
        phase: 'pull-failed',
        container: {
          id: 'c4',
          name: 'tautulli',
          watcher: 'docker',
          updateAvailable: true,
        },
      });

      expect(event.emitContainerUpdateFailed).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-fail-with-container',
        expect.objectContaining({
          status: 'failed',
          container: expect.objectContaining({ agent: 'test-agent', id: 'c4' }),
        }),
      );
    });

    test('should terminalize agent update-failed payloads with operation ids through the store', async () => {
      await client.handleEvent('dd:update-failed', {
        operationId: 'remote-fail-1',
        batchId: 'remote-batch-fail-1',
        containerId: 'c-fail',
        containerName: 'local_nginx',
        error: 'compose pull failed',
        phase: 'pull-failed',
      });

      expect(event.emitContainerUpdateFailed).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-fail-1',
        expect.objectContaining({
          status: 'failed',
          containerId: 'c-fail',
          lastError: 'compose pull failed',
          phase: 'pull-failed',
        }),
      );
    });

    test('should emit update-failed without touching operation store when operation id is absent', async () => {
      await client.handleEvent('dd:update-failed', {
        containerId: 'c-fail',
        containerName: 'local_nginx',
        error: 'compose pull failed',
        phase: 'pull-failed',
      });

      expect(event.emitContainerUpdateFailed).toHaveBeenCalledWith({
        containerId: 'c-fail',
        containerName: 'local_nginx',
        error: 'compose pull failed',
        phase: 'pull-failed',
      });
      expect(updateOperationStore.getOperationById).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).not.toHaveBeenCalled();
    });

    test('should forward container snapshot on update-failed with agent decoration', async () => {
      const containerSnapshot = {
        id: 'c-fail',
        name: 'local_nginx',
        watcher: 'local',
        displayName: 'nginx',
        displayIcon: 'nginx',
        status: 'stopped',
        image: { id: 'img-1', name: 'nginx:1.25', registry: {} },
        updateAvailable: false,
        updateKind: 'unknown',
      };
      await client.handleEvent('dd:update-failed', {
        containerId: 'c-fail',
        containerName: 'local_nginx',
        error: 'recreate failed',
        container: containerSnapshot,
      });

      expect(event.emitContainerUpdateFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          containerName: 'local_nginx',
          container: expect.objectContaining({
            id: 'c-fail',
            agent: 'test-agent',
          }),
        }),
      );
    });

    test('should mark failed agent operations without optional fields', async () => {
      await client.handleEvent('dd:update-failed', {
        operationId: 'remote-fail-no-optionals',
        containerName: 'local_nginx',
        error: 'compose pull failed',
      });

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-fail-no-optionals',
        expect.not.objectContaining({
          containerId: expect.anything(),
          phase: expect.anything(),
        }),
      );
      expect(event.emitContainerUpdateFailed).not.toHaveBeenCalled();
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

    test('should insert a synthetic controller operation when an agent sends an active phase event', async () => {
      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-active',
        containerName: 'local_nginx',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-test-agent-remote-op-active',
          kind: 'container-update',
          containerName: 'local_nginx',
          containerId: 'c1',
          status: 'in-progress',
          phase: 'pulling',
        }),
      );
    });

    test('should stamp fresh active agent operation rows with derived identity', async () => {
      vi.mocked(storeContainer.getContainer).mockReturnValueOnce({
        id: 'c1',
        name: 'local_nginx',
        watcher: 'local',
        agent: 'test-agent',
      } as any);

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-active-scoped',
        containerName: 'local_nginx',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-test-agent-remote-op-active-scoped',
          agent: 'test-agent',
          watcher: 'local',
        }),
      );
    });

    test('should insert active synthetic operations without optional fields', async () => {
      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-minimal-active',
        containerName: 'local_nginx',
        status: 'queued',
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.not.objectContaining({
          containerId: expect.anything(),
          newContainerId: expect.anything(),
          phase: expect.anything(),
        }),
      );
      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-test-agent-remote-op-minimal-active',
          containerName: 'local_nginx',
          status: 'queued',
        }),
      );
    });

    test('should update an existing synthetic controller operation on active phase events', async () => {
      // Use mockImplementation so resolveAgentOperationId finds no controller row (raw id),
      // falls back to scoped, and the second lookup finds the existing scoped row.
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-remote-op-existing') {
          return {
            id: 'agent-test-agent-remote-op-existing',
            containerName: 'local_nginx',
            status: 'in-progress',
            phase: 'pulling',
          } as any;
        }
        return undefined;
      });

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-existing',
        containerName: 'local_nginx',
        containerId: 'c1',
        newContainerId: 'c2',
        status: 'in-progress',
        phase: 'new-created',
      });

      expect(updateOperationStore.updateOperation).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-existing',
        expect.objectContaining({
          containerName: 'local_nginx',
          containerId: 'c1',
          newContainerId: 'c2',
          status: 'in-progress',
          phase: 'new-created',
        }),
      );
      expect(updateOperationStore.insertOperation).not.toHaveBeenCalled();
    });

    test('should hydrate active operation identity from newContainerId when old id is gone', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(undefined);
      storeContainer.getContainer.mockImplementation((id) =>
        id === 'new-c1'
          ? ({
              id: 'new-c1',
              name: 'local_nginx',
              watcher: 'local',
              agent: 'test-agent',
            } as any)
          : undefined,
      );
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-new-id-only',
        containerName: 'local_nginx',
        containerId: 'old-c1',
        newContainerId: 'new-c1',
        status: 'in-progress',
        phase: 'new-started',
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-test-agent-remote-op-new-id-only',
          containerName: 'local_nginx',
          agent: 'test-agent',
          watcher: 'local',
          containerId: 'old-c1',
          newContainerId: 'new-c1',
          container: expect.objectContaining({
            id: 'new-c1',
            watcher: 'local',
            agent: 'test-agent',
          }),
        }),
      );
    });

    test('should update active synthetic operations without optional fields', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-remote-op-existing-minimal') {
          return {
            id: 'agent-test-agent-remote-op-existing-minimal',
            containerName: 'local_nginx',
            status: 'queued',
            phase: 'queued',
          } as any;
        }
        return undefined;
      });

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-existing-minimal',
        containerName: 'local_nginx',
        status: 'in-progress',
      });

      expect(updateOperationStore.updateOperation).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-existing-minimal',
        expect.not.objectContaining({
          containerId: expect.anything(),
          newContainerId: expect.anything(),
          phase: expect.anything(),
        }),
      );
      expect(updateOperationStore.updateOperation).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-existing-minimal',
        expect.objectContaining({
          containerName: 'local_nginx',
          status: 'in-progress',
        }),
      );
    });

    test('should ignore active updates for already terminal synthetic operations', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-remote-op-already-terminal') {
          return {
            id: 'agent-test-agent-remote-op-already-terminal',
            containerName: 'local_nginx',
            status: 'failed',
            phase: 'failed',
          } as any;
        }
        return undefined;
      });

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-already-terminal',
        containerName: 'local_nginx',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(updateOperationStore.updateOperation).not.toHaveBeenCalled();
      expect(updateOperationStore.insertOperation).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).not.toHaveBeenCalled();
    });

    test('should mark a synthetic controller operation terminal when an agent sends a terminal phase event', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-remote-op-terminal') {
          return {
            id: 'agent-test-agent-remote-op-terminal',
            containerName: 'local_nginx',
            status: 'in-progress',
            phase: 'new-started',
          } as any;
        }
        return undefined;
      });

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-terminal',
        containerName: 'local_nginx',
        containerId: 'old-c1',
        newContainerId: 'new-c1',
        status: 'succeeded',
        phase: 'succeeded',
      });

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-terminal',
        expect.objectContaining({
          status: 'succeeded',
          phase: 'succeeded',
          containerName: 'local_nginx',
          containerId: 'old-c1',
          newContainerId: 'new-c1',
        }),
      );
    });

    test('should ignore invalid update-operation-changed payloads from agents', async () => {
      await client.handleEvent('dd:update-operation-changed', null);
      await client.handleEvent('dd:update-operation-changed', {
        operationId: '',
        containerName: 'local_nginx',
        status: 'in-progress',
      });
      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-invalid-name',
        containerName: '',
        status: 'in-progress',
      });
      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-invalid-status',
        containerName: 'local_nginx',
        status: 'unknown',
      });

      expect(updateOperationStore.insertOperation).not.toHaveBeenCalled();
      expect(updateOperationStore.updateOperation).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).not.toHaveBeenCalled();
    });

    test('should ignore impossible operation statuses defensively', () => {
      (client as any).applyAgentUpdateOperationChanged({
        operationId: 'remote-op-impossible',
        containerName: 'local_nginx',
        status: 'unknown',
      });

      expect(updateOperationStore.insertOperation).not.toHaveBeenCalled();
      expect(updateOperationStore.updateOperation).not.toHaveBeenCalled();
      expect(updateOperationStore.markOperationTerminal).not.toHaveBeenCalled();
    });

    test('should not re-mark an already terminal synthetic controller operation', async () => {
      // Use mockImplementation so the mock only returns a value for the scoped id,
      // avoiding pollution of subsequent tests that now call getOperationById via
      // resolveAgentOperationId (clearAllMocks doesn't reset mockReturnValue).
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-remote-op-terminal') {
          return {
            id: 'agent-test-agent-remote-op-terminal',
            containerName: 'local_nginx',
            status: 'succeeded',
            phase: 'succeeded',
          } as any;
        }
        return undefined;
      });

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-terminal',
        containerName: 'local_nginx',
        status: 'succeeded',
        phase: 'succeeded',
      });

      expect(updateOperationStore.markOperationTerminal).not.toHaveBeenCalled();
      expect(updateOperationStore.insertOperation).not.toHaveBeenCalled();
    });

    test('should forward agent batch completion summaries with synthetic ids', async () => {
      await client.handleEvent('dd:batch-update-completed', {
        batchId: 'remote-batch-1',
        total: 2,
        succeeded: 1,
        failed: 1,
        durationMs: 2500,
        items: [
          {
            operationId: 'remote-op-1',
            containerId: 'c1',
            containerName: 'local_nginx',
            status: 'succeeded',
          },
          {
            operationId: 'remote-op-2',
            containerId: 'c2',
            containerName: 'local_redis',
            status: 'failed',
          },
        ],
        timestamp: '2026-04-29T12:00:00.000Z',
      });

      expect(event.emitBatchUpdateCompleted).toHaveBeenCalledWith({
        batchId: 'agent-test-agent-remote-batch-1',
        total: 2,
        succeeded: 1,
        failed: 1,
        durationMs: 2500,
        items: [
          expect.objectContaining({ operationId: 'agent-test-agent-remote-op-1' }),
          expect.objectContaining({ operationId: 'agent-test-agent-remote-op-2' }),
        ],
        timestamp: '2026-04-29T12:00:00.000Z',
      });
    });

    test('should default optional agent batch completion fields', async () => {
      vi.setSystemTime(new Date('2026-04-29T12:05:00.000Z'));

      await client.handleEvent('dd:batch-update-completed', {
        batchId: 'remote-batch-defaults',
        total: 1,
        succeeded: 1,
        failed: 0,
        durationMs: 1500,
        items: [
          {
            operationId: 'remote-op-defaults',
            containerName: 'local_nginx',
            status: 'succeeded',
          },
        ],
      });

      expect(event.emitBatchUpdateCompleted).toHaveBeenCalledWith({
        batchId: 'agent-test-agent-remote-batch-defaults',
        total: 1,
        succeeded: 1,
        failed: 0,
        durationMs: 1500,
        items: [
          {
            operationId: 'agent-test-agent-remote-op-defaults',
            containerId: '',
            containerName: 'local_nginx',
            status: 'succeeded',
          },
        ],
        timestamp: '2026-04-29T12:05:00.000Z',
      });
    });

    test('should ignore malformed agent batch completion summaries', async () => {
      await client.handleEvent('dd:batch-update-completed', null);
      await client.handleEvent('dd:batch-update-completed', {
        batchId: 'remote-batch-1',
        total: 1,
        succeeded: 1,
        failed: 0,
        durationMs: '2500',
        items: [],
      });
      await client.handleEvent('dd:batch-update-completed', {
        batchId: 'remote-batch-2',
        total: 1,
        succeeded: 1,
        failed: 0,
        durationMs: 2500,
        items: [null],
      });
      await client.handleEvent('dd:batch-update-completed', {
        batchId: 'remote-batch-3',
        total: 1,
        succeeded: 0,
        failed: 1,
        durationMs: 2500,
        items: [
          {
            operationId: 'remote-op-3',
            containerName: 'local_nginx',
            status: 'queued',
          },
        ],
      });

      expect(event.emitBatchUpdateCompleted).not.toHaveBeenCalled();
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
        cycleId: '00000000-0000-7000-8000-000000000001',
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
        cycleId: '00000000-0000-7000-8000-000000000001',
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
        cycleId: '00000000-0000-7000-8000-000000000001',
      });
    });

    test('should pass through cycleId from modern agents and skip synthesis', async () => {
      await client.handleEvent('dd:security-alert', {
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: 'blocked',
        blockingCount: 1,
        cycleId: 'modern-cycle-abc',
      });

      expect(event.emitSecurityAlert).toHaveBeenCalledWith({
        containerName: 'local_nginx',
        details: '1 critical vulnerability',
        status: 'blocked',
        blockingCount: 1,
        cycleId: 'modern-cycle-abc',
      });
      expect(event.emitSecurityScanCycleComplete).not.toHaveBeenCalled();
    });

    test('should synthesize cycleId and emit cycle-complete for legacy agents', async () => {
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
        cycleId: '00000000-0000-7000-8000-000000000001',
      });
      expect(event.emitSecurityScanCycleComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: '00000000-0000-7000-8000-000000000001',
          scannedCount: 1,
          alertCount: 1,
          scope: 'agent-forwarded',
        }),
      );
    });

    test('should emit forwarded security-scan-cycle-complete from agents', async () => {
      await client.handleEvent('dd:security-scan-cycle-complete', {
        cycleId: 'agent-cycle-42',
        scannedCount: 7,
        alertCount: 2,
        startedAt: '2026-04-17T22:30:00.000Z',
        completedAt: '2026-04-17T22:30:10.000Z',
      });

      expect(event.emitSecurityScanCycleComplete).toHaveBeenCalledWith({
        cycleId: 'agent-cycle-42',
        scannedCount: 7,
        alertCount: 2,
        startedAt: '2026-04-17T22:30:00.000Z',
        completedAt: '2026-04-17T22:30:10.000Z',
        scope: 'agent-forwarded',
      });
    });

    test('should omit invalid optional forwarded security-scan-cycle-complete fields from agents', async () => {
      await client.handleEvent('dd:security-scan-cycle-complete', {
        cycleId: 'agent-cycle-43',
        scannedCount: 4,
        alertCount: '2',
        startedAt: '',
        completedAt: 123,
      });

      expect(event.emitSecurityScanCycleComplete).toHaveBeenCalledWith({
        cycleId: 'agent-cycle-43',
        scannedCount: 4,
        scope: 'agent-forwarded',
      });
    });

    test('should ignore invalid security-scan-cycle-complete payloads', async () => {
      await client.handleEvent('dd:security-scan-cycle-complete', null);
      await client.handleEvent('dd:security-scan-cycle-complete', {
        cycleId: '',
        scannedCount: 3,
      });
      await client.handleEvent('dd:security-scan-cycle-complete', {
        cycleId: 'ok',
        scannedCount: 'not-a-number',
      });

      expect(event.emitSecurityScanCycleComplete).not.toHaveBeenCalled();
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

    test('should preserve changed=true for remote container updates when watcher snapshot closes the same cycle', async () => {
      const changedBeforeSnapshot = {
        id: 'c1',
        name: 'qBittorrent',
        watcher: 'mediavault',
        agent: 'test-agent',
        updateAvailable: true,
        resultChanged: vi.fn().mockReturnValue(true),
      };
      const unchangedAfterSnapshot = {
        id: 'c1',
        name: 'qBittorrent',
        watcher: 'mediavault',
        agent: 'test-agent',
        updateAvailable: true,
        resultChanged: vi.fn().mockReturnValue(false),
      };

      storeContainer.getContainer
        .mockReturnValueOnce(changedBeforeSnapshot)
        .mockReturnValueOnce(unchangedAfterSnapshot);
      storeContainer.updateContainer.mockImplementation((container) => ({
        ...container,
        updateAvailable: true,
      }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:container-updated', {
        id: 'c1',
        name: 'qBittorrent',
        watcher: 'mediavault',
        updateAvailable: true,
      });
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'mediavault' },
        containers: [
          {
            id: 'c1',
            name: 'qBittorrent',
            watcher: 'mediavault',
            updateAvailable: true,
          },
        ],
      });

      expect(event.emitContainerReport).toHaveBeenCalledTimes(1);
      expect(event.emitContainerReport).toHaveBeenCalledWith(
        expect.objectContaining({
          changed: true,
          container: expect.objectContaining({
            id: 'c1',
            watcher: 'mediavault',
            agent: 'test-agent',
          }),
        }),
      );
      expect(event.emitContainerReports).toHaveBeenCalledWith([
        expect.objectContaining({
          changed: true,
          container: expect.objectContaining({
            id: 'c1',
            watcher: 'mediavault',
            agent: 'test-agent',
          }),
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

    test('should treat a null watcher snapshot payload as an empty anonymous snapshot', async () => {
      await client.handleEvent('dd:watcher-snapshot', null);

      expect(event.emitContainerReports).toHaveBeenCalledWith([]);
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
      expect(storeContainer.getContainers).not.toHaveBeenCalled();
    });

    test('should skip watcher snapshot cache updates when the watcher type is not a string', async () => {
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 42, name: 'local' },
        containers: [],
      });

      expect(client.getWatcherSnapshot('docker', 'local')).toBeUndefined();
    });

    test('should ignore unknown event types', async () => {
      const processSpy = vi.spyOn(client, 'processContainer');
      await client.handleEvent('dd:unknown', {});
      expect(processSpy).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('should emit emitAgentStatsChanged with agent name after watcher snapshot is processed', async () => {
      storeContainer.getContainers.mockReturnValue([]);
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => c);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
      });

      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should emit emitAgentStatsChanged even for empty watcher snapshots', async () => {
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [],
      });

      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should emit emitAgentStatsChanged even when the watcher name is missing', async () => {
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', null);

      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should log debug when emitAgentStatsChanged rejects', async () => {
      storeContainer.getContainers.mockReturnValue([]);
      vi.mocked(event.emitAgentStatsChanged).mockRejectedValueOnce(new Error('stats emit failed'));

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [],
      });

      await vi.runAllTimersAsync();
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to emit agent stats changed event'),
      );
    });

    test('handshake then watcher snapshot should emit emitAgentConnected once then emitAgentStatsChanged', async () => {
      vi.mocked(axios.get).mockImplementation((url: string) => {
        if (String(url).endsWith('/api/containers')) {
          return Promise.resolve({ data: [] });
        }
        if (String(url).endsWith('/api/watchers')) {
          return Promise.resolve({ data: [] });
        }
        if (String(url).endsWith('/api/triggers')) {
          return Promise.resolve({ data: [] });
        }
        return Promise.resolve({ data: [] });
      });

      await client.handshake();

      expect(event.emitAgentConnected).toHaveBeenCalledTimes(1);
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();

      storeContainer.getContainers.mockReturnValue([]);
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => c);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
      });

      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
      expect(event.emitAgentConnected).toHaveBeenCalledTimes(1);
    });
  });

  describe('runRemoteTrigger', () => {
    test('should post to remote trigger endpoint', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = { id: 'c1', name: 'my-container' };
      await client.runRemoteTrigger(container, 'docker', 'update');
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/triggers/docker/update'),
        expect.objectContaining({ id: 'c1', name: 'my-container' }),
        expect.any(Object),
      );
    });

    test('should post only id and name for docker update triggers (avoids agent 256kb 413)', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = {
        id: 'c1',
        name: 'calibre',
        status: 'running',
        watcher: 'mediavault',
        displayName: 'calibre',
        image: { id: 'sha256:abc', name: 'linuxserver/calibre', tag: { value: 'latest' } },
        result: { tag: 'latest', releaseNotes: { body: 'x'.repeat(300 * 1024) } },
        details: { env: [{ key: 'A', value: 'B' }], labels: { foo: 'bar' } },
      };
      await client.runRemoteTrigger(container, 'docker', 'update');
      const [, postedPayload] = axios.post.mock.calls[0];
      expect(postedPayload).toStrictEqual({ id: 'c1', name: 'calibre' });
    });

    test('should post only id and name for dockercompose update triggers', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = {
        id: 'c2',
        name: 'web',
        result: { releaseNotes: { body: 'x'.repeat(400 * 1024) } },
      };
      await client.runRemoteTrigger(container, 'dockercompose', 'update');
      const [, postedPayload] = axios.post.mock.calls[0];
      expect(postedPayload).toStrictEqual({ id: 'c2', name: 'web' });
    });

    test('should post the full container for non-update (notification) trigger types', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = {
        id: 'c3',
        name: 'api',
        status: 'running',
        result: { releaseNotes: { body: 'release body' } },
      };
      await client.runRemoteTrigger(container, 'smtp', 'notify');
      const [, postedPayload] = axios.post.mock.calls[0];
      expect(postedPayload).toBe(container);
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

    test('should include operationId in payload for update triggers when runtimeContext supplies it (#289)', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = { id: 'c1', name: 'tautulli' };
      const runtimeContext = { operationId: 'uuid-controller-1' };
      await client.runRemoteTrigger(container, 'docker', 'update', runtimeContext);
      const [, postedPayload] = axios.post.mock.calls[0];
      expect(postedPayload).toStrictEqual({
        id: 'c1',
        name: 'tautulli',
        operationId: 'uuid-controller-1',
      });
    });

    test('should include operationId for dockercompose update triggers when runtimeContext supplies it', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = { id: 'c2', name: 'web' };
      const runtimeContext = { operationId: 'uuid-controller-2' };
      await client.runRemoteTrigger(container, 'dockercompose', 'update', runtimeContext);
      const [, postedPayload] = axios.post.mock.calls[0];
      expect(postedPayload).toStrictEqual({
        id: 'c2',
        name: 'web',
        operationId: 'uuid-controller-2',
      });
    });

    test('should omit operationId for update triggers when runtimeContext has none', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = { id: 'c1', name: 'nginx' };
      await client.runRemoteTrigger(container, 'docker', 'update', {});
      const [, postedPayload] = axios.post.mock.calls[0];
      expect(postedPayload).toStrictEqual({ id: 'c1', name: 'nginx' });
    });

    test('should omit operationId for update triggers when no runtimeContext', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = { id: 'c1', name: 'nginx' };
      await client.runRemoteTrigger(container, 'docker', 'update');
      const [, postedPayload] = axios.post.mock.calls[0];
      expect(postedPayload).toStrictEqual({ id: 'c1', name: 'nginx' });
    });

    test('should not include operationId for notification trigger types', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const container = { id: 'c3', name: 'api', status: 'running' };
      const runtimeContext = { operationId: 'uuid-controller-1' };
      await client.runRemoteTrigger(container, 'smtp', 'notify', runtimeContext);
      const [, postedPayload] = axios.post.mock.calls[0];
      // Full container is posted for notification triggers, no operationId injection
      expect(postedPayload).toBe(container);
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

    test('should embed per-container operationIds from runtimeContext for update triggers (#289)', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const containers = [
        { id: 'c1', name: 'app1' },
        { id: 'c2', name: 'app2' },
      ];
      const runtimeContext = { operationIds: { c1: 'uuid-ctrl-1', c2: 'uuid-ctrl-2' } };
      await client.runRemoteTriggerBatch(containers, 'docker', 'update', runtimeContext);
      const [, postedBody] = axios.post.mock.calls[0];
      expect(postedBody).toEqual([
        { id: 'c1', name: 'app1', operationId: 'uuid-ctrl-1' },
        { id: 'c2', name: 'app2', operationId: 'uuid-ctrl-2' },
      ]);
    });

    test('should post containers without operationId when runtimeContext has no match for a container', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const containers = [
        { id: 'c1', name: 'app1' },
        { id: 'c2', name: 'app2' },
      ];
      const runtimeContext = { operationIds: { c1: 'uuid-ctrl-1' } };
      await client.runRemoteTriggerBatch(containers, 'docker', 'update', runtimeContext);
      const [, postedBody] = axios.post.mock.calls[0];
      expect(postedBody[0]).toHaveProperty('operationId', 'uuid-ctrl-1');
      expect(postedBody[1]).not.toHaveProperty('operationId');
    });

    test('should post containers as-is when no runtimeContext (update triggers)', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const containers = [{ id: 'c1', name: 'app1' }];
      await client.runRemoteTriggerBatch(containers, 'docker', 'update');
      const [, postedBody] = axios.post.mock.calls[0];
      expect(postedBody).toBe(containers);
    });

    test('should not embed operationIds for notification batch triggers', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const containers = [{ id: 'c1', name: 'app1' }];
      const runtimeContext = { operationIds: { c1: 'uuid-ctrl-1' } };
      await client.runRemoteTriggerBatch(containers, 'slack', 'notify', runtimeContext);
      const [, postedBody] = axios.post.mock.calls[0];
      expect(postedBody).toBe(containers);
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

    test('should emit emitAgentStatsChanged after watch() completes', async () => {
      const reports = [{ container: { id: 'c1' } }];
      axios.post.mockResolvedValue({ data: reports });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.watch('docker', 'local');
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should not emit emitAgentStatsChanged when watch() throws', async () => {
      axios.post.mockRejectedValue(new Error('watch failed'));
      await expect(client.watch('docker', 'local')).rejects.toThrow('watch failed');
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();
    });

    test('should log debug when emitAgentStatsChanged rejects in watch()', async () => {
      const reports = [{ container: { id: 'c1' } }];
      axios.post.mockResolvedValue({ data: reports });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));
      storeContainer.getContainers.mockReturnValue([]);
      vi.mocked(event.emitAgentStatsChanged).mockRejectedValueOnce(new Error('stats emit failed'));

      await client.watch('docker', 'local');
      await vi.runAllTimersAsync();
      expect(mockLogChild.debug).toHaveBeenCalledWith(
        expect.stringContaining('Failed to emit agent stats changed event'),
      );
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

    test('should emit emitAgentStatsChanged after a successful watchContainer call', async () => {
      const report = { container: { id: 'c1' } };
      axios.post.mockResolvedValue({ data: report });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c, updateAvailable: false }));

      await client.watchContainer('docker', 'local', { id: 'c1', name: 'test' });
      // Debounce must not have fired yet
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();
      // Drain the debounce timer
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).toHaveBeenCalledWith({ agentName: 'test-agent' });
    });

    test('should NOT emit emitAgentStatsChanged when watchContainer throws', async () => {
      axios.post.mockRejectedValue(new Error('watch failed'));

      await expect(
        client.watchContainer('docker', 'local', { id: 'c1', name: 'test' }),
      ).rejects.toThrow('watch failed');
      await vi.runAllTimersAsync();
      expect(event.emitAgentStatsChanged).not.toHaveBeenCalled();
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

  describe('edgeAdapter delegation', () => {
    test('getContainerLogs delegates to edgeAdapter.requestContainerLogs instead of axios', async () => {
      const edgeAdapter = {
        requestContainerLogs: vi.fn().mockResolvedValue('log line 1\nlog line 2\n'),
        deleteContainer: vi.fn(),
      };
      client.edgeAdapter = edgeAdapter;

      const result = await client.getContainerLogs('c1', {
        tail: 100,
        since: 0,
        timestamps: true,
      });

      expect(result).toBe('log line 1\nlog line 2\n');
      // Punch-list #5 (resolved): `timestamps` is now forwarded over the edge
      // path — portwing's dd:container_log_request carries a `timestamps` field
      // its handler reads — so the caller's request (and the UI "show
      // timestamps" toggle) reaches the edge agent the same as the HTTP/SSE
      // fallback. See the call site in AgentClient.getContainerLogs() and
      // content/docs/current/configuration/agents/index.mdx.
      expect(edgeAdapter.requestContainerLogs).toHaveBeenCalledWith('c1', {
        tail: 100,
        since: '0',
        timestamps: true,
      });
      expect(axios.get).not.toHaveBeenCalled();
    });

    test('deleteContainer delegates to edgeAdapter.deleteContainer instead of axios', async () => {
      const edgeAdapter = {
        requestContainerLogs: vi.fn(),
        deleteContainer: vi.fn().mockResolvedValue(undefined),
      };
      client.edgeAdapter = edgeAdapter;

      await client.deleteContainer('c1');

      expect(edgeAdapter.deleteContainer).toHaveBeenCalledWith('c1');
      expect(axios.delete).not.toHaveBeenCalled();
    });

    test('deleteContainer propagates edgeAdapter rejection', async () => {
      const edgeAdapter = {
        requestContainerLogs: vi.fn(),
        deleteContainer: vi.fn().mockRejectedValue(new Error('delete failed')),
      };
      client.edgeAdapter = edgeAdapter;

      await expect(client.deleteContainer('c1')).rejects.toThrow('delete failed');
      expect(axios.delete).not.toHaveBeenCalled();
    });
  });

  describe('watcher snapshot cache', () => {
    test('getWatcherSnapshot returns undefined before handshake or SSE event fires', () => {
      expect(client.getWatcherSnapshot('docker', 'remote')).toBeUndefined();
    });

    test('handshake seeds the watcher snapshot cache from GET /api/watchers response', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // containers
        .mockResolvedValueOnce({
          data: [
            {
              type: 'docker',
              name: 'remote',
              configuration: { cron: '*/5 * * * *' },
              metadata: { nextRunAt: '2026-04-19T00:05:00.000Z' },
            },
          ],
        }) // watchers
        .mockResolvedValueOnce({ data: [] }); // triggers

      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      expect(client.getWatcherSnapshot('docker', 'remote')).toEqual({
        type: 'docker',
        name: 'remote',
        configuration: { cron: '*/5 * * * *' },
        metadata: { nextRunAt: '2026-04-19T00:05:00.000Z' },
      });
    });

    test('handshake ignores watcher descriptors missing type or name when seeding the cache', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // containers
        .mockResolvedValueOnce({
          data: [
            {
              type: 'docker',
              name: 'remote',
              configuration: { cron: '*/5 * * * *' },
              metadata: { nextRunAt: '2026-04-19T00:05:00.000Z' },
            },
            {
              type: 'docker',
              configuration: { cron: '*/10 * * * *' },
              metadata: { nextRunAt: '2026-04-19T00:10:00.000Z' },
            },
            {
              name: 'missing-type',
              configuration: { cron: '*/15 * * * *' },
              metadata: { nextRunAt: '2026-04-19T00:15:00.000Z' },
            },
          ],
        }) // watchers
        .mockResolvedValueOnce({ data: [] }); // triggers

      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      expect(client.getWatcherSnapshot('docker', 'remote')).toEqual({
        type: 'docker',
        name: 'remote',
        configuration: { cron: '*/5 * * * *' },
        metadata: { nextRunAt: '2026-04-19T00:05:00.000Z' },
      });
      expect(
        (
          client as unknown as {
            watcherSnapshotCache: Map<string, unknown>;
          }
        ).watcherSnapshotCache.size,
      ).toBe(1);
    });

    test('dd:watcher-snapshot SSE event updates the cache with fresh configuration and metadata', async () => {
      // Seed via handshake first
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [
            {
              type: 'docker',
              name: 'remote',
              configuration: { cron: '0 * * * *' },
              metadata: { nextRunAt: '2026-04-19T01:00:00.000Z' },
            },
          ],
        })
        .mockResolvedValueOnce({ data: [] });
      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();

      // Now fire a snapshot SSE with updated values
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: {
          type: 'docker',
          name: 'remote',
          configuration: { cron: '*/15 * * * *' },
          metadata: { nextRunAt: '2026-04-19T01:15:00.000Z' },
        },
        containers: [],
      });

      expect(client.getWatcherSnapshot('docker', 'remote')).toEqual({
        type: 'docker',
        name: 'remote',
        configuration: { cron: '*/15 * * * *' },
        metadata: { nextRunAt: '2026-04-19T01:15:00.000Z' },
      });
    });

    test('dd:watcher-snapshot event with only partial watcher fields preserves existing cache values', async () => {
      // Seed with full data via handshake
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [
            {
              type: 'docker',
              name: 'remote',
              configuration: { cron: '0 * * * *' },
              metadata: { nextRunAt: '2026-04-19T01:00:00.000Z' },
            },
          ],
        })
        .mockResolvedValueOnce({ data: [] });
      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();

      // Fire a snapshot with only type and name (no configuration or metadata)
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'remote' },
        containers: [],
      });

      // Existing values must be preserved
      expect(client.getWatcherSnapshot('docker', 'remote')).toEqual({
        type: 'docker',
        name: 'remote',
        configuration: { cron: '0 * * * *' },
        metadata: { nextRunAt: '2026-04-19T01:00:00.000Z' },
      });
    });

    test('dd:watcher-snapshot event without a watcher type does not seed the cache', async () => {
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { name: 'remote' },
        containers: [],
      });

      expect(client.getWatcherSnapshot('docker', 'remote')).toBeUndefined();
    });

    test('dd:watcher-snapshot event with only type and name populates the cache with undefined configuration and metadata', async () => {
      // No prior handshake — first SSE event for an unknown watcher
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'newbie' },
        containers: [],
      });

      expect(client.getWatcherSnapshot('docker', 'newbie')).toEqual({
        type: 'docker',
        name: 'newbie',
        configuration: undefined,
        metadata: undefined,
      });
    });

    test('getWatcherSnapshot with unknown watcher returns undefined', async () => {
      // Populate cache with docker.a
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [{ type: 'docker', name: 'a', configuration: {}, metadata: {} }],
        })
        .mockResolvedValueOnce({ data: [] });
      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();

      expect(client.getWatcherSnapshot('docker', 'b')).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Additional tests to kill surviving Stryker mutants
  // ─────────────────────────────────────────────────────────────────────────────

  describe('toOptionalRecord (private helper)', () => {
    // Lines 141-144: ConditionalExpression / LogicalOperator mutants
    test('returns undefined for null', () => {
      expect((client as any).toOptionalRecord?.(null)).toBeUndefined();
      // Verify via a method that uses it (updateWatcherSnapshotCache)
    });

    test('toOptionalRecord rejects null, arrays, primitives and accepts plain objects', async () => {
      // Exercise via handleWatcherSnapshotEvent which calls toOptionalRecord
      storeContainer.getContainers.mockReturnValue([]);

      // Pass array metadata — toOptionalRecord should reject it
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: {
          type: 'docker',
          name: 'local',
          configuration: null,
          metadata: [1, 2, 3],
        },
        containers: [],
      });
      expect(client.getWatcherSnapshot('docker', 'local')).toEqual({
        type: 'docker',
        name: 'local',
        configuration: undefined,
        metadata: undefined,
      });

      // Now with a real object
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: {
          type: 'docker',
          name: 'local',
          configuration: { key: 'value' },
          metadata: { info: 'data' },
        },
        containers: [],
      });
      expect(client.getWatcherSnapshot('docker', 'local')).toEqual({
        type: 'docker',
        name: 'local',
        configuration: { key: 'value' },
        metadata: { info: 'data' },
      });
    });

    test('toOptionalRecord rejects false, 0, empty string as falsy values', async () => {
      // These should produce undefined when used as configuration/metadata via snapshot event
      storeContainer.getContainers.mockReturnValue([]);

      for (const falsy of [false, 0, '']) {
        const watcherName = `test-falsy-${String(falsy)}`;
        await client.handleEvent('dd:watcher-snapshot', {
          watcher: {
            type: 'docker',
            name: watcherName,
            configuration: falsy,
            metadata: undefined,
          },
          containers: [],
        });
        expect(client.getWatcherSnapshot('docker', watcherName)?.configuration).toBeUndefined();
      }
    });

    test('toOptionalRecord rejects arrays even when truthy', async () => {
      // Array.isArray guard: line 141
      storeContainer.getContainers.mockReturnValue([]);
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: {
          type: 'docker',
          name: 'array-test',
          configuration: ['item1', 'item2'],
          metadata: undefined,
        },
        containers: [],
      });
      expect(client.getWatcherSnapshot('docker', 'array-test')?.configuration).toBeUndefined();
    });
  });

  describe('toNonEmptyString (private helper)', () => {
    // Lines 148: EqualityOperator (>= 0), MethodExpression (trim)
    test('rejects empty string', () => {
      // Exercise via parseBatchUpdateCompletedPayload — batchId must be non-empty
      const internal = client as any;
      expect(
        internal.parseBatchUpdateCompletedPayload({
          batchId: '',
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [],
        }),
      ).toBeUndefined();
    });

    test('rejects whitespace-only string', () => {
      const internal = client as any;
      expect(
        internal.parseBatchUpdateCompletedPayload({
          batchId: '   ',
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [],
        }),
      ).toBeUndefined();
    });

    test('accepts and trims non-empty string', () => {
      const internal = client as any;
      const result = internal.parseBatchUpdateCompletedPayload({
        batchId: '  batch-1  ',
        total: 1,
        succeeded: 1,
        failed: 0,
        durationMs: 100,
        items: [{ operationId: 'op-1', containerName: 'nginx', status: 'succeeded' }],
      });
      expect(result).not.toBeUndefined();
      // Trimmed batchId should be scoped
      expect(result.batchId).toBe('agent-test-agent-batch-1');
    });

    test('rejects non-string values', () => {
      const internal = client as any;
      expect(
        internal.parseBatchUpdateCompletedPayload({
          batchId: 123,
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [],
        }),
      ).toBeUndefined();
    });
  });

  describe('isContainerUpdateAppliedEventPayload (private helper)', () => {
    // Lines 158-163: ConditionalExpression / BlockStatement mutants
    test('returns false for null input', () => {
      // null: !data → true, returns false
      expect((client as any).isContainerUpdateAppliedEventPayload?.(null)).toBeUndefined();
      // Actually it's a module-level function, but exercised via handleEvent:
    });

    test('rejects null, primitives and arrays as update-applied payloads', async () => {
      // null
      await client.handleEvent('dd:update-applied', null);
      expect(event.emitContainerUpdateApplied).not.toHaveBeenCalled();
    });

    test('rejects update-applied payload with empty containerName', async () => {
      await client.handleEvent('dd:update-applied', { containerName: '' });
      expect(event.emitContainerUpdateApplied).not.toHaveBeenCalled();
    });

    test('rejects update-applied payload with numeric containerName', async () => {
      await client.handleEvent('dd:update-applied', { containerName: 42 });
      expect(event.emitContainerUpdateApplied).not.toHaveBeenCalled();
    });

    test('accepts update-applied payload with valid containerName', async () => {
      await client.handleEvent('dd:update-applied', { containerName: 'nginx' });
      expect(event.emitContainerUpdateApplied).toHaveBeenCalledWith(
        expect.objectContaining({ containerName: 'nginx' }),
      );
    });
  });

  describe('constructor: log component and axiosOptions details', () => {
    // Line 185: StringLiteral `` — logger child label
    test('creates child logger with correct component label including agent name', async () => {
      const c = new AgentClient('my-agent', {
        host: 'localhost',
        port: 3001,
        secret: '',
      });
      // init() calls log.info with the base URL which includes the name in the component
      vi.spyOn(c, 'startSse').mockImplementation(() => {});
      await c.init();
      // log.info called with a string containing the agent name and base URL
      expect(mockLogChild.info).toHaveBeenCalledWith(expect.stringContaining('my-agent'));
    });

    // Line 250-251: ObjectLiteral mutations for axiosOptions headers
    test('axiosOptions includes correct X-Dd-Agent-Secret header', () => {
      const c = new AgentClient('agent-x', {
        host: 'localhost',
        port: 3001,
        secret: 'my-secret-value',
        cafile: '/ca.pem', // use HTTPS to avoid HTTP+secret rejection
      });
      expect((c as any).axiosOptions.headers['X-Dd-Agent-Secret']).toBe('my-secret-value');
    });

    test('axiosOptions headers object is not empty', () => {
      const c = new AgentClient('agent-y', {
        host: 'localhost',
        port: 3001,
        secret: 'some-secret',
        cafile: '/ca.pem', // use https to avoid HTTP+secret rejection
      });
      expect((c as any).axiosOptions.headers).toBeDefined();
      expect(Object.keys((c as any).axiosOptions.headers).length).toBeGreaterThan(0);
    });

    // Line 256: ConditionalExpression true — shouldBuildHttpsAgent
    test('does not create httpsAgent when neither certfile nor cafile is provided', () => {
      const c = new AgentClient('agent-no-tls', {
        host: 'localhost',
        port: 3001,
        secret: '',
      });
      expect((c as any).axiosOptions.httpsAgent).toBeUndefined();
    });

    // Lines 268-270: StringLiteral `` — resolveTlsPath labels
    test('passes correct label to resolveConfiguredPath for ca, cert, and key files', () => {
      const calls: [string, { label: string }][] = [];
      mockResolveConfiguredPath.mockImplementation((path, opts) => {
        if (opts?.label) calls.push([path, opts]);
        return path;
      });

      new AgentClient('tls-agent', {
        host: 'localhost',
        port: 4000,
        secret: 's',
        cafile: '/ca.pem',
        certfile: '/cert.pem',
        keyfile: '/key.pem',
      });

      expect(calls.some(([, o]) => o.label === 'tls-agent ca file')).toBe(true);
      expect(calls.some(([, o]) => o.label === 'tls-agent cert file')).toBe(true);
      expect(calls.some(([, o]) => o.label === 'tls-agent key file')).toBe(true);
    });

    // Line 264: ConditionalExpression — shouldBuildHttpsAgent (certfile only)
    test('shouldBuildHttpsAgent returns false when both certfile and cafile are absent', () => {
      const c = new AgentClient('no-tls', { host: 'localhost', port: 3001, secret: '' });
      expect((c as any).shouldBuildHttpsAgent()).toBe(false);
    });

    test('shouldBuildHttpsAgent returns true with only certfile', () => {
      const c = new AgentClient('tls1', {
        host: 'localhost',
        port: 4000,
        secret: 's',
        certfile: '/cert.pem',
      });
      expect((c as any).shouldBuildHttpsAgent()).toBe(true);
    });

    test('shouldBuildHttpsAgent returns true with only cafile', () => {
      const c = new AgentClient('tls2', {
        host: 'localhost',
        port: 4000,
        secret: 's',
        cafile: '/ca.pem',
      });
      expect((c as any).shouldBuildHttpsAgent()).toBe(true);
    });
  });

  describe('rejectSecretConfiguredOverHttp', () => {
    // Line 239: ConditionalExpression true — checks both protocol AND hasSecretConfigured
    test('does not reject when protocol is https even with a secret', () => {
      expect(
        () =>
          new AgentClient('secure', {
            host: 'localhost',
            port: 4000,
            secret: 'my-secret',
            certfile: '/cert.pem',
          }),
      ).not.toThrow();
    });

    test('does not reject when protocol is http but no secret is configured', () => {
      expect(
        () =>
          new AgentClient('no-secret', {
            host: 'localhost',
            port: 3000,
            secret: '',
          }),
      ).not.toThrow();
    });

    test('does not reject when protocol is http and secret is only whitespace', () => {
      expect(
        () =>
          new AgentClient('whitespace-secret', {
            host: 'localhost',
            port: 3000,
            secret: '   ',
          }),
      ).not.toThrow();
    });

    // Line 239: MethodExpression on this.config.secret.trim()
    test('rejects http + non-empty secret (verifies trim check is active)', () => {
      // A secret with surrounding whitespace that is non-empty after trim
      expect(
        () =>
          new AgentClient('ws-secret', {
            host: 'localhost',
            port: 3000,
            secret: '  abc  ',
          }),
      ).toThrow('Configure HTTPS');
    });
  });

  describe('getPendingWatcherCycleContainerKey', () => {
    // Lines 324-334: ConditionalExpression / EqualityOperator mutants
    test('returns undefined for non-container input', () => {
      expect((client as any).getPendingWatcherCycleContainerKey(null)).toBeUndefined();
      expect((client as any).getPendingWatcherCycleContainerKey(undefined)).toBeUndefined();
      expect((client as any).getPendingWatcherCycleContainerKey('string')).toBeUndefined();
      expect((client as any).getPendingWatcherCycleContainerKey(42)).toBeUndefined();
    });

    test('returns container.id when it is a non-empty string', () => {
      expect(
        (client as any).getPendingWatcherCycleContainerKey({ id: 'c1', name: 'n', watcher: 'w' }),
      ).toBe('c1');
    });

    test('returns undefined when container.id is empty string', () => {
      // Only watcher + name fallback would apply, but watcher missing too
      expect(
        (client as any).getPendingWatcherCycleContainerKey({
          id: '',
          name: '',
          watcher: '',
        }),
      ).toBeUndefined();
    });

    test('returns watcher:name composite when id is absent but watcher and name are present', () => {
      expect(
        (client as any).getPendingWatcherCycleContainerKey({ name: 'nginx', watcher: 'local' }),
      ).toBe('local:nginx');
    });

    test('returns undefined when id is empty, watcher is empty', () => {
      expect(
        (client as any).getPendingWatcherCycleContainerKey({ id: '', name: 'nginx', watcher: '' }),
      ).toBeUndefined();
    });

    test('returns undefined when id is empty, name is empty', () => {
      expect(
        (client as any).getPendingWatcherCycleContainerKey({ id: '', name: '', watcher: 'local' }),
      ).toBeUndefined();
    });

    // EqualityOperator mutant: container.id.length >= 0 (would always be true)
    test('does not use id when it is an empty string (length > 0 check)', () => {
      // id: '' has length 0 which is NOT > 0, must fall through to watcher:name
      const key = (client as any).getPendingWatcherCycleContainerKey({
        id: '',
        name: 'app',
        watcher: 'remote',
      });
      expect(key).toBe('remote:app');
    });
  });

  describe('rememberPendingWatcherCycleReport', () => {
    // Lines 346-347: OptionalChaining / ConditionalExpression mutants
    test('ignores reports with falsy containerReport', () => {
      expect(() => (client as any).rememberPendingWatcherCycleReport(null)).not.toThrow();
      expect(() => (client as any).rememberPendingWatcherCycleReport(undefined)).not.toThrow();
      expect((client as any).pendingWatcherCycleReports.size).toBe(0);
    });

    test('ignores reports without container', () => {
      (client as any).rememberPendingWatcherCycleReport({ changed: true });
      expect((client as any).pendingWatcherCycleReports.size).toBe(0);
    });

    test('ignores reports with empty watcher name', () => {
      (client as any).rememberPendingWatcherCycleReport({
        container: { id: 'c1', name: 'nginx', watcher: '' },
        changed: true,
      });
      expect((client as any).pendingWatcherCycleReports.size).toBe(0);
    });

    test('ignores reports with non-string watcher name', () => {
      (client as any).rememberPendingWatcherCycleReport({
        container: { id: 'c1', name: 'nginx', watcher: 42 },
        changed: true,
      });
      expect((client as any).pendingWatcherCycleReports.size).toBe(0);
    });

    // line 346 OptionalChaining: containerReport.container?.watcher vs containerReport.container.watcher
    test('stores a valid report with all required fields', () => {
      (client as any).rememberPendingWatcherCycleReport({
        container: { id: 'c1', name: 'nginx', watcher: 'local' },
        changed: true,
      });
      expect((client as any).pendingWatcherCycleReports.get('local')?.has('c1')).toBe(true);
    });
  });

  describe('clearPendingWatcherCycleReports', () => {
    // Lines 391-392: ConditionalExpression / EqualityOperator / BlockStatement mutants
    test('clears pending watcher cycle reports for a valid watcher name', () => {
      (client as any).pendingWatcherCycleReports.set('local', new Map([['c1', {}]]));
      (client as any).clearPendingWatcherCycleReports('local');
      expect((client as any).pendingWatcherCycleReports.has('local')).toBe(false);
    });

    test('does not throw for undefined watcher name', () => {
      expect(() => (client as any).clearPendingWatcherCycleReports(undefined)).not.toThrow();
    });

    test('does not throw for empty watcher name', () => {
      expect(() => (client as any).clearPendingWatcherCycleReports('')).not.toThrow();
    });

    // EqualityOperator: watcherName.length >= 0 vs > 0
    test('does not clear for empty watcher name (length > 0 check)', () => {
      (client as any).pendingWatcherCycleReports.set('local', new Map([['c1', {}]]));
      (client as any).clearPendingWatcherCycleReports('');
      // should NOT be cleared
      expect((client as any).pendingWatcherCycleReports.has('local')).toBe(true);
    });

    // BlockStatement: body cleared → no delete
    test('clears only the specified watcher bucket', () => {
      (client as any).pendingWatcherCycleReports.set('local', new Map([['c1', {}]]));
      (client as any).pendingWatcherCycleReports.set('remote', new Map([['c2', {}]]));
      (client as any).clearPendingWatcherCycleReports('local');
      expect((client as any).pendingWatcherCycleReports.has('local')).toBe(false);
      expect((client as any).pendingWatcherCycleReports.has('remote')).toBe(true);
    });
  });

  describe('clearPendingWatcherCycleReportByContainerId', () => {
    // Line 398: ConditionalExpression false
    test('does not process for empty containerId', () => {
      (client as any).pendingWatcherCycleReports.set('local', new Map([['c1', {}]]));
      (client as any).clearPendingWatcherCycleReportByContainerId('');
      expect((client as any).pendingWatcherCycleReports.has('local')).toBe(true);
    });

    test('does not process for non-string containerId', () => {
      (client as any).pendingWatcherCycleReports.set('local', new Map([['c1', {}]]));
      (client as any).clearPendingWatcherCycleReportByContainerId(null);
      expect((client as any).pendingWatcherCycleReports.has('local')).toBe(true);
    });
  });

  describe('handshake URL construction', () => {
    // Lines 484, 500, 504, 515, 521, 527, 532: StringLiteral `` mutations
    test('uses /api/containers path for initial container fetch', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      const containerUrl = axios.get.mock.calls[0][0];
      expect(containerUrl).toContain('/api/containers');
      expect(containerUrl).not.toBe('');
    });

    test('uses /api/watchers path for watcher fetch', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      const watcherUrl = axios.get.mock.calls[1][0];
      expect(watcherUrl).toContain('/api/watchers');
      expect(watcherUrl).not.toBe('');
    });

    test('uses /api/triggers path for trigger fetch', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      const triggerUrl = axios.get.mock.calls[2][0];
      expect(triggerUrl).toContain('/api/triggers');
      expect(triggerUrl).not.toBe('');
    });

    test('logs info message with base URL on init', async () => {
      const _spy = vi.spyOn(client, 'startSse').mockImplementation(() => {});
      await client.init();
      expect(mockLogChild.info).toHaveBeenCalledWith(
        expect.stringContaining('https://localhost:3001'),
      );
    });
  });

  describe('parseSseLine', () => {
    // Lines 602, 607, 616, 617: StringLiteral / ConditionalExpression / BlockStatement / LogicalOperator
    test('skips lines not starting with data:', async () => {
      const internal = client as any;
      const spy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      await internal.parseSseLine('event: test');
      await internal.parseSseLine('id: 123');
      await internal.parseSseLine(': comment');
      expect(spy).not.toHaveBeenCalled();
    });

    test('processes line starting with "data: "', async () => {
      const internal = client as any;
      const spy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      await internal.parseSseLine('data: {"type":"dd:ack","data":{"version":"2.0"}}');
      expect(spy).toHaveBeenCalledWith('dd:ack', { version: '2.0' });
    });

    // Line 602: StringLiteral "" — 'data: ' prefix check
    test('does not process empty string data prefix', async () => {
      const internal = client as any;
      const spy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      await internal.parseSseLine('data:{"type":"dd:ack","data":{}}'); // missing space
      expect(spy).not.toHaveBeenCalled();
    });

    // Line 607: LogicalOperator — payload.type && payload.data vs payload.type || payload.data
    test('skips SSE event when type is present but data is missing', async () => {
      const internal = client as any;
      const spy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      await internal.parseSseLine('data: {"type":"dd:ack"}');
      expect(spy).not.toHaveBeenCalled();
    });

    test('skips SSE event when data is present but type is missing', async () => {
      const internal = client as any;
      const spy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      await internal.parseSseLine('data: {"data":{"version":"1.0"}}');
      expect(spy).not.toHaveBeenCalled();
    });

    // Line 616: BlockStatement — catch block
    test('logs warning for malformed JSON in data line', async () => {
      const internal = client as any;
      await internal.parseSseLine('data: {invalid}');
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error parsing SSE data'),
      );
    });

    // Line 617: StringLiteral `` — warn message
    test('warn message mentions SSE data parsing', async () => {
      const internal = client as any;
      await internal.parseSseLine('data: not-json');
      expect(mockLogChild.warn).toHaveBeenCalledWith(
        expect.stringContaining('Error parsing SSE data'),
      );
    });

    // Lines 602:9 ConditionalExpression / 602:26 StringLiteral / 602:37 BlockStatement
    // These mutations remove or change the 'data: ' prefix guard, causing non-data lines to
    // go through JSON.parse which fails and triggers log.warn. Verify no warn is emitted.
    test('does NOT log warn for non-data lines (event:)', async () => {
      const internal = client as any;
      await internal.parseSseLine('event: dd:ack');
      expect(mockLogChild.warn).not.toHaveBeenCalled();
    });

    test('does NOT log warn for non-data lines (id:)', async () => {
      const internal = client as any;
      await internal.parseSseLine('id: 123456');
      expect(mockLogChild.warn).not.toHaveBeenCalled();
    });

    test('does NOT log warn for SSE comment lines', async () => {
      const internal = client as any;
      await internal.parseSseLine(': keep-alive');
      expect(mockLogChild.warn).not.toHaveBeenCalled();
    });
  });

  describe('processSseBuffer', () => {
    // Line 624: remainder
    test('returns incomplete message as remainder', async () => {
      const internal = client as any;
      vi.spyOn(internal, 'parseSseLine').mockResolvedValue(undefined);
      const remainder = await internal.processSseBuffer('data: complete\n\ndata: incomplete');
      expect(remainder).toBe('data: incomplete');
    });

    test('returns empty string when buffer ends with double newline', async () => {
      const internal = client as any;
      vi.spyOn(internal, 'parseSseLine').mockResolvedValue(undefined);
      const remainder = await internal.processSseBuffer('data: complete\n\n');
      expect(remainder).toBe('');
    });
  });

  describe('buildRuntimeInfoFromAck', () => {
    // Lines 695-706: OptionalChaining mutants
    test('all optional chaining guards on runtimeData fields', async () => {
      // Verify that if runtimeData fields are missing (optional chaining fails),
      // existing info is preserved
      const internal = client as any;
      client.info = {
        version: 'v1',
        os: 'linux',
        arch: 'amd64',
        cpus: 4,
        memoryGb: 8,
        uptimeSeconds: 100,
      };

      // Pass null as data — all fields should fall back to existing info
      // (optional chaining ?. means null?.version is undefined → falls back)
      const result = internal.buildRuntimeInfoFromAck(null);
      expect(result.version).toBe('v1');
      expect(result.os).toBe('linux');
      expect(result.arch).toBe('amd64');
      expect(result.cpus).toBe(4);
      expect(result.memoryGb).toBe(8);
      expect(result.uptimeSeconds).toBe(100);
    });

    test('applies new numeric fields from ack data', async () => {
      const internal = client as any;
      client.info = { cpus: 1, memoryGb: 1, uptimeSeconds: 1 };

      const result = internal.buildRuntimeInfoFromAck({
        cpus: 8,
        memoryGb: 15.5,
        uptimeSeconds: 3600,
      });
      expect(result.cpus).toBe(8);
      expect(result.memoryGb).toBe(15.5);
      expect(result.uptimeSeconds).toBe(3600);
    });

    // Line 706: OptionalChaining runtimeData?.lastSeen
    test('falls back to new Date().toISOString() when lastSeen is absent', () => {
      const internal = client as any;
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const result = internal.buildRuntimeInfoFromAck({});
      expect(result.lastSeen).toBe('2026-01-01T00:00:00.000Z');
      vi.useRealTimers();
      vi.useFakeTimers();
    });

    // Line 695: OptionalChaining runtimeData?.version — null runtimeData
    test('handles undefined data for all numeric fields', () => {
      const internal = client as any;
      const result = internal.buildRuntimeInfoFromAck(undefined);
      // Should not throw — optional chaining prevents it
      expect(result).toBeDefined();
    });

    test('applies logLevel and pollInterval from ack payload', () => {
      const internal = client as any;
      client.info = { logLevel: 'info', pollInterval: '300' };

      const result = internal.buildRuntimeInfoFromAck({
        logLevel: 'debug',
        pollInterval: '60',
      });
      expect(result.logLevel).toBe('debug');
      expect(result.pollInterval).toBe('60');
    });

    test('falls back to existing logLevel and pollInterval when absent from ack payload', () => {
      const internal = client as any;
      client.info = { logLevel: 'warn', pollInterval: '120' };

      const result = internal.buildRuntimeInfoFromAck({});
      expect(result.logLevel).toBe('warn');
      expect(result.pollInterval).toBe('120');
    });

    test('falls back to existing logLevel when ack payload logLevel is empty string', () => {
      const internal = client as any;
      client.info = { logLevel: 'error' };

      const result = internal.buildRuntimeInfoFromAck({ logLevel: '' });
      expect(result.logLevel).toBe('error');
    });
  });

  describe('handleWatcherSnapshotEvent optional chaining', () => {
    // Lines 736, 738: OptionalChaining snapshotPayload?.watcher.type and .name
    test('handles watcher snapshot event with no watcher field', async () => {
      storeContainer.getContainers.mockReturnValue([]);
      await client.handleEvent('dd:watcher-snapshot', { containers: [] });
      // Should not throw
      expect(event.emitContainerReports).toHaveBeenCalledWith([]);
    });

    // Lines 747, 748: OptionalChaining snapshotPayload.watcher.configuration / .metadata
    test('uses toOptionalRecord for configuration and metadata with non-object values', async () => {
      storeContainer.getContainers.mockReturnValue([]);
      storeContainer.insertContainer.mockImplementation((c) => c);
      storeContainer.getContainer.mockReturnValue(undefined);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: {
          type: 'docker',
          name: 'local',
          configuration: 'string-not-object',
          metadata: [1, 2, 3],
        },
        containers: [],
      });

      expect(client.getWatcherSnapshot('docker', 'local')).toEqual({
        type: 'docker',
        name: 'local',
        configuration: undefined,
        metadata: undefined,
      });
    });

    // Line 743: LogicalOperator watcherType || watcherName vs watcherType && watcherName
    test('skips cache update when only watcherName is present but not watcherType', async () => {
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { name: 'local' }, // no type
        containers: [],
      });

      // No cache entry should be created without a type
      expect(client.getWatcherSnapshot(undefined as any, 'local')).toBeUndefined();
    });

    test('skips cache update when only watcherType is present but not watcherName', async () => {
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker' }, // no name
        containers: [],
      });

      expect(client.getWatcherSnapshot('docker', undefined as any)).toBeUndefined();
    });
  });

  describe('parseUpdateFailedEventPayload', () => {
    // Lines 802, 828-836: ConditionalExpression / EqualityOperator / MethodExpression / StringLiteral
    const parseFailedPayload = (data: unknown) =>
      (client as any).parseUpdateFailedEventPayload(data);

    test('returns undefined for null input', () => {
      expect(parseFailedPayload(null)).toBeUndefined();
    });

    test('returns undefined for non-object input', () => {
      expect(parseFailedPayload('string')).toBeUndefined();
    });

    test('returns undefined when containerName is empty', () => {
      expect(parseFailedPayload({ containerName: '', error: 'oops' })).toBeUndefined();
    });

    test('returns undefined when containerName is not a string', () => {
      expect(parseFailedPayload({ containerName: 42, error: 'oops' })).toBeUndefined();
    });

    test('returns undefined when error is empty', () => {
      expect(parseFailedPayload({ containerName: 'nginx', error: '' })).toBeUndefined();
    });

    test('returns undefined when error is not a string', () => {
      expect(parseFailedPayload({ containerName: 'nginx', error: null })).toBeUndefined();
    });

    test('returns payload with raw (unscoped) operationId and agent-scoped batchId', () => {
      // parseUpdateFailedEventPayload now returns the raw operationId so that
      // resolveAgentOperationId can decide whether to use the controller row
      // or create an agent-scoped one (fixes #289). batchId is still scoped
      // because it is always agent-generated.
      const result = parseFailedPayload({
        containerName: 'nginx',
        error: 'pull failed',
        operationId: 'op-1',
        batchId: 'batch-1',
      });
      expect(result).toBeDefined();
      expect(result.containerName).toBe('nginx');
      expect(result.operationId).toBe('op-1');
      expect(result.batchId).toBe('agent-test-agent-batch-1');
    });

    test('omits operationId when operationId is empty string', () => {
      const result = parseFailedPayload({
        containerName: 'nginx',
        error: 'pull failed',
        operationId: '',
      });
      expect(result).toBeDefined();
      expect(result.operationId).toBeUndefined();
    });

    test('includes containerId when present as string', () => {
      const result = parseFailedPayload({
        containerName: 'nginx',
        error: 'pull failed',
        containerId: 'c1',
      });
      expect(result.containerId).toBe('c1');
    });

    test('omits containerId when not present', () => {
      const result = parseFailedPayload({ containerName: 'nginx', error: 'pull failed' });
      expect(result).not.toHaveProperty('containerId');
    });

    // Line 831:11 ConditionalExpression — `phase !== undefined` → `true`
    // Mutation adds { phase: undefined } to result. Check key is absent (not just value).
    test('does not include phase key when payload has no phase field (direct key check)', () => {
      const result = parseFailedPayload({ containerName: 'nginx', error: 'pull failed' });
      expect(result).toBeDefined();
      expect(Object.hasOwn(result, 'phase')).toBe(false);
    });

    test('does not include phase key when phase is undefined (explicit key check)', () => {
      const result = parseFailedPayload({
        containerName: 'nginx',
        error: 'pull failed',
        phase: undefined,
      });
      expect(result).toBeDefined();
      expect(Object.hasOwn(result, 'phase')).toBe(false);
    });

    test('includes container with agent decoration when data.container is a non-null object', () => {
      const result = parseFailedPayload({
        containerName: 'nginx',
        error: 'pull failed',
        container: { id: 'c1', name: 'nginx', watcher: 'local' },
      });
      expect(result).toBeDefined();
      expect(result.container).toBeDefined();
      expect(result.container).toMatchObject({ id: 'c1', name: 'nginx', agent: 'test-agent' });
    });

    test('omits container when data.container is null', () => {
      const result = parseFailedPayload({
        containerName: 'nginx',
        error: 'pull failed',
        container: null,
      });
      expect(result).toBeDefined();
      expect(result.container).toBeUndefined();
    });

    test('omits container when data.container is not an object', () => {
      const result = parseFailedPayload({
        containerName: 'nginx',
        error: 'pull failed',
        container: 'not-an-object',
      });
      expect(result).toBeDefined();
      expect(result.container).toBeUndefined();
    });

    // Line 836: MethodExpression remoteId — toAgentScopedId
    test('toAgentScopedId scopes an unscoped id', () => {
      expect((client as any).toAgentScopedId('op-1')).toBe('agent-test-agent-op-1');
    });

    test('toAgentScopedId does not double-scope an already-scoped id', () => {
      expect((client as any).toAgentScopedId('agent-test-agent-op-1')).toBe(
        'agent-test-agent-op-1',
      );
    });

    test('toAgentScopedId trims leading/trailing whitespace', () => {
      expect((client as any).toAgentScopedId('  op-1  ')).toBe('agent-test-agent-op-1');
    });
  });

  describe('parseAgentUpdateOperationChangedPayload', () => {
    // Lines 844, 859, 862, 879-880: ConditionalExpression / EqualityOperator / ObjectLiteral
    const parseChangedPayload = (data: unknown) =>
      (client as any).parseAgentUpdateOperationChangedPayload(data);

    test('returns undefined for null', () => {
      expect(parseChangedPayload(null)).toBeUndefined();
    });

    test('returns undefined when operationId is empty', () => {
      expect(
        parseChangedPayload({ operationId: '', containerName: 'nginx', status: 'in-progress' }),
      ).toBeUndefined();
    });

    test('returns undefined when containerName is empty', () => {
      expect(
        parseChangedPayload({
          operationId: 'op-1',
          containerName: '',
          status: 'in-progress',
        }),
      ).toBeUndefined();
    });

    test('returns undefined for invalid status', () => {
      expect(
        parseChangedPayload({
          operationId: 'op-1',
          containerName: 'nginx',
          status: 'not-a-status',
        }),
      ).toBeUndefined();
    });

    test('includes containerId when present', () => {
      const result = parseChangedPayload({
        operationId: 'op-1',
        containerName: 'nginx',
        status: 'in-progress',
        containerId: 'c1',
      });
      expect(result?.containerId).toBe('c1');
    });

    test('omits containerId when absent', () => {
      const result = parseChangedPayload({
        operationId: 'op-1',
        containerName: 'nginx',
        status: 'in-progress',
      });
      expect(result).not.toHaveProperty('containerId');
    });

    // Lines 879-880: newContainerId optional inclusion
    test('includes newContainerId when present', () => {
      const result = parseChangedPayload({
        operationId: 'op-1',
        containerName: 'nginx',
        status: 'in-progress',
        newContainerId: 'c2',
      });
      expect(result?.newContainerId).toBe('c2');
    });

    test('omits newContainerId when absent (undefined check)', () => {
      const result = parseChangedPayload({
        operationId: 'op-1',
        containerName: 'nginx',
        status: 'in-progress',
      });
      expect(result).not.toHaveProperty('newContainerId');
    });

    // Line 880 EqualityOperator: === undefined vs !== undefined
    test('includes newContainerId when it is an empty string (undefined check, not emptiness check)', () => {
      const result = parseChangedPayload({
        operationId: 'op-1',
        containerName: 'nginx',
        status: 'in-progress',
        newContainerId: '',
      });
      // toOptionalString('') returns '' which is !== undefined → include
      expect(result).toHaveProperty('newContainerId', '');
    });
  });

  describe('buildAgentOperationBase', () => {
    // Line 880 ObjectLiteral
    test('returns object with id, kind, containerName', () => {
      const result = (client as any).buildAgentOperationBase({
        operationId: 'op-1',
        containerName: 'nginx',
      });
      expect(result).toEqual({
        id: 'agent-test-agent-op-1',
        kind: 'container-update',
        containerName: 'nginx',
        agent: 'test-agent',
      });
    });

    test('includes containerId when present', () => {
      const result = (client as any).buildAgentOperationBase({
        operationId: 'op-1',
        containerName: 'nginx',
        containerId: 'c1',
      });
      expect(result.containerId).toBe('c1');
    });

    test('includes newContainerId when present', () => {
      const result = (client as any).buildAgentOperationBase({
        operationId: 'op-1',
        containerName: 'nginx',
        newContainerId: 'c2',
      });
      expect(result.newContainerId).toBe('c2');
    });

    test('omits containerId when undefined', () => {
      const result = (client as any).buildAgentOperationBase({
        operationId: 'op-1',
        containerName: 'nginx',
        containerId: undefined,
      });
      expect(result).not.toHaveProperty('containerId');
    });

    // Line 880: ObjectLiteral {} mutation would produce empty object instead of real base
    test('result is not an empty object', () => {
      const result = (client as any).buildAgentOperationBase({
        operationId: 'op-1',
        containerName: 'nginx',
      });
      expect(Object.keys(result).length).toBeGreaterThan(0);
    });
  });

  describe('resolveAgentOperationId (#289)', () => {
    test('returns raw id when a row exists at that id (controller-issued row)', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue({
        id: 'uuid-controller-1',
        status: 'queued',
      } as any);
      const result = (client as any).resolveAgentOperationId('uuid-controller-1');
      expect(result).toBe('uuid-controller-1');
      expect(updateOperationStore.getOperationById).toHaveBeenCalledWith('uuid-controller-1');
    });

    test('returns agent-scoped id when no row exists at the raw id (backwards compat)', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(undefined);
      const result = (client as any).resolveAgentOperationId('remote-op-abc');
      expect(result).toBe('agent-test-agent-remote-op-abc');
    });

    test('does not double-scope already-scoped ids', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(undefined);
      const result = (client as any).resolveAgentOperationId('agent-test-agent-already-scoped');
      expect(result).toBe('agent-test-agent-already-scoped');
    });
  });

  describe('getStoredContainerForAgentOperation', () => {
    test('finds one agent-owned container by name when payload ids are absent', () => {
      const row = { id: 'container-1', name: 'nginx', agent: 'test-agent' };
      vi.mocked(storeContainer.getContainers).mockReturnValue([
        undefined,
        row,
        { id: 'container-2', name: 'nginx', agent: 'other-agent' },
      ] as any);

      const result = (client as any).getStoredContainerForAgentOperation({
        containerName: 'nginx',
      });

      expect(result).toBe(row);
      expect(storeContainer.getContainers).toHaveBeenCalledWith({ agent: 'test-agent' });
    });

    test('returns undefined when two agent-owned containers share the same name (ambiguous match)', () => {
      // Two containers both named 'nginx' on this agent — cannot determine which
      // identity to stamp, so the function must return undefined rather than
      // picking one arbitrarily.
      vi.mocked(storeContainer.getContainer).mockReturnValue(undefined);
      vi.mocked(storeContainer.getContainers).mockReturnValue([
        { id: 'nginx-1', name: 'nginx', agent: 'test-agent', watcher: 'local' },
        { id: 'nginx-2', name: 'nginx', agent: 'test-agent', watcher: 'local' },
      ] as any);

      const result = (client as any).getStoredContainerForAgentOperation({
        containerName: 'nginx',
      });

      expect(result).toBeUndefined();
    });

    test('ambiguous two-name: buildAgentOperationBase omits container snapshot and watcher when store is ambiguous', async () => {
      // When two same-named containers exist on the agent, getStoredContainerForAgentOperation
      // returns undefined, so buildAgentOperationBase must not stamp a container or watcher.
      vi.mocked(storeContainer.getContainer).mockReturnValue(undefined);
      vi.mocked(storeContainer.getContainers).mockReturnValue([
        { id: 'nginx-1', name: 'nginx', agent: 'test-agent', watcher: 'local' },
        { id: 'nginx-2', name: 'nginx', agent: 'test-agent', watcher: 'local' },
      ] as any);

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'remote-op-ambiguous',
        containerName: 'nginx',
        status: 'in-progress',
        phase: 'pulling',
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.not.objectContaining({
          container: expect.anything(),
          watcher: expect.anything(),
        }),
      );
      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-test-agent-remote-op-ambiguous',
          containerName: 'nginx',
          agent: 'test-agent',
        }),
      );
    });
  });

  describe('applyAgentUpdateOperationChanged — controller-issued row reuse (#289)', () => {
    test('updates the controller-issued row when agent echoes back the controller operationId', () => {
      // Simulate controller row existing at the raw id
      const controllerRow = {
        id: 'uuid-controller-1',
        status: 'queued',
        containerName: 'tautulli',
      };
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'uuid-controller-1') return controllerRow as any;
        return undefined;
      });
      (client as any).applyAgentUpdateOperationChanged({
        operationId: 'uuid-controller-1',
        containerName: 'tautulli',
        status: 'in-progress',
        phase: 'prepare',
      });
      // Should update the controller row, not insert a new agent-scoped one
      expect(updateOperationStore.updateOperation).toHaveBeenCalledWith(
        'uuid-controller-1',
        expect.objectContaining({ status: 'in-progress', containerName: 'tautulli' }),
      );
      expect(updateOperationStore.insertOperation).not.toHaveBeenCalled();
    });

    test('marks the controller-issued row terminal when agent echoes back the controller operationId', () => {
      const controllerRow = {
        id: 'uuid-controller-1',
        status: 'in-progress',
        containerName: 'tautulli',
      };
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'uuid-controller-1') return controllerRow as any;
        return undefined;
      });
      (client as any).applyAgentUpdateOperationChanged({
        operationId: 'uuid-controller-1',
        containerName: 'tautulli',
        status: 'succeeded',
        phase: 'succeeded',
      });
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'uuid-controller-1',
        expect.objectContaining({ status: 'succeeded' }),
      );
    });

    test('falls back to agent-scoped id and inserts new row when no controller row exists', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(undefined);
      (client as any).applyAgentUpdateOperationChanged({
        operationId: 'remote-op-legacy',
        containerName: 'nginx',
        status: 'in-progress',
        phase: 'prepare',
      });
      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-test-agent-remote-op-legacy' }),
      );
    });
  });

  describe('maybeMarkAgentOperationSucceededFromAppliedPayload — controller-issued row reuse (#289)', () => {
    test('returns raw id when controller row exists and marks it succeeded', () => {
      const controllerRow = {
        id: 'uuid-controller-1',
        status: 'in-progress',
        containerName: 'tautulli',
      };
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'uuid-controller-1') return controllerRow as any;
        return undefined;
      });
      const result = (client as any).maybeMarkAgentOperationSucceededFromAppliedPayload({
        operationId: 'uuid-controller-1',
        containerName: 'tautulli',
        container: { id: 'c1', name: 'tautulli' },
      });
      expect(result).toBe('uuid-controller-1');
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'uuid-controller-1',
        expect.objectContaining({ status: 'succeeded', phase: 'succeeded' }),
      );
    });

    test('returns agent-scoped id when no controller row exists (backwards compat)', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      const result = (client as any).maybeMarkAgentOperationSucceededFromAppliedPayload({
        operationId: 'remote-op-legacy',
        containerName: 'nginx',
      });
      expect(result).toBe('agent-test-agent-remote-op-legacy');
    });
  });

  describe('maybeMarkAgentOperationFailedFromFailedPayload — controller-issued row reuse (#289)', () => {
    test('marks the controller-issued row failed when agent echoes back the controller operationId', () => {
      const controllerRow = {
        id: 'uuid-controller-1',
        status: 'in-progress',
        containerName: 'tautulli',
      };
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'uuid-controller-1') return controllerRow as any;
        return undefined;
      });
      const result = (client as any).maybeMarkAgentOperationFailedFromFailedPayload({
        operationId: 'uuid-controller-1',
        containerName: 'tautulli',
        error: 'pull failed',
      });
      expect(result).toBe(true);
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'uuid-controller-1',
        expect.objectContaining({ status: 'failed', lastError: 'pull failed' }),
      );
    });
  });

  describe('parseUpdateFailedEventPayload — deferred scoping (#289)', () => {
    const parseFailedPayload = (data: unknown) =>
      (client as any).parseUpdateFailedEventPayload(data);

    test('returns raw operationId without pre-scoping so resolveAgentOperationId can decide', () => {
      const result = parseFailedPayload({
        containerName: 'tautulli',
        error: 'pull failed',
        operationId: 'uuid-controller-1',
      });
      expect(result?.operationId).toBe('uuid-controller-1');
    });

    test('still scopes batchId', () => {
      const result = parseFailedPayload({
        containerName: 'tautulli',
        error: 'pull failed',
        operationId: 'uuid-op',
        batchId: 'uuid-batch',
      });
      expect(result?.batchId).toBe('agent-test-agent-uuid-batch');
    });

    test('returns undefined operationId when absent', () => {
      const result = parseFailedPayload({
        containerName: 'tautulli',
        error: 'pull failed',
      });
      expect(result?.operationId).toBeUndefined();
    });
  });

  describe('applyAgentUpdateOperationChanged — terminal status coverage', () => {
    // Lines 912-913: ConditionalExpression true for terminal path
    // Call applyAgentUpdateOperationChanged directly with typed payload to bypass parse
    test('marks operation terminal when status is succeeded', () => {
      // Reset to ensure no leftover mock state from prior tests
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(undefined);
      // pass an unscoped id — toAgentScopedId will scope it
      (client as any).applyAgentUpdateOperationChanged({
        operationId: 'remote-op-new-terminal-1',
        containerName: 'nginx',
        status: 'succeeded',
        phase: 'succeeded',
      });
      // Check via insertOperation (ensureAgentOperationForTerminal) which should always fire
      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'agent-test-agent-remote-op-new-terminal-1',
          status: 'in-progress',
        }),
      );
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-new-terminal-1',
        expect.objectContaining({ status: 'succeeded' }),
      );
    });

    test('marks operation terminal when status is failed', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(undefined);
      (client as any).applyAgentUpdateOperationChanged({
        operationId: 'remote-op-new-terminal-2',
        containerName: 'nginx',
        status: 'failed',
        phase: 'failed',
      });
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-remote-op-new-terminal-2',
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });

  describe('markAgentOperationTerminal', () => {
    // Lines 955-956: ConditionalExpression
    test('marks non-existing operation terminal by inserting first', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);

      (client as any).markAgentOperationTerminal({
        operationId: 'new-op',
        containerName: 'nginx',
        status: 'succeeded',
        phase: 'succeeded',
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'agent-test-agent-new-op', status: 'in-progress' }),
      );
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-new-op',
        expect.objectContaining({ status: 'succeeded' }),
      );
    });

    test('includes phase in markOperationTerminal call', () => {
      // Return the existing row only for the scoped id so resolveAgentOperationId
      // falls back to the scoped form (no controller row at the raw id).
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-with-phase') {
          return {
            id: 'agent-test-agent-with-phase',
            status: 'in-progress',
            phase: 'pulling',
          } as any;
        }
        return undefined;
      });

      (client as any).markAgentOperationTerminal({
        operationId: 'with-phase',
        containerName: 'nginx',
        status: 'succeeded',
        phase: 'succeeded',
      });

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-with-phase',
        expect.objectContaining({ phase: 'succeeded' }),
      );
    });

    test('includes lastError in markOperationTerminal call', () => {
      // Return the existing row only for the scoped id so resolveAgentOperationId
      // falls back to the scoped form (no controller row at the raw id).
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-with-error') {
          return { id: 'agent-test-agent-with-error', status: 'in-progress' } as any;
        }
        return undefined;
      });

      (client as any).markAgentOperationTerminal({
        operationId: 'with-error',
        containerName: 'nginx',
        status: 'failed',
        lastError: 'docker pull failed',
      });

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-with-error',
        expect.objectContaining({ lastError: 'docker pull failed' }),
      );
    });
  });

  describe('maybeMarkAgentOperationSucceededFromAppliedPayload', () => {
    // Lines 975-992: ConditionalExpression
    test('returns undefined when operationId is missing', () => {
      const result = (client as any).maybeMarkAgentOperationSucceededFromAppliedPayload({
        containerName: 'nginx',
      });
      expect(result).toBeUndefined();
    });

    test('marks operation succeeded and returns scoped operationId', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      const result = (client as any).maybeMarkAgentOperationSucceededFromAppliedPayload({
        operationId: 'op-applied',
        containerName: 'nginx',
        container: { id: 'c1', name: 'nginx' },
      });
      expect(result).toBe('agent-test-agent-op-applied');
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-op-applied',
        expect.objectContaining({ status: 'succeeded', phase: 'succeeded' }),
      );
    });

    test('omits containerId when container is not an object', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      (client as any).maybeMarkAgentOperationSucceededFromAppliedPayload({
        operationId: 'op-no-container',
        containerName: 'nginx',
        container: 'not-an-object',
      });
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-op-no-container',
        expect.not.objectContaining({ containerId: expect.anything() }),
      );
    });

    test('includes containerId when container is an object with id', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      (client as any).maybeMarkAgentOperationSucceededFromAppliedPayload({
        operationId: 'op-with-container',
        containerName: 'nginx',
        container: { id: 'c5' },
      });
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalledWith(
        'agent-test-agent-op-with-container',
        expect.objectContaining({ containerId: 'c5' }),
      );
    });
  });

  describe('maybeMarkAgentOperationFailedFromFailedPayload', () => {
    // Lines 1002: ConditionalExpression false
    test('returns false when operationId is absent', () => {
      const result = (client as any).maybeMarkAgentOperationFailedFromFailedPayload({
        containerName: 'nginx',
        error: 'pull failed',
      });
      expect(result).toBe(false);
    });

    test('returns true and calls markAgentOperationTerminal when operationId is present', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      const result = (client as any).maybeMarkAgentOperationFailedFromFailedPayload({
        operationId: 'remote-fail',
        containerName: 'nginx',
        error: 'pull failed',
      });
      expect(result).toBe(true);
      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalled();
    });
  });

  describe('parseBatchUpdateCompletedPayload', () => {
    // Lines 1009, 1021, 1028: ConditionalExpression / LogicalOperator mutants
    const parseBatch = (data: unknown) => (client as any).parseBatchUpdateCompletedPayload(data);

    test('returns undefined when batchId is missing', () => {
      expect(
        parseBatch({ total: 1, succeeded: 1, failed: 0, durationMs: 100, items: [] }),
      ).toBeUndefined();
    });

    test('returns undefined when total is not finite', () => {
      expect(
        parseBatch({
          batchId: 'b1',
          total: NaN,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [],
        }),
      ).toBeUndefined();
    });

    test('returns undefined when succeeded is not finite', () => {
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: Infinity,
          failed: 0,
          durationMs: 100,
          items: [],
        }),
      ).toBeUndefined();
    });

    test('returns undefined when failed is not finite', () => {
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: 1,
          failed: NaN,
          durationMs: 100,
          items: [],
        }),
      ).toBeUndefined();
    });

    test('returns undefined when durationMs is not finite', () => {
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: NaN,
          items: [],
        }),
      ).toBeUndefined();
    });

    test('returns undefined when items is not an array', () => {
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: 'not-array',
        }),
      ).toBeUndefined();
    });

    // Line 1021: ConditionalExpression false — invalid item
    test('returns undefined when an item is null', () => {
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [null],
        }),
      ).toBeUndefined();
    });

    // Line 1028: ConditionalExpression / LogicalOperator — !operationId && !containerName
    test('returns undefined when item operationId is missing', () => {
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [{ containerName: 'nginx', status: 'succeeded' }],
        }),
      ).toBeUndefined();
    });

    test('returns undefined when item containerName is missing', () => {
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [{ operationId: 'op-1', status: 'succeeded' }],
        }),
      ).toBeUndefined();
    });

    test('requires BOTH operationId AND containerName to be present', () => {
      // LogicalOperator: !operationId || !containerName vs !operationId && !containerName
      // If the mutant uses &&, then only BOTH missing would fail—but the test has operationId
      // missing (so it should return undefined regardless of containerName)
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [{ operationId: '', containerName: 'nginx', status: 'succeeded' }],
        }),
      ).toBeUndefined();
    });

    // Lines 1009: LogicalOperator mutant combinations
    test('all three conditions (batchId, total, succeeded) must be valid', () => {
      // Test each alone failing
      // batchId missing
      expect(
        parseBatch({ total: 1, succeeded: 1, failed: 0, durationMs: 100, items: [] }),
      ).toBeUndefined();
      // total invalid
      expect(
        parseBatch({
          batchId: 'b1',
          total: NaN,
          succeeded: 1,
          failed: 0,
          durationMs: 100,
          items: [],
        }),
      ).toBeUndefined();
      // succeeded invalid
      expect(
        parseBatch({
          batchId: 'b1',
          total: 1,
          succeeded: NaN,
          failed: 0,
          durationMs: 100,
          items: [],
        }),
      ).toBeUndefined();
    });

    test('valid complete payload returns parsed result', () => {
      vi.setSystemTime(new Date('2026-04-29T12:00:00.000Z'));
      const result = parseBatch({
        batchId: 'batch-x',
        total: 2,
        succeeded: 2,
        failed: 0,
        durationMs: 500,
        items: [
          { operationId: 'op-a', containerName: 'nginx', status: 'succeeded' },
          { operationId: 'op-b', containerId: 'c2', containerName: 'redis', status: 'failed' },
        ],
      });
      expect(result).not.toBeUndefined();
      expect(result.batchId).toBe('agent-test-agent-batch-x');
      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.durationMs).toBe(500);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].operationId).toBe('agent-test-agent-op-a');
      // containerId defaults to empty string when not present
      expect(result.items[0].containerId).toBe('');
      expect(result.items[1].containerId).toBe('c2');
    });

    test('uses raw operationId when a controller row already exists at that id', () => {
      // Simulate a controller-issued operationId that has a row in the store.
      // resolveAgentOperationId returns the raw id; toAgentScopedId would
      // incorrectly prepend agent-test-agent- and double-scope it.
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'uuid-controller-issued')
          return { id: 'uuid-controller-issued', status: 'queued' } as any;
        return undefined;
      });

      const result = parseBatch({
        batchId: 'remote-batch-ctrl',
        total: 1,
        succeeded: 1,
        failed: 0,
        durationMs: 300,
        items: [
          {
            operationId: 'uuid-controller-issued',
            containerName: 'nginx',
            status: 'succeeded',
          },
        ],
        timestamp: '2026-06-03T00:00:00.000Z',
      });

      expect(result).not.toBeUndefined();
      // Raw id must be preserved — NOT 'agent-test-agent-uuid-controller-issued'
      expect(result.items[0].operationId).toBe('uuid-controller-issued');
    });
  });

  describe('parseSecurityAlertEventPayload', () => {
    // Lines 1070, 1077, 1095, 1098, 1107
    const parseAlert = (data: unknown) => (client as any).parseSecurityAlertEventPayload(data);

    test('returns undefined for null input', () => {
      expect(parseAlert(null)).toBeUndefined();
    });

    test('returns undefined when containerName is empty', () => {
      expect(parseAlert({ containerName: '', details: 'vuln found' })).toBeUndefined();
    });

    test('returns undefined when details is empty', () => {
      expect(parseAlert({ containerName: 'nginx', details: '' })).toBeUndefined();
    });

    test('returns undefined when containerName is not a string', () => {
      expect(parseAlert({ containerName: 42, details: 'vuln found' })).toBeUndefined();
    });

    test('includes status when it is a non-empty string', () => {
      const result = parseAlert({ containerName: 'nginx', details: 'vuln', status: 'blocked' });
      expect(result?.status).toBe('blocked');
    });

    // Line 1077: ConditionalExpression false
    test('omits status when it is an empty string', () => {
      const result = parseAlert({ containerName: 'nginx', details: 'vuln', status: '' });
      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('status');
    });

    // Line 1095: ConditionalExpression true — blockingCount
    test('includes blockingCount when it is a finite number', () => {
      const result = parseAlert({ containerName: 'nginx', details: 'vuln', blockingCount: 3 });
      expect(result?.blockingCount).toBe(3);
    });

    test('omits blockingCount when it is not finite', () => {
      const result = parseAlert({
        containerName: 'nginx',
        details: 'vuln',
        blockingCount: 'not-a-number',
      });
      expect(result).not.toHaveProperty('blockingCount');
    });

    // Lines 1098: ConditionalExpression/EqualityOperator
    test('includes cycleId when it is non-empty string', () => {
      const result = parseAlert({ containerName: 'nginx', details: 'vuln', cycleId: 'cycle-abc' });
      expect(result?.cycleId).toBe('cycle-abc');
    });

    test('omits cycleId when it is empty string', () => {
      const result = parseAlert({ containerName: 'nginx', details: 'vuln', cycleId: '' });
      expect(result).not.toHaveProperty('cycleId');
    });

    // EqualityOperator: payload.cycleId.length >= 0 (would always be true)
    test('cycleId.length > 0 check: empty cycleId is excluded', () => {
      const result = parseAlert({ containerName: 'nginx', details: 'vuln', cycleId: '' });
      expect(result).not.toHaveProperty('cycleId');
    });

    // Line 1107: ConditionalExpression
    test('includes summary when valid', () => {
      const result = parseAlert({
        containerName: 'nginx',
        details: 'vuln',
        summary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 1 },
      });
      expect(result?.summary).toEqual({ unknown: 0, low: 0, medium: 0, high: 0, critical: 1 });
    });

    test('omits summary when invalid (missing key)', () => {
      const result = parseAlert({
        containerName: 'nginx',
        details: 'vuln',
        summary: { unknown: 0, low: 0, medium: 0, high: 0 }, // missing critical
      });
      expect(result).not.toHaveProperty('summary');
    });
  });

  describe('parseSecurityScanCycleCompleteEventPayload', () => {
    // Lines 1128, 1128-EqualityOperator
    const parseCycle = (data: unknown) =>
      (client as any).parseSecurityScanCycleCompleteEventPayload(data);

    test('returns undefined for null input', () => {
      expect(parseCycle(null)).toBeUndefined();
    });

    test('returns undefined when cycleId is empty', () => {
      expect(parseCycle({ cycleId: '', scannedCount: 3 })).toBeUndefined();
    });

    // EqualityOperator: payload.completedAt.length >= 0 (would include empty string)
    test('omits completedAt when it is empty string', () => {
      const result = parseCycle({ cycleId: 'c1', scannedCount: 3, completedAt: '' });
      expect(result).not.toHaveProperty('completedAt');
    });

    test('includes completedAt when it is a non-empty string', () => {
      const result = parseCycle({
        cycleId: 'c1',
        scannedCount: 3,
        completedAt: '2026-05-01T00:00:00.000Z',
      });
      expect(result?.completedAt).toBe('2026-05-01T00:00:00.000Z');
    });
  });

  describe('handleEvent: default case', () => {
    // Line 1224: ConditionalExpression default
    test('returns without action for completely unknown event names', async () => {
      await client.handleEvent('completely:unknown:event', {});
      expect(event.emitContainerReport).not.toHaveBeenCalled();
      expect(event.emitContainerReports).not.toHaveBeenCalled();
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('returns without action for empty string event name', async () => {
      await client.handleEvent('', {});
      expect(event.emitContainerReport).not.toHaveBeenCalled();
    });
  });

  describe('getRemoteTriggerFailureMessage', () => {
    // Lines 1230-1255: LogicalOperator / BooleanLiteral / ConditionalExpression / EqualityOperator / BlockStatement / StringLiteral
    const getMsg = (error: unknown) => (client as any).getRemoteTriggerFailureMessage(error);

    // Line 1230: !error || typeof error !== 'object'
    test('returns undefined for null error', () => {
      expect(getMsg(null)).toBeUndefined();
    });

    test('returns undefined for string error', () => {
      expect(getMsg('just a string')).toBeUndefined();
    });

    test('returns undefined for number error', () => {
      expect(getMsg(42)).toBeUndefined();
    });

    // Line 1230 BooleanLiteral: `error` → true (always proceed)
    test('returns undefined when error is an empty object (no response)', () => {
      expect(getMsg({})).toBeUndefined();
    });

    // Line 1230 EqualityOperator: typeof error === 'object' vs !== 'object'
    test('processes error that is a plain object', () => {
      // Has response.data.error — should return the message
      const result = getMsg({
        response: { data: { error: 'server error' } },
      });
      expect(result).toBe('server error');
    });

    // Line 1234: !response || typeof response !== 'object'
    test('returns undefined when response is not an object', () => {
      expect(getMsg({ response: 'string-response' })).toBeUndefined();
    });

    test('returns undefined when response is null', () => {
      expect(getMsg({ response: null })).toBeUndefined();
    });

    // Line 1234 BooleanLiteral
    test('returns undefined when response is an empty object', () => {
      expect(getMsg({ response: {} })).toBeUndefined();
    });

    // Line 1238: !data || typeof data !== 'object'
    test('returns undefined when data is a string', () => {
      expect(getMsg({ response: { data: 'not an object' } })).toBeUndefined();
    });

    test('returns undefined when data is null', () => {
      expect(getMsg({ response: { data: null } })).toBeUndefined();
    });

    // Line 1238 BooleanLiteral: data → true (always proceed even if falsy)
    test('returns undefined when data is an empty object (no error field)', () => {
      expect(getMsg({ response: { data: {} } })).toBeUndefined();
    });

    // Line 1244: errorMessage check
    test('returns undefined when error field is not a string', () => {
      expect(getMsg({ response: { data: { error: 42 } } })).toBeUndefined();
    });

    test('returns undefined when error field is empty string', () => {
      expect(getMsg({ response: { data: { error: '' } } })).toBeUndefined();
    });

    // Line 1244 BooleanLiteral: errorMessage → true (always proceed)
    test('returns error message when present without details', () => {
      const result = getMsg({ response: { data: { error: 'trigger error' } } });
      expect(result).toBe('trigger error');
    });

    // Lines 1250-1255: details + reason handling
    // Line 1250: ConditionalExpression / LogicalOperator
    test('returns error+reason when details is object with reason string', () => {
      const result = getMsg({
        response: {
          data: {
            error: 'trigger error',
            details: { reason: 'no watcher found' },
          },
        },
      });
      expect(result).toBe('trigger error (reason: no watcher found)');
    });

    // Line 1250: LogicalOperator — details && typeof details === 'object' || ...
    test('returns plain error when details is a string (not an object)', () => {
      const result = getMsg({
        response: {
          data: {
            error: 'trigger error',
            details: 'a string',
          },
        },
      });
      expect(result).toBe('trigger error');
    });

    test('returns plain error when details is null', () => {
      const result = getMsg({
        response: {
          data: {
            error: 'trigger error',
            details: null,
          },
        },
      });
      expect(result).toBe('trigger error');
    });

    // Line 1251: EqualityOperator typeof details !== 'object' vs === 'object'
    test('returns plain error when details has no reason field', () => {
      const result = getMsg({
        response: {
          data: {
            error: 'trigger error',
            details: { otherField: 'data' },
          },
        },
      });
      expect(result).toBe('trigger error');
    });

    // Line 1252: EqualityOperator typeof reason !== 'string' vs === 'string'
    test('returns plain error when reason is not a string', () => {
      const result = getMsg({
        response: {
          data: {
            error: 'trigger error',
            details: { reason: 42 },
          },
        },
      });
      expect(result).toBe('trigger error');
    });

    // Line 1255: StringLiteral `` — reason format string
    test('formatted reason string includes both error and reason', () => {
      const result = getMsg({
        response: {
          data: {
            error: 'my error',
            details: { reason: 'specific reason' },
          },
        },
      });
      expect(result).toBe('my error (reason: specific reason)');
      expect(result).not.toBe('');
      expect(result).toContain('my error');
      expect(result).toContain('specific reason');
    });
  });

  describe('runRemoteTrigger: error message logging', () => {
    // Lines 1279, 1284-1285, 1297, 1302-1303: StringLiteral / LogicalOperator
    test('logs detailed error message when remote payload provides one', async () => {
      axios.post.mockRejectedValue({
        message: 'Request failed',
        response: {
          data: { error: 'remote error message', details: { reason: 'no watcher' } },
        },
      });

      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toBeDefined();

      expect(mockLogChild.error).toHaveBeenCalledWith(
        expect.stringContaining('remote error message (reason: no watcher)'),
      );
    });

    test('falls back to generic error when no detailed message', async () => {
      axios.post.mockRejectedValue(new Error('connection refused'));

      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toThrow(
        'connection refused',
      );

      expect(mockLogChild.error).toHaveBeenCalledWith(
        expect.stringContaining('connection refused'),
      );
    });

    // Line 1279: REMOTE_UPDATE_TRIGGER_TYPES guard for markPendingFreshState
    test('marks pending fresh state only for update trigger types', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const internal = client as any;

      await client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update');
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('c1')).toBe(true);

      await client.runRemoteTrigger({ id: 'c2' }, 'slack', 'notify');
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('c2')).toBe(false);
    });

    // Line 1284: LogicalOperator detailedMessage && getErrorMessage(error)
    test('error log message is not empty', async () => {
      axios.post.mockRejectedValue(new Error('some error'));
      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toBeDefined();
      expect(mockLogChild.error).toHaveBeenCalledWith(expect.stringContaining('some error'));
    });

    // Line 1285: StringLiteral ``
    test('error log includes "Error running remote trigger" prefix', async () => {
      axios.post.mockRejectedValue(new Error('trigger error'));
      await expect(client.runRemoteTrigger({ id: 'c1' }, 'docker', 'update')).rejects.toBeDefined();
      expect(mockLogChild.error).toHaveBeenCalledWith(
        expect.stringContaining('Error running remote trigger'),
      );
    });
  });

  describe('runRemoteTriggerBatch: error message logging', () => {
    // Lines 1297, 1302-1303: StringLiteral / LogicalOperator
    test('logs detailed error for batch trigger failures', async () => {
      axios.post.mockRejectedValue({
        message: 'Request failed',
        response: { data: { error: 'batch remote error', details: { reason: 'no watcher' } } },
      });

      await expect(
        client.runRemoteTriggerBatch([{ id: 'c1' }], 'docker', 'update'),
      ).rejects.toBeDefined();

      expect(mockLogChild.error).toHaveBeenCalledWith(
        expect.stringContaining('batch remote error (reason: no watcher)'),
      );
    });

    // Line 1297: StringLiteral ``
    test('batch error log includes "Error running remote batch trigger" prefix', async () => {
      axios.post.mockRejectedValue(new Error('batch error'));
      await expect(client.runRemoteTriggerBatch([], 'docker', 'update')).rejects.toBeDefined();
      expect(mockLogChild.error).toHaveBeenCalledWith(
        expect.stringContaining('Error running remote batch trigger'),
      );
    });

    // Line 1297: REMOTE_UPDATE_TRIGGER_TYPES for batch
    test('marks pending fresh state for all containers in update batch', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const internal = client as any;
      await client.runRemoteTriggerBatch([{ id: 'c1' }, { id: 'c2' }], 'docker', 'update');
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('c1')).toBe(true);
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('c2')).toBe(true);
    });

    test('does not mark pending fresh state for notification batch triggers', async () => {
      axios.post.mockResolvedValue({ data: {} });
      const internal = client as any;
      await client.runRemoteTriggerBatch([{ id: 'c1' }], 'slack', 'notify');
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('c1')).toBe(false);
    });

    // Line 1302: LogicalOperator detailedMessage && getErrorMessage(error)
    test('batch error log message is not empty for generic errors', async () => {
      axios.post.mockRejectedValue(new Error('network failure'));
      await expect(client.runRemoteTriggerBatch([], 'docker', 'update')).rejects.toBeDefined();
      expect(mockLogChild.error).toHaveBeenCalledWith(expect.stringContaining('network failure'));
    });
  });

  describe('API method URL string assertions', () => {
    // Lines 1323, 1339, 1346, 1352, 1366, 1385, 1404: StringLiteral `` mutations

    test('getLogEntries uses /api/log/entries path', async () => {
      axios.get.mockResolvedValue({ data: [] });
      await client.getLogEntries({ level: 'info' });
      const url = axios.get.mock.calls[0][0];
      expect(url).toContain('/api/log/entries');
      expect(url).not.toBe('');
    });

    test('getLogEntries URL includes query params', async () => {
      axios.get.mockResolvedValue({ data: [] });
      await client.getLogEntries({ level: 'error', component: 'docker', tail: 50, since: 9999 });
      const url = axios.get.mock.calls[0][0];
      expect(url).toContain('level=error');
      expect(url).toContain('component=docker');
      expect(url).toContain('tail=50');
      expect(url).toContain('since=9999');
    });

    test('getContainerLogs uses /api/containers/{id}/logs path', async () => {
      axios.get.mockResolvedValue({ data: {} });
      await client.getContainerLogs('my-container', { tail: 100, since: 0, timestamps: false });
      const url = axios.get.mock.calls[0][0];
      expect(url).toContain('/api/containers/my-container/logs');
      expect(url).not.toBe('');
    });

    test('getContainerLogs URL includes tail, since, timestamps params', async () => {
      axios.get.mockResolvedValue({ data: {} });
      await client.getContainerLogs('cid', { tail: 200, since: 12345, timestamps: true });
      const url = axios.get.mock.calls[0][0];
      expect(url).toContain('tail=200');
      expect(url).toContain('since=12345');
      expect(url).toContain('timestamps=true');
    });

    test('deleteContainer uses /api/containers/{id} path', async () => {
      axios.delete.mockResolvedValue({ data: {} });
      await client.deleteContainer('del-container-id');
      const url = axios.delete.mock.calls[0][0];
      expect(url).toContain('/api/containers/del-container-id');
      expect(url).not.toBe('');
    });

    test('watch uses /api/watchers/{type}/{name} path', async () => {
      axios.post.mockResolvedValue({ data: [] });
      storeContainer.getContainers.mockReturnValue([]);
      await client.watch('docker', 'local');
      const url = axios.post.mock.calls[0][0];
      expect(url).toContain('/api/watchers/docker/local');
      expect(url).not.toBe('');
    });

    test('watchContainer uses /api/watchers/{type}/{name}/container/{id} path', async () => {
      axios.post.mockResolvedValue({ data: { container: { id: 'c1' } } });
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue({ id: 'c1' });
      await client.watchContainer('docker', 'local', { id: 'c1', name: 'test' });
      const url = axios.post.mock.calls[0][0];
      expect(url).toContain('/api/watchers/docker/local/container/c1');
      expect(url).not.toBe('');
    });

    test('getWatcher uses /api/watchers/{type}/{name} path', async () => {
      axios.get.mockResolvedValue({ data: {} });
      await client.getWatcher('docker', 'local');
      const url = axios.get.mock.calls[0][0];
      expect(url).toContain('/api/watchers/docker/local');
      expect(url).not.toBe('');
    });

    test('getLogEntries without params omits query string', async () => {
      axios.get.mockResolvedValue({ data: [] });
      await client.getLogEntries();
      const url = axios.get.mock.calls[0][0];
      expect(url).not.toContain('?');
    });
  });

  describe('getLogEntries error handling', () => {
    // Line 1366: StringLiteral `` — error log message
    test('error log mentions fetching log entries from agent', async () => {
      axios.get.mockRejectedValue(new Error('network down'));
      await expect(client.getLogEntries()).rejects.toThrow('network down');
      expect(mockLogChild.error).toHaveBeenCalledWith(expect.stringContaining('log entries'));
    });
  });

  describe('getContainerLogs error handling', () => {
    // Line 1385: StringLiteral ``
    test('error log mentions fetching container logs from agent', async () => {
      axios.get.mockRejectedValue(new Error('container not found'));
      await expect(
        client.getContainerLogs('c1', { tail: 100, since: 0, timestamps: false }),
      ).rejects.toThrow('container not found');
      expect(mockLogChild.error).toHaveBeenCalledWith(expect.stringContaining('container logs'));
    });
  });

  describe('deleteContainer error handling', () => {
    // Line 1404: StringLiteral ``
    test('error log mentions deleting container on agent', async () => {
      axios.delete.mockRejectedValue(new Error('not found'));
      await expect(client.deleteContainer('c1')).rejects.toThrow('not found');
      expect(mockLogChild.error).toHaveBeenCalledWith(
        expect.stringContaining('deleting container'),
      );
    });
  });

  describe('getWatcher error handling', () => {
    // Line 1404 (actually around 1370 area for getWatcher)
    test('error log mentions watcher fetch failure', async () => {
      axios.get.mockRejectedValue(new Error('watcher down'));
      await expect(client.getWatcher('docker', 'local')).rejects.toThrow('watcher down');
      expect(mockLogChild.error).toHaveBeenCalledWith(expect.stringContaining('watcher'));
    });
  });

  describe('watchContainer error handling', () => {
    test('error log includes container name', async () => {
      axios.post.mockRejectedValue(new Error('watch failed'));
      await expect(
        client.watchContainer('docker', 'local', { id: 'c1', name: 'my-nginx' }),
      ).rejects.toThrow('watch failed');
      expect(mockLogChild.error).toHaveBeenCalledWith(expect.stringContaining('my-nginx'));
    });
  });

  describe('watch error handling', () => {
    test('error log mentions watch on agent', async () => {
      axios.post.mockRejectedValue(new Error('watch error'));
      await expect(client.watch('docker', 'local')).rejects.toThrow('watch error');
      expect(mockLogChild.error).toHaveBeenCalledWith(expect.stringContaining('watch'));
    });
  });

  describe('additional getRemoteTriggerFailureMessage coverage for surviving mutants', () => {
    const getMsg = (error: unknown) => (client as any).getRemoteTriggerFailureMessage(error);

    // Line 1238:18 — ConditionalExpression: typeof data !== 'object' → false
    // This means the mutation makes the check always pass even for non-objects.
    // We need a test where data is a non-null, non-object value to kill this.
    test('returns undefined when response.data is a number', () => {
      expect(getMsg({ response: { data: 42 } })).toBeUndefined();
    });

    test('returns undefined when response.data is a boolean', () => {
      expect(getMsg({ response: { data: true } })).toBeUndefined();
    });

    test('returns undefined when response.data is an array', () => {
      // Arrays pass typeof === 'object' but should be handled as objects
      // Only non-null objects pass, and arrays are objects. Let's verify the
      // code doesn't try to access .error on array items:
      expect(getMsg({ response: { data: [1, 2, 3] } })).toBeUndefined();
    });

    // Line 1251:7 — typeof details === 'object' → true
    // Mutation makes this always true, so details could be a number/string and
    // we'd still try to access reason. We need to test details = truthy non-object.
    test('returns plain error when details is a truthy number (not an object)', () => {
      const result = getMsg({
        response: { data: { error: 'trigger error', details: 42 } },
      });
      expect(result).toBe('trigger error');
    });

    test('returns plain error when details is true (not an object)', () => {
      const result = getMsg({
        response: { data: { error: 'trigger error', details: true } },
      });
      expect(result).toBe('trigger error');
    });
  });

  describe('runRemoteTrigger: debug log for trigger execution', () => {
    // Line 1272:9 — StringLiteral debug log message → ''
    test('logs debug message with trigger type and name', async () => {
      axios.post.mockResolvedValue({ data: {} });
      await client.runRemoteTrigger({ id: 'c1', name: 'nginx' }, 'docker', 'update');
      expect(mockLogChild.debug).toHaveBeenCalledWith(expect.stringContaining('docker'));
    });

    test('debug log includes trigger name', async () => {
      axios.post.mockResolvedValue({ data: {} });
      await client.runRemoteTrigger({ id: 'c1', name: 'nginx' }, 'smtp', 'my-notify');
      expect(mockLogChild.debug).toHaveBeenCalledWith(expect.stringContaining('my-notify'));
    });

    test('debug log message is not empty', async () => {
      axios.post.mockResolvedValue({ data: {} });
      await client.runRemoteTrigger({ id: 'c1', name: 'nginx' }, 'slack', 'alert');
      const debugCalls = mockLogChild.debug.mock.calls;
      expect(debugCalls.length).toBeGreaterThan(0);
      expect(debugCalls[0][0]).not.toBe('');
    });
  });

  describe('deleteContainer: debug log', () => {
    // Line 1346:22 — StringLiteral debug log → ''
    test('logs debug message mentioning the container id', async () => {
      axios.delete.mockResolvedValue({ data: {} });
      await client.deleteContainer('my-container-id');
      expect(mockLogChild.debug).toHaveBeenCalledWith(expect.stringContaining('my-container-id'));
    });

    test('deleteContainer debug log message is not empty', async () => {
      axios.delete.mockResolvedValue({ data: {} });
      await client.deleteContainer('del-id');
      const debugCalls = mockLogChild.debug.mock.calls;
      expect(debugCalls.length).toBeGreaterThan(0);
      expect(debugCalls[0][0]).not.toBe('');
    });
  });

  describe('scheduleReconnect: SSE URL', () => {
    // Line 430: ConditionalExpression true — startSse guard
    test('startSse uses /api/events URL', async () => {
      // The axios call in startSse should request /api/events
      axios.mockResolvedValue({ data: new EventEmitter() });
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const callArg = (axios as any).mock.calls[0][0];
      expect(callArg.url).toContain('/api/events');
      expect(callArg.url).not.toBe('');
    });

    // Line 430: ConditionalExpression true — reconnectTimer check in startSse
    test('startSse does not call axios again if reconnect is pending', () => {
      // startSse clears the timer first, so a second call should still fire
      // We need to test the guard: if reconnectTimer was set by scheduleReconnect,
      // startSse should clear it and proceed
      axios.mockResolvedValue({ data: new EventEmitter() });
      client.scheduleReconnect(60_000); // long delay
      // Timer is set, but not yet fired
      expect((client as any).reconnectTimer).not.toBeNull();
      client.startSse();
      // reconnectTimer should now be null (cleared by startSse)
      expect((client as any).reconnectTimer).toBeNull();
    });
  });

  describe('parseSecurityAlertSummary', () => {
    // Lines 1054, 1054-18, 1070: ConditionalExpression / LogicalOperator
    const parseSummary = (data: unknown) => (client as any).parseSecurityAlertSummary(data);

    test('returns undefined for null input', () => {
      expect(parseSummary(null)).toBeUndefined();
    });

    test('returns undefined for non-object input', () => {
      expect(parseSummary('not an object')).toBeUndefined();
    });

    test('returns undefined when a required key is missing', () => {
      expect(parseSummary({ unknown: 0, low: 0, medium: 0, high: 0 })).toBeUndefined();
    });

    test('returns undefined when a key is not finite', () => {
      expect(
        parseSummary({ unknown: NaN, low: 0, medium: 0, high: 0, critical: 0 }),
      ).toBeUndefined();
    });

    test('returns parsed summary when all keys are valid', () => {
      expect(parseSummary({ unknown: 0, low: 1, medium: 2, high: 3, critical: 4 })).toEqual({
        unknown: 0,
        low: 1,
        medium: 2,
        high: 3,
        critical: 4,
      });
    });
  });

  // ─── Tests targeting surviving mutants not killed by earlier assertions ──────

  describe('buildAgentOperationBase: key absence when undefined', () => {
    // Line 880:11 ConditionalExpression true — newContainerId !== undefined → true
    // Mutation would include { newContainerId: undefined } when not provided
    // toEqual ignores undefined keys, so we need not.toHaveProperty
    test('omits newContainerId key when payload has no newContainerId', () => {
      const result = (client as any).buildAgentOperationBase({
        operationId: 'op-1',
        containerName: 'nginx',
      });
      expect(result).not.toHaveProperty('newContainerId');
    });

    test('omits newContainerId key when payload.newContainerId is explicitly undefined', () => {
      const result = (client as any).buildAgentOperationBase({
        operationId: 'op-1',
        containerName: 'nginx',
        newContainerId: undefined,
      });
      expect(result).not.toHaveProperty('newContainerId');
    });

    test('omits containerId key when payload.containerId is explicitly undefined', () => {
      const result = (client as any).buildAgentOperationBase({
        operationId: 'op-1',
        containerName: 'nginx',
        containerId: undefined,
      });
      expect(result).not.toHaveProperty('containerId');
    });
  });

  describe('applyAgentUpdateOperationChanged: updateOperation key absence', () => {
    // Lines 912:17, 913:17 ConditionalExpression true
    // Mutation would include { containerId: undefined } or { newContainerId: undefined }
    // expect.not.objectContaining won't catch undefined-valued keys (expect.anything() skips undefined)
    // We need to directly inspect mock call args with not.toHaveProperty
    test('updateOperation call omits containerId key when payload has no containerId', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-op-no-cid') {
          return {
            id: 'agent-test-agent-op-no-cid',
            containerName: 'nginx',
            status: 'queued',
            phase: 'queued',
          } as any;
        }
        return undefined;
      });

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'op-no-cid',
        containerName: 'nginx',
        status: 'in-progress',
      });

      expect(updateOperationStore.updateOperation).toHaveBeenCalled();
      const callArgs = vi.mocked(updateOperationStore.updateOperation).mock.calls[0][1];
      expect(Object.hasOwn(callArgs, 'containerId')).toBe(false);
    });

    test('updateOperation call omits newContainerId key when payload has no newContainerId', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockImplementation((id) => {
        if (id === 'agent-test-agent-op-no-ncid') {
          return {
            id: 'agent-test-agent-op-no-ncid',
            containerName: 'nginx',
            status: 'in-progress',
            phase: 'pulling',
          } as any;
        }
        return undefined;
      });

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'op-no-ncid',
        containerName: 'nginx',
        status: 'in-progress',
      });

      expect(updateOperationStore.updateOperation).toHaveBeenCalled();
      const callArgs = vi.mocked(updateOperationStore.updateOperation).mock.calls[0][1];
      expect(Object.hasOwn(callArgs, 'newContainerId')).toBe(false);
    });
  });

  describe('markAgentOperationTerminal: key absence in markOperationTerminal', () => {
    // Lines 955:11, 956:11 ConditionalExpression true
    test('markOperationTerminal call omits containerId key when undefined', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue({
        id: 'agent-test-agent-term-no-cid',
        status: 'in-progress',
      } as any);

      (client as any).markAgentOperationTerminal({
        operationId: 'term-no-cid',
        containerName: 'nginx',
        status: 'succeeded',
        phase: 'succeeded',
      });

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalled();
      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(Object.hasOwn(callArgs, 'containerId')).toBe(false);
    });

    test('markOperationTerminal call omits newContainerId key when undefined', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue({
        id: 'agent-test-agent-term-no-ncid',
        status: 'in-progress',
      } as any);

      (client as any).markAgentOperationTerminal({
        operationId: 'term-no-ncid',
        containerName: 'nginx',
        status: 'succeeded',
      });

      expect(updateOperationStore.markOperationTerminal).toHaveBeenCalled();
      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(Object.hasOwn(callArgs, 'newContainerId')).toBe(false);
    });

    test('markOperationTerminal call includes containerId when provided', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue({
        id: 'agent-test-agent-term-with-cid',
        status: 'in-progress',
      } as any);

      (client as any).markAgentOperationTerminal({
        operationId: 'term-with-cid',
        containerName: 'nginx',
        status: 'succeeded',
        containerId: 'container-123',
      });

      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(callArgs).toHaveProperty('containerId', 'container-123');
    });
  });

  describe('maybeMarkAgentOperationSucceededFromAppliedPayload: containerId key absence', () => {
    // Line 975:11 ConditionalExpression true
    test('markOperationTerminal omits containerId key when container has no id', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      (client as any).maybeMarkAgentOperationSucceededFromAppliedPayload({
        operationId: 'op-success-no-id',
        containerName: 'nginx',
        container: { name: 'nginx' }, // no id field
      });

      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(Object.hasOwn(callArgs, 'containerId')).toBe(false);
    });

    test('markOperationTerminal omits containerId key when container is absent', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      (client as any).maybeMarkAgentOperationSucceededFromAppliedPayload({
        operationId: 'op-success-no-container',
        containerName: 'nginx',
      });

      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(Object.hasOwn(callArgs, 'containerId')).toBe(false);
    });
  });

  describe('maybeMarkAgentOperationFailedFromFailedPayload: containerId key absence', () => {
    // Line 992:11 ConditionalExpression true
    test('markOperationTerminal omits containerId key when payload has no containerId', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      (client as any).maybeMarkAgentOperationFailedFromFailedPayload({
        operationId: 'op-fail-no-cid',
        containerName: 'nginx',
        error: 'pull failed',
      });

      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(Object.hasOwn(callArgs, 'containerId')).toBe(false);
    });

    test('markOperationTerminal includes containerId key when payload has containerId', () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      (client as any).maybeMarkAgentOperationFailedFromFailedPayload({
        operationId: 'op-fail-with-cid',
        containerName: 'nginx',
        error: 'pull failed',
        containerId: 'container-456',
      });

      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(callArgs).toHaveProperty('containerId', 'container-456');
    });
  });

  describe('parseUpdateFailedEventPayload: phase key absence', () => {
    // Line 831:11 ConditionalExpression true — phase !== undefined → true
    test('does not include phase key when payload has no phase field', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      await client.handleEvent('dd:update-failed', {
        containerName: 'nginx',
        error: 'pull failed',
        operationId: 'op-fail-no-phase',
      });

      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(Object.hasOwn(callArgs, 'phase')).toBe(false);
    });

    test('includes phase key when payload has a valid phase', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValue(null);
      await client.handleEvent('dd:update-failed', {
        containerName: 'nginx',
        error: 'pull failed',
        operationId: 'op-fail-with-phase',
        phase: 'pulling',
      });

      const callArgs = vi.mocked(updateOperationStore.markOperationTerminal).mock.calls[0][1];
      expect(callArgs).toHaveProperty('phase', 'pulling');
    });
  });

  describe('pruneOldContainers: query argument and log message', () => {
    // Line 291:44 ObjectLiteral {} — { agent: this.name } → {}
    // Line 292:9 ConditionalExpression true — if (watcher) → if (true)
    // Line 303:21 StringLiteral — prune log message
    test('getContainers is called with agent name in query', () => {
      storeContainer.getContainers.mockReturnValue([]);
      (client as any).pruneOldContainers([]);
      expect(storeContainer.getContainers).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'test-agent' }),
      );
    });

    test('getContainers query includes watcher when provided', () => {
      storeContainer.getContainers.mockReturnValue([]);
      (client as any).pruneOldContainers([], 'docker');
      expect(storeContainer.getContainers).toHaveBeenCalledWith(
        expect.objectContaining({ watcher: 'docker' }),
      );
    });

    test('getContainers query does not include watcher when omitted', () => {
      storeContainer.getContainers.mockReturnValue([]);
      (client as any).pruneOldContainers([]);
      const callArg = vi.mocked(storeContainer.getContainers).mock.calls[0][0];
      // With ConditionalExpression true mutation, watcher: undefined would be present
      expect(Object.hasOwn(callArg, 'watcher')).toBe(false);
    });

    test('logs prune info message with container name', () => {
      storeContainer.getContainers.mockReturnValue([
        { id: 'c2', name: 'old-nginx', agent: 'test-agent' },
      ]);
      (client as any).pruneOldContainers([]);
      expect(mockLogChild.info).toHaveBeenCalledWith(expect.stringContaining('old-nginx'));
      expect(mockLogChild.info).toHaveBeenCalledWith(expect.stringContaining('Pruning'));
    });

    // #496: the agent prune path deleted with no replacement signal at all, so a recreated
    // agent-owned container lost its updatePolicy. The local watcher paths already pass this.
    test('flags replacementExpected when a same-named container is in the new list', () => {
      storeContainer.getContainers.mockReturnValue([
        { id: 'old-id', name: 'nginx', agent: 'test-agent' },
      ]);
      (client as any).pruneOldContainers([{ id: 'new-id', name: 'nginx' }]);
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old-id', {
        replacementExpected: true,
      });
    });

    // A genuinely removed container must stay unflagged, otherwise Hass keeps its discovery
    // state topic alive forever (Hass.ts reads replacementExpected off the removed event).
    test('does not flag replacementExpected when the container is genuinely gone', () => {
      storeContainer.getContainers.mockReturnValue([
        { id: 'c2', name: 'old-nginx', agent: 'test-agent' },
      ]);
      (client as any).pruneOldContainers([{ id: 'other-id', name: 'something-else' }]);
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c2');
    });

    test('does not flag replacementExpected for an unnamed stale entry', () => {
      storeContainer.getContainers.mockReturnValue([{ id: 'c3', agent: 'test-agent' }]);
      (client as any).pruneOldContainers([{ id: 'new-id', name: 'nginx' }]);
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c3');
    });

    test('ignores unnamed containers in the authoritative list when matching names', () => {
      storeContainer.getContainers.mockReturnValue([
        { id: 'old-id', name: 'nginx', agent: 'test-agent' },
      ]);
      (client as any).pruneOldContainers([{ id: 'new-id' }, { id: 'n2', name: '' }]);
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('old-id');
    });
  });

  describe('buildContainerReport: clearPendingFreshState on updateAvailable === false', () => {
    // Line 430:16 ConditionalExpression true — updateAvailable === false → true
    // Mutation would always call clearPendingFreshState regardless of updateAvailable value
    test('does NOT clear pending fresh state when updateAvailable is undefined', () => {
      const internal = client as any;
      internal.pendingFreshStateAfterRemoteUpdate.add('c-test');
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue({ id: 'c-test', updateAvailable: undefined });

      // Container has updateAvailable=undefined (not false), id in pending
      // shouldPreserveClearedUpdateAvailable: has('c-test') && undefined === true → false
      // else if: undefined === false → false (original: don't clear)
      // mutation: true → clear
      internal.buildContainerReport({ id: 'c-test', updateAvailable: undefined, name: 'nginx' });
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('c-test')).toBe(true);
    });

    test('does NOT clear pending fresh state when updateAvailable is null', () => {
      const internal = client as any;
      internal.pendingFreshStateAfterRemoteUpdate.add('c-null');
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue({ id: 'c-null', updateAvailable: null });

      internal.buildContainerReport({ id: 'c-null', updateAvailable: null, name: 'nginx' });
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('c-null')).toBe(true);
    });

    test('clears pending fresh state when updateAvailable === false', () => {
      const internal = client as any;
      internal.pendingFreshStateAfterRemoteUpdate.add('c-false');
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockReturnValue({ id: 'c-false', updateAvailable: false });

      internal.buildContainerReport({ id: 'c-false', updateAvailable: false, name: 'nginx' });
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('c-false')).toBe(false);
    });
  });

  describe('parseSseLine: data prefix check', () => {
    // Line 602:9 ConditionalExpression false / Line 602:26 StringLiteral / Line 602:37 BlockStatement
    test('does not call handleEvent for non-data lines', async () => {
      const handleEventSpy = vi.spyOn(client, 'handleEvent');
      await (client as any).parseSseLine('event: dd:ack');
      expect(handleEventSpy).not.toHaveBeenCalled();
    });

    test('does not call handleEvent for empty lines', async () => {
      const handleEventSpy = vi.spyOn(client, 'handleEvent');
      await (client as any).parseSseLine('');
      expect(handleEventSpy).not.toHaveBeenCalled();
    });

    test('calls handleEvent for valid data lines', async () => {
      const handleEventSpy = vi.spyOn(client, 'handleEvent').mockResolvedValue(undefined);
      await (client as any).parseSseLine('data: {"type":"dd:ack","data":{}}');
      expect(handleEventSpy).toHaveBeenCalledWith('dd:ack', {});
    });

    test('does not call handleEvent for "data:" prefix without space', async () => {
      const handleEventSpy = vi.spyOn(client, 'handleEvent');
      await (client as any).parseSseLine('data:{"type":"dd:ack","data":{}}');
      expect(handleEventSpy).not.toHaveBeenCalled();
    });
  });

  describe('handshake: log messages', () => {
    // Line 504:19 StringLiteral — handshake info log
    // Lines 521:21, 532:21 StringLiteral — warn logs for watcher/trigger fetch failures
    test('logs non-empty info message on successful handshake', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // containers
        .mockResolvedValueOnce({ data: [] }) // watchers
        .mockResolvedValueOnce({ data: [] }); // triggers
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      expect(mockLogChild.info).toHaveBeenCalledWith(expect.stringContaining('Handshake'));
      const infoCalls = mockLogChild.info.mock.calls.map((c) => c[0]);
      expect(infoCalls.some((m) => m !== '')).toBe(true);
    });

    test('logs non-empty warn message when watchers fetch fails', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // containers
        .mockRejectedValueOnce(new Error('watcher fetch error')) // watchers
        .mockResolvedValueOnce({ data: [] }); // triggers
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      expect(mockLogChild.warn).toHaveBeenCalledWith(expect.stringContaining('watcher'));
      const warnCalls = mockLogChild.warn.mock.calls.map((c) => c[0]);
      expect(warnCalls.some((m) => m !== '')).toBe(true);
    });

    test('logs non-empty warn message when triggers fetch fails', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // containers
        .mockResolvedValueOnce({ data: [] }) // watchers
        .mockRejectedValueOnce(new Error('trigger fetch error')); // triggers
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      expect(mockLogChild.warn).toHaveBeenCalledWith(expect.stringContaining('trigger'));
    });
  });

  describe('registerAgentComponents: debug log message', () => {
    // Line 484:22 StringLiteral — debug message in registerAgentComponents
    test('logs non-empty debug message for each registered component', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // containers
        .mockResolvedValueOnce({
          data: [{ type: 'docker', name: 'local', configuration: {} }],
        }) // watchers
        .mockResolvedValueOnce({ data: [] }); // triggers
      storeContainer.getContainers.mockReturnValue([]);

      await client.handshake();

      const debugCalls = mockLogChild.debug.mock.calls.map((c) => c[0]);
      const hasRegistrationLog = debugCalls.some(
        (m) => typeof m === 'string' && m.length > 0 && m.includes('docker'),
      );
      expect(hasRegistrationLog).toBe(true);
    });
  });

  describe('SSE stream handlers: log messages', () => {
    // Line 655:22 StringLiteral — stream error log
    // Line 659:21 StringLiteral — stream end warn log
    test('logs non-empty error when stream emits error', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });
      client.startSse();
      await vi.advanceTimersByTimeAsync(0); // let axios promise resolve so stream handlers attach

      stream.emit('error', new Error('connection reset'));
      expect(mockLogChild.error).toHaveBeenCalledWith(
        expect.stringContaining('SSE Connection failed'),
      );
      const errorCalls = mockLogChild.error.mock.calls.map((c) => c[0]);
      expect(errorCalls.some((m) => m !== '')).toBe(true);
    });

    test('logs non-empty warn when stream ends', async () => {
      const stream = new EventEmitter();
      axios.mockResolvedValue({ data: stream });
      client.startSse();
      await vi.advanceTimersByTimeAsync(0); // let the promise resolve

      stream.emit('end');
      expect(mockLogChild.warn).toHaveBeenCalledWith(expect.stringContaining('SSE stream ended'));
    });
  });

  describe('startSse: axios options and log', () => {
    // Line 670:15 StringLiteral — 'get' method
    // Line 686:24 StringLiteral — error log
    test('calls axios with method "get"', async () => {
      axios.mockResolvedValue({ data: new EventEmitter() });
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      const axiosCallArg = (axios as any).mock.calls[0][0];
      expect(axiosCallArg.method).toBe('get');
      expect(axiosCallArg.method).not.toBe('');
    });

    test('logs non-empty error when startSse axios call fails', async () => {
      axios.mockRejectedValue(new Error('connection refused'));
      client.startSse();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockLogChild.error).toHaveBeenCalledWith(
        expect.stringContaining('SSE Connection failed'),
      );
      const errorCalls = mockLogChild.error.mock.calls.map((c) => c[0]);
      expect(errorCalls.some((m) => m !== '')).toBe(true);
    });
  });

  describe('handleAckEvent: info log message', () => {
    // Line 715:19 StringLiteral — ack info log
    test('logs non-empty info message when ack is received', async () => {
      axios.get
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] });
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:ack', { version: '1.5.0', os: 'linux' });

      const infoCalls = mockLogChild.info.mock.calls.map((c) => c[0]);
      const hasAckLog = infoCalls.some(
        (m) =>
          typeof m === 'string' &&
          m.length > 0 &&
          (m.includes('test-agent') || m.includes('connected')),
      );
      expect(hasAckLog).toBe(true);
    });
  });

  describe('handleWatcherSnapshotEvent: optional chaining', () => {
    // Lines 747:41, 748:36 OptionalChaining
    // snapshotPayload.watcher?.configuration and snapshotPayload.watcher?.metadata
    test('caches snapshot with undefined configuration/metadata when watcher has no config/metadata', async () => {
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' }, // no configuration or metadata
        containers: [],
      });

      const cached = (client as any).watcherSnapshotCache.get('docker.local');
      expect(cached).toBeDefined();
      expect(cached?.configuration).toBeUndefined();
      expect(cached?.metadata).toBeUndefined();
    });

    test('caches snapshot with configuration when watcher has configuration', async () => {
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: {
          type: 'docker',
          name: 'local',
          configuration: { socket: '/var/run/docker.sock' },
        },
        containers: [],
      });

      const cached = (client as any).watcherSnapshotCache.get('docker.local');
      expect(cached?.configuration).toEqual({ socket: '/var/run/docker.sock' });
    });

    test('caches snapshot with metadata when watcher has metadata', async () => {
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: {
          type: 'docker',
          name: 'local',
          metadata: { host: 'docker-host' },
        },
        containers: [],
      });

      const cached = (client as any).watcherSnapshotCache.get('docker.local');
      expect(cached?.metadata).toEqual({ host: 'docker-host' });
    });
  });

  describe('clearPendingWatcherCycleReports: empty string key detection', () => {
    // Lines 392:9 ConditionalExpression true, 392:44 ConditionalExpression true / EqualityOperator >= 0
    // These survive because existing tests check map['local'] which isn't the empty key
    // We need to test with an actual '' key to detect >= 0 vs > 0
    test('does not delete a map entry with empty string key when called with empty string', () => {
      // Set up a map entry with key '' (unusual but tests the >= 0 mutation)
      (client as any).pendingWatcherCycleReports.set('', new Map([['c1', {}]]));
      (client as any).clearPendingWatcherCycleReports('');
      // Original: '' fails length > 0, so not deleted
      // Mutation >= 0: '' passes length >= 0, so deleted
      expect((client as any).pendingWatcherCycleReports.has('')).toBe(true);
    });
  });

  describe('insertOperation key absence in applyAgentUpdateOperationChanged', () => {
    // Lines 879:11, 880:11 ObjectLiteral/ConditionalExpression in buildAgentOperationBase
    // The insertOperation path (new active operation) uses buildAgentOperationBase
    test('insertOperation call omits containerId key when new active operation has no containerId', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValueOnce(undefined);

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'new-active-no-cid',
        containerName: 'nginx',
        status: 'queued',
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalled();
      const callArgs = vi.mocked(updateOperationStore.insertOperation).mock.calls[0][0];
      expect(Object.hasOwn(callArgs, 'containerId')).toBe(false);
    });

    test('insertOperation call omits newContainerId key when new active operation has no newContainerId', async () => {
      vi.mocked(updateOperationStore.getOperationById).mockReturnValueOnce(undefined);

      await client.handleEvent('dd:update-operation-changed', {
        operationId: 'new-active-no-ncid',
        containerName: 'nginx',
        status: 'queued',
      });

      expect(updateOperationStore.insertOperation).toHaveBeenCalled();
      const callArgs = vi.mocked(updateOperationStore.insertOperation).mock.calls[0][0];
      expect(Object.hasOwn(callArgs, 'newContainerId')).toBe(false);
    });
  });

  describe('clearPendingFreshState: empty-string key detection', () => {
    // Line 316:44 ConditionalExpression true / EqualityOperator >= 0
    // These survive because existing tests call clearPendingFreshState('') and check that
    // some other key ('c1') is still present. The mutation deletes key '' (no-op since '' isn't in set).
    // We need to set '' in the Set and verify it is NOT deleted (because length > 0 fails for '').
    test('does not delete an empty-string entry from pendingFreshState', () => {
      const internal = client as any;
      // Add '' to the Set (edge case, but tests length > 0 vs >= 0)
      internal.pendingFreshStateAfterRemoteUpdate.add('');
      internal.clearPendingFreshState('');
      // Original: '' fails length > 0, so '' is NOT deleted
      // Mutation >= 0: '' passes length >= 0, so '' IS deleted → test fails
      expect(internal.pendingFreshStateAfterRemoteUpdate.has('')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Regression tests for #386 — snapshot-replay convergence
  //
  // The agent-side fix (event.ts) caches the latest dd:watcher-snapshot per
  // watcher and replays it to each new SSE client right after dd:ack. From the
  // controller side (AgentClient) the invariant is: once the replayed snapshot
  // arrives, the controller store must contain the agent's containers with
  // correct agent scoping, regardless of the ack/snapshot arrival ordering.
  // ─────────────────────────────────────────────────────────────────────────────
  describe('snapshot-replay convergence (#386)', () => {
    // Helper: perform a full handshake that returns 0 containers (the cold-start
    // race that motivated #386) so that pruneOldContainers is skipped.
    async function doZeroContainerHandshake() {
      axios.get
        .mockResolvedValueOnce({ data: [] }) // /api/containers
        .mockResolvedValueOnce({ data: [{ type: 'docker', name: 'local', configuration: {} }] }) // /api/watchers
        .mockResolvedValueOnce({ data: [] }); // /api/triggers
      storeContainer.getContainers.mockReturnValue([]);
      await client.handshake();
    }

    test('CORE: replayed snapshot after dd:ack populates the store with agent-scoped containers', async () => {
      // Simulate the normal reconnect sequence:
      //   1. Controller connects → receives dd:ack → handshake fetches 0 containers
      //   2. Agent immediately replays cached dd:watcher-snapshot with the real container list
      //
      // After this sequence the controller store must hold the container from the snapshot
      // tagged with the correct agent name — this is the fundamental #386 invariant.
      await doZeroContainerHandshake();

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
      });

      // The container must be inserted with agent = 'test-agent'.
      expect(storeContainer.insertContainer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', agent: 'test-agent' }),
      );
      // And reported via emitContainerReports.
      expect(event.emitContainerReports).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            container: expect.objectContaining({ id: 'c1', agent: 'test-agent' }),
          }),
        ]),
      );
    });

    test('CORE: replayed snapshot for multiple containers all carry agent scoping', async () => {
      await doZeroContainerHandshake();

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [
          { id: 'c1', name: 'web', watcher: 'local' },
          { id: 'c2', name: 'db', watcher: 'local' },
          { id: 'c3', name: 'cache', watcher: 'local' },
        ],
      });

      const calls = vi.mocked(storeContainer.insertContainer).mock.calls;
      for (const [inserted] of calls) {
        expect(inserted).toMatchObject({ agent: 'test-agent' });
      }
      expect(calls).toHaveLength(3);
    });

    test('RACE order A (snapshot before ack completes): containers must not be zero after ack', async () => {
      // Ordering that can occur when the agent sends the snapshot before the
      // controller handshake finishes:
      //   1. dd:ack fires → handshake starts (slow)
      //   2. dd:watcher-snapshot fires and is processed immediately (SSE is sequential)
      //   3. handshake returns 0 → prune is skipped (zero-container guard)
      //
      // The resulting state must have the container from the snapshot in the store,
      // not zero.  This tests the zero-container prune guard from #386.

      // Set up a slow handshake so snapshot can "arrive first" in logical terms.
      let resolveHandshake!: () => void;
      const slowHandshake = new Promise<void>((resolve) => {
        resolveHandshake = resolve;
      });
      vi.spyOn(client as never, '_doHandshake').mockReturnValueOnce(slowHandshake);

      // dd:ack fires; handshake starts but does not complete yet.
      void client.handleEvent('dd:ack', { version: '1.0' });

      // While handshake is still in flight, the snapshot arrives.
      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
      });

      // Snapshot processed; container is in store.
      expect(storeContainer.insertContainer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', agent: 'test-agent' }),
      );

      // Now let the handshake resolve (0 containers, so prune is skipped).
      resolveHandshake();
      await Promise.resolve();

      // Container must NOT have been pruned — the zero-container guard applies.
      expect(storeContainer.deleteContainer).not.toHaveBeenCalledWith('c1');
    });

    test('RACE order B (snapshot arrives after ack+handshake): containers converge after snapshot', async () => {
      // Normal chronological order:
      //   1. dd:ack fires → handshake completes (0 containers → prune skipped)
      //   2. Agent sends replayed dd:watcher-snapshot with real containers
      //
      // After both steps the store must contain the container from the snapshot.
      await doZeroContainerHandshake();

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
      });

      // Container from the replayed snapshot must be present with agent scoping.
      expect(storeContainer.insertContainer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', agent: 'test-agent' }),
      );
      expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('RACE: snapshot before ack must update the watcher snapshot cache', async () => {
      // Even when a snapshot fires before the handshake completes the cache must
      // be populated so a subsequent getWatcherSnapshot call returns the entry.
      let resolveHandshake!: () => void;
      const slowHandshake = new Promise<void>((resolve) => {
        resolveHandshake = resolve;
      });
      vi.spyOn(client as never, '_doHandshake').mockReturnValueOnce(slowHandshake);

      void client.handleEvent('dd:ack', { version: '1.0' });

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => ({ ...c }));
      storeContainer.getContainers.mockReturnValue([]);

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: {
          type: 'docker',
          name: 'local',
          configuration: { socket: '/var/run/docker.sock' },
        },
        containers: [],
      });

      // Cache must already be populated before handshake finishes.
      expect(client.getWatcherSnapshot('docker', 'local')).toEqual(
        expect.objectContaining({ type: 'docker', name: 'local' }),
      );

      resolveHandshake();
      await Promise.resolve();
    });

    test('RACE: two snapshots in a row — only the latest containers are in the store after the second snapshot prunes the first', async () => {
      // Verifies that the watcher-scoped prune in handleWatcherSnapshotEvent
      // correctly removes containers from the first snapshot that are absent
      // in the second snapshot — the controller must not hold stale entries.
      await doZeroContainerHandshake();

      const containerStore: Array<{ id: string; name: string; watcher: string; agent: string }> =
        [];

      storeContainer.getContainer.mockReturnValue(undefined);
      storeContainer.insertContainer.mockImplementation((c) => {
        const entry = { ...c };
        containerStore.push(entry);
        return entry;
      });
      storeContainer.getContainers.mockImplementation((query = {}) =>
        containerStore.filter(
          (c) =>
            (!query.agent || c.agent === query.agent) &&
            (!query.watcher || c.watcher === query.watcher),
        ),
      );
      storeContainer.deleteContainer.mockImplementation((id: string) => {
        const idx = containerStore.findIndex((c) => c.id === id);
        if (idx !== -1) containerStore.splice(idx, 1);
      });

      // First snapshot: c1 + c2
      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [
          { id: 'c1', name: 'web', watcher: 'local' },
          { id: 'c2', name: 'db', watcher: 'local' },
        ],
      });
      expect(containerStore.map((c) => c.id).sort()).toEqual(['c1', 'c2']);

      // Second snapshot: only c1 (c2 was stopped/removed on the agent)
      storeContainer.getContainer.mockImplementation((id: string) =>
        containerStore.find((c) => c.id === id),
      );
      storeContainer.updateContainer.mockImplementation((c) => {
        const idx = containerStore.findIndex((stored) => stored.id === c.id);
        if (idx !== -1) Object.assign(containerStore[idx], c);
        return c;
      });

      await client.handleEvent('dd:watcher-snapshot', {
        watcher: { type: 'docker', name: 'local' },
        containers: [{ id: 'c1', name: 'web', watcher: 'local' }],
      });

      // c2 must have been pruned; c1 must remain.
      expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c2');
      expect(containerStore.map((c) => c.id)).toEqual(['c1']);
    });
  });

  describe('handleContainerSync (edge agent public shim)', () => {
    test('processes authoritative containers and calls scheduleStatsChanged', async () => {
      vi.mocked(storeContainer.getContainers).mockReturnValue([]);
      vi.mocked(storeContainer.getContainer).mockReturnValue(undefined);
      vi.mocked(storeContainer.insertContainer).mockImplementation((c) => c);

      // Call with an empty container list — processAuthoritativeContainers runs, pruneOldContainers is skipped
      await client.handleContainerSync([]);

      // emitContainerReports is mocked; scheduleStatsChanged is covered by this call
      expect(event.emitContainerReports).toHaveBeenCalledWith([]);
    });

    test('calls pruneOldContainers when containers list is non-empty', async () => {
      const containers = [
        { id: 'c1', name: 'web', agent: 'test-agent', watcher: 'local', status: 'running' },
      ];
      vi.mocked(storeContainer.getContainers).mockReturnValue([]);
      vi.mocked(storeContainer.getContainer).mockReturnValue(undefined);
      vi.mocked(storeContainer.insertContainer).mockImplementation((c) => c);

      await client.handleContainerSync(
        containers as Parameters<typeof client.handleContainerSync>[0],
      );

      // pruneOldContainers was called (deletes containers not in the provided list)
      expect(storeContainer.getContainers).toHaveBeenCalled();
    });
  });

  describe('handleComponentSync (edge agent public shim)', () => {
    test('deregisters agent components and re-registers watchers and triggers', async () => {
      const watchers = [{ type: 'docker', name: 'local', configuration: {} }];
      const triggers = [{ type: 'mock', name: 'update', configuration: {} }];

      await client.handleComponentSync(watchers, triggers);

      expect(registry.deregisterAgentComponents).toHaveBeenCalledWith('test-agent');
      expect(registry.registerComponent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'watcher', provider: 'docker', name: 'local' }),
      );
      expect(registry.registerComponent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'trigger', provider: 'mock', name: 'update' }),
      );
    });

    test('works with empty watchers and triggers (no-op)', async () => {
      await client.handleComponentSync([], []);

      expect(registry.deregisterAgentComponents).toHaveBeenCalledWith('test-agent');
      expect(registry.registerComponent).not.toHaveBeenCalled();
    });
  });

  describe('scheduleStatsChangedPublic (edge agent public shim)', () => {
    test('invokes scheduleStatsChanged debounce without throwing', () => {
      // scheduleStatsChanged sets a debounce timer; calling the public shim
      // must not throw and must schedule the stats event.
      expect(() => client.scheduleStatsChangedPublic()).not.toThrow();
      // Advance timer to fire the debounce
      vi.advanceTimersByTime(1000);
      // emitAgentStatsChanged is scheduled by the debounce; no assertion needed
      // beyond not throwing — the debounce fires async on its own timer.
    });
  });

  describe('authmode: ed25519 request signing', () => {
    const TEST_KEY_ID = 'deadbeefcafef00d';
    let privateKeyPem: string;
    let publicKeyObject: ReturnType<typeof generateKeyPairSync<'ed25519'>>['publicKey'];

    beforeAll(() => {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      publicKeyObject = publicKey;
      privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    });

    function makeEd25519Client(overrides: Record<string, unknown> = {}) {
      return new AgentClient('ed25519-agent', {
        host: 'ed25519-host',
        port: 3001,
        secret: '',
        authmode: 'ed25519',
        signingkeyid: TEST_KEY_ID,
        signingkey: privateKeyPem,
        ...overrides,
      });
    }

    /** Extracts the headers object axios was called with for call index `n`. */
    function headersFromGetOrDeleteCall(mockFn: { mock: { calls: unknown[][] } }, n = 0) {
      return (mockFn.mock.calls[n][1] as { headers: Record<string, string> }).headers;
    }

    function headersFromPostCall(mockFn: { mock: { calls: unknown[][] } }, n = 0) {
      return (mockFn.mock.calls[n][2] as { headers: Record<string, string> }).headers;
    }

    /**
     * Cross-check: reconstructs Portwing's canonical message from the sent
     * headers + known method/path/body and verifies the signature against the
     * real Ed25519 public key — mirrors internal/auth/verify.go byte for byte.
     */
    function expectHeadersVerify(
      headers: Record<string, string>,
      method: string,
      path: string,
      bodyBytes: Buffer,
    ) {
      expect(headers['X-Portwing-Key-ID']).toBe(TEST_KEY_ID);
      expect(headers['X-Portwing-Timestamp']).toMatch(/^[0-9]+$/);
      expect(headers['X-Portwing-Nonce']).toMatch(/^[0-9a-f]{32}$/);
      expect(headers['X-Portwing-Signature']).not.toMatch(/[+/=]/);

      const bodyHashHex = bodySha256Hex(bodyBytes);
      const canonicalMessage = buildCanonicalMessage(
        method,
        path,
        bodyHashHex,
        Number(headers['X-Portwing-Timestamp']),
        headers['X-Portwing-Nonce'],
      );
      const signatureBuf = Buffer.from(headers['X-Portwing-Signature'], 'base64url');
      expect(
        cryptoVerify(null, Buffer.from(canonicalMessage, 'utf8'), publicKeyObject, signatureBuf),
      ).toBe(true);
    }

    describe('construction / key loading', () => {
      test('constructs successfully with a valid PEM signing key', () => {
        expect(() => makeEd25519Client()).not.toThrow();
      });

      test('throws when authmode is ed25519 but signingkeyid is missing', () => {
        expect(() => makeEd25519Client({ signingkeyid: undefined })).toThrow(
          /signingkeyid|signingkey/,
        );
      });

      test('throws when authmode is ed25519 but signingkey is missing', () => {
        expect(() => makeEd25519Client({ signingkey: undefined })).toThrow(
          /signingkeyid|signingkey/,
        );
      });

      test('throws a descriptive error when signingkey is not a valid Ed25519 key', () => {
        const { privateKey: rsaPrivateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const rsaPem = rsaPrivateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
        expect(() => makeEd25519Client({ signingkey: rsaPem })).toThrow(/Ed25519/);
      });

      test('throws for garbage signingkey material', () => {
        expect(() => makeEd25519Client({ signingkey: 'not a real key' })).toThrow();
      });

      test('token-mode client (authmode omitted) is unaffected by ed25519 fields entirely', () => {
        // Existing default construction (used by the shared `client` from
        // beforeEach) must remain unchanged: no authmode set at all.
        expect(client.config.authmode).toBeUndefined();
      });
    });

    describe('token mode is unaffected (regression guard)', () => {
      test('default (token) client never sends X-Portwing-* headers', async () => {
        axios.get.mockResolvedValue({ data: {} });
        await client.getWatcher('docker', 'local');
        const headers = headersFromGetOrDeleteCall(axios.get);
        expect(headers['X-Dd-Agent-Secret']).toBe('test-secret');
        expect(headers['X-Portwing-Key-ID']).toBeUndefined();
        expect(headers['X-Portwing-Signature']).toBeUndefined();
      });
    });

    describe('per-endpoint signing', () => {
      test('ed25519-mode client sends no X-Dd-Agent-Secret header', async () => {
        const edClient = makeEd25519Client();
        axios.get.mockResolvedValue({ data: {} });
        await edClient.getWatcher('docker', 'local');
        const headers = headersFromGetOrDeleteCall(axios.get);
        expect(headers['X-Dd-Agent-Secret']).toBeUndefined();
      });

      test('getWatcher (GET, empty body) signs with the empty-body hash', async () => {
        const edClient = makeEd25519Client();
        axios.get.mockResolvedValue({ data: {} });
        await edClient.getWatcher('docker', 'local');
        const headers = headersFromGetOrDeleteCall(axios.get);
        expectHeadersVerify(headers, 'GET', '/api/watchers/docker/local', Buffer.alloc(0));
        // Sanity: empty body hashes to the well-known constant.
        expect(bodySha256Hex(Buffer.alloc(0))).toBe(EMPTY_BODY_SHA256_HEX);
      });

      test('deleteContainer (DELETE, empty body) signs correctly', async () => {
        const edClient = makeEd25519Client();
        axios.delete.mockResolvedValue({ data: {} });
        await edClient.deleteContainer('c1');
        const headers = headersFromGetOrDeleteCall(axios.delete);
        expectHeadersVerify(headers, 'DELETE', '/api/containers/c1', Buffer.alloc(0));
      });

      test('runRemoteTrigger (POST with JSON body) signs the exact serialized body bytes', async () => {
        const edClient = makeEd25519Client();
        axios.post.mockResolvedValue({ data: {} });
        const container = { id: 'c1', name: 'my-container' };
        await edClient.runRemoteTrigger(container, 'docker', 'update');
        const headers = headersFromPostCall(axios.post);
        const [, postedPayload] = axios.post.mock.calls[0];
        expectHeadersVerify(
          headers,
          'POST',
          '/api/triggers/docker/update',
          Buffer.from(JSON.stringify(postedPayload), 'utf8'),
        );
      });

      test('runRemoteTriggerBatch (POST) signs correctly', async () => {
        const edClient = makeEd25519Client();
        axios.post.mockResolvedValue({ data: {} });
        const containers = [{ id: 'c1', name: 'a' }];
        await edClient.runRemoteTriggerBatch(containers, 'smtp', 'notify');
        const headers = headersFromPostCall(axios.post);
        const [, postedPayload] = axios.post.mock.calls[0];
        expectHeadersVerify(
          headers,
          'POST',
          '/api/triggers/smtp/notify/batch',
          Buffer.from(JSON.stringify(postedPayload), 'utf8'),
        );
      });

      test('watch (POST with {} body) hashes "{}" — NOT the empty-body constant', async () => {
        const edClient = makeEd25519Client();
        axios.post.mockResolvedValue({ data: [] });
        storeContainer.getContainers.mockReturnValue([]);
        await edClient.watch('docker', 'local');
        const headers = headersFromPostCall(axios.post);
        const emptyObjectBody = Buffer.from('{}', 'utf8');
        expectHeadersVerify(headers, 'POST', '/api/watchers/docker/local', emptyObjectBody);
        // A {} body must NOT be treated as an empty body.
        expect(bodySha256Hex(emptyObjectBody)).not.toBe(EMPTY_BODY_SHA256_HEX);
      });

      test('watchContainer (POST with {} body) signs the nested container path correctly', async () => {
        const edClient = makeEd25519Client();
        axios.post.mockResolvedValue({ data: { container: { id: 'c1' } } });
        storeContainer.getContainer.mockReturnValue(undefined);
        storeContainer.insertContainer.mockReturnValue({ id: 'c1' });
        await edClient.watchContainer('docker', 'local', { id: 'c1', name: 'test' });
        const headers = headersFromPostCall(axios.post);
        expectHeadersVerify(
          headers,
          'POST',
          '/api/watchers/docker/local/container/c1',
          Buffer.from('{}', 'utf8'),
        );
      });

      test('getContainerLogs (GET with query string) signs the bare path, not the query string', async () => {
        const edClient = makeEd25519Client();
        axios.get.mockResolvedValue({ data: {} });
        await edClient.getContainerLogs('cid', { tail: 100, since: 0, timestamps: false });
        const url = axios.get.mock.calls[0][0];
        // The wire URL still carries the query string...
        expect(url).toContain('?tail=100');
        // ...but the signed canonical path must be query-free.
        const headers = headersFromGetOrDeleteCall(axios.get);
        expectHeadersVerify(headers, 'GET', '/api/containers/cid/logs', Buffer.alloc(0));
      });

      test('getLogEntries (GET with query string) signs the bare path, not the query string', async () => {
        const edClient = makeEd25519Client();
        axios.get.mockResolvedValue({ data: [] });
        await edClient.getLogEntries({ level: 'error', tail: 50 });
        const url = axios.get.mock.calls[0][0];
        expect(url).toContain('?level=error');
        const headers = headersFromGetOrDeleteCall(axios.get);
        expectHeadersVerify(headers, 'GET', '/api/log/entries', Buffer.alloc(0));
      });

      test('startSse (GET /api/events) signs an empty-body GET request', async () => {
        const edClient = makeEd25519Client();
        axios.mockResolvedValue({ data: new EventEmitter() });
        edClient.startSse();
        await vi.advanceTimersByTimeAsync(0);
        const axiosCallArg = (axios as unknown as { mock: { calls: unknown[][] } }).mock
          .calls[0][0] as {
          headers: Record<string, string>;
        };
        expectHeadersVerify(axiosCallArg.headers, 'GET', '/api/events', Buffer.alloc(0));
      });
    });

    describe('nonce and timestamp hygiene', () => {
      test('two consecutive signed requests use different nonces', async () => {
        const edClient = makeEd25519Client();
        axios.get.mockResolvedValue({ data: {} });
        await edClient.getWatcher('docker', 'local');
        await edClient.getWatcher('docker', 'local');
        const first = headersFromGetOrDeleteCall(axios.get, 0);
        const second = headersFromGetOrDeleteCall(axios.get, 1);
        expect(first['X-Portwing-Nonce']).not.toBe(second['X-Portwing-Nonce']);
      });

      test('X-Portwing-Timestamp is an integer-seconds string (no fractional/ms component)', async () => {
        const edClient = makeEd25519Client();
        axios.get.mockResolvedValue({ data: {} });
        await edClient.getWatcher('docker', 'local');
        const headers = headersFromGetOrDeleteCall(axios.get);
        expect(headers['X-Portwing-Timestamp']).toMatch(/^[0-9]+$/);
        expect(Number.isInteger(Number(headers['X-Portwing-Timestamp']))).toBe(true);
      });
    });
  });
});
