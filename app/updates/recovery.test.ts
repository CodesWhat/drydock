import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockListActiveOperations,
  mockGetOperationById,
  mockMarkOperationTerminal,
  mockGetContainer,
  mockGetContainers,
  mockGetState,
  mockFindDockerTriggerForContainer,
  mockDispatchAcceptedGroups,
} = vi.hoisted(() => ({
  mockListActiveOperations: vi.fn(),
  mockGetOperationById: vi.fn(),
  mockMarkOperationTerminal: vi.fn(),
  mockGetContainer: vi.fn(),
  mockGetContainers: vi.fn(),
  mockGetState: vi.fn(),
  mockFindDockerTriggerForContainer: vi.fn(),
  mockDispatchAcceptedGroups: vi.fn(),
}));

vi.mock('../store/update-operation.js', () => ({
  listActiveOperations: mockListActiveOperations,
  getOperationById: mockGetOperationById,
  markOperationTerminal: mockMarkOperationTerminal,
}));

vi.mock('../store/container.js', () => ({
  getContainer: mockGetContainer,
  getContainers: mockGetContainers,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../api/docker-trigger.js', () => ({
  findDockerTriggerForContainer: mockFindDockerTriggerForContainer,
}));

vi.mock('./request-update.js', () => ({
  dispatchAcceptedGroups: mockDispatchAcceptedGroups,
}));

