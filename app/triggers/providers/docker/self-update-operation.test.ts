import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  type PrepareSelfUpdateOperationArgs,
  prepareSelfUpdateOperation,
} from './self-update-operation.js';

const mockInsertOperation = vi.hoisted(() => vi.fn());
const mockUpdateOperation = vi.hoisted(() => vi.fn());
const mockGetOperationById = vi.hoisted(() => vi.fn());

vi.mock('../../../store/update-operation.js', () => ({
  insertOperation: (...args: unknown[]) => mockInsertOperation(...args),
  updateOperation: (...args: unknown[]) => mockUpdateOperation(...args),
  getOperationById: (...args: unknown[]) => mockGetOperationById(...args),
}));

function createArgs(
  overrides: Partial<PrepareSelfUpdateOperationArgs> = {},
): PrepareSelfUpdateOperationArgs {
  return {
    container: {
      id: 'container-id',
      name: 'drydock',
      image: {
        tag: { value: '1.0.0' },
      },
      updateKind: {
        localValue: '1.0.0',
        remoteValue: '2.0.0',
      },
    },
    context: {
      newImage: 'ghcr.io/acme/drydock:2.0.0',
      currentContainerSpec: {
        Id: 'old-container-id',
        Name: '/drydock',
        State: { Running: true },
      },
    },
    triggerName: 'docker.test',
    runtimeContext: undefined,
    now: () => '2026-04-11T12:00:00.000Z',
    createOperationId: () => 'generated-operation-id',
    ...overrides,
  };
}

describe('prepareSelfUpdateOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOperationById.mockReturnValue(undefined);
  });

  test('reuses a requested operation id and upgrades it into an active self-update operation', () => {
    mockGetOperationById.mockReturnValue({
      id: 'queued-op-id',
      status: 'queued',
      phase: 'queued',
    });
    mockUpdateOperation.mockReturnValue({
      id: 'queued-op-id',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });

    const operationId = prepareSelfUpdateOperation(
      createArgs({
        runtimeContext: { operationId: 'queued-op-id' },
      }),
    );

    expect(operationId).toBe('queued-op-id');
    expect(mockUpdateOperation).toHaveBeenCalledWith(
      'queued-op-id',
      expect.objectContaining({
        kind: 'self-update',
        status: 'in-progress',
        phase: 'prepare',
        containerId: 'container-id',
        containerName: 'drydock',
        triggerName: 'docker.test',
        oldContainerId: 'old-container-id',
        oldName: 'drydock',
        oldContainerWasRunning: true,
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        targetImage: 'ghcr.io/acme/drydock:2.0.0',
        completedAt: undefined,
        lastError: undefined,
      }),
    );
    expect(mockInsertOperation).not.toHaveBeenCalled();
  });

  test('creates a new self-update operation when no requested operation id exists', () => {
    mockInsertOperation.mockReturnValue({
      id: 'generated-operation-id',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });

    const operationId = prepareSelfUpdateOperation(createArgs());

    expect(operationId).toBe('generated-operation-id');
    expect(mockInsertOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-operation-id',
        kind: 'self-update',
        status: 'in-progress',
        phase: 'prepare',
        containerId: 'container-id',
        containerName: 'drydock',
        triggerName: 'docker.test',
      }),
    );
  });

  test('creates a new self-update operation when the requested operation id already points to a terminal row', () => {
    mockGetOperationById.mockReturnValue({
      id: 'failed-op-id',
      status: 'failed',
      phase: 'failed',
      kind: 'self-update',
    });
    mockInsertOperation.mockReturnValue({
      id: 'generated-operation-id',
      status: 'in-progress',
      phase: 'prepare',
      kind: 'self-update',
    });

    const operationId = prepareSelfUpdateOperation(
      createArgs({
        runtimeContext: { operationId: 'failed-op-id' },
      }),
    );

    expect(operationId).toBe('generated-operation-id');
    expect(mockUpdateOperation).not.toHaveBeenCalled();
    expect(mockInsertOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-operation-id',
        kind: 'self-update',
        status: 'in-progress',
        phase: 'prepare',
      }),
    );
  });
});
