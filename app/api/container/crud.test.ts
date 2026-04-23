import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMockResponse } from '../../test/helpers.js';

const mockGetFullReleaseNotesForContainer = vi.hoisted(() => vi.fn());
vi.mock('../../release-notes/index.js', () => ({
  getFullReleaseNotesForContainer: (...args: unknown[]) =>
    mockGetFullReleaseNotesForContainer(...args),
}));

import { isRollbackContainer } from '../../model/container.js';
import { createCrudHandlers } from './crud.js';

type CrudDependencies = Parameters<typeof createCrudHandlers>[0];

type GroupedCrudDepsInput = {
  getContainersFromStore: CrudDependencies['storeApi']['getContainersFromStore'];
  getContainerCountFromStore: CrudDependencies['storeApi']['getContainerCountFromStore'];
  storeContainer: CrudDependencies['storeApi']['storeContainer'];
  updateOperationStore: CrudDependencies['storeApi']['updateOperationStore'];
  getContainerRaw: NonNullable<CrudDependencies['storeApi']['getContainerRaw']>;
  getServerConfiguration: CrudDependencies['agentApi']['getServerConfiguration'];
  getAgent: CrudDependencies['agentApi']['getAgent'];
  getWatchers: CrudDependencies['agentApi']['getWatchers'];
  getErrorMessage: CrudDependencies['errorApi']['getErrorMessage'];
  getErrorStatusCode: CrudDependencies['errorApi']['getErrorStatusCode'];
  redactContainerRuntimeEnv: CrudDependencies['securityApi']['redactContainerRuntimeEnv'];
  redactContainersRuntimeEnv: CrudDependencies['securityApi']['redactContainersRuntimeEnv'];
  auditStore: NonNullable<CrudDependencies['securityApi']['auditStore']>;
};

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

function groupCrudDeps(deps: GroupedCrudDepsInput): CrudDependencies {
  return {
    storeApi: {
      getContainersFromStore: deps.getContainersFromStore,
      getContainerCountFromStore: deps.getContainerCountFromStore,
      storeContainer: deps.storeContainer,
      updateOperationStore: deps.updateOperationStore,
      getContainerRaw: deps.getContainerRaw,
    },
    agentApi: {
      getServerConfiguration: deps.getServerConfiguration,
      getAgent: deps.getAgent,
      getWatchers: deps.getWatchers,
    },
    errorApi: {
      getErrorMessage: deps.getErrorMessage,
      getErrorStatusCode: deps.getErrorStatusCode,
    },
    securityApi: {
      redactContainerRuntimeEnv: deps.redactContainerRuntimeEnv,
      redactContainersRuntimeEnv: deps.redactContainersRuntimeEnv,
      auditStore: deps.auditStore,
    },
  };
}

function getValueByPath(record: Record<string, unknown>, path: string): unknown {
  const pathSegments = path.split('.');
  let currentValue: unknown = record;
  for (const segment of pathSegments) {
    if (!currentValue || typeof currentValue !== 'object') {
      return undefined;
    }
    currentValue = (currentValue as Record<string, unknown>)[segment];
  }
  return currentValue;
}

function filterAndSortContainers(
  containers: Record<string, unknown>[],
  query: Record<string, unknown>,
) {
  const { excludeRollbackContainers, ...exactMatchQuery } = query || {};
  const queryEntries = Object.entries(exactMatchQuery);
  let filteredContainers = containers.filter((container) =>
    queryEntries.every(
      ([queryPath, queryValue]) => getValueByPath(container, queryPath) === queryValue,
    ),
  );
  if (excludeRollbackContainers === true) {
    filteredContainers = filteredContainers.filter((container) => !isRollbackContainer(container));
  }
  return [...filteredContainers].sort((leftContainer, rightContainer) => {
    const watcherCompare = `${leftContainer.watcher ?? ''}`.localeCompare(
      `${rightContainer.watcher ?? ''}`,
    );
    if (watcherCompare !== 0) {
      return watcherCompare;
    }
    const nameCompare = `${leftContainer.name ?? ''}`.localeCompare(`${rightContainer.name ?? ''}`);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return `${leftContainer.image?.tag?.value ?? ''}`.localeCompare(
      `${rightContainer.image?.tag?.value ?? ''}`,
    );
  });
}

function buildVisibleContainersStoreQuery(query: Record<string, unknown> = {}) {
  return {
    excludeRollbackContainers: true,
    ...query,
  };
}

