import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';
import { createCrudHandlers } from './crud.js';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'nginx',
    watcher: 'local',
    status: 'running',
    image: {
      registry: { name: 'hub', url: 'docker.io' },
      name: 'library/nginx',
      tag: { value: '1.0.0' },
    },
    details: {
      env: [],
    },
    ...overrides,
  };
}

function createHarness(options: { containers?: any[] } = {}) {
  const containers = options.containers ?? [];
  const byId = new Map(containers.map((container) => [container.id, container]));

  const deps = {
    getContainersFromStore: vi.fn(() => containers),
    storeContainer: {
      getContainer: vi.fn((id: string) => byId.get(id)),
      deleteContainer: vi.fn((id: string) => {
        byId.delete(id);
      }),
    },
    updateOperationStore: {
      getOperationsByContainerName: vi.fn(() => []),
    },
    getServerConfiguration: vi.fn(() => ({ feature: { delete: true } })),
    getAgent: vi.fn(),
    getErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : 'unknown error',
    ),
    getErrorStatusCode: vi.fn((error: any) => error?.response?.status),
    getWatchers: vi.fn(() => ({})),
    redactContainerRuntimeEnv: vi.fn((container: unknown) => container),
    redactContainersRuntimeEnv: vi.fn((value: unknown) => value),
    getContainerRaw: vi.fn((id: string) => byId.get(id)),
    auditStore: {
      insertAudit: vi.fn(),
    },
  };

  return {
    deps,
    handlers: createCrudHandlers(deps),
  };
}

function callGetContainers(
  handlers: ReturnType<typeof createCrudHandlers>,
  query: Record<string, unknown> = {},
) {
  const res = createMockResponse();
  handlers.getContainers({ query } as any, res as any);
  return res;
}

function callGetContainerSummary(handlers: ReturnType<typeof createCrudHandlers>) {
  const res = createMockResponse();
  handlers.getContainerSummary({} as any, res as any);
  return res;
}

function callGetContainer(
  handlers: ReturnType<typeof createCrudHandlers>,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  handlers.getContainer({ params: { id } } as any, res as any);
  return res;
}

function callGetContainerUpdateOperations(
  handlers: ReturnType<typeof createCrudHandlers>,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  handlers.getContainerUpdateOperations({ params: { id } } as any, res as any);
  return res;
}

function callRevealContainerEnv(
  handlers: ReturnType<typeof createCrudHandlers>,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  handlers.revealContainerEnv({ params: { id } } as any, res as any);
  return res;
}

async function callDeleteContainer(
  handlers: ReturnType<typeof createCrudHandlers>,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  await handlers.deleteContainer({ params: { id } } as any, res as any);
  return res;
}

async function callWatchContainers(
  handlers: ReturnType<typeof createCrudHandlers>,
  query: Record<string, unknown> = {},
) {
  const res = createMockResponse();
  await handlers.watchContainers({ query } as any, res as any);
  return res;
}

async function callWatchContainer(
  handlers: ReturnType<typeof createCrudHandlers>,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  await handlers.watchContainer({ params: { id } } as any, res as any);
  return res;
}

