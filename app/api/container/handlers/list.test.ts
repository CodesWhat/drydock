import type { Container } from '../../../model/container.js';
import type { CrudHandlerContext } from '../crud-context.js';
import { attachInProgressUpdateOperation } from './list.js';

function createMockContext(operation?: unknown): CrudHandlerContext {
  return {
    getContainersFromStore: vi.fn(),
    getContainerCountFromStore: vi.fn(),
    storeContainer: { getContainer: vi.fn(), deleteContainer: vi.fn() },
    updateOperationStore: {
      getOperationsByContainerName: vi.fn(),
      getInProgressOperationByContainerName: vi.fn().mockReturnValue(operation),
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
});
