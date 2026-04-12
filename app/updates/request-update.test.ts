import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetOperationById,
  mockGetActiveOperationByContainerId,
  mockGetActiveOperationByContainerName,
  mockInsertOperation,
  mockMarkOperationTerminal,
} = vi.hoisted(() => ({
  mockGetOperationById: vi.fn(),
  mockGetActiveOperationByContainerId: vi.fn(),
  mockGetActiveOperationByContainerName: vi.fn(),
  mockInsertOperation: vi.fn(),
  mockMarkOperationTerminal: vi.fn(),
}));

vi.mock('../store/update-operation.js', () => ({
  getOperationById: mockGetOperationById,
  getActiveOperationByContainerId: mockGetActiveOperationByContainerId,
  getActiveOperationByContainerName: mockGetActiveOperationByContainerName,
  insertOperation: mockInsertOperation,
  markOperationTerminal: mockMarkOperationTerminal,
}));

vi.mock('../registry/index.js', () => ({
  getState: vi.fn(() => ({ trigger: {} })),
}));

vi.mock('../log/index.js', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

import {
  enqueueContainerUpdates,
  requestContainerUpdate,
  runAcceptedContainerUpdates,
  type UpdateRequestError,
} from './request-update.js';

function createContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'nginx',
    image: { name: 'nginx' },
    updateAvailable: true,
    ...overrides,
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('request-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOperationById.mockReturnValue(undefined);
    mockGetActiveOperationByContainerId.mockReturnValue(undefined);
    mockGetActiveOperationByContainerName.mockReturnValue(undefined);
    mockInsertOperation.mockImplementation((operation) => ({
      id: operation.id || 'op-1',
      ...operation,
    }));
  });

  test('requestContainerUpdate enqueues an operation and runs the provided trigger with the operation id', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockResolvedValue(undefined),
    };

    const accepted = await requestContainerUpdate(createContainer(), { trigger });
    await flushAsyncWork();

    expect(mockInsertOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        containerId: 'c1',
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
      }),
    );
    expect(trigger.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', name: 'nginx' }),
      expect.objectContaining({ operationId: accepted.operationId }),
    );
  });

  test('requestContainerUpdate marks a still-queued accepted operation as failed when trigger execution throws early', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockRejectedValue(new Error('pull failed')),
    };
    mockGetOperationById.mockImplementation((id: string) => ({
      id,
      status: 'queued',
      phase: 'queued',
    }));

    const accepted = await requestContainerUpdate(createContainer(), { trigger });
    await flushAsyncWork();

    expect(mockMarkOperationTerminal).toHaveBeenCalledWith(accepted.operationId, {
      status: 'failed',
      phase: 'failed',
      lastError: 'pull failed',
    });
  });

  test('requestContainerUpdate rejects when no update is available', async () => {
    await expect(
      requestContainerUpdate(createContainer({ updateAvailable: false }), {
        trigger: { type: 'docker', trigger: vi.fn() },
      }),
    ).rejects.toMatchObject<Partial<UpdateRequestError>>({
      statusCode: 400,
      message: 'No update available for this container',
    });
  });

  test('enqueueContainerUpdates assigns one backend-owned batch sequence across accepted containers', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockResolvedValue(undefined),
    };

    const result = await enqueueContainerUpdates(
      [createContainer({ id: 'c1', name: 'nginx' }), createContainer({ id: 'c2', name: 'redis' })],
      { trigger },
    );

    expect(result.rejected).toStrictEqual([]);
    expect(result.accepted).toHaveLength(2);
    expect(mockInsertOperation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        containerId: 'c1',
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
        batchId: expect.any(String),
        queuePosition: 1,
        queueTotal: 2,
      }),
    );
    expect(mockInsertOperation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        containerId: 'c2',
        containerName: 'redis',
        status: 'queued',
        phase: 'queued',
        batchId: mockInsertOperation.mock.calls[0]?.[0]?.batchId,
        queuePosition: 2,
        queueTotal: 2,
      }),
    );
  });

  test('runAcceptedContainerUpdates isolates per-entry failures so one failure does not cascade to the rest', async () => {
    mockGetOperationById.mockImplementation((id: string) => ({
      id,
      status: 'queued',
      phase: 'queued',
    }));
    const triggerNginx = vi.fn().mockRejectedValue(new Error('pull denied'));
    const triggerRedis = vi.fn().mockResolvedValue(undefined);

    await expect(
      runAcceptedContainerUpdates([
        {
          operationId: 'op-1',
          container: createContainer({ id: 'c1', name: 'nginx' }),
          trigger: { type: 'docker', trigger: triggerNginx },
        },
        {
          operationId: 'op-2',
          container: createContainer({ id: 'c2', name: 'redis' }),
          trigger: { type: 'docker', trigger: triggerRedis },
        },
      ]),
    ).rejects.toThrow('pull denied');

    expect(triggerNginx).toHaveBeenCalled();
    expect(triggerRedis).toHaveBeenCalled();
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-1', {
      status: 'failed',
      phase: 'failed',
      lastError: 'pull denied',
    });
    expect(mockMarkOperationTerminal).not.toHaveBeenCalledWith('op-2', expect.anything());
  });
});
