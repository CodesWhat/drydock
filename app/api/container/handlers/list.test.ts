import type { Container } from '../../../model/container.js';
import type { CrudHandlerContext } from '../crud-context.js';
import { attachInProgressUpdateOperation, buildContainerListResponse } from './list.js';

function createMockContext(operation?: unknown): CrudHandlerContext {
  return {
    getContainersFromStore: vi.fn(),
    getContainerCountFromStore: vi.fn(),
    storeContainer: { getContainer: vi.fn(), deleteContainer: vi.fn() },
    updateOperationStore: {
      getOperationsByContainerName: vi.fn(),
      getInProgressOperationByContainerName: vi.fn().mockReturnValue(operation),
      getInProgressOperationByContainerId: vi.fn(),
      getActiveOperationByContainerName: vi.fn().mockReturnValue(operation),
      getActiveOperationByContainerId: vi.fn(),
    },
    getServerConfiguration: vi.fn(),
    getAgent: vi.fn(),
    getWatchers: vi.fn(),
    getErrorMessage: vi.fn((error: unknown) => String(error)),
    getErrorStatusCode: vi.fn(),
    redactContainerRuntimeEnv: vi.fn(),
    redactContainersRuntimeEnv: vi.fn(),
  };
}

function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    name: 'web',
    displayName: 'web',
    displayIcon: 'mdi:docker',
    status: 'running',
    watcher: 'local',
    image: {
      id: 'image-1',
      registry: {
        name: 'dockerhub',
        url: 'https://registry-1.docker.io',
      },
      name: 'nginx',
      tag: {
        value: '1.0.0',
        semver: true,
      },
      digest: {
        watch: false,
      },
      architecture: 'amd64',
      os: 'linux',
    },
    updateAvailable: false,
    updateKind: {
      kind: 'unknown',
    },
    ...overrides,
  };
}

