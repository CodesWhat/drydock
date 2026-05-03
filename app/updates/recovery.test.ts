import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockListActiveOperations,
  mockMarkOperationTerminal,
  mockGetContainer,
  mockGetState,
  mockFindDockerTriggerForContainer,
  mockDispatchAccepted,
} = vi.hoisted(() => ({
  mockListActiveOperations: vi.fn(),
  mockMarkOperationTerminal: vi.fn(),
  mockGetContainer: vi.fn(),
  mockGetState: vi.fn(),
  mockFindDockerTriggerForContainer: vi.fn(),
  mockDispatchAccepted: vi.fn(),
}));

vi.mock('../store/update-operation.js', () => ({
  listActiveOperations: mockListActiveOperations,
  markOperationTerminal: mockMarkOperationTerminal,
}));

vi.mock('../store/container.js', () => ({
  getContainer: mockGetContainer,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../api/docker-trigger.js', () => ({
  findDockerTriggerForContainer: mockFindDockerTriggerForContainer,
}));

vi.mock('./request-update.js', () => ({
  dispatchAccepted: mockDispatchAccepted,
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

import { recoverQueuedOperationsOnStartup } from './recovery.js';

describe('recoverQueuedOperationsOnStartup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY;
    mockGetState.mockReturnValue({ trigger: { 'docker.local': {} } });
  });

  test('returns zeros and dispatches nothing when there are no active operations', () => {
    mockListActiveOperations.mockReturnValue([]);
    expect(recoverQueuedOperationsOnStartup()).toEqual({ resumed: 0, abandoned: 0 });
    expect(mockDispatchAccepted).not.toHaveBeenCalled();
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
    expect(mockDispatchAccepted).not.toHaveBeenCalled();
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
    expect(mockDispatchAccepted).not.toHaveBeenCalled();
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
    expect(mockDispatchAccepted).not.toHaveBeenCalled();
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
    expect(mockDispatchAccepted).not.toHaveBeenCalled();
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
    expect(mockDispatchAccepted).not.toHaveBeenCalled();
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
    expect(mockDispatchAccepted).toHaveBeenCalledWith(
      [{ container, operationId: 'op-go', trigger }],
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
    expect(mockDispatchAccepted).toHaveBeenCalledWith(expect.any(Array), { concurrency: 4 });
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
      expect(mockDispatchAccepted).toHaveBeenCalledWith(expect.any(Array), { concurrency: 2 });
    } finally {
      if (previous === undefined) {
        delete process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY;
      } else {
        process.env.DD_UPDATE_RECOVERY_BOOT_CONCURRENCY = previous;
      }
    }
  });

  test('dispatches a mid-health-gate crash operation after startup reconciliation reset it to queued', () => {
    const container = { id: 'c-health', name: 'web', watcher: 'local' };
    const trigger = { type: 'docker', trigger: vi.fn() };
    mockListActiveOperations.mockReturnValue([
      {
        id: 'op-health-gate-crash',
        status: 'queued',
        phase: 'queued',
        containerId: 'c-health',
        containerName: 'web',
        oldContainerId: 'old-c-health',
        oldName: 'web',
        tempName: 'web-drydock-update',
        newContainerId: 'new-c-health',
        recoveredAt: '2026-02-23T02:00:00.000Z',
      },
    ]);
    mockGetContainer.mockReturnValue(container);
    mockFindDockerTriggerForContainer.mockReturnValue(trigger);

    const result = recoverQueuedOperationsOnStartup();

    expect(result).toEqual({ resumed: 1, abandoned: 0 });
    expect(mockDispatchAccepted).toHaveBeenCalledWith(
      [{ container, operationId: 'op-health-gate-crash', trigger }],
      { concurrency: 4 },
    );
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
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
    expect(mockDispatchAccepted).toHaveBeenCalledWith(
      [
        { container: containerA, operationId: 'op-a', trigger },
        { container: containerB, operationId: 'op-b', trigger },
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
    expect(mockDispatchAccepted).toHaveBeenCalledWith(
      [{ container, operationId: 'op-good', trigger }],
      { concurrency: 4 },
    );
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
      'op-bad',
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