describe('api/container/crud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getContainers pagination normalization', () => {
    test('handles non-object falsy query and forwards an empty store filter', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      const res = createMockResponse();

      harness.handlers.getContainers({ query: '' } as any, res as any);

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith({});
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ id: 'c1' })]);
    });

    test('normalizes negative/invalid pagination to zero and returns all results', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' }), createContainer({ id: 'c2' })],
      });

      const res = callGetContainers(harness.handlers, {
        watcher: 'docker',
        limit: '-25',
        offset: 'invalid',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith({ watcher: 'docker' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'c1' }),
        expect.objectContaining({ id: 'c2' }),
      ]);
    });

    test('uses first limit/offset array values and strips control params from store query', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1' }),
          createContainer({ id: 'c2' }),
          createContainer({ id: 'c3' }),
        ],
      });

      const res = callGetContainers(harness.handlers, {
        watcher: 'docker',
        includeVulnerabilities: 'false',
        limit: ['1', '99'],
        offset: ['1', '99'],
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith({ watcher: 'docker' });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ id: 'c2' })]);
    });

    test('caps limit at 200 items', () => {
      const containers = Array.from({ length: 240 }, (_, index) =>
        createContainer({ id: `c${index + 1}` }),
      );
      const harness = createHarness({ containers });

      const res = callGetContainers(harness.handlers, {
        limit: '9999',
      });

      const payload = res.json.mock.calls[0][0];
      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toHaveLength(200);
      expect(payload[0]).toEqual(expect.objectContaining({ id: 'c1' }));
      expect(payload[199]).toEqual(expect.objectContaining({ id: 'c200' }));
    });

    test('applies offset when normalized limit is zero', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1' }),
          createContainer({ id: 'c2' }),
          createContainer({ id: 'c3' }),
          createContainer({ id: 'c4' }),
        ],
      });

      const res = callGetContainers(harness.handlers, {
        limit: '0',
        offset: '2',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'c3' }),
        expect.objectContaining({ id: 'c4' }),
      ]);
    });

    test('strips vulnerability arrays by default when security scans are present', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            security: {
              scan: {
                vulnerabilities: [{ id: 'CVE-1' }],
              },
              updateScan: {
                vulnerabilities: [{ id: 'CVE-2' }],
              },
            },
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'c1',
          security: expect.objectContaining({
            scan: expect.objectContaining({ vulnerabilities: [] }),
            updateScan: expect.objectContaining({ vulnerabilities: [] }),
          }),
        }),
      ]);
    });

    test('keeps vulnerability arrays when includeVulnerabilities=true', () => {
      const container = createContainer({
        id: 'c1',
        security: {
          scan: {
            vulnerabilities: [{ id: 'CVE-1' }],
          },
        },
      });
      const harness = createHarness({
        containers: [container],
      });

      const res = callGetContainers(harness.handlers, { includeVulnerabilities: 'true' });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([container]);
    });

    test('preserves undefined scan/updateScan when security object exists without scans', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            security: {},
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, {});

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'c1',
          security: expect.objectContaining({
            scan: undefined,
            updateScan: undefined,
          }),
        }),
      ]);
    });
  });

  describe('summary and lookup handlers', () => {
    test('returns running/stopped and security issue summary', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            status: 'running',
            security: { scan: { summary: { critical: 1, high: 0 } } },
          }),
          createContainer({
            id: 'c2',
            status: 'exited',
            security: { scan: { summary: { critical: 0, high: 2 } } },
          }),
          createContainer({
            id: 'c3',
            status: 'paused',
            security: { scan: { summary: { critical: 0, high: 0 } } },
          }),
        ],
      });

      const res = callGetContainerSummary(harness.handlers);

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith({});
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        containers: {
          total: 3,
          running: 1,
          stopped: 2,
        },
        security: {
          issues: 2,
        },
      });
    });

    test('treats missing scan summary fields as zero issues', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', status: 'running' }),
          createContainer({
            id: 'c2',
            status: 'exited',
            security: { scan: {} },
          }),
        ],
      });

      const res = callGetContainerSummary(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        containers: {
          total: 2,
          running: 1,
          stopped: 1,
        },
        security: {
          issues: 0,
        },
      });
    });

    test('treats missing container status as not running', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', status: undefined }),
          createContainer({ id: 'c2', status: 'running' }),
        ],
      });

      const res = callGetContainerSummary(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        containers: {
          total: 2,
          running: 1,
          stopped: 1,
        },
        security: {
          issues: 0,
        },
      });
    });

    test('returns redacted container when id exists', () => {
      const redacted = { id: 'c1', details: { env: [{ key: 'TOKEN', value: '[REDACTED]' }] } };
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      harness.deps.redactContainerRuntimeEnv.mockReturnValue(redacted);

      const res = callGetContainer(harness.handlers, 'c1');

      expect(harness.deps.storeContainer.getContainer).toHaveBeenCalledWith('c1');
      expect(harness.deps.redactContainerRuntimeEnv).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(redacted);
    });

    test('returns 404 when container id does not exist', () => {
      const harness = createHarness();

      const res = callGetContainer(harness.handlers, 'missing');

      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('returns update-operation history for an existing container', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'edge-api' })],
      });
      harness.deps.updateOperationStore.getOperationsByContainerName.mockReturnValue([
        { id: 'op-1' },
        { id: 'op-2' },
      ]);

      const res = callGetContainerUpdateOperations(harness.handlers, 'c1');

      expect(harness.deps.updateOperationStore.getOperationsByContainerName).toHaveBeenCalledWith(
        'edge-api',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([{ id: 'op-1' }, { id: 'op-2' }]);
    });

    test('returns 404 for update-operation lookup when container is missing', () => {
      const harness = createHarness();

      const res = callGetContainerUpdateOperations(harness.handlers, 'missing');

      expect(res.sendStatus).toHaveBeenCalledWith(404);
      expect(harness.deps.updateOperationStore.getOperationsByContainerName).not.toHaveBeenCalled();
    });
  });

  describe('revealContainerEnv', () => {
    test('returns 501 when raw env dependencies are not provided', () => {
      const handlers = createCrudHandlers({
        getContainersFromStore: vi.fn(() => []),
        storeContainer: {
          getContainer: vi.fn(),
          deleteContainer: vi.fn(),
        },
        updateOperationStore: {
          getOperationsByContainerName: vi.fn(() => []),
        },
        getServerConfiguration: vi.fn(() => ({ feature: { delete: true } })),
        getAgent: vi.fn(),
        getErrorMessage: vi.fn(() => 'error'),
        getErrorStatusCode: vi.fn(() => undefined),
        getWatchers: vi.fn(() => ({})),
        redactContainerRuntimeEnv: vi.fn((container) => container),
        redactContainersRuntimeEnv: vi.fn((value) => value),
      });

      const res = callRevealContainerEnv(handlers);

      expect(res.sendStatus).toHaveBeenCalledWith(501);
    });

    test('returns env values with sensitivity flags and writes an audit entry', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'edge-api',
            image: { name: 'org/edge-api' },
            details: {
              env: [
                { key: 'DB_PASSWORD', value: 'super-secret' },
                { key: 'PORT', value: '8080' },
                null,
                { key: 42, value: 'bad' },
                { key: 'API_TOKEN' },
              ],
            },
          }),
        ],
      });

      const res = callRevealContainerEnv(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        env: [
          { key: 'DB_PASSWORD', value: 'super-secret', sensitive: true },
          { key: 'PORT', value: '8080', sensitive: false },
          { key: 'API_TOKEN', value: undefined, sensitive: true },
        ],
      });
      expect(harness.deps.auditStore.insertAudit).toHaveBeenCalledWith({
        action: 'env-reveal',
        containerName: 'edge-api',
        containerImage: 'org/edge-api',
        status: 'info',
        details: 'Revealed 2 sensitive env var(s)',
      });
    });

    test('returns empty env payload when details.env is not an array', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            details: {
              env: 'DB_PASSWORD=secret',
            },
          }),
        ],
      });

      const res = callRevealContainerEnv(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ env: [] });
      expect(harness.deps.auditStore.insertAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          details: 'Revealed 0 sensitive env var(s)',
        }),
      );
    });

    test('returns 404 when raw container is not found', () => {
      const harness = createHarness();

      const res = callRevealContainerEnv(harness.handlers, 'missing');

      expect(res.sendStatus).toHaveBeenCalledWith(404);
      expect(harness.deps.auditStore.insertAudit).not.toHaveBeenCalled();
    });
  });

  describe('deleteContainer for agent-managed containers', () => {
    test('returns 403 when delete feature is disabled', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      harness.deps.getServerConfiguration.mockReturnValue({ feature: { delete: false } });

      const res = await callDeleteContainer(harness.handlers, 'c1');

      expect(res.sendStatus).toHaveBeenCalledWith(403);
      expect(harness.deps.storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('returns 404 when delete target is missing', async () => {
      const harness = createHarness();

      const res = await callDeleteContainer(harness.handlers, 'missing');

      expect(res.sendStatus).toHaveBeenCalledWith(404);
      expect(harness.deps.storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('deletes local container directly when no agent is configured', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });

      const res = await callDeleteContainer(harness.handlers, 'c1');

      expect(harness.deps.storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
      expect(res.sendStatus).toHaveBeenCalledWith(204);
      expect(harness.deps.getAgent).not.toHaveBeenCalled();
    });

    test('returns 500 when container points to a missing agent', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', agent: 'remote-a' })],
      });
      harness.deps.getAgent.mockReturnValue(undefined);

      const res = await callDeleteContainer(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Agent remote-a not found' });
      expect(harness.deps.storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('deletes local state after a successful remote delete', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', agent: 'remote-a' })],
      });
      const agent = {
        deleteContainer: vi.fn().mockResolvedValue(undefined),
      };
      harness.deps.getAgent.mockReturnValue(agent);

      const res = await callDeleteContainer(harness.handlers);

      expect(agent.deleteContainer).toHaveBeenCalledWith('c1');
      expect(harness.deps.storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });

    test('treats remote 404 delete as already deleted and cleans up local state', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', agent: 'remote-a' })],
      });
      const remoteNotFoundError = new Error('missing');
      (remoteNotFoundError as any).response = { status: 404 };
      const agent = {
        deleteContainer: vi.fn().mockRejectedValue(remoteNotFoundError),
      };
      harness.deps.getAgent.mockReturnValue(agent);

      const res = await callDeleteContainer(harness.handlers);

      expect(harness.deps.getErrorStatusCode).toHaveBeenCalledWith(remoteNotFoundError);
      expect(harness.deps.storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
      expect(res.sendStatus).toHaveBeenCalledWith(204);
    });

    test('returns 500 for remote delete failures that are not 404', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', agent: 'remote-a' })],
      });
      const remoteError = new Error('upstream unavailable');
      (remoteError as any).response = { status: 500 };
      const agent = {
        deleteContainer: vi.fn().mockRejectedValue(remoteError),
      };
      harness.deps.getAgent.mockReturnValue(agent);

      const res = await callDeleteContainer(harness.handlers);

      expect(harness.deps.storeContainer.deleteContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error deleting container on agent (upstream unavailable)',
      });
    });
  });

  describe('watch handlers', () => {
    test('watchContainers triggers all watchers and returns refreshed container list', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      const watcherA = { watch: vi.fn().mockResolvedValue(undefined), watchContainer: vi.fn() };
      const watcherB = { watch: vi.fn().mockResolvedValue(undefined), watchContainer: vi.fn() };
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': watcherA,
        'docker.remote': watcherB,
      });

      const res = await callWatchContainers(harness.handlers, { watcher: 'docker' });

      expect(watcherA.watch).toHaveBeenCalledTimes(1);
      expect(watcherB.watch).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ id: 'c1' })]);
    });

    test('watchContainers returns 500 when any watcher fails', async () => {
      const harness = createHarness();
      const failure = new Error('watch failed');
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': {
          watch: vi.fn().mockRejectedValue(failure),
          watchContainer: vi.fn(),
        },
      });

      const res = await callWatchContainers(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when watching images (watch failed)',
      });
    });

    test('watchContainer returns 404 when container is missing', async () => {
      const harness = createHarness();

      const res = await callWatchContainer(harness.handlers, 'missing');

      expect(res.sendStatus).toHaveBeenCalledWith(404);
    });

    test('watchContainer returns 500 when watcher is not registered', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', watcher: 'local' })],
      });
      harness.deps.getWatchers.mockReturnValue({});

      const res = await callWatchContainer(harness.handlers, 'c1');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'No provider found for container c1 and provider docker.local',
      });
    });

    test('watchContainer prefixes watcher id with agent name for remote containers', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', watcher: 'local', agent: 'agent-a' })],
      });
      const watcher = {
        watch: vi.fn(),
        watchContainer: vi.fn().mockResolvedValue({
          container: createContainer({ id: 'c1', watcher: 'local', agent: 'agent-a' }),
        }),
      };
      harness.deps.getWatchers.mockReturnValue({
        'agent-a.docker.local': watcher,
      });

      const res = await callWatchContainer(harness.handlers, 'c1');

      expect(watcher.watchContainer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', agent: 'agent-a' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1', agent: 'agent-a' }),
      );
    });

    test('watchContainer returns 404 when watcher.getContainers does not include target container', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', watcher: 'local' })],
      });
      const watcher = {
        watch: vi.fn(),
        getContainers: vi.fn().mockResolvedValue([createContainer({ id: 'other' })]),
        watchContainer: vi.fn(),
      };
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': watcher,
      });

      const res = await callWatchContainer(harness.handlers, 'c1');

      expect(watcher.getContainers).toHaveBeenCalledTimes(1);
      expect(watcher.watchContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith();
    });

    test('watchContainer runs watcher when getContainers confirms the target exists', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', watcher: 'local' })],
      });
      const reportContainer = createContainer({ id: 'c1', status: 'running' });
      const watcher = {
        watch: vi.fn(),
        getContainers: vi.fn().mockResolvedValue([createContainer({ id: 'c1' })]),
        watchContainer: vi.fn().mockResolvedValue({
          container: reportContainer,
        }),
      };
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': watcher,
      });

      const res = await callWatchContainer(harness.handlers, 'c1');

      expect(watcher.getContainers).toHaveBeenCalledTimes(1);
      expect(watcher.watchContainer).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
      expect(harness.deps.redactContainerRuntimeEnv).toHaveBeenCalledWith(reportContainer);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(reportContainer);
    });

    test('watchContainer returns 500 when watcher throws', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', watcher: 'local' })],
      });
      const watcher = {
        watch: vi.fn(),
        watchContainer: vi.fn().mockRejectedValue(new Error('watch explode')),
      };
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': watcher,
      });

      const res = await callWatchContainer(harness.handlers, 'c1');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error when watching container c1',
      });
    });
  });
});
