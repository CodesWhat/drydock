import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetOperationById,
  mockGetActiveOperationByContainerId,
  mockGetActiveOperationByContainerName,
  mockInsertOperation,
  mockMarkOperationTerminal,
  mockGetState,
} = vi.hoisted(() => ({
  mockGetOperationById: vi.fn(),
  mockGetActiveOperationByContainerId: vi.fn(),
  mockGetActiveOperationByContainerName: vi.fn(),
  mockInsertOperation: vi.fn(),
  mockMarkOperationTerminal: vi.fn(),
  mockGetState: vi.fn(() => ({ trigger: {} })),
}));

vi.mock('../store/update-operation.js', () => ({
  getOperationById: mockGetOperationById,
  getActiveOperationByContainerId: mockGetActiveOperationByContainerId,
  getActiveOperationByContainerName: mockGetActiveOperationByContainerName,
  insertOperation: mockInsertOperation,
  markOperationTerminal: mockMarkOperationTerminal,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../log/index.js', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() })) },
}));

import {
  buildAcceptedUpdateRuntimeContext,
  dispatchAccepted,
  enqueueContainerUpdate,
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

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('request-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOperationById.mockReturnValue(undefined);
    mockGetActiveOperationByContainerId.mockReturnValue(undefined);
    mockGetActiveOperationByContainerName.mockReturnValue(undefined);
    mockGetState.mockReturnValue({ trigger: {} });
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

  test('requestContainerUpdate resolves an explicit dockercompose triggerTypes override', async () => {
    const trigger = {
      type: 'dockercompose',
      configuration: { file: '/opt/drydock/test/monitoring.yml' },
      getDefaultComposeFilePath: vi.fn(() => '/opt/drydock/test/monitoring.yml'),
      getComposeFilesForContainer: vi.fn(() => ['/opt/drydock/test/monitoring.yml']),
      trigger: vi.fn().mockResolvedValue(undefined),
    };
    mockGetState.mockReturnValue({
      trigger: {
        'dockercompose.compose': trigger,
      },
    });
    const container = createContainer({
      labels: {
        'com.docker.compose.project.config_files': '/opt/drydock/test/monitoring.yml',
      },
    });
    mockGetState.mockReturnValue({
      trigger: {
        'dockercompose.compose': trigger,
      },
    });

    const accepted = await requestContainerUpdate(container, {
      triggerTypes: ['dockercompose'],
    });
    await flushAsyncWork();

    expect(accepted.operationId).toBeDefined();
    expect(trigger.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', name: 'nginx' }),
      expect.objectContaining({ operationId: accepted.operationId }),
    );
  });

  test('enqueueContainerUpdate rejects invalid provided trigger shapes', async () => {
    await expect(
      enqueueContainerUpdate(createContainer(), {
        trigger: { type: 123, trigger: vi.fn() } as any,
      }),
    ).rejects.toMatchObject<Partial<UpdateRequestError>>({
      statusCode: 500,
      message: 'Invalid update trigger',
    });
  });

  test('enqueueContainerUpdate rejects non-container update trigger types', async () => {
    await expect(
      enqueueContainerUpdate(createContainer(), {
        trigger: { type: 'slack', trigger: vi.fn() } as any,
      }),
    ).rejects.toMatchObject<Partial<UpdateRequestError>>({
      statusCode: 400,
      message: 'Trigger is not a container update trigger',
    });
  });

  test('enqueueContainerUpdate rejects when no docker trigger is found', async () => {
    await expect(
      enqueueContainerUpdate(createContainer(), {
        triggerTypes: ['dockercompose'],
      }),
    ).rejects.toMatchObject<Partial<UpdateRequestError>>({
      statusCode: 404,
      message: 'No docker trigger found for this container',
    });
  });

  test('enqueueContainerUpdates rethrows unexpected trigger resolution failures', async () => {
    const evilTrigger = {
      get type() {
        throw new Error('boom');
      },
      trigger: vi.fn(),
    } as any;

    await expect(
      enqueueContainerUpdates([createContainer()], {
        trigger: evilTrigger,
      }),
    ).rejects.toThrow('boom');
  });

  test('buildAcceptedUpdateRuntimeContext filters invalid container ids from bulk updates', () => {
    const accepted = [
      {
        container: createContainer({ id: 'c1' }),
        operationId: 'op-1',
        trigger: { type: 'docker', trigger: vi.fn() },
      },
      {
        container: createContainer({ id: '' }),
        operationId: 'op-2',
        trigger: { type: 'docker', trigger: vi.fn() },
      },
    ];

    expect(buildAcceptedUpdateRuntimeContext(accepted)).toEqual({
      operationIds: {
        c1: 'op-1',
      },
    });
  });

  test('buildAcceptedUpdateRuntimeContext returns a single operation id for one accepted update', () => {
    const accepted = [
      {
        container: createContainer({ id: 'c1' }),
        operationId: 'op-1',
        trigger: { type: 'docker', trigger: vi.fn() },
      },
    ];

    expect(buildAcceptedUpdateRuntimeContext(accepted)).toEqual({
      operationId: 'op-1',
    });
  });

  test('runAcceptedContainerUpdates handles empty accepted lists', async () => {
    await expect(runAcceptedContainerUpdates([])).resolves.toBeUndefined();
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
  });

  test('runAcceptedContainerUpdates rejects invalid concurrency limits', async () => {
    await expect(
      runAcceptedContainerUpdates(
        [
          {
            container: createContainer({ id: 'c1' }),
            operationId: 'op-1',
            trigger: { type: 'docker', trigger: vi.fn() },
          },
        ],
        { concurrency: 0 },
      ),
    ).rejects.toThrow('Accepted update dispatch concurrency must be a positive integer');
  });

  test('runAcceptedContainerUpdates limits trigger concurrency when a cap is provided', async () => {
    const gates = Array.from({ length: 5 }, () => deferred());
    const started: string[] = [];
    const accepted = gates.map((gate, index) => {
      const operationId = `op-${index + 1}`;
      return {
        operationId,
        container: createContainer({ id: `c${index + 1}`, name: `app-${index + 1}` }),
        trigger: {
          type: 'docker',
          trigger: vi.fn(async () => {
            started.push(operationId);
            await gate.promise;
          }),
        },
      };
    });

    const run = runAcceptedContainerUpdates(accepted, { concurrency: 2 });

    await flushAsyncWork();
    expect(started).toEqual(['op-1', 'op-2']);

    gates[0].resolve();
    await flushAsyncWork();
    expect(started).toEqual(['op-1', 'op-2', 'op-3']);

    for (const gate of gates) {
      gate.resolve();
    }
    await expect(run).resolves.toBeUndefined();
  });

  test('dispatchAccepted runs triggers in the background and returns synchronously', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockResolvedValue(undefined),
    };
    const entry = {
      container: createContainer(),
      operationId: 'op-bg-1',
      trigger,
    };

    const result = dispatchAccepted([entry]);
    expect(result).toBeUndefined();

    await flushAsyncWork();
    expect(trigger.trigger).toHaveBeenCalledWith(entry.container, {
      operationId: 'op-bg-1',
    });
  });

  test('dispatchAccepted swallows trigger rejection so it never escapes as an unhandled rejection', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockRejectedValue(new Error('explosion')),
    };
    const entry = {
      container: createContainer(),
      operationId: 'op-bg-2',
      trigger,
    };
    mockGetOperationById.mockImplementation((id: string) => ({
      id,
      status: 'queued',
      phase: 'queued',
    }));

    expect(() => dispatchAccepted([entry])).not.toThrow();

    await flushAsyncWork();
    expect(mockMarkOperationTerminal).toHaveBeenCalledWith('op-bg-2', {
      status: 'failed',
      phase: 'failed',
      lastError: 'explosion',
    });
  });

  test('runAcceptedContainerUpdates leaves successful terminalization to the trigger lifecycle', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockResolvedValue(undefined),
    };
    const accepted = [
      {
        container: createContainer({ id: 'c1' }),
        operationId: 'op-1',
        trigger,
      },
    ];

    await runAcceptedContainerUpdates(accepted);

    expect(trigger.trigger).toHaveBeenCalledWith(accepted[0].container, {
      operationId: 'op-1',
    });
    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
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

  describe('hard-blocker enforcement via update-eligibility', () => {
    // These tests need a container shape that satisfies eligibility's
    // hasRawTagOrDigestUpdate (image.tag.value differs from result.tag),
    // since eligibility short-circuits to no-update-available otherwise.
    function createContainerWithRawUpdate(overrides: Record<string, unknown> = {}) {
      return createContainer({
        image: { name: 'nginx', tag: { value: '1.0.0' } },
        result: { tag: '1.1.0' },
        ...overrides,
      });
    }

    test('rejects with 409 when container is a rollback artifact', async () => {
      const trigger = {
        type: 'docker',
        trigger: vi.fn(),
        agent: undefined,
        configuration: { threshold: 'all' },
        getId: () => 'docker.update',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger } });

      await expect(
        enqueueContainerUpdate(createContainerWithRawUpdate({ name: 'nginx-old-1700000000000' })),
      ).rejects.toMatchObject<Partial<UpdateRequestError>>({
        statusCode: 409,
        message: 'This is a rollback container created during a previous update.',
      });
    });

    test('rejects with 409 when security update scan is blocked', async () => {
      const trigger = {
        type: 'docker',
        trigger: vi.fn(),
        agent: undefined,
        configuration: { threshold: 'all' },
        getId: () => 'docker.update',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger } });

      await expect(
        enqueueContainerUpdate(
          createContainerWithRawUpdate({
            security: { updateScan: { status: 'blocked' } },
          }),
        ),
      ).rejects.toMatchObject<Partial<UpdateRequestError>>({
        statusCode: 409,
        message: expect.stringContaining('Security scan is blocking this update'),
      });
    });

    test('rejects with 409 when last update rolled back and candidate digest matches', async () => {
      const trigger = {
        type: 'docker',
        trigger: vi.fn(),
        agent: undefined,
        configuration: { threshold: 'all' },
        getId: () => 'docker.update',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger } });

      await expect(
        enqueueContainerUpdate(
          createContainerWithRawUpdate({
            result: { tag: '1.1.0', digest: 'sha256:deadbeef' },
            updateRollback: {
              recordedAt: '2026-04-01T00:00:00.000Z',
              targetDigest: 'sha256:deadbeef',
              reason: 'start_new_failed',
              lastError: 'container exited with code 1',
            },
          }),
        ),
      ).rejects.toMatchObject<Partial<UpdateRequestError>>({
        statusCode: 409,
        message: expect.stringContaining('Last update attempt rolled back'),
      });
    });

    test('rejects with 404 when no docker trigger is configured at all', async () => {
      mockGetState.mockReturnValue({ trigger: {} });

      await expect(enqueueContainerUpdate(createContainerWithRawUpdate())).rejects.toMatchObject<
        Partial<UpdateRequestError>
      >({
        statusCode: 404,
        message: expect.stringContaining('No docker or dockercompose action trigger is configured'),
      });
    });

    test('rejects with 404 with the agent-mismatch message when trigger is on the wrong agent', async () => {
      const trigger = {
        type: 'docker',
        trigger: vi.fn(),
        agent: 'edge-1',
        configuration: { threshold: 'all' },
        getId: () => 'docker.update',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger } });

      await expect(
        enqueueContainerUpdate(createContainerWithRawUpdate({ agent: 'edge-2' })),
      ).rejects.toMatchObject<Partial<UpdateRequestError>>({
        statusCode: 404,
        message: expect.stringContaining("Update trigger runs on agent 'edge-1'"),
      });
    });

    test('allows manual update when only soft blockers (snooze) are present', async () => {
      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockResolvedValue(undefined),
        agent: undefined,
        configuration: { threshold: 'all' },
        getId: () => 'docker.update',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      mockGetState.mockReturnValue({ trigger: { 'docker.update': trigger } });

      const accepted = await enqueueContainerUpdate(
        createContainerWithRawUpdate({
          updatePolicy: { snoozeUntil: '2099-01-01T00:00:00.000Z' },
        }),
        { trigger: { type: 'docker', trigger: vi.fn().mockResolvedValue(undefined) } },
      );
      expect(accepted.operationId).toBeDefined();
      expect(mockInsertOperation).toHaveBeenCalled();
    });
  });
});