function createHarness(options: { containers?: any[] } = {}) {
  const containers = options.containers ?? [];
  const byId = new Map(containers.map((container) => [container.id, container]));

  const deps = {
    getContainersFromStore: vi.fn((query: Record<string, unknown> = {}, pagination?: any) => {
      const matchingContainers = filterAndSortContainers(containers, query);
      const limit =
        typeof pagination?.limit === 'number' && Number.isFinite(pagination.limit)
          ? Math.max(0, Math.trunc(pagination.limit))
          : 0;
      const offset =
        typeof pagination?.offset === 'number' && Number.isFinite(pagination.offset)
          ? Math.max(0, Math.trunc(pagination.offset))
          : 0;
      if (limit === 0 && offset === 0) {
        return matchingContainers;
      }
      if (limit === 0) {
        return matchingContainers.slice(offset);
      }
      return matchingContainers.slice(offset, offset + limit);
    }),
    getContainerCountFromStore: vi.fn(
      (query: Record<string, unknown> = {}) => filterAndSortContainers(containers, query).length,
    ),
    storeContainer: {
      getContainer: vi.fn((id: string) => byId.get(id)),
      deleteContainer: vi.fn((id: string) => {
        byId.delete(id);
      }),
    },
    updateOperationStore: {
      getOperationsByContainerName: vi.fn(() => []),
      getInProgressOperationByContainerName: vi.fn(() => undefined),
      getInProgressOperationByContainerId: vi.fn(() => undefined),
      getActiveOperationByContainerName: vi.fn(() => undefined),
      getActiveOperationByContainerId: vi.fn(() => undefined),
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
    handlers: createCrudHandlers(groupCrudDeps(deps)),
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

function callGetContainerSecurityVulnerabilities(
  handlers: ReturnType<typeof createCrudHandlers>,
  query: Record<string, unknown> = {},
) {
  const res = createMockResponse();
  handlers.getContainerSecurityVulnerabilities({ query } as any, res as any);
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

async function callGetContainerReleaseNotes(
  handlers: ReturnType<typeof createCrudHandlers>,
  id: string | string[] | undefined = 'c1',
) {
  const res = createMockResponse();
  await handlers.getContainerReleaseNotes({ params: { id } } as any, res as any);
  return res;
}

function callGetContainerUpdateOperations(
  handlers: ReturnType<typeof createCrudHandlers>,
  id: string | string[] | undefined = 'c1',
  query: Record<string, unknown> = {},
) {
  const res = createMockResponse();
  handlers.getContainerUpdateOperations({ params: { id }, query } as any, res as any);
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
  options: {
    query?: Record<string, unknown>;
    body?: unknown;
  } = {},
) {
  const res = createMockResponse();
  await handlers.watchContainers(
    {
      query: options.query ?? {},
      body: options.body,
    } as any,
    res as any,
  );
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
    mockGetFullReleaseNotesForContainer.mockResolvedValue(undefined);
  });

  describe('createCrudHandlers dependency grouping', () => {
    test('accepts grouped dependency objects', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      const handlers = createCrudHandlers(groupCrudDeps(harness.deps));

      const res = callGetContainerSummary(handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        containers: {
          total: 1,
          running: 1,
          stopped: 0,
          updatesAvailable: 0,
        },
        security: { issues: 0 },
        hotUpdates: 0,
        matureUpdates: 0,
      });
    });
  });

  describe('getContainers pagination normalization', () => {
    test('handles non-object falsy query and forwards an empty store filter', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      const res = createMockResponse();

      harness.handlers.getContainers({ query: '' } as any, res as any);

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery(),
        { limit: 0, offset: 0 },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c1' })],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('returns suggestedTag in container result payload when available', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            result: {
              tag: 'latest',
              suggestedTag: '1.27.3',
            },
          }),
        ],
      });

      const res = callGetContainers(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            result: expect.objectContaining({ suggestedTag: '1.27.3' }),
          }),
        ],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('normalizes negative/invalid pagination to zero and returns all results', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' }), createContainer({ id: 'c2' })],
      });

      const res = callGetContainers(harness.handlers, {
        watcher: 'local',
        limit: '-25',
        offset: 'invalid',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({ watcher: 'local' }),
        { limit: 0, offset: 0 },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c1' }), expect.objectContaining({ id: 'c2' })],
        total: 2,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
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
        watcher: 'local',
        includeVulnerabilities: 'false',
        limit: ['1', '99'],
        offset: ['1', '99'],
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({ watcher: 'local' }),
        { limit: 1, offset: 1 },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c2' })],
        total: 3,
        limit: 1,
        offset: 1,
        hasMore: true,
        _links: {
          self: '/api/containers?watcher=local&includeVulnerabilities=false&limit=1&offset=1',
          next: '/api/containers?watcher=local&includeVulnerabilities=false&limit=1&offset=2',
        },
      });
    });

    test('hides temporary rollback containers from paginated list responses', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'service', displayName: 'service' }),
          createContainer({
            id: 'c2',
            name: 'service-old-1773933154786',
            displayName: 'service-old-1773933154786',
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, {
        limit: '10',
        offset: '0',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c1', name: 'service' })],
        total: 1,
        limit: 10,
        offset: 0,
        hasMore: false,
        _links: {
          self: '/api/containers?limit=10&offset=0',
        },
      });
    });

    test('forwards normalized pagination to store query', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1' }),
          createContainer({ id: 'c2' }),
          createContainer({ id: 'c3' }),
        ],
      });

      callGetContainers(harness.handlers, {
        watcher: 'local',
        limit: ['1', '99'],
        offset: ['1', '99'],
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({ watcher: 'local' }),
        { limit: 1, offset: 1 },
      );
    });

    test('uses container count dependency for paginated totals without a second list query', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1' }),
          createContainer({ id: 'c2' }),
          createContainer({ id: 'c3' }),
        ],
      });

      const res = callGetContainers(harness.handlers, {
        watcher: 'local',
        limit: '1',
        offset: '1',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledTimes(1);
      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({ watcher: 'local' }),
        { limit: 1, offset: 1 },
      );
      expect(harness.deps.getContainerCountFromStore).toHaveBeenCalledTimes(1);
      expect(harness.deps.getContainerCountFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({ watcher: 'local' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c2' })],
        total: 3,
        limit: 1,
        offset: 1,
        hasMore: true,
        _links: {
          self: '/api/containers?watcher=local&limit=1&offset=1',
          next: '/api/containers?watcher=local&limit=1&offset=2',
        },
      });
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
      expect(payload).toMatchObject({
        total: 240,
        limit: 200,
        offset: 0,
        hasMore: true,
        _links: {
          self: '/api/containers?limit=200&offset=0',
          next: '/api/containers?limit=200&offset=200',
        },
      });
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload.data).toHaveLength(200);
      expect(payload.data[0]).toEqual(expect.objectContaining({ id: 'c1' }));
      expect(payload.data[199]).toEqual(expect.objectContaining({ id: 'c200' }));
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
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c3' }), expect.objectContaining({ id: 'c4' })],
        total: 4,
        limit: 0,
        offset: 2,
        hasMore: false,
      });
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
      expect(res.json).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            id: 'c1',
            security: expect.objectContaining({
              scan: expect.objectContaining({ vulnerabilities: [] }),
              updateScan: expect.objectContaining({ vulnerabilities: [] }),
            }),
          }),
        ],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
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
      expect(res.json).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            id: 'c1',
            security: expect.objectContaining({
              scan: expect.objectContaining({ vulnerabilities: [{ id: 'CVE-1' }] }),
            }),
          }),
        ],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
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
      expect(res.json).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            id: 'c1',
            security: expect.objectContaining({
              scan: undefined,
              updateScan: undefined,
            }),
          }),
        ],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('supports sort=age and returns oldest updates first', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', updateAge: 2_000 }),
          createContainer({ id: 'c2', updateAge: 8_000 }),
          createContainer({ id: 'c3', updateAge: 4_000 }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'age' });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery(),
        { limit: 0, offset: 0 },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ id: 'c2' }),
          expect.objectContaining({ id: 'c3' }),
          expect.objectContaining({ id: 'c1' }),
        ],
        total: 3,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('supports maturity filter for hot|mature|established', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', updateMaturityLevel: 'hot' }),
          createContainer({ id: 'c2', updateMaturityLevel: 'mature' }),
          createContainer({ id: 'c3', updateMaturityLevel: 'established' }),
        ],
      });

      const res = callGetContainers(harness.handlers, { maturity: 'mature' });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery(),
        { limit: 0, offset: 0 },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c2' })],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('sorts containers by name ascending by default', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'zulu' }),
          createContainer({ id: 'c2', name: 'alpha' }),
          createContainer({ id: 'c3', name: 'bravo' }),
        ],
      });

      const res = callGetContainers(harness.handlers, {});
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'alpha',
        'bravo',
        'zulu',
      ]);
    });

    test('sorts containers by name descending when sort=-name', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'alpha' }),
          createContainer({ id: 'c2', name: 'charlie' }),
          createContainer({ id: 'c3', name: 'bravo' }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: '-name' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'charlie',
        'bravo',
        'alpha',
      ]);
    });

    test('sorts by update status with available updates first', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'no-update', updateAvailable: false }),
          createContainer({ id: 'c2', name: 'has-update-a', updateAvailable: true }),
          createContainer({ id: 'c3', name: 'has-update-b', updateAvailable: true }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'status' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(
        payload.data.map((container: { name: string; updateAvailable: boolean }) => ({
          name: container.name,
          updateAvailable: container.updateAvailable,
        })),
      ).toEqual([
        { name: 'has-update-a', updateAvailable: true },
        { name: 'has-update-b', updateAvailable: true },
        { name: 'no-update', updateAvailable: false },
      ]);
    });

    test('sorts by update age with oldest updates first', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'newest-update',
            updateAvailable: true,
            updateAge: 2_000,
          }),
          createContainer({
            id: 'c2',
            name: 'oldest-update',
            updateAvailable: true,
            updateAge: 8_000,
          }),
          createContainer({
            id: 'c3',
            name: 'no-update',
            updateAvailable: false,
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'age' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'oldest-update',
        'newest-update',
        'no-update',
      ]);
    });

    test('sorts by image creation date', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'new-image',
            image: {
              registry: { name: 'hub', url: 'docker.io' },
              name: 'library/nginx',
              tag: { value: '1.0.0' },
              created: '2026-03-01T00:00:00.000Z',
            },
          }),
          createContainer({
            id: 'c2',
            name: 'old-image',
            image: {
              registry: { name: 'hub', url: 'docker.io' },
              name: 'library/nginx',
              tag: { value: '1.0.0' },
              created: '2025-01-01T00:00:00.000Z',
            },
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'created' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'old-image',
        'new-image',
      ]);
    });

    test('applies sorting before pagination', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'charlie' }),
          createContainer({ id: 'c2', name: 'alpha' }),
          createContainer({ id: 'c3', name: 'bravo' }),
        ],
      });

      const res = callGetContainers(harness.handlers, {
        sort: 'name',
        limit: '1',
        offset: '1',
      });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data).toEqual([expect.objectContaining({ name: 'bravo' })]);
      expect(payload.total).toBe(3);
      expect(payload.hasMore).toBe(true);
    });

    test('supports order=desc to sort containers in descending order', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'alpha' }),
          createContainer({ id: 'c2', name: 'charlie' }),
          createContainer({ id: 'c3', name: 'bravo' }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'name', order: 'desc' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'charlie',
        'bravo',
        'alpha',
      ]);
    });

    test('supports order=asc to sort containers in ascending order', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'charlie' }),
          createContainer({ id: 'c2', name: 'alpha' }),
          createContainer({ id: 'c3', name: 'bravo' }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'name', order: 'asc' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'alpha',
        'bravo',
        'charlie',
      ]);
    });

    test('order=asc overrides prefix-based descending sort', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'charlie' }),
          createContainer({ id: 'c2', name: 'alpha' }),
          createContainer({ id: 'c3', name: 'bravo' }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: '-name', order: 'asc' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'alpha',
        'bravo',
        'charlie',
      ]);
    });

    test('order=desc with sort=status sorts update-available last', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'no-update', updateAvailable: false }),
          createContainer({ id: 'c2', name: 'has-update', updateAvailable: true }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'status', order: 'desc' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'no-update',
        'has-update',
      ]);
    });

    test('order param without sort defaults to name sort', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'charlie' }),
          createContainer({ id: 'c2', name: 'alpha' }),
          createContainer({ id: 'c3', name: 'bravo' }),
        ],
      });

      const res = callGetContainers(harness.handlers, { order: 'desc' });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'charlie',
        'bravo',
        'alpha',
      ]);
    });

    test('order param is not passed as a column filter to the store', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'nginx' })],
      });

      callGetContainers(harness.handlers, { sort: 'name', order: 'asc' });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery(),
        { limit: 0, offset: 0 },
      );
    });

    test('returns 400 for invalid order value', () => {
      const harness = createHarness({ containers: [] });

      const res = callGetContainers(harness.handlers, { order: 'ascending' });

      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('applies sort with order before pagination', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'alpha' }),
          createContainer({ id: 'c2', name: 'charlie' }),
          createContainer({ id: 'c3', name: 'bravo' }),
        ],
      });

      const res = callGetContainers(harness.handlers, {
        sort: 'name',
        order: 'desc',
        limit: '2',
        offset: '0',
      });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload.data.map((container: { name: string }) => container.name)).toEqual([
        'charlie',
        'bravo',
      ]);
      expect(payload.total).toBe(3);
      expect(payload.hasMore).toBe(true);
    });

    test('maps status/kind/watcher filters to store query fields with AND semantics', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });

      callGetContainers(harness.handlers, {
        status: 'update-available',
        kind: 'major',
        watcher: 'local',
      });

      // status and kind are pushed down as store-level filters, so pagination
      // is forwarded to the store (fast path) instead of loading everything.
      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({
          updateAvailable: true,
          'updateKind.semverDiff': 'major',
          watcher: 'local',
        }),
        { limit: 0, offset: 0 },
      );
    });

    test('maps status=up-to-date to updateAvailable=false', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', updateAvailable: false })],
      });

      callGetContainers(harness.handlers, {
        status: 'up-to-date',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({
          updateAvailable: false,
        }),
        { limit: 0, offset: 0 },
      );
    });

    test('maps status=running to runtime status store filter', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', status: 'running' })],
      });

      callGetContainers(harness.handlers, {
        status: 'running',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({
          status: 'running',
        }),
        { limit: 0, offset: 0 },
      );
    });

    test.each([
      'running',
      'stopped',
      'exited',
      'paused',
      'restarting',
      'dead',
      'created',
    ])('accepts Docker runtime status=%s as a valid filter', (runtimeStatus) => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', status: runtimeStatus })],
      });

      const res = callGetContainers(harness.handlers, {
        status: runtimeStatus,
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({ status: runtimeStatus }),
        { limit: 0, offset: 0 },
      );
    });

    test('maps kind=digest to updateKind.kind filter', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });

      callGetContainers(harness.handlers, {
        kind: 'digest',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({
          'updateKind.kind': 'digest',
        }),
        { limit: 0, offset: 0 },
      );
    });

    test('kind=all keeps store-level pagination path without watched-kind in-memory filtering', () => {
      const harness = createHarness({
        containers: [
          createContainer({ id: 'c1', name: 'watched', watch: true }),
          createContainer({ id: 'c2', name: 'unwatched', watch: false }),
        ],
      });

      const res = callGetContainers(harness.handlers, {
        kind: 'all',
        limit: '1',
        offset: '0',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery(),
        { limit: 1, offset: 0 },
      );
      expect(harness.deps.getContainerCountFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery(),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].total).toBe(2);
    });

    test('status/kind filters use store-level pagination without full-collection load', () => {
      const containers = Array.from({ length: 20 }, (_, i) =>
        createContainer({
          id: `c${i + 1}`,
          name: `container-${String(i + 1).padStart(2, '0')}`,
          updateAvailable: true,
          updateKind: { semverDiff: 'major', kind: 'tag' },
        }),
      );
      const harness = createHarness({ containers });

      const res = callGetContainers(harness.handlers, {
        status: 'update-available',
        kind: 'major',
        limit: '5',
        offset: '0',
      });

      // Should forward pagination to the store (fast path) since status
      // and kind are store-level filters — no full-collection load needed.
      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({
          updateAvailable: true,
          'updateKind.semverDiff': 'major',
        }),
        { limit: 5, offset: 0 },
      );
      // Should use getContainerCountFromStore for total instead of
      // loading all containers just to count them.
      expect(harness.deps.getContainerCountFromStore).toHaveBeenCalledWith({
        excludeRollbackContainers: true,
        updateAvailable: true,
        'updateKind.semverDiff': 'major',
      });
      const payload = res.json.mock.calls[0][0];
      expect(payload.data).toHaveLength(5);
      expect(payload.total).toBe(20);
      expect(payload.hasMore).toBe(true);
    });

    test('status filter with sort still requires full-collection load', () => {
      const containers = Array.from({ length: 10 }, (_, i) =>
        createContainer({
          id: `c${i + 1}`,
          name: `container-${i + 1}`,
          updateAvailable: true,
        }),
      );
      const harness = createHarness({ containers });

      callGetContainers(harness.handlers, {
        status: 'update-available',
        sort: 'status',
        limit: '3',
      });

      // Sort requires full collection for correct pagination order
      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({ updateAvailable: true }),
        { limit: 0, offset: 0 },
      );
      // Should NOT call getContainerCountFromStore — total comes from the sorted array
      expect(harness.deps.getContainerCountFromStore).not.toHaveBeenCalled();
    });

    test('filters by update maturity buckets', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c-hot',
            name: 'hot-update',
            updateAvailable: true,
            updateMaturityLevel: 'hot',
          }),
          createContainer({
            id: 'c-mature',
            name: 'mature-update',
            updateAvailable: true,
            updateMaturityLevel: 'mature',
          }),
          createContainer({
            id: 'c-established',
            name: 'established-update',
            updateAvailable: true,
            updateMaturityLevel: 'established',
          }),
        ],
      });

      const hotRes = callGetContainers(harness.handlers, { maturity: 'hot' });
      expect(hotRes.json.mock.calls[0][0].data).toEqual([expect.objectContaining({ id: 'c-hot' })]);

      const matureRes = callGetContainers(harness.handlers, { maturity: 'mature' });
      expect(matureRes.json.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ id: 'c-mature' }),
      ]);

      const establishedRes = callGetContainers(harness.handlers, { maturity: 'established' });
      expect(establishedRes.json.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ id: 'c-established' }),
      ]);
    });

    test.each([
      [{ sort: 'latest-first' }, 'Invalid sort value'],
      [{ status: 'active' }, 'Invalid status filter value'],
      [{ kind: 'prerelease' }, 'Invalid kind filter value'],
      [{ watcher: '   ' }, 'Invalid watcher filter value'],
      [{ maturity: 'fresh' }, 'Invalid maturity filter value'],
    ])('returns 400 for invalid container-list filters: %o', (query, expectedMessage) => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });

      const res = callGetContainers(harness.handlers, query);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: expectedMessage,
      });
      expect(harness.deps.getContainersFromStore).not.toHaveBeenCalled();
    });

    test('preserves non-control query params in store filtering', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', labels: 'prod' })],
      });

      callGetContainers(harness.handlers, {
        labels: 'prod',
        watcher: 'local',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith(
        buildVisibleContainersStoreQuery({
          labels: 'prod',
          watcher: 'local',
        }),
        { limit: 0, offset: 0 },
      );
    });

    test('supports array query values for sort and defaults when array contains no strings', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'alpha' })],
      });

      const resFromStringArray = callGetContainers(harness.handlers, {
        sort: ['-name', 'name'],
      });
      expect(resFromStringArray.status).toHaveBeenCalledWith(200);

      const resFromNonStringArray = callGetContainers(harness.handlers, {
        sort: [1, 2] as any,
      });
      expect(resFromNonStringArray.status).toHaveBeenCalledWith(200);
    });

    test('computes update age fallback from firstSeenAt, publishedAt, and updateDetectedAt', () => {
      vi.useFakeTimers();
      const now = new Date('2026-03-15T00:00:00.000Z').getTime();
      vi.setSystemTime(now);

      try {
        const harness = createHarness({
          containers: [
            createContainer({
              id: 'c-min',
              firstSeenAt: '2026-03-05T00:00:00.000Z',
              result: { publishedAt: '2026-03-12T00:00:00.000Z' },
            }),
            createContainer({
              id: 'c-first',
              firstSeenAt: '2026-03-07T00:00:00.000Z',
            }),
            createContainer({
              id: 'c-published',
              result: { publishedAt: '2026-03-09T00:00:00.000Z' },
            }),
            createContainer({
              id: 'c-detected',
              updateDetectedAt: '2026-03-11T00:00:00.000Z',
            }),
            createContainer({
              id: 'c-none',
            }),
          ],
        });

        const res = callGetContainers(harness.handlers, { sort: 'age' });
        const payload = res.json.mock.calls[0][0];

        expect(payload.data.map((container: { id: string }) => container.id)).toEqual([
          'c-min',
          'c-first',
          'c-published',
          'c-detected',
          'c-none',
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    test('derives maturity filter from update age when updateMaturityLevel is missing', () => {
      vi.useFakeTimers();
      const now = new Date('2026-03-15T00:00:00.000Z').getTime();
      vi.setSystemTime(now);
      const previousThreshold = process.env.DD_UI_MATURITY_THRESHOLD_DAYS;
      process.env.DD_UI_MATURITY_THRESHOLD_DAYS = '5';

      try {
        const harness = createHarness({
          containers: [
            createContainer({
              id: 'c-hot',
              firstSeenAt: '2026-03-14T00:00:00.000Z',
            }),
            createContainer({
              id: 'c-mature',
              result: { publishedAt: '2026-03-07T00:00:00.000Z' },
            }),
            createContainer({
              id: 'c-established',
              updateDetectedAt: '2026-02-01T00:00:00.000Z',
            }),
          ],
        });

        const hotRes = callGetContainers(harness.handlers, { maturity: 'hot' });
        expect(hotRes.json.mock.calls[0][0].data).toEqual([
          expect.objectContaining({ id: 'c-hot' }),
        ]);

        const matureRes = callGetContainers(harness.handlers, { maturity: 'mature' });
        expect(matureRes.json.mock.calls[0][0].data).toEqual([
          expect.objectContaining({ id: 'c-mature' }),
        ]);

        const establishedRes = callGetContainers(harness.handlers, { maturity: 'established' });
        expect(establishedRes.json.mock.calls[0][0].data).toEqual([
          expect.objectContaining({ id: 'c-established' }),
        ]);
      } finally {
        if (previousThreshold === undefined) {
          delete process.env.DD_UI_MATURITY_THRESHOLD_DAYS;
        } else {
          process.env.DD_UI_MATURITY_THRESHOLD_DAYS = previousThreshold;
        }
        vi.useRealTimers();
      }
    });

    test('excludes containers without resolvable age when applying maturity filters', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-15T00:00:00.000Z'));

      try {
        const harness = createHarness({
          containers: [
            createContainer({
              id: 'c-no-age',
            }),
            createContainer({
              id: 'c-hot',
              firstSeenAt: '2026-03-14T00:00:00.000Z',
            }),
          ],
        });

        const res = callGetContainers(harness.handlers, { maturity: 'hot' });
        const payload = res.json.mock.calls[0][0];

        expect(payload.data.map((container: { id: string }) => container.id)).toEqual(['c-hot']);
      } finally {
        vi.useRealTimers();
      }
    });

    test('uses watcher/name/id fallbacks when sorting by age with equal ages', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 1 as any,
            name: 1 as any,
            watcher: 1 as any,
          }),
          createContainer({
            id: 'c2',
            name: 'alpha',
            watcher: 'local',
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'age' });
      const payload = res.json.mock.calls[0][0];

      expect(payload.data.map((container: { id: unknown }) => container.id)).toEqual([1, 'c2']);
    });

    test('sorts by created date name tie-breaker when timestamps are equal', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c-beta',
            name: 'beta',
            image: {
              registry: { name: 'hub', url: 'docker.io' },
              name: 'library/nginx',
              tag: { value: '1.0.0' },
              created: '2026-03-01T00:00:00.000Z',
            },
          }),
          createContainer({
            id: 'c-alpha',
            name: 'alpha',
            image: {
              registry: { name: 'hub', url: 'docker.io' },
              name: 'library/nginx',
              tag: { value: '1.0.0' },
              created: '2026-03-01T00:00:00.000Z',
            },
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'created' });
      const payload = res.json.mock.calls[0][0];

      expect(payload.data.map((container: { id: string }) => container.id)).toEqual([
        'c-alpha',
        'c-beta',
      ]);
    });

    test('sorts by created date with valid timestamps before invalid timestamps', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c-invalid-a',
            name: 'invalid-a',
            image: {
              registry: { name: 'hub', url: 'docker.io' },
              name: 'library/nginx',
              tag: { value: '1.0.0' },
              created: 'not-a-date',
            },
          }),
          createContainer({
            id: 'c-valid',
            name: 'valid',
            image: {
              registry: { name: 'hub', url: 'docker.io' },
              name: 'library/nginx',
              tag: { value: '1.0.0' },
              created: '2025-01-01T00:00:00.000Z',
            },
          }),
          createContainer({
            id: 'c-invalid-b',
            name: 'invalid-b',
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'created' });
      const payload = res.json.mock.calls[0][0];

      expect(payload.data.map((container: { id: string }) => container.id)).toEqual([
        'c-valid',
        'c-invalid-a',
        'c-invalid-b',
      ]);
    });

    test('sorts by created date when left entry is invalid and right entry is valid', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c-invalid',
            image: {
              registry: { name: 'hub', url: 'docker.io' },
              name: 'library/nginx',
              tag: { value: '1.0.0' },
              created: 'not-a-date',
            },
          }),
          createContainer({
            id: 'c-valid',
            image: {
              registry: { name: 'hub', url: 'docker.io' },
              name: 'library/nginx',
              tag: { value: '1.0.0' },
              created: '2025-01-01T00:00:00.000Z',
            },
          }),
        ],
      });

      const res = callGetContainers(harness.handlers, { sort: 'created' });
      const payload = res.json.mock.calls[0][0];

      expect(payload.data.map((container: { id: string }) => container.id)).toEqual([
        'c-valid',
        'c-invalid',
      ]);
    });

    test('returns generic invalid request message when a non-Error is thrown', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      harness.deps.getContainersFromStore.mockImplementation(() => {
        throw 'non-error';
      });

      const res = callGetContainers(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Invalid request',
      });
    });
  });

  describe('summary and lookup handlers', () => {
    test('returns running/stopped, updatesAvailable, and security issue summary', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            status: 'running',
            updateAvailable: true,
            security: { scan: { summary: { critical: 1, high: 0 } } },
          }),
          createContainer({
            id: 'c2',
            status: 'exited',
            updateAvailable: false,
            security: { scan: { summary: { critical: 0, high: 2 } } },
          }),
          createContainer({
            id: 'c3',
            status: 'paused',
            updateAvailable: true,
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
          updatesAvailable: 2,
        },
        security: {
          issues: 2,
        },
        hotUpdates: 0,
        matureUpdates: 0,
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
          updatesAvailable: 0,
        },
        security: {
          issues: 0,
        },
        hotUpdates: 0,
        matureUpdates: 0,
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
          updatesAvailable: 0,
        },
        security: {
          issues: 0,
        },
        hotUpdates: 0,
        matureUpdates: 0,
      });
    });

    test('includes hot and mature update counters in summary', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            updateAvailable: true,
            updateMaturityLevel: 'hot',
          }),
          createContainer({
            id: 'c2',
            updateAvailable: true,
            updateMaturityLevel: 'mature',
          }),
          createContainer({
            id: 'c3',
            updateAvailable: true,
            updateMaturityLevel: 'established',
          }),
          createContainer({
            id: 'c4',
            updateAvailable: false,
            updateMaturityLevel: 'hot',
          }),
        ],
      });

      const res = callGetContainerSummary(harness.handlers);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        containers: {
          total: 4,
          running: 4,
          stopped: 0,
          updatesAvailable: 3,
        },
        security: { issues: 0 },
        hotUpdates: 1,
        matureUpdates: 2,
      });
    });

    test('returns aggregated vulnerabilities grouped by image for the security view', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'nginx',
            displayName: 'nginx',
            security: {
              scan: {
                scannedAt: '2026-02-01T10:00:00.000Z',
                vulnerabilities: [
                  {
                    id: 'CVE-2026-0001',
                    severity: 'CRITICAL',
                    packageName: 'openssl',
                    installedVersion: '3.0.0',
                    fixedVersion: '3.0.1',
                    title: 'openssl issue',
                    target: 'usr/lib/libssl.so',
                    primaryUrl: 'https://example.com/CVE-2026-0001',
                    publishedDate: '2026-01-01T00:00:00.000Z',
                  },
                ],
              },
              updateScan: {
                summary: {
                  critical: 0,
                  high: 0,
                  medium: 0,
                  low: 0,
                  unknown: 2,
                },
              },
            },
          }),
          createContainer({
            id: 'c2',
            name: 'nginx',
            displayName: 'nginx',
            security: {
              scan: {
                scannedAt: '2026-02-02T10:00:00.000Z',
                vulnerabilities: [
                  {
                    id: 'CVE-2026-0002',
                    severity: 'HIGH',
                    package: 'zlib',
                    version: '1.2.10',
                  },
                ],
              },
            },
          }),
          createContainer({
            id: 'c3',
            name: 'redis',
            displayName: 'redis',
            security: {},
          }),
        ],
      });

      const res = callGetContainerSecurityVulnerabilities(harness.handlers);

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith({});
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        totalContainers: 3,
        scannedContainers: 2,
        latestScannedAt: '2026-02-02T10:00:00.000Z',
        total: 2,
        limit: 0,
        offset: 0,
        hasMore: false,
        images: [
          {
            image: 'nginx',
            containerIds: ['c1', 'c2'],
            updateSummary: {
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              unknown: 2,
            },
            vulnerabilities: [
              {
                id: 'CVE-2026-0001',
                severity: 'CRITICAL',
                package: 'openssl',
                version: '3.0.0',
                fixedIn: '3.0.1',
                title: 'openssl issue',
                target: 'usr/lib/libssl.so',
                primaryUrl: 'https://example.com/CVE-2026-0001',
                publishedDate: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'CVE-2026-0002',
                severity: 'HIGH',
                package: 'zlib',
                version: '1.2.10',
                fixedIn: null,
                title: '',
                target: '',
                primaryUrl: '',
                publishedDate: '',
              },
            ],
          },
        ],
      });
    });

    test('derives security overview totals from fetched containers without a separate count query', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'nginx',
            displayName: 'nginx',
            security: {
              scan: {
                scannedAt: '2026-02-01T10:00:00.000Z',
                vulnerabilities: [],
              },
            },
          }),
          createContainer({
            id: 'c2',
            name: 'redis',
            displayName: 'redis',
          }),
        ],
      });
      harness.deps.getContainerCountFromStore.mockImplementation(() => {
        throw new Error('unexpected count query');
      });

      const res = callGetContainerSecurityVulnerabilities(harness.handlers);

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith({});
      expect(harness.deps.getContainerCountFromStore).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        totalContainers: 2,
        scannedContainers: 1,
        latestScannedAt: '2026-02-01T10:00:00.000Z',
        total: 0,
        limit: 0,
        offset: 0,
        hasMore: false,
        images: [
          {
            image: 'nginx',
            containerIds: ['c1'],
            vulnerabilities: [],
          },
        ],
      });
    });

    test('supports limit/offset pagination for aggregated vulnerabilities', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'nginx',
            displayName: 'nginx',
            security: {
              scan: {
                scannedAt: '2026-02-01T10:00:00.000Z',
                vulnerabilities: [
                  {
                    id: 'CVE-2026-0001',
                    severity: 'CRITICAL',
                    packageName: 'openssl',
                    installedVersion: '3.0.0',
                  },
                  {
                    id: 'CVE-2026-0002',
                    severity: 'HIGH',
                    packageName: 'zlib',
                    installedVersion: '1.2.10',
                  },
                ],
              },
            },
          }),
          createContainer({
            id: 'c2',
            name: 'redis',
            displayName: 'redis',
            security: {
              scan: {
                scannedAt: '2026-02-02T10:00:00.000Z',
                vulnerabilities: [
                  {
                    id: 'CVE-2026-0003',
                    severity: 'MEDIUM',
                    packageName: 'jemalloc',
                    installedVersion: '5.2.1',
                  },
                ],
              },
            },
          }),
        ],
      });

      const res = callGetContainerSecurityVulnerabilities(harness.handlers, {
        limit: '1',
        offset: '1',
      });

      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith({});
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        totalContainers: 2,
        scannedContainers: 2,
        latestScannedAt: '2026-02-02T10:00:00.000Z',
        total: 3,
        limit: 1,
        offset: 1,
        hasMore: true,
        _links: {
          self: '/api/containers/security/vulnerabilities?limit=1&offset=1',
          next: '/api/containers/security/vulnerabilities?limit=1&offset=2',
        },
        images: [
          {
            image: 'nginx',
            containerIds: ['c1'],
            vulnerabilities: [
              {
                id: 'CVE-2026-0002',
                severity: 'HIGH',
                package: 'zlib',
                version: '1.2.10',
                fixedIn: null,
                title: '',
                target: '',
                primaryUrl: '',
                publishedDate: '',
              },
            ],
          },
        ],
      });
    });

    test('supports offset-only pagination for aggregated vulnerabilities when limit is zero', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'nginx',
            displayName: 'nginx',
            security: {
              scan: {
                vulnerabilities: [
                  {
                    id: 'CVE-2026-1001',
                    severity: 'LOW',
                    packageName: 'openssl',
                    installedVersion: '3.0.0',
                  },
                  {
                    id: 'CVE-2026-1002',
                    severity: 'HIGH',
                    packageName: 'zlib',
                    installedVersion: '1.2.10',
                  },
                ],
              },
            },
          }),
          createContainer({
            id: 'c2',
            name: 'redis',
            displayName: 'redis',
            security: {
              scan: {
                vulnerabilities: [
                  {
                    id: 'CVE-2026-1003',
                    severity: 'MEDIUM',
                    packageName: 'jemalloc',
                    installedVersion: '5.2.1',
                  },
                ],
              },
            },
          }),
        ],
      });

      const res = callGetContainerSecurityVulnerabilities(harness.handlers, {
        limit: '0',
        offset: '1',
      });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload).toMatchObject({
        totalContainers: 2,
        scannedContainers: 2,
        latestScannedAt: null,
        total: 3,
        limit: 0,
        offset: 1,
        hasMore: false,
      });
      expect(payload).not.toHaveProperty('_links');
      expect(payload.images).toEqual([
        {
          image: 'nginx',
          containerIds: ['c1'],
          vulnerabilities: [
            {
              id: 'CVE-2026-1002',
              severity: 'HIGH',
              package: 'zlib',
              version: '1.2.10',
              fixedIn: null,
              title: '',
              target: '',
              primaryUrl: '',
              publishedDate: '',
            },
          ],
        },
        {
          image: 'redis',
          containerIds: ['c2'],
          vulnerabilities: [
            {
              id: 'CVE-2026-1003',
              severity: 'MEDIUM',
              package: 'jemalloc',
              version: '5.2.1',
              fixedIn: null,
              title: '',
              target: '',
              primaryUrl: '',
              publishedDate: '',
            },
          ],
        },
      ]);
    });

    test('reuses paginated image groups and carries update summary when multiple rows share an image', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'nginx',
            displayName: 'nginx',
            security: {
              scan: {
                vulnerabilities: [
                  {
                    id: 'CVE-2026-2001',
                    severity: 'LOW',
                    packageName: 'openssl',
                    installedVersion: '3.0.0',
                  },
                  {
                    id: 'CVE-2026-2002',
                    severity: 'HIGH',
                    packageName: 'zlib',
                    installedVersion: '1.2.10',
                  },
                ],
              },
              updateScan: {
                summary: {
                  unknown: 5,
                  low: 4,
                  medium: 3,
                  high: 2,
                  critical: 1,
                },
              },
            },
          }),
        ],
      });

      const res = callGetContainerSecurityVulnerabilities(harness.handlers, {
        limit: '2',
        offset: '0',
      });
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload).toMatchObject({
        total: 2,
        limit: 2,
        offset: 0,
        hasMore: false,
        _links: {
          self: '/api/containers/security/vulnerabilities?limit=2&offset=0',
        },
      });
      expect(payload.images).toEqual([
        {
          image: 'nginx',
          containerIds: ['c1'],
          updateSummary: {
            unknown: 5,
            low: 4,
            medium: 3,
            high: 2,
            critical: 1,
          },
          vulnerabilities: [
            {
              id: 'CVE-2026-2001',
              severity: 'LOW',
              package: 'openssl',
              version: '3.0.0',
              fixedIn: null,
              title: '',
              target: '',
              primaryUrl: '',
              publishedDate: '',
            },
            {
              id: 'CVE-2026-2002',
              severity: 'HIGH',
              package: 'zlib',
              version: '1.2.10',
              fixedIn: null,
              title: '',
              target: '',
              primaryUrl: '',
              publishedDate: '',
            },
          ],
        },
      ]);
    });

    test('skips paged rows defensively when template lookup misses during grouping', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            name: 'nginx',
            displayName: 'nginx',
            security: {
              scan: {
                vulnerabilities: [
                  {
                    id: 'CVE-2026-3001',
                    severity: 'LOW',
                    packageName: 'openssl',
                    installedVersion: '3.0.0',
                  },
                ],
              },
            },
          }),
        ],
      });
      const originalGet = Map.prototype.get;
      const getSpy = vi.spyOn(Map.prototype, 'get').mockImplementation(function (
        this: Map<unknown, unknown>,
        key: unknown,
      ) {
        const value = originalGet.call(this, key);
        if (
          value &&
          typeof value === 'object' &&
          'image' in (value as Record<string, unknown>) &&
          Array.isArray((value as Record<string, unknown>).containerIds) &&
          Array.isArray((value as Record<string, unknown>).vulnerabilities)
        ) {
          return undefined;
        }
        return value;
      });

      try {
        const res = callGetContainerSecurityVulnerabilities(harness.handlers, {
          limit: '1',
          offset: '0',
        });
        const payload = res.json.mock.calls[0][0];

        expect(res.status).toHaveBeenCalledWith(200);
        expect(payload).toMatchObject({
          totalContainers: 1,
          scannedContainers: 1,
          total: 1,
          limit: 1,
          offset: 0,
          hasMore: false,
          _links: {
            self: '/api/containers/security/vulnerabilities?limit=1&offset=0',
          },
          images: [],
        });
      } finally {
        getSpy.mockRestore();
      }
    });

    test('normalizes edge-case scan payloads and resolves image names through all fallbacks', () => {
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'name-fallback-a',
            name: 'name-fallback',
            displayName: '',
            security: {
              scan: {
                scannedAt: '2026-02-10T00:00:00.000Z',
                vulnerabilities: [
                  'invalid-vulnerability',
                  {
                    id: 'CVE-NAME',
                    severity: 'HIGH',
                    packageName: 'pkg-name',
                  },
                ],
              },
              updateScan: {
                summary: 'invalid-summary',
              },
            },
          }),
          createContainer({
            id: 'name-fallback-b',
            name: 'name-fallback',
            displayName: '',
            security: {
              scan: {
                scannedAt: '2026-02-01T00:00:00.000Z',
                vulnerabilities: [],
              },
            },
          }),
          createContainer({
            id: 'unknown-fallback',
            name: '',
            displayName: '',
            security: {
              scan: {
                scannedAt: 'z',
                vulnerabilities: null,
              },
            },
          }),
          createContainer({
            id: 'display-name',
            name: 'display-name-fallback',
            displayName: 'display-name',
            security: {
              scan: {
                scannedAt: 'a',
                vulnerabilities: [],
              },
            },
          }),
          createContainer({
            id: 'empty-scan-date',
            name: 'ignored-empty-date',
            displayName: '',
            security: {
              scan: {
                scannedAt: '',
                vulnerabilities: [],
              },
            },
          }),
        ],
      });

      const res = callGetContainerSecurityVulnerabilities(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload).toMatchObject({
        totalContainers: 5,
        scannedContainers: 5,
        latestScannedAt: 'z',
        total: 2,
        limit: 0,
        offset: 0,
        hasMore: false,
      });

      expect(payload.images).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            image: 'name-fallback',
            containerIds: ['name-fallback-a', 'name-fallback-b'],
            updateSummary: {
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              unknown: 0,
            },
            vulnerabilities: expect.arrayContaining([
              expect.objectContaining({
                id: 'unknown',
                severity: 'UNKNOWN',
                package: 'unknown',
              }),
              expect.objectContaining({
                id: 'CVE-NAME',
                package: 'pkg-name',
              }),
            ]),
          }),
          expect.objectContaining({
            image: 'unknown',
            containerIds: ['unknown-fallback'],
            vulnerabilities: [],
          }),
          expect.objectContaining({
            image: 'display-name',
            containerIds: ['display-name'],
            vulnerabilities: [],
          }),
        ]),
      );
    });

    test('returns empty overview when no containers are fetched', () => {
      const harness = createHarness({ containers: [] });

      const res = callGetContainerSecurityVulnerabilities(harness.handlers);
      const payload = res.json.mock.calls[0][0];

      expect(res.status).toHaveBeenCalledWith(200);
      expect(payload).toMatchObject({
        totalContainers: 0,
        scannedContainers: 0,
        total: 0,
        images: [],
      });
      expect(harness.deps.getContainersFromStore).toHaveBeenCalledWith({});
      expect(harness.deps.getContainerCountFromStore).not.toHaveBeenCalled();
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
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining(redacted));
    });

    test('returns 404 when container id does not exist', () => {
      const harness = createHarness();

      const res = callGetContainer(harness.handlers, 'missing');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('includes active update-operation state on list and single-container responses', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'edge-api' })],
      });
      harness.deps.updateOperationStore.getActiveOperationByContainerName.mockReturnValue({
        id: 'op-1',
        status: 'in-progress',
        phase: 'old-stopped',
        updatedAt: '2026-04-01T12:00:00.000Z',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        batchId: 'batch-1',
        queuePosition: 1,
        queueTotal: 3,
      });

      const listRes = callGetContainers(harness.handlers);
      const singleRes = callGetContainer(harness.handlers, 'c1');

      expect(
        harness.deps.updateOperationStore.getActiveOperationByContainerName,
      ).toHaveBeenCalledWith('edge-api');
      expect(listRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              updateOperation: expect.objectContaining({
                id: 'op-1',
                status: 'in-progress',
                phase: 'old-stopped',
                fromVersion: '1.0.0',
                toVersion: '1.1.0',
                batchId: 'batch-1',
                queuePosition: 1,
                queueTotal: 3,
              }),
            }),
          ],
        }),
      );
      expect(singleRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          updateOperation: expect.objectContaining({
            id: 'op-1',
            status: 'in-progress',
            phase: 'old-stopped',
            batchId: 'batch-1',
            queuePosition: 1,
            queueTotal: 3,
          }),
        }),
      );
    });

    test('coerces string queue metadata on active update-operation responses', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'edge-api' })],
      });
      harness.deps.updateOperationStore.getActiveOperationByContainerName.mockReturnValue({
        id: 'op-1',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-2',
        queuePosition: '2',
        queueTotal: '3',
      });

      const listRes = callGetContainers(harness.handlers);
      const singleRes = callGetContainer(harness.handlers, 'c1');

      expect(listRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              updateOperation: expect.objectContaining({
                batchId: 'batch-2',
                queuePosition: 2,
                queueTotal: 3,
              }),
            }),
          ],
        }),
      );
      expect(singleRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          updateOperation: expect.objectContaining({
            batchId: 'batch-2',
            queuePosition: 2,
            queueTotal: 3,
          }),
        }),
      );
    });

    test('omits invalid queue metadata from active update-operation responses', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'edge-api' })],
      });
      harness.deps.updateOperationStore.getActiveOperationByContainerName.mockReturnValue({
        id: 'op-1',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-3',
        queuePosition: 'not-a-number',
        queueTotal: '2',
      });

      const listRes = callGetContainers(harness.handlers);
      const singleRes = callGetContainer(harness.handlers, 'c1');

      expect(listRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              updateOperation: expect.not.objectContaining({
                batchId: expect.anything(),
                queuePosition: expect.anything(),
                queueTotal: expect.anything(),
              }),
            }),
          ],
        }),
      );
      expect(singleRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          updateOperation: expect.not.objectContaining({
            batchId: expect.anything(),
            queuePosition: expect.anything(),
            queueTotal: expect.anything(),
          }),
        }),
      );
    });

    test('includes active update-operation state after container replacement changes the Docker ID (#248)', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'new-c1', name: 'edge-api' })],
      });
      harness.deps.updateOperationStore.getActiveOperationByContainerId.mockImplementation(
        (id: string) =>
          id === 'new-c1'
            ? {
                id: 'op-1',
                containerId: 'old-c1',
                newContainerId: 'new-c1',
                status: 'in-progress',
                phase: 'new-started',
                updatedAt: '2026-04-03T12:00:00.000Z',
                fromVersion: '1.0.0',
                toVersion: '1.1.0',
              }
            : undefined,
      );

      const listRes = callGetContainers(harness.handlers);
      const singleRes = callGetContainer(harness.handlers, 'new-c1');

      expect(
        harness.deps.updateOperationStore.getActiveOperationByContainerId,
      ).toHaveBeenCalledWith('new-c1');
      expect(
        harness.deps.updateOperationStore.getActiveOperationByContainerName,
      ).not.toHaveBeenCalled();
      expect(listRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              updateOperation: expect.objectContaining({
                id: 'op-1',
                status: 'in-progress',
                phase: 'new-started',
                fromVersion: '1.0.0',
                toVersion: '1.1.0',
              }),
            }),
          ],
        }),
      );
      expect(singleRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          updateOperation: expect.objectContaining({
            id: 'op-1',
            status: 'in-progress',
            phase: 'new-started',
          }),
        }),
      );
    });

    test('omits invalid active update-operation status and phase values from responses', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'edge-api' })],
      });
      harness.deps.updateOperationStore.getActiveOperationByContainerName.mockReturnValue({
        id: 'op-1',
        status: 'success',
        phase: 'complete',
        updatedAt: '2026-04-01T12:00:00.000Z',
      });

      const listRes = callGetContainers(harness.handlers);
      const singleRes = callGetContainer(harness.handlers, 'c1');

      expect(listRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.not.objectContaining({ updateOperation: expect.anything() })],
        }),
      );
      expect(singleRes.json).toHaveBeenCalledWith(
        expect.not.objectContaining({ updateOperation: expect.anything() }),
      );
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
      expect(res.json).toHaveBeenCalledWith({
        data: [{ id: 'op-1' }, { id: 'op-2' }],
        total: 2,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('applies limit/offset pagination to update-operation history', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'edge-api' })],
      });
      harness.deps.updateOperationStore.getOperationsByContainerName.mockReturnValue([
        { id: 'op-1' },
        { id: 'op-2' },
        { id: 'op-3' },
      ]);

      const res = callGetContainerUpdateOperations(harness.handlers, 'c1', {
        limit: '1',
        offset: '1',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [{ id: 'op-2' }],
        total: 3,
        limit: 1,
        offset: 1,
        hasMore: true,
        _links: {
          self: '/api/containers/c1/update-operations?limit=1&offset=1',
          next: '/api/containers/c1/update-operations?limit=1&offset=2',
        },
      });
    });

    test('applies offset-only pagination when limit is zero for update-operations', () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', name: 'edge-api' })],
      });
      harness.deps.updateOperationStore.getOperationsByContainerName.mockReturnValue([
        { id: 'op-1' },
        { id: 'op-2' },
        { id: 'op-3' },
      ]);

      const res = callGetContainerUpdateOperations(harness.handlers, 'c1', {
        limit: '0',
        offset: '1',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [{ id: 'op-2' }, { id: 'op-3' }],
        total: 3,
        limit: 0,
        offset: 1,
        hasMore: false,
      });
    });

    test('returns 404 for update-operation lookup when container is missing', () => {
      const harness = createHarness();

      const res = callGetContainerUpdateOperations(harness.handlers, 'missing');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
      expect(harness.deps.updateOperationStore.getOperationsByContainerName).not.toHaveBeenCalled();
    });
  });

  describe('release notes handler', () => {
    test('returns full release notes when available', async () => {
      mockGetFullReleaseNotesForContainer.mockResolvedValue({
        title: 'Release 2.0.0',
        body: 'Full release notes body',
        url: 'https://github.com/acme/service/releases/tag/v2.0.0',
        publishedAt: '2026-03-01T00:00:00.000Z',
        provider: 'github',
      });
      const harness = createHarness({
        containers: [
          createContainer({
            id: 'c1',
            sourceRepo: 'github.com/acme/service',
            result: {
              tag: '2.0.0',
            },
          }),
        ],
      });

      const res = await callGetContainerReleaseNotes(harness.handlers, 'c1');

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        title: 'Release 2.0.0',
        body: 'Full release notes body',
        url: 'https://github.com/acme/service/releases/tag/v2.0.0',
        publishedAt: '2026-03-01T00:00:00.000Z',
        provider: 'github',
      });
    });

    test('returns 404 when container is missing', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });

      const res = await callGetContainerReleaseNotes(harness.handlers, 'missing');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
      expect(mockGetFullReleaseNotesForContainer).not.toHaveBeenCalled();
    });

    test('returns 404 when release notes are unavailable', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });

      const res = await callGetContainerReleaseNotes(harness.handlers, 'c1');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Release notes not available' });
    });

    test('returns 500 when release notes lookup throws', async () => {
      mockGetFullReleaseNotesForContainer.mockRejectedValue(new Error('boom'));
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });

      const res = await callGetContainerReleaseNotes(harness.handlers, 'c1');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Error retrieving release notes (boom)',
      });
    });
  });

  describe('revealContainerEnv', () => {
    test('returns 501 when raw env dependencies are not provided', () => {
      const handlers = createCrudHandlers({
        storeApi: {
          getContainersFromStore: vi.fn(() => []),
          getContainerCountFromStore: vi.fn(() => 0),
          storeContainer: {
            getContainer: vi.fn(),
            deleteContainer: vi.fn(),
          },
          updateOperationStore: {
            getOperationsByContainerName: vi.fn(() => []),
            getInProgressOperationByContainerName: vi.fn(() => undefined),
            getInProgressOperationByContainerId: vi.fn(() => undefined),
          },
        },
        agentApi: {
          getServerConfiguration: vi.fn(() => ({ feature: { delete: true } })),
          getAgent: vi.fn(),
          getWatchers: vi.fn(() => ({})),
        },
        errorApi: {
          getErrorMessage: vi.fn(() => 'error'),
          getErrorStatusCode: vi.fn(() => undefined),
        },
        securityApi: {
          redactContainerRuntimeEnv: vi.fn((container) => container),
          redactContainersRuntimeEnv: vi.fn((value) => value),
        },
      });

      const res = callRevealContainerEnv(handlers);

      expect(res.status).toHaveBeenCalledWith(501);
      expect(res.json).toHaveBeenCalledWith({ error: 'Environment reveal is not available' });
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

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
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

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container deletion is disabled' });
      expect(harness.deps.storeContainer.deleteContainer).not.toHaveBeenCalled();
    });

    test('returns 404 when delete target is missing', async () => {
      const harness = createHarness();

      const res = await callDeleteContainer(harness.handlers, 'missing');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
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

      const res = await callWatchContainers(harness.handlers, { query: { watcher: 'local' } });

      expect(watcherA.watch).toHaveBeenCalledTimes(1);
      expect(watcherB.watch).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c1' })],
        total: 1,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
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

    test('watchContainers validates request payload and rejects unknown properties', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      const watcher = {
        watch: vi.fn().mockResolvedValue(undefined),
        watchContainer: vi.fn().mockResolvedValue({ container: createContainer({ id: 'c1' }) }),
      };
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': watcher,
      });

      const res = await callWatchContainers(harness.handlers, {
        body: {
          containerIds: ['c1'],
          unexpected: true,
        },
      });

      expect(watcher.watch).not.toHaveBeenCalled();
      expect(watcher.watchContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Unknown request properties: unexpected',
      });
    });

    test('watchContainers treats an empty payload object as watch-all', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });
      const watcher = {
        watch: vi.fn().mockResolvedValue(undefined),
        watchContainer: vi.fn(),
      };
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': watcher,
      });

      const res = await callWatchContainers(harness.handlers, {
        body: {},
      });

      expect(watcher.watch).toHaveBeenCalledTimes(1);
      expect(watcher.watchContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('watchContainers validates payload types and containerIds constraints', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1' })],
      });

      const invalidBodyRes = await callWatchContainers(harness.handlers, {
        body: ['c1'],
      });
      expect(invalidBodyRes.status).toHaveBeenCalledWith(400);
      expect(invalidBodyRes.json).toHaveBeenCalledWith({
        error: 'Request body must be an object',
      });

      const nonArrayIdsRes = await callWatchContainers(harness.handlers, {
        body: { containerIds: 'c1' },
      });
      expect(nonArrayIdsRes.status).toHaveBeenCalledWith(400);
      expect(nonArrayIdsRes.json).toHaveBeenCalledWith({
        error: 'containerIds must be an array of non-empty strings',
      });

      const emptyIdsRes = await callWatchContainers(harness.handlers, {
        body: { containerIds: [] },
      });
      expect(emptyIdsRes.status).toHaveBeenCalledWith(400);
      expect(emptyIdsRes.json).toHaveBeenCalledWith({
        error: 'containerIds must not be empty',
      });

      const tooManyIdsRes = await callWatchContainers(harness.handlers, {
        body: { containerIds: Array.from({ length: 201 }, (_, index) => `c${index}`) },
      });
      expect(tooManyIdsRes.status).toHaveBeenCalledWith(400);
      expect(tooManyIdsRes.json).toHaveBeenCalledWith({
        error: 'containerIds must contain at most 200 entries',
      });

      const invalidIdRes = await callWatchContainers(harness.handlers, {
        body: { containerIds: ['c1', '   '] },
      });
      expect(invalidIdRes.status).toHaveBeenCalledWith(400);
      expect(invalidIdRes.json).toHaveBeenCalledWith({
        error: 'containerIds must be an array of non-empty strings',
      });
    });

    test('watchContainers honors containerIds payload for targeted batch watch', async () => {
      const c1 = createContainer({ id: 'c1', watcher: 'local', agent: undefined });
      const c2 = createContainer({ id: 'c2', watcher: 'remote', agent: undefined });
      const harness = createHarness({
        containers: [c1, c2],
      });
      const watcherLocal = {
        watch: vi.fn().mockResolvedValue(undefined),
        watchContainer: vi.fn().mockResolvedValue({ container: c1 }),
      };
      const watcherRemote = {
        watch: vi.fn().mockResolvedValue(undefined),
        watchContainer: vi.fn().mockResolvedValue({ container: c2 }),
      };
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': watcherLocal,
        'docker.remote': watcherRemote,
      });

      const res = await callWatchContainers(harness.handlers, {
        body: { containerIds: ['c1'] },
      });

      expect(watcherLocal.watch).not.toHaveBeenCalled();
      expect(watcherRemote.watch).not.toHaveBeenCalled();
      expect(watcherLocal.watchContainer).toHaveBeenCalledTimes(1);
      expect(watcherLocal.watchContainer).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
      );
      expect(watcherRemote.watchContainer).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id: 'c1' }), expect.objectContaining({ id: 'c2' })],
        total: 2,
        limit: 0,
        offset: 0,
        hasMore: false,
      });
    });

    test('watchContainers de-duplicates targeted container ids before dispatching', async () => {
      const c1 = createContainer({ id: 'c1', watcher: 'local', agent: undefined });
      const c2 = createContainer({ id: 'c2', watcher: 'remote', agent: undefined });
      const harness = createHarness({
        containers: [c1, c2],
      });
      const watcherLocal = {
        watch: vi.fn().mockResolvedValue(undefined),
        watchContainer: vi.fn().mockResolvedValue({ container: c1 }),
      };
      const watcherRemote = {
        watch: vi.fn().mockResolvedValue(undefined),
        watchContainer: vi.fn().mockResolvedValue({ container: c2 }),
      };
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': watcherLocal,
        'docker.remote': watcherRemote,
      });

      const res = await callWatchContainers(harness.handlers, {
        body: { containerIds: ['c1', ' c1 ', 'c2', 'c2'] },
      });

      expect(watcherLocal.watchContainer).toHaveBeenCalledTimes(1);
      expect(watcherRemote.watchContainer).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test('watchContainers returns 404 when targeted container is missing', async () => {
      const harness = createHarness();
      harness.deps.getWatchers.mockReturnValue({
        'docker.local': {
          watch: vi.fn(),
          watchContainer: vi.fn(),
        },
      });

      const res = await callWatchContainers(harness.handlers, {
        body: { containerIds: ['missing'] },
      });

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
    });

    test('watchContainers returns 500 when targeted watcher provider is missing', async () => {
      const harness = createHarness({
        containers: [createContainer({ id: 'c1', watcher: 'local' })],
      });
      harness.deps.getWatchers.mockReturnValue({});

      const res = await callWatchContainers(harness.handlers, {
        body: { containerIds: ['c1'] },
      });

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'No provider found for container c1 and provider docker.local',
      });
    });

    test('watchContainer returns 404 when container is missing', async () => {
      const harness = createHarness();

      const res = await callWatchContainer(harness.handlers, 'missing');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
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
        createContainer({ id: 'c1', watcher: 'local', agent: 'agent-a' }),
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
      expect(res.json).toHaveBeenCalledWith({ error: 'Container not found' });
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