describe('attachInProgressUpdateOperation', () => {
  test.each([
    ['id', { status: 'in-progress', phase: 'old-stopped', updatedAt: '2026-04-01T12:00:00.000Z' }],
    ['status', { id: 'op-1', phase: 'old-stopped', updatedAt: '2026-04-01T12:00:00.000Z' }],
    ['phase', { id: 'op-1', status: 'in-progress', updatedAt: '2026-04-01T12:00:00.000Z' }],
    ['updatedAt', { id: 'op-1', status: 'in-progress', phase: 'old-stopped' }],
  ])('ignores malformed operations missing %s', (_field, operation) => {
    const container = createContainer();
    const context = createMockContext(operation);

    const result = attachInProgressUpdateOperation(context, container);

    expect(result).toBe(container);
  });

  test('keeps only optional string metadata from valid in-progress operations', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-1',
      status: 'in-progress',
      phase: 'health-gate',
      updatedAt: '2026-04-01T12:00:00.000Z',
      fromVersion: 123,
      toVersion: null,
      targetImage: 'nginx:1.1.0',
    });

    expect(attachInProgressUpdateOperation(context, container)).toEqual({
      ...container,
      updateOperation: {
        id: 'op-1',
        status: 'in-progress',
        phase: 'health-gate',
        updatedAt: '2026-04-01T12:00:00.000Z',
        targetImage: 'nginx:1.1.0',
      },
    });
  });

  test('keeps recovered rollback phases from valid terminal operations', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-recovered',
      status: 'rolled-back',
      phase: 'recovered-rollback',
      updatedAt: '2026-04-01T12:00:00.000Z',
      fromVersion: '1.0.1',
      toVersion: '1.0.0',
    });

    expect(attachInProgressUpdateOperation(context, container)).toEqual({
      ...container,
      updateOperation: {
        id: 'op-recovered',
        status: 'rolled-back',
        phase: 'recovered-rollback',
        updatedAt: '2026-04-01T12:00:00.000Z',
        fromVersion: '1.0.1',
        toVersion: '1.0.0',
      },
    });
  });

  test('keeps valid batch queue metadata from active operations', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-1',
      status: 'queued',
      phase: 'queued',
      updatedAt: '2026-04-01T12:00:00.000Z',
      batchId: 'batch-1',
      queuePosition: 2,
      queueTotal: 4,
    });

    expect(attachInProgressUpdateOperation(context, container)).toEqual({
      ...container,
      updateOperation: {
        id: 'op-1',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 2,
        queueTotal: 4,
      },
    });
  });

  test('parses string batch queue metadata from active operations', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-1',
      status: 'queued',
      phase: 'queued',
      updatedAt: '2026-04-01T12:00:00.000Z',
      batchId: 'batch-1',
      queuePosition: '2',
      queueTotal: '4',
    });

    expect(attachInProgressUpdateOperation(context, container)).toEqual({
      ...container,
      updateOperation: {
        id: 'op-1',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 2,
        queueTotal: 4,
      },
    });
  });

  test('ignores zero numeric batch queue metadata from active operations', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-1',
      status: 'queued',
      phase: 'queued',
      updatedAt: '2026-04-01T12:00:00.000Z',
      batchId: 'batch-1',
      queuePosition: 0,
      queueTotal: 4,
    });

    expect(attachInProgressUpdateOperation(context, container)).toEqual({
      ...container,
      updateOperation: {
        id: 'op-1',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
  });

  test('ignores zero string batch queue metadata from active operations', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-1',
      status: 'queued',
      phase: 'queued',
      updatedAt: '2026-04-01T12:00:00.000Z',
      batchId: 'batch-1',
      queuePosition: '0',
      queueTotal: '4',
    });

    expect(attachInProgressUpdateOperation(context, container)).toEqual({
      ...container,
      updateOperation: {
        id: 'op-1',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
  });

  test('prefers container-ID lookup over name-based lookup', () => {
    const container = createContainer({ id: 'c1', name: 'portainer_agent' });
    const byIdResult = {
      id: 'op-by-id',
      containerId: 'c1',
      status: 'in-progress',
      phase: 'pulling',
      updatedAt: '2026-04-01T12:00:00.000Z',
    };
    const byNameResult = {
      id: 'op-by-name',
      containerId: 'c2',
      status: 'in-progress',
      phase: 'pulling',
      updatedAt: '2026-04-01T12:00:00.000Z',
    };
    const context = createMockContext();
    (
      context.updateOperationStore.getActiveOperationByContainerId as ReturnType<typeof vi.fn>
    ).mockReturnValue(byIdResult);
    (
      context.updateOperationStore.getActiveOperationByContainerName as ReturnType<typeof vi.fn>
    ).mockReturnValue(byNameResult);

    const result = attachInProgressUpdateOperation(context, container);

    expect(result.updateOperation?.id).toBe('op-by-id');
    expect(context.updateOperationStore.getActiveOperationByContainerId).toHaveBeenCalledWith('c1');
    expect(context.updateOperationStore.getActiveOperationByContainerName).not.toHaveBeenCalled();
  });

  test('does not attach name-matched operation that belongs to a different container ID (#256)', () => {
    const containerA = createContainer({ id: 'host1-abc', name: 'portainer_agent' });
    const containerB = createContainer({ id: 'host2-def', name: 'portainer_agent' });
    const operationForA = {
      id: 'op-1',
      containerId: 'host1-abc',
      containerName: 'portainer_agent',
      status: 'in-progress',
      phase: 'pulling',
      updatedAt: '2026-04-01T12:00:00.000Z',
    };
    const context = createMockContext();
    (
      context.updateOperationStore.getActiveOperationByContainerId as ReturnType<typeof vi.fn>
    ).mockImplementation((id: string) => (id === 'host1-abc' ? operationForA : undefined));
    (
      context.updateOperationStore.getActiveOperationByContainerName as ReturnType<typeof vi.fn>
    ).mockReturnValue(operationForA);

    const resultA = attachInProgressUpdateOperation(context, containerA);
    const resultB = attachInProgressUpdateOperation(context, containerB);

    expect(resultA.updateOperation?.id).toBe('op-1');
    expect(resultB.updateOperation).toBeUndefined();
  });

  test('falls back to name-based lookup for legacy operations without containerId', () => {
    const container = createContainer({ id: 'c1', name: 'web' });
    const legacyOperation = {
      id: 'op-legacy',
      containerName: 'web',
      status: 'in-progress',
      phase: 'pulling',
      updatedAt: '2026-04-01T12:00:00.000Z',
    };
    const context = createMockContext();
    (
      context.updateOperationStore.getActiveOperationByContainerId as ReturnType<typeof vi.fn>
    ).mockReturnValue(undefined);
    (
      context.updateOperationStore.getActiveOperationByContainerName as ReturnType<typeof vi.fn>
    ).mockReturnValue(legacyOperation);

    const result = attachInProgressUpdateOperation(context, container);

    expect(result.updateOperation?.id).toBe('op-legacy');
  });
});

describe('buildContainerListResponse', () => {
  test('preserves store-level rollback filtering after downstream transforms', () => {
    const containers = [
      createContainer({ id: 'c1', name: 'service', displayName: 'service' }),
      createContainer({ id: 'c2', name: 'worker', displayName: 'worker' }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 2),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => [
        items[0]!,
        {
          ...items[1]!,
          name: 'worker-old-1773933154786',
          displayName: 'worker-old-1773933154786',
        },
      ]),
    };

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(context.getContainersFromStore).toHaveBeenCalledWith(
      {
        excludeRollbackContainers: true,
      },
      { limit: 10, offset: 0 },
    );
    expect(response.total).toBe(2);
    expect(response.data).toHaveLength(2);
    expect(response.hasMore).toBe(false);
    expect(response._links).toEqual({
      self: '/api/containers?limit=10&offset=0',
    });
  });
});
