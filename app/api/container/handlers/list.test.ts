import type { Container } from '../../../model/container.js';
import type { CrudHandlerContext } from '../crud-context.js';
import {
  attachInProgressUpdateOperation,
  buildContainerListResponse,
  createGetContainersHandler,
} from './list.js';

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

  test('ignores terminal operations on live container payloads', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-recovered',
      status: 'rolled-back',
      phase: 'recovered-rollback',
      updatedAt: '2026-04-01T12:00:00.000Z',
      fromVersion: '1.0.1',
      toVersion: '1.0.0',
    });

    expect(attachInProgressUpdateOperation(context, container)).toBe(container);
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

  test('keeps optional metadata from rich active operations', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-1',
      kind: 'self-update',
      status: 'in-progress',
      phase: 'new-started',
      updatedAt: '2026-04-01T12:00:00.000Z',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      targetImage: 'nginx:1.1.0',
      batchId: 'batch-1',
      queuePosition: 1,
      queueTotal: 2,
    });

    expect(attachInProgressUpdateOperation(context, container)).toEqual({
      ...container,
      updateOperation: {
        id: 'op-1',
        kind: 'self-update',
        status: 'in-progress',
        phase: 'new-started',
        updatedAt: '2026-04-01T12:00:00.000Z',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        targetImage: 'nginx:1.1.0',
        batchId: 'batch-1',
        queuePosition: 1,
        queueTotal: 2,
      },
    });
  });

  test('drops invalid batch queue metadata when queue position exceeds total', () => {
    const container = createContainer();
    const context = createMockContext({
      id: 'op-1',
      status: 'queued',
      phase: 'queued',
      updatedAt: '2026-04-01T12:00:00.000Z',
      batchId: 'batch-1',
      queuePosition: 4,
      queueTotal: 3,
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
  test('preloads active operations once for the full container list response', () => {
    const containers = [
      createContainer({ id: 'c1', name: 'web', displayName: 'web' }),
      createContainer({ id: 'c2', name: 'worker', displayName: 'worker' }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => containers.length),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    (context.updateOperationStore as any).listActiveOperations = vi.fn(() => [
      {
        id: 'op-1',
        containerId: 'c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ]);
    (
      context.updateOperationStore.getActiveOperationByContainerId as ReturnType<typeof vi.fn>
    ).mockImplementation(() => {
      throw new Error('per-container ID lookup should not be used');
    });
    (
      context.updateOperationStore.getActiveOperationByContainerName as ReturnType<typeof vi.fn>
    ).mockImplementation(() => {
      throw new Error('per-container name lookup should not be used');
    });

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect((context.updateOperationStore as any).listActiveOperations).toHaveBeenCalledTimes(1);
    expect(context.updateOperationStore.getActiveOperationByContainerId).not.toHaveBeenCalled();
    expect(context.updateOperationStore.getActiveOperationByContainerName).not.toHaveBeenCalled();
    expect(response.data[0]?.updateOperation).toEqual({
      id: 'op-1',
      status: 'in-progress',
      phase: 'pulling',
      updatedAt: '2026-04-01T12:00:00.000Z',
    });
    expect(response.data[1]?.updateOperation).toBeUndefined();
  });

  test('preloaded operations map replacement container ids and expose projected descriptors', () => {
    const containers = [
      createContainer({
        id: 'new-c1',
        name: 'web',
        displayName: 'web',
        security: {
          status: 'healthy',
          scan: {
            status: 'healthy',
            vulnerabilities: [{ id: 'v1' }] as any,
          } as any,
        } as any,
      }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    (context.updateOperationStore as any).listActiveOperations = vi.fn(() => [
      {
        id: 'op-1',
        containerId: 'old-c1',
        newContainerId: 'new-c1',
        containerName: 'web',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ]);

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.updateOperation?.id).toBe('op-1');
    expect(Object.getOwnPropertyDescriptor(response.data[0]!, 'updateOperation')).toEqual({
      configurable: true,
      enumerable: true,
      writable: true,
      value: {
        id: 'op-1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
    expect(Object.getOwnPropertyDescriptor(response.data[0]!, 'security')).toMatchObject({
      configurable: true,
      enumerable: true,
      writable: true,
    });
  });

  test('preloaded operation projections expose compatible descriptors for overridden non-writable properties', () => {
    const container = createContainer({ id: 'c1', name: 'web', displayName: 'web' });
    Object.defineProperty(container, 'updateOperation', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: {
        id: 'stale-op',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T11:59:00.000Z',
      },
    });
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => [container]),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    (context.updateOperationStore as any).listActiveOperations = vi.fn(() => [
      {
        id: 'op-1',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ]);

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(Object.getOwnPropertyDescriptor(response.data[0]!, 'updateOperation')).toEqual({
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        id: 'op-1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
  });

  test('preloaded operations fall back to legacy container names when ids are unavailable', () => {
    const containers = [createContainer({ id: 'c1', name: 'web', displayName: 'web' })];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    (context.updateOperationStore as any).listActiveOperations = vi.fn(() => [
      {
        id: 'op-legacy',
        containerName: 'web',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ]);

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.updateOperation?.id).toBe('op-legacy');
  });

  test('preloaded operations keep the newest timestamp and treat invalid timestamps as oldest', () => {
    const containers = [createContainer({ id: 'c1', name: 'web', displayName: 'web' })];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    (context.updateOperationStore as any).listActiveOperations = vi.fn(() => [
      {
        id: 'op-invalid',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: 'not-a-date',
      },
      {
        id: 'op-latest',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'health-gate',
        updatedAt: '2026-04-01T12:01:00.000Z',
      },
      {
        id: 'op-older',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T11:59:00.000Z',
      },
    ]);

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.updateOperation).toEqual({
      id: 'op-latest',
      status: 'in-progress',
      phase: 'health-gate',
      updatedAt: '2026-04-01T12:01:00.000Z',
    });
  });

  test('preloaded operations keep an existing newer timestamp when a later duplicate is older', () => {
    const containers = [createContainer({ id: 'c1', name: 'web', displayName: 'web' })];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    (context.updateOperationStore as any).listActiveOperations = vi.fn(() => [
      {
        id: 'op-latest',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'health-gate',
        updatedAt: '2026-04-01T12:01:00.000Z',
      },
      {
        id: 'op-older',
        containerId: 'c1',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ]);

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.updateOperation).toEqual({
      id: 'op-latest',
      status: 'in-progress',
      phase: 'health-gate',
      updatedAt: '2026-04-01T12:01:00.000Z',
    });
  });

  test('falls back to per-container lookups when the preloaded operation list has no usable keys', () => {
    const containers = [createContainer({ id: 'c1', name: 'web', displayName: 'web' })];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    (context.updateOperationStore as any).listActiveOperations = vi.fn(() => [
      null,
      { id: 'bad-op', status: 'queued', phase: 'queued' },
      {
        id: 'also-bad',
        containerName: '',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ]);
    (
      context.updateOperationStore.getActiveOperationByContainerId as ReturnType<typeof vi.fn>
    ).mockReturnValue({
      id: 'op-fallback',
      containerId: 'c1',
      status: 'in-progress',
      phase: 'pulling',
      updatedAt: '2026-04-01T12:00:00.000Z',
    });

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(context.updateOperationStore.getActiveOperationByContainerId).toHaveBeenCalledWith('c1');
    expect(response.data[0]?.updateOperation?.id).toBe('op-fallback');
  });

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

  test('strips vulnerability arrays from security payloads when includeVulnerabilities is false', () => {
    const containers = [
      createContainer({
        id: 'c1',
        name: 'service',
        security: {
          scan: {
            vulnerabilities: ['v1'],
          },
          updateScan: {
            vulnerabilities: ['v2'],
          },
        },
      }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.security?.scan?.vulnerabilities).toEqual([]);
    expect(response.data[0]?.security?.updateScan?.vulnerabilities).toEqual([]);
  });

  test('preserves vulnerability arrays when includeVulnerabilities is true', () => {
    const containers = [
      createContainer({
        id: 'c1',
        name: 'service',
        security: {
          scan: {
            vulnerabilities: ['v1'],
          },
          updateScan: {
            vulnerabilities: ['v2'],
          },
        },
      }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { includeVulnerabilities: 'true', limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.security?.scan?.vulnerabilities).toEqual(['v1']);
    expect(response.data[0]?.security?.updateScan?.vulnerabilities).toEqual(['v2']);
  });

  test('preserves partial security payloads without inventing missing scan arrays', () => {
    const containers = [
      createContainer({
        id: 'c1',
        name: 'scan-only',
        security: {
          scan: {
            vulnerabilities: ['v1'],
          },
        },
      }),
      createContainer({
        id: 'c2',
        name: 'update-only',
        security: {
          updateScan: {
            vulnerabilities: ['v2'],
          },
        },
      }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 2),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.security?.scan?.vulnerabilities).toEqual([]);
    expect(response.data[0]?.security?.updateScan).toBeUndefined();
    expect(response.data[1]?.security?.scan).toBeUndefined();
    expect(response.data[1]?.security?.updateScan?.vulnerabilities).toEqual([]);
  });

  test('strips vulnerabilities without eagerly reading unrelated enumerable properties', () => {
    const container = createContainer({
      id: 'c1',
      name: 'service',
      security: {
        scan: {
          vulnerabilities: ['v1'],
        },
      },
    });
    const expensiveGetter = vi.fn(() => {
      throw new Error('unexpected eager property read');
    });
    Object.defineProperty(container, 'expensive', {
      enumerable: true,
      get: expensiveGetter,
    });

    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => [container]),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.id).toBe('c1');
    expect(response.data[0]?.security?.scan?.vulnerabilities).toEqual([]);
    expect(expensiveGetter).not.toHaveBeenCalled();
  });

  test('pushes watched-kind all through the filter pipeline without forcing full collection', () => {
    const containers = [
      createContainer({
        id: 'c1',
        name: 'watched',
        labels: {
          'dd.watch': 'true',
        },
      }),
      createContainer({
        id: 'c2',
        name: 'unwatched',
      }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => containers.length),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { kind: 'all', limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(context.getContainersFromStore).toHaveBeenCalledWith(
      { excludeRollbackContainers: true },
      { limit: 10, offset: 0 },
    );
    expect(context.getContainerCountFromStore).toHaveBeenCalledWith({
      excludeRollbackContainers: true,
    });
    expect(response.total).toBe(2);
    expect(response.data).toHaveLength(2);
  });

  test('pushes status and watcher filters into the store query', () => {
    const containers = [createContainer({ id: 'c1', name: 'service' })];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    buildContainerListResponse(
      context,
      { status: 'update-available', watcher: 'local', limit: '10', offset: '0' } as any,
      '/api/containers',
    );
    buildContainerListResponse(
      context,
      { status: 'running', limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(context.getContainersFromStore).toHaveBeenNthCalledWith(
      1,
      { watcher: 'local', updateAvailable: true, excludeRollbackContainers: true },
      { limit: 10, offset: 0 },
    );
    expect(context.getContainersFromStore).toHaveBeenNthCalledWith(
      2,
      { status: 'running', excludeRollbackContainers: true },
      { limit: 10, offset: 0 },
    );
  });

  test('uses the zero-limit non-sorting path without looking up counts', () => {
    const containers = [
      createContainer({ id: 'c1', name: 'beta' }),
      createContainer({ id: 'c2', name: 'alpha' }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { limit: '0', offset: '0' } as any,
      '/api/containers',
    );

    expect(context.getContainersFromStore).toHaveBeenCalledWith(
      { excludeRollbackContainers: true },
      { limit: 0, offset: 0 },
    );
    expect(context.getContainerCountFromStore).not.toHaveBeenCalled();
    expect(response.total).toBe(2);
    expect(response.data).toHaveLength(2);
    expect(response.hasMore).toBe(false);
  });

  test('uses the full-collection path when sorting requires in-memory processing', () => {
    const containers = [
      createContainer({ id: 'c1', name: 'beta' }),
      createContainer({ id: 'c2', name: 'alpha' }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { sort: 'name', limit: '1', offset: '0' } as any,
      '/api/containers',
    );

    expect(context.getContainersFromStore).toHaveBeenCalledWith(
      { excludeRollbackContainers: true },
      { limit: 0, offset: 0 },
    );
    expect(context.getContainerCountFromStore).not.toHaveBeenCalled();
    expect(response.total).toBe(2);
    expect(response.data).toHaveLength(1);
    expect(response.hasMore).toBe(true);
  });

  test('uses the full-collection path without count lookup when pagination is zeroed', () => {
    const containers = [
      createContainer({ id: 'c1', name: 'beta' }),
      createContainer({ id: 'c2', name: 'alpha' }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { sort: 'name', limit: '0', offset: '0' } as any,
      '/api/containers',
    );

    expect(context.getContainersFromStore).toHaveBeenCalledWith(
      { excludeRollbackContainers: true },
      { limit: 0, offset: 0 },
    );
    expect(context.getContainerCountFromStore).not.toHaveBeenCalled();
    expect(response.total).toBe(2);
    expect(response.data).toHaveLength(2);
    expect(response.hasMore).toBe(false);
  });

  test('strips sbom, updateSbom, signature, and updateSignature from security when includeVulnerabilities is false', () => {
    const sbomDoc = { generator: 'trivy', formats: ['spdx-json'], documents: { large: true } };
    const sigDoc = { verifier: 'cosign', status: 'verified', signatures: 1 };
    const containers = [
      createContainer({
        id: 'c1',
        name: 'service',
        security: {
          scan: {
            status: 'passed',
            summary: { unknown: 0, low: 1, medium: 0, high: 0, critical: 0 },
            vulnerabilities: [],
          },
          updateScan: { status: 'passed', vulnerabilities: [] },
          sbom: sbomDoc,
          updateSbom: sbomDoc,
          signature: sigDoc,
          updateSignature: sigDoc,
        } as any,
      }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.security?.sbom).toBeUndefined();
    expect(response.data[0]?.security?.updateSbom).toBeUndefined();
    expect(response.data[0]?.security?.signature).toBeUndefined();
    expect(response.data[0]?.security?.updateSignature).toBeUndefined();
    // scan and updateScan are still present (only vulnerabilities stripped)
    expect(response.data[0]?.security?.scan?.status).toBe('passed');
    expect(response.data[0]?.security?.scan?.summary).toEqual({
      unknown: 0,
      low: 1,
      medium: 0,
      high: 0,
      critical: 0,
    });
  });

  test('strips sbom, updateSbom, signature, and updateSignature from security even when includeVulnerabilities is true', () => {
    const sbomDoc = { generator: 'trivy', formats: ['spdx-json'], documents: { large: true } };
    const sigDoc = { verifier: 'cosign', status: 'verified', signatures: 1 };
    const containers = [
      createContainer({
        id: 'c1',
        name: 'service',
        security: {
          scan: { status: 'passed', vulnerabilities: ['v1'] },
          updateScan: { status: 'passed', vulnerabilities: ['v2'] },
          sbom: sbomDoc,
          updateSbom: sbomDoc,
          signature: sigDoc,
          updateSignature: sigDoc,
        } as any,
      }),
    ];
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => containers),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { includeVulnerabilities: 'true', limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    // Vulnerabilities are preserved when explicitly opted in
    expect(response.data[0]?.security?.scan?.vulnerabilities).toEqual(['v1']);
    expect(response.data[0]?.security?.updateScan?.vulnerabilities).toEqual(['v2']);
    // Detail-only fields are always stripped regardless of includeVulnerabilities
    expect(response.data[0]?.security?.sbom).toBeUndefined();
    expect(response.data[0]?.security?.updateSbom).toBeUndefined();
    expect(response.data[0]?.security?.signature).toBeUndefined();
    expect(response.data[0]?.security?.updateSignature).toBeUndefined();
  });

  test('returns container unchanged when security is absent', () => {
    const container = createContainer({ id: 'c1', name: 'no-security' });
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => [container]),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    const response = buildContainerListResponse(
      context,
      { limit: '10', offset: '0' } as any,
      '/api/containers',
    );

    expect(response.data[0]?.security).toBeUndefined();
    expect(response.data[0]?.id).toBe('c1');
  });

  test('stripping detail-only security fields does not mutate the underlying store container', () => {
    const sbomDoc = { generator: 'trivy', formats: ['spdx-json'], documents: { large: true } };
    const container = createContainer({
      id: 'c1',
      name: 'service',
      security: {
        scan: { status: 'passed', vulnerabilities: ['v1'] },
        sbom: sbomDoc,
        signature: { verifier: 'cosign', status: 'verified', signatures: 1 },
      } as any,
    });
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => [container]),
      getContainerCountFromStore: vi.fn(() => 1),
      redactContainersRuntimeEnv: vi.fn((items: Container[]) => items),
    };

    buildContainerListResponse(context, { limit: '10', offset: '0' } as any, '/api/containers');

    // The underlying store container must not be mutated
    expect((container.security as any).sbom).toBe(sbomDoc);
    expect((container.security as any).signature).toBeDefined();
    expect((container.security?.scan as any).vulnerabilities).toEqual(['v1']);
  });
});

describe('createGetContainersHandler', () => {
  test('returns 400 when the list builder throws', () => {
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => {
        throw new Error('bad list query');
      }),
    };
    const handler = createGetContainersHandler(context);
    const req = { query: {} } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'bad list query' });
  });

  test('returns a generic invalid request message when the list builder throws a string', () => {
    const context: CrudHandlerContext = {
      ...createMockContext(),
      getContainersFromStore: vi.fn(() => {
        throw 'bad list query';
      }),
    };
    const handler = createGetContainersHandler(context);
    const req = { query: {} } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid request' });
  });
});