vi.mock('../log/index.js', () => ({
  default: {
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

import {
  parseRecoveryBootConcurrency,
  recoverInProgressOperationsOnStartup,
  recoverQueuedOperationsOnStartup,
} from './recovery.js';

describe('recoverQueuedOperationsOnStartup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY;
    mockGetState.mockReturnValue({ trigger: { 'docker.local': {} } });
    mockGetContainers.mockReturnValue([]);
    mockGetOperationById.mockReturnValue({ status: 'succeeded' });
  });

  test('returns zeros and dispatches nothing when there are no active operations', () => {
    mockListActiveOperations.mockReturnValue([]);
    expect(recoverQueuedOperationsOnStartup()).toEqual({ resumed: 0, abandoned: 0 });
    expect(mockDispatchAcceptedGroups).not.toHaveBeenCalled();
  });

  test('skips self-update operations entirely', () => {
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-self',
        status: 'queued',
        kind: 'self-update',
        containerId: 'self-c',
        containerName: 'drydock',
      },
    ]);

    expect(recoverQueuedOperationsOnStartup()).toEqual({ resumed: 0, abandoned: 0 });
    expect(mockDispatchAcceptedGroups).not.toHaveBeenCalled();
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
  });

  test('skips non-queued active operations (in-progress phases like pulling)', () => {
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-pulling',
        status: 'in-progress',
        phase: 'pulling',
        containerId: 'c-1',
        containerName: 'web',
      },
    ]);

    expect(recoverQueuedOperationsOnStartup()).toEqual({ resumed: 0, abandoned: 0 });
    expect(mockDispatchAcceptedGroups).not.toHaveBeenCalled();
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
  });

  test('marks an operation failed when its container is not resolvable', () => {
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-1',
        status: 'queued',
        containerId: 'missing-c',
        containerName: 'gone',
      },
    ]);
    mockGetContainer.mockReturnValue(undefined);

    const result = recoverQueuedOperationsOnStartup();

    expect(result).toEqual({ resumed: 0, abandoned: 1 });
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-1',
      expect.objectContaining({
        status: 'failed',
        phase: 'failed',
        lastError: expect.stringContaining('container'),
      }),
    );
    expect(mockDispatchAcceptedGroups).not.toHaveBeenCalled();
  });

  test('marks an operation failed when its container has no containerId on record', () => {
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-noid',
        status: 'queued',
        containerName: 'web',
      },
    ]);

    const result = recoverQueuedOperationsOnStartup();

    expect(result).toEqual({ resumed: 0, abandoned: 1 });
    expect(mockGetContainer).not.toHaveBeenCalled();
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-noid',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  test('marks an operation with an empty-string containerId failed without resolving a container', () => {
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-empty-id',
        status: 'queued',
        containerId: '',
        containerName: 'web',
      },
    ]);

    const result = recoverQueuedOperationsOnStartup();

    expect(result).toEqual({ resumed: 0, abandoned: 1 });
    expect(mockGetContainer).not.toHaveBeenCalled();
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-empty-id',
      expect.objectContaining({
        status: 'failed',
        phase: 'failed',
        lastError: expect.stringContaining('web'),
      }),
    );
    expect(mockDispatchAcceptedGroups).not.toHaveBeenCalled();
  });

  test('marks an operation failed when no compatible trigger is found', () => {
    const container = { id: 'c-1', name: 'web', watcher: 'local' };
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-2',
        status: 'queued',
        containerId: 'c-1',
        containerName: 'web',
      },
    ]);
    mockGetContainer.mockReturnValue(container);
    mockFindDockerTriggerForContainer.mockReturnValue(undefined);

    const result = recoverQueuedOperationsOnStartup();

    expect(result).toEqual({ resumed: 0, abandoned: 1 });
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-2',
      expect.objectContaining({
        status: 'failed',
        lastError: expect.stringContaining('trigger'),
      }),
    );
    expect(mockDispatchAcceptedGroups).not.toHaveBeenCalled();
  });

  test('dispatches a queued operation when both container and trigger resolve', () => {
    const container = { id: 'c-1', name: 'web', watcher: 'local' };
    const trigger = { type: 'docker', trigger: vi.fn() };
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-go',
        status: 'queued',
        containerId: 'c-1',
        containerName: 'web',
      },
    ]);
    mockGetContainer.mockReturnValue(container);
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    const result = recoverQueuedOperationsOnStartup();

    expect(result).toEqual({ resumed: 1, abandoned: 0 });
    expect(mockDispatchAcceptedGroups).toHaveBeenCalledWith(
      [{ accepted: [{ container, operationId: 'op-go', trigger }], dependencyContext: [] }],
      { concurrency: 4 },
    );
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
  });

  test('dispatches recovered operations with the default boot concurrency cap', () => {
    const trigger = { type: 'docker', trigger: vi.fn() };
    const operations = Array.from({ length: 5 }, (_, index) => ({
      id: `op-${index + 1}`,
      status: 'queued',
      containerId: `c-${index + 1}`,
      containerName: `app-${index + 1}`,
    }));
    mockListActiveOperations.mockReturnValue(operations);
    mockGetContainer.mockImplementation((id: string) => ({
      id,
      name: `app-${id.slice(2)}`,
      watcher: 'local',
    }));
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    const result = recoverQueuedOperationsOnStartup();

    expect(result).toEqual({ resumed: 5, abandoned: 0 });
    expect(mockDispatchAcceptedGroups).toHaveBeenCalledWith(expect.any(Array), { concurrency: 4 });
  });

  test('uses DD_UPDATE_RECOVERY_BOOT_CONCURRENCY for startup redispatch', () => {
    const previous = process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY;
    process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY = '2';
    const container = { id: 'c-1', name: 'web', watcher: 'local' };
    const trigger = { type: 'docker', trigger: vi.fn() };
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-env-cap',
        status: 'queued',
        containerId: 'c-1',
        containerName: 'web',
      },
    ]);
    mockGetContainer.mockReturnValue(container);
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    try {
      const result = recoverQueuedOperationsOnStartup();

      expect(result).toEqual({ resumed: 1, abandoned: 0 });
      expect(mockDispatchAcceptedGroups).toHaveBeenCalledWith(expect.any(Array), {
        concurrency: 2,
      });
    } finally {
      if (previous === undefined) {
        delete process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY;
      } else {
        process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY = previous;
      }
    }
  });

  test('rejects zero DD_UPDATE_RECOVERY_BOOT_CONCURRENCY values', () => {
    expect(() => parseRecoveryBootConcurrency('0')).toThrow(
      'DD_UPDATE_RECOVERY_BOOT_CONCURRENCY must be at least 1 (got "0")',
    );
  });

  test('returns zeros when there are no in-progress Docker operations', async () => {
    mockListActiveOperations.mockReturnValue([]);

    await expect(recoverInProgressOperationsOnStartup()).resolves.toEqual({
      reconciled: 0,
      abandoned: 0,
    });
  });

  test('resolves an in-progress operation through its replacement container id', async () => {
    const replacement = { id: 'c-new', name: 'web', watcher: 'local' };
    const dockerApi = {};
    const reconcile = vi.fn().mockResolvedValue(undefined);
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-replacement-only',
        status: 'in-progress',
        phase: 'old-stopped',
        containerName: 'web',
        newContainerId: 'c-new',
      },
    ]);
    mockGetContainer.mockImplementation((id: string) => (id === 'c-new' ? replacement : undefined));
    mockFindDockerTriggerForContainer.mockReturnValue({
      getWatcher: vi.fn(() => ({ dockerApi })),
      reconcileInProgressContainerUpdateOperation: reconcile,
    });

    await expect(recoverInProgressOperationsOnStartup()).resolves.toEqual({
      reconciled: 1,
      abandoned: 0,
    });
    expect(reconcile).toHaveBeenCalledWith(dockerApi, replacement, expect.any(Object));
  });

  test.each([
    ['missing container', undefined, undefined, 'not found'],
    ['incompatible trigger', { id: 'c-old', name: 'web', watcher: 'local' }, {}, 'no compatible'],
    [
      'watcher without Docker API',
      { id: 'c-old', name: 'web', watcher: 'local' },
      {
        getWatcher: vi.fn(() => ({})),
        reconcileInProgressContainerUpdateOperation: vi.fn(),
      },
      'has no Docker API',
    ],
  ])('abandons recovery for %s', async (_label, container, trigger, message) => {
    mockListActiveOperations.mockReturnValue([
      {
        id: `op-${_label}`,
        status: 'in-progress',
        phase: 'pulling',
        containerName: 'web',
        container,
      },
    ]);
    mockGetContainer.mockReturnValue(container);
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    await expect(recoverInProgressOperationsOnStartup()).resolves.toEqual({
      reconciled: 0,
      abandoned: 1,
    });
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      `op-${_label}`,
      expect.objectContaining({ lastError: expect.stringContaining(message) }),
    );
  });

  test.each(['renamed', 'old-stopped'])(
    'reconciles a persisted %s operation through its saved container and watcher',
    async (phase) => {
      const persistedContainer = { id: 'c-old', name: 'web', watcher: 'local' };
      const replacementContainer = { id: 'c-new', name: 'web', watcher: 'local' };
      const dockerApi = { getContainer: vi.fn() };
      const reconcile = vi.fn().mockResolvedValue(undefined);
      const trigger = {
        type: 'docker',
        trigger: vi.fn(),
        getWatcher: vi.fn(() => ({ dockerApi })),
        reconcileInProgressContainerUpdateOperation: reconcile,
      };
      mockListActiveOperations.mockReturnValue([
        {
          id: `op-${phase}`,
          status: 'in-progress',
          phase,
          containerId: 'c-old',
          containerName: 'web',
          oldContainerId: 'c-old',
          tempName: 'web-drydock-update',
          newContainerId: 'c-new',
          container: persistedContainer,
        },
      ]);
      mockGetContainer.mockImplementation((id: string) =>
        phase === 'old-stopped' && id === 'c-new' ? replacementContainer : undefined,
      );
      mockFindDockerTriggerForContainer.mockReturnValue(trigger);

      await expect(recoverInProgressOperationsOnStartup()).resolves.toEqual({
        reconciled: 1,
        abandoned: 0,
      });

      expect(trigger.getWatcher).toHaveBeenCalledWith(persistedContainer);
      expect(reconcile).toHaveBeenCalledWith(dockerApi, persistedContainer, expect.any(Object));
      expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
    },
  );

  test('marks an in-progress operation failed only after runtime resolution fails', async () => {
    const container = { id: 'c-old', name: 'web', watcher: 'local' };
    const trigger = {
      type: 'docker',
      trigger: vi.fn(),
      getWatcher: vi.fn(() => {
        throw new Error('watcher missing');
      }),
      reconcileInProgressContainerUpdateOperation: vi.fn(),
    };
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-runtime-failure',
        status: 'in-progress',
        phase: 'new-created',
        containerId: 'c-old',
        containerName: 'web',
      },
    ]);
    mockGetContainer.mockReturnValue(container);
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    await expect(recoverInProgressOperationsOnStartup()).resolves.toEqual({
      reconciled: 0,
      abandoned: 1,
    });
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-runtime-failure',
      expect.objectContaining({
        status: 'failed',
        phase: 'failed',
        lastError: expect.stringContaining('watcher missing'),
      }),
    );
  });

  test('marks reconciliation failed when the Docker recovery hook leaves the row active', async () => {
    const container = { id: 'c-old', name: 'web', watcher: 'local' };
    const trigger = {
      type: 'docker',
      trigger: vi.fn(),
      getWatcher: vi.fn(() => ({ dockerApi: {} })),
      reconcileInProgressContainerUpdateOperation: vi.fn().mockResolvedValue(undefined),
    };
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-still-active',
        status: 'in-progress',
        phase: 'renamed',
        containerId: 'c-old',
        containerName: 'web',
      },
    ]);
    mockGetContainer.mockReturnValue(container);
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);
    mockGetOperationById.mockReturnValue({ id: 'op-still-active', status: 'in-progress' });

    await expect(recoverInProgressOperationsOnStartup()).resolves.toEqual({
      reconciled: 0,
      abandoned: 1,
    });
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-still-active',
      expect.objectContaining({ lastError: expect.stringContaining('left operation') }),
    );
  });

  test('groups queued recovery by batch and supplies live dependency context', () => {
    const upstream = { id: 'db', name: 'db', watcher: 'local', updateAvailable: false };
    const dependent = {
      id: 'api',
      name: 'api',
      watcher: 'local',
      updateAvailable: false,
      dependsOn: ['db'],
      dependsOnAction: 'restart',
    };
    const other = { id: 'worker', name: 'worker', watcher: 'local' };
    const liveContainers = [upstream, dependent, other];
    const trigger = { type: 'docker', trigger: vi.fn() };
    mockGetContainers.mockReturnValue(liveContainers);
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-api',
        status: 'queued',
        containerId: 'api',
        containerName: 'api',
        batchId: 'batch-a',
      },
      {
        id: 'op-worker',
        status: 'queued',
        containerId: 'worker',
        containerName: 'worker',
        batchId: 'batch-b',
      },
    ]);
    mockGetContainer.mockImplementation((id: string) =>
      liveContainers.find((container) => container.id === id),
    );
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    expect(recoverQueuedOperationsOnStartup()).toEqual({ resumed: 2, abandoned: 0 });

    expect(mockDispatchAcceptedGroups).toHaveBeenCalledWith(
      [
        {
          accepted: [{ container: dependent, operationId: 'op-api', trigger }],
          dependencyContext: liveContainers,
        },
        {
          accepted: [{ container: other, operationId: 'op-worker', trigger }],
          dependencyContext: liveContainers,
        },
      ],
      { concurrency: 4 },
    );
  });

  test('logs plural-form messages when more than one operation is resumed or abandoned', () => {
    const containerA = { id: 'c-a', name: 'web', watcher: 'local' };
    const containerB = { id: 'c-b', name: 'api', watcher: 'local' };
    const trigger = { type: 'docker', trigger: vi.fn() };
    mockListActiveOperations.mockReturnValue([
      { id: 'op-a', status: 'queued', containerId: 'c-a', containerName: 'web' },
      { id: 'op-b', status: 'queued', containerId: 'c-b', containerName: 'api' },
      { id: 'op-x', status: 'queued', containerId: 'missing-1', containerName: 'gone-1' },
      { id: 'op-y', status: 'queued', containerId: 'missing-2', containerName: 'gone-2' },
    ]);
    mockGetContainer.mockImplementation((id: string) => {
      if (id === 'c-a') return containerA;
      if (id === 'c-b') return containerB;
      return undefined;
    });
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    const result = recoverQueuedOperationsOnStartup();
    expect(result).toEqual({ resumed: 2, abandoned: 2 });
    expect(mockDispatchAcceptedGroups).toHaveBeenCalledWith(
      [
        {
          accepted: [
            { container: containerA, operationId: 'op-a', trigger },
            { container: containerB, operationId: 'op-b', trigger },
          ],
          dependencyContext: [],
        },
      ],
      { concurrency: 4 },
    );
  });

  test('handles a mix of resumable and abandoned operations in one sweep', () => {
    const container = { id: 'c-1', name: 'web', watcher: 'local' };
    const trigger = { type: 'docker', trigger: vi.fn() };
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-good',
        status: 'queued',
        containerId: 'c-1',
        containerName: 'web',
      },
      {
        id: 'op-bad',
        status: 'queued',
        containerId: 'missing',
        containerName: 'gone',
      },
    ]);
    mockGetContainer.mockImplementation((id: string) => (id === 'c-1' ? container : undefined));
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    const result = recoverQueuedOperationsOnStartup();

    expect(result).toEqual({ resumed: 1, abandoned: 1 });
    expect(mockDispatchAcceptedGroups).toHaveBeenCalledWith(
      [{ accepted: [{ container, operationId: 'op-good', trigger }], dependencyContext: [] }],
      { concurrency: 4 },
    );
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-bad',
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
