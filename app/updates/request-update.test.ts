import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetOperationById,
  mockGetActiveOperationByContainerId,
  mockGetActiveOperationByContainerName,
  mockGetRecentTerminalSucceededOperationByContainerName,
  mockInsertOperation,
  mockMarkOperationTerminal,
  mockGetState,
  mockLogWarn,
  mockStatSync,
} = vi.hoisted(() => ({
  mockGetOperationById: vi.fn(),
  mockGetActiveOperationByContainerId: vi.fn(),
  mockGetActiveOperationByContainerName: vi.fn(),
  mockGetRecentTerminalSucceededOperationByContainerName: vi.fn(() => undefined),
  mockInsertOperation: vi.fn(),
  mockMarkOperationTerminal: vi.fn(),
  mockGetState: vi.fn(() => ({ trigger: {}, watcher: {} })),
  mockLogWarn: vi.fn(),
  mockStatSync: vi.fn(() => ({ isSocket: () => false })),
}));

vi.mock('../store/update-operation.js', () => ({
  getOperationById: mockGetOperationById,
  getActiveOperationByContainerId: mockGetActiveOperationByContainerId,
  getActiveOperationByContainerName: mockGetActiveOperationByContainerName,
  getRecentTerminalSucceededOperationByContainerName:
    mockGetRecentTerminalSucceededOperationByContainerName,
  insertOperation: mockInsertOperation,
  markOperationTerminal: mockMarkOperationTerminal,
}));

vi.mock('../registry/index.js', () => ({
  getState: mockGetState,
}));

vi.mock('../log/index.js', () => ({
  default: { child: vi.fn(() => ({ info: vi.fn(), warn: mockLogWarn, debug: vi.fn() })) },
}));

vi.mock('node:fs', () => ({
  default: {
    statSync: mockStatSync,
  },
}));

import {
  buildAcceptedUpdateRuntimeContext,
  dispatchAccepted,
  enqueueContainerUpdate,
  enqueueContainerUpdates,
  requestContainerUpdate,
  requestContainerUpdates,
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
    mockGetState.mockReturnValue({ trigger: {}, watcher: {} });
    mockStatSync.mockReturnValue({ isSocket: () => false });
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
      expect.objectContaining({ skipChangeEvent: true }),
    );
    expect(trigger.trigger).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', name: 'nginx' }),
      expect.objectContaining({ operationId: accepted.operationId }),
    );
  });

  test('requestContainerUpdate persists container snapshot on the operation so update-applied can carry it (issue #385)', async () => {
    // The container snapshot must be stored on the operation at enqueue time so
    // that buildTerminalLifecycleEventBase can attach it to the update-applied /
    // update-failed payload even after the old container is gone from the store
    // (compose recreate race, ~8 s gap).
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockResolvedValue(undefined),
    };
    const container = createContainer({ id: 'c42', name: 'myapp' });

    await requestContainerUpdate(container, { trigger });

    expect(mockInsertOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        containerId: 'c42',
        containerName: 'myapp',
        container: expect.objectContaining({ id: 'c42', name: 'myapp' }),
        status: 'queued',
        phase: 'queued',
      }),
      expect.any(Object),
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

  test('requestContainerUpdate uses shared error-message handling for object trigger rejections', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockRejectedValue({ message: 'registry timeout' }),
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
      lastError: 'registry timeout',
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

  test('requestContainerUpdate rejects with 409 when getActiveOperationByContainerId returns a queued operation', async () => {
    mockGetActiveOperationByContainerId.mockReturnValue({ id: 'op-existing', status: 'queued' });

    await expect(
      requestContainerUpdate(createContainer(), {
        trigger: { type: 'docker', trigger: vi.fn() },
      }),
    ).rejects.toMatchObject<Partial<UpdateRequestError>>({
      statusCode: 409,
      message: 'Container update already queued',
    });
  });

  test('requestContainerUpdate rejects with 409 (in progress) when getActiveOperationByContainerId returns a running operation', async () => {
    mockGetActiveOperationByContainerId.mockReturnValue({ id: 'op-running', status: 'running' });

    await expect(
      requestContainerUpdate(createContainer(), {
        trigger: { type: 'docker', trigger: vi.fn() },
      }),
    ).rejects.toMatchObject<Partial<UpdateRequestError>>({
      statusCode: 409,
      message: 'Container update already in progress',
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
      expect.objectContaining({ skipChangeEvent: true }),
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
      expect.objectContaining({ skipChangeEvent: true }),
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

  test('enqueueContainerUpdate uses provided operationId instead of generating a new one (#289)', async () => {
    const trigger = { type: 'docker', trigger: vi.fn().mockResolvedValue(undefined) };
    const accepted = await enqueueContainerUpdate(createContainer(), {
      trigger,
      operationId: 'controller-op-uuid',
    });
    expect(accepted.operationId).toBe('controller-op-uuid');
    expect(mockInsertOperation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'controller-op-uuid' }),
      expect.any(Object),
    );
  });

  test('enqueueContainerUpdates uses provided operationId for single-container batches (#289)', async () => {
    const trigger = { type: 'docker', trigger: vi.fn().mockResolvedValue(undefined) };
    const result = await enqueueContainerUpdates([createContainer({ id: 'c1', name: 'nginx' })], {
      trigger,
      operationId: 'controller-single-op',
    });
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].operationId).toBe('controller-single-op');
    expect(mockInsertOperation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'controller-single-op' }),
      expect.any(Object),
    );
  });

  test('enqueueContainerUpdates ignores provided operationId for multi-container batches (#289)', async () => {
    const trigger = { type: 'docker', trigger: vi.fn().mockResolvedValue(undefined) };
    const result = await enqueueContainerUpdates(
      [createContainer({ id: 'c1', name: 'nginx' }), createContainer({ id: 'c2', name: 'redis' })],
      { trigger, operationId: 'should-not-be-used' },
    );
    expect(result.accepted).toHaveLength(2);
    // Each container gets its own generated UUID — the provided operationId is ignored
    expect(result.accepted[0].operationId).not.toBe('should-not-be-used');
    expect(result.accepted[1].operationId).not.toBe('should-not-be-used');
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

  test('runAcceptedContainerUpdates dispatches all accepted updates by default so update locks own concurrency', async () => {
    const gates = Array.from({ length: 3 }, () => deferred());
    const started: string[] = [];
    const accepted = gates.map((gate, index) => {
      const operationId = `op-default-${index + 1}`;
      return {
        operationId,
        container: createContainer({ id: `c-default-${index + 1}`, name: `app-${index + 1}` }),
        trigger: {
          type: 'docker',
          trigger: vi.fn(async () => {
            started.push(operationId);
            await gate.promise;
          }),
        },
      };
    });

    const run = runAcceptedContainerUpdates(accepted);

    await flushAsyncWork();
    expect(started).toEqual(['op-default-1', 'op-default-2', 'op-default-3']);

    for (const gate of gates) {
      gate.resolve();
    }
    await expect(run).resolves.toBeUndefined();
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

    dispatchAccepted([entry]);

    await flushAsyncWork();
    expect(trigger.trigger).toHaveBeenCalledWith(entry.container, {
      operationId: 'op-bg-1',
    });
  });

  test('dispatchAccepted does not call markOperationTerminal when operation is already past queued (e.g. running)', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockRejectedValue(new Error('late failure')),
    };
    // Return an operation with status 'running' — markAcceptedQueuedOperationFailed should
    // short-circuit and NOT call markOperationTerminal
    mockGetOperationById.mockImplementation((id: string) => ({
      id,
      status: 'running',
      phase: 'running',
    }));

    const entry = {
      container: createContainer(),
      operationId: 'op-late',
      trigger,
    };
    dispatchAccepted([entry]);
    await flushAsyncWork();

    expect(mockMarkOperationTerminal).not.toHaveBeenCalled();
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
    await vi.waitFor(() =>
      expect(mockLogWarn).toHaveBeenCalledWith(
        'Accepted update dispatch failed for nginx (operation op-bg-2): explosion',
      ),
    );
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

    test('rejects with 409 when last update rolled back and candidate tag matches without digest', async () => {
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
            result: { tag: '1.1.0' },
            updateRollback: {
              recordedAt: '2026-04-01T00:00:00.000Z',
              targetDigest: '1.1.0',
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

    test('rejects with 409 when self-update-unavailable blocker fires (drydock self-container, socket absent)', async () => {
      const trigger = {
        type: 'docker',
        trigger: vi.fn(),
        agent: undefined,
        configuration: { threshold: 'all' },
        getId: () => 'docker.update',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      // Provide a watcher with dockerApi in socket mode (no TCP host)
      // and mock statSync to return non-socket → isSelfUpdateAvailable returns false
      mockGetState.mockReturnValue({
        trigger: { 'docker.update': trigger },
        watcher: {
          local: {
            dockerApi: {
              modem: { host: '' },
            },
          },
        },
      });
      mockStatSync.mockReturnValue({ isSocket: () => false });

      // Drydock self-container with a real tag update
      await expect(
        enqueueContainerUpdate(
          createContainerWithRawUpdate({
            watcher: 'local',
            image: { name: 'drydock', tag: { value: '1.5.0' } },
            result: { tag: '1.6.0' },
          }),
        ),
      ).rejects.toMatchObject<Partial<UpdateRequestError>>({
        statusCode: 409,
        message: expect.stringContaining('Self-update cannot run in this deployment'),
      });
    });

    test('allows update for self-container when self-update IS available (TCP mode)', async () => {
      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockResolvedValue(undefined),
        agent: undefined,
        configuration: { threshold: 'all' },
        getId: () => 'docker.update',
        isTriggerIncluded: () => true,
        isTriggerExcluded: () => false,
      };
      // TCP watcher → isSelfUpdateAvailable returns true → no self-update-unavailable blocker
      mockGetState.mockReturnValue({
        trigger: { 'docker.update': trigger },
        watcher: {
          local: {
            dockerApi: {
              modem: { host: '10.0.0.1' },
            },
          },
        },
      });

      const accepted = await enqueueContainerUpdate(
        createContainerWithRawUpdate({
          watcher: 'local',
          image: { name: 'drydock', tag: { value: '1.5.0' } },
          result: { tag: '1.6.0' },
        }),
        { trigger: { type: 'docker', trigger: vi.fn().mockResolvedValue(undefined) } },
      );
      expect(accepted.operationId).toBeDefined();
      expect(mockInsertOperation).toHaveBeenCalled();
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

  test('dispatchAccepted logs bulk context when multiple accepted entries fail', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockRejectedValue(new Error('registry down')),
    };
    mockGetOperationById.mockImplementation((id: string) => ({
      id,
      status: 'queued',
      phase: 'queued',
    }));

    dispatchAccepted([
      { container: createContainer({ id: 'c1', name: 'nginx' }), operationId: 'op-1', trigger },
      { container: createContainer({ id: 'c2', name: 'redis' }), operationId: 'op-2', trigger },
    ]);

    await vi.waitFor(() =>
      expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('2 accepted updates')),
    );
  });

  test('dispatchAccepted formats multi-entry context with joined operation ids', async () => {
    // Exercises the multi-entry branch where operationIds is non-empty (joined result).
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockRejectedValue(new Error('boom')),
    };
    mockGetOperationById.mockImplementation((id: string) => ({
      id,
      status: 'queued',
      phase: 'queued',
    }));

    dispatchAccepted([
      { container: createContainer({ id: 'c1', name: 'nginx' }), operationId: 'op-a', trigger },
      { container: createContainer({ id: 'c2', name: 'redis' }), operationId: 'op-b', trigger },
    ]);

    await vi.waitFor(() =>
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringMatching(/2 accepted updates \(operations op-a, op-b\)/),
      ),
    );
  });

  test('dispatchAccepted formats multi-entry context without operation ids when all are empty', async () => {
    // Exercises the ternary `: ''` branch where all operationIds filter out to empty strings.
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockRejectedValue(new Error('boom')),
    };
    mockGetOperationById.mockImplementation((id: string) => ({
      id,
      status: 'queued',
      phase: 'queued',
    }));

    dispatchAccepted([
      { container: createContainer({ id: 'c1', name: 'nginx' }), operationId: '', trigger },
      { container: createContainer({ id: 'c2', name: 'redis' }), operationId: '', trigger },
    ]);

    await vi.waitFor(() => {
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringMatching(/^Accepted update dispatch failed for 2 accepted updates: boom$/),
      );
    });
  });

  test('dispatchAccepted formats single-entry context with <unknown> when container has no name or id', async () => {
    // Exercises the '<unknown>' fallback in the `||` chain for the single-entry branch.
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockRejectedValue(new Error('bang')),
    };
    mockGetOperationById.mockImplementation((id: string) => ({
      id,
      status: 'queued',
      phase: 'queued',
    }));

    dispatchAccepted([
      {
        container: createContainer({ id: '', name: '' }),
        operationId: 'op-x',
        trigger,
      },
    ]);

    await vi.waitFor(() =>
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.stringContaining('<unknown> (operation op-x)'),
      ),
    );
  });

  test('requestContainerUpdates enqueues all containers and dispatches accepted', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockResolvedValue(undefined),
    };

    const result = await requestContainerUpdates(
      [createContainer({ id: 'c1', name: 'nginx' }), createContainer({ id: 'c2', name: 'redis' })],
      { trigger },
    );

    await flushAsyncWork();

    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(trigger.trigger).toHaveBeenCalledTimes(2);
  });

  test('enqueueContainerUpdates includes rejected containers when some fail eligibility', async () => {
    const trigger = {
      type: 'docker',
      trigger: vi.fn().mockResolvedValue(undefined),
    };

    const result = await enqueueContainerUpdates(
      [
        createContainer({ id: 'c1', name: 'nginx', updateAvailable: true }),
        createContainer({ id: 'c2', name: 'redis', updateAvailable: false }),
      ],
      { trigger },
    );

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].container.name).toBe('redis');
    expect(result.rejected[0].statusCode).toBe(400);
  });

  describe('getActiveUpdateOperationForContainer name-based dedup (issue #410 Part A)', () => {
    test('blocks duplicate enqueue when a modern (containerId-carrying) op exists for the same container name', async () => {
      // A modern op (has containerId) is active for container "nginx".
      // The NEW container has a different Docker ID (recreated), so by-id lookup misses.
      // The by-name lookup SHOULD block the enqueue because agent+watcher match.
      mockGetActiveOperationByContainerId.mockReturnValue(undefined); // new ID not found
      mockGetActiveOperationByContainerName.mockReturnValue({
        id: 'op-existing',
        status: 'in-progress',
        containerId: 'old-container-id', // modern op: has containerId
        container: { agent: undefined, watcher: 'local' },
      });

      await expect(
        requestContainerUpdate(
          createContainer({ id: 'new-container-id', name: 'nginx', watcher: 'local' }),
          {
            trigger: { type: 'docker', trigger: vi.fn() },
          },
        ),
      ).rejects.toMatchObject<Partial<UpdateRequestError>>({
        statusCode: 409,
        message: 'Container update already in progress',
      });
    });

    test('allows fresh enqueue when the previously active op is terminal (succeeded)', async () => {
      // After Op1 completes successfully (terminal), Op2 for the same name should be allowed.
      mockGetActiveOperationByContainerId.mockReturnValue(undefined);
      mockGetActiveOperationByContainerName.mockReturnValue(undefined); // no active op

      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      const accepted = await requestContainerUpdate(createContainer({ name: 'nginx' }), {
        trigger,
      });
      expect(accepted.operationId).toBeDefined();
      expect(mockInsertOperation).toHaveBeenCalled();
    });

    test('cross-agent non-collision: agent-A does not get 409 when agent-B has active op for same name', async () => {
      // agent-B has an in-progress op for "drydock-agent", agent-A should NOT be blocked.
      mockGetActiveOperationByContainerId.mockReturnValue(undefined);
      mockGetActiveOperationByContainerName.mockReturnValue(undefined); // scoped call returns undefined

      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      const accepted = await requestContainerUpdate(
        createContainer({
          id: 'c-agent-a',
          name: 'drydock-agent',
          agent: 'agent-A',
          watcher: 'local',
        }),
        { trigger },
      );
      expect(accepted.operationId).toBeDefined();
      expect(mockInsertOperation).toHaveBeenCalled();
    });

    test('cross-watcher non-collision: different watcher does not block enqueue', async () => {
      // watcher-2 has an op for "web", watcher-1 should not be blocked.
      mockGetActiveOperationByContainerId.mockReturnValue(undefined);
      mockGetActiveOperationByContainerName.mockReturnValue(undefined); // scoped call returns undefined

      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockResolvedValue(undefined),
      };
      const accepted = await requestContainerUpdate(
        createContainer({ id: 'c-w1', name: 'web', watcher: 'watcher-1' }),
        { trigger },
      );
      expect(accepted.operationId).toBeDefined();
      expect(mockInsertOperation).toHaveBeenCalled();
    });

    test('legacy op (no container snapshot) still blocks enqueue', async () => {
      // Legacy row without a container snapshot — backward-compatible block.
      mockGetActiveOperationByContainerId.mockReturnValue(undefined);
      mockGetActiveOperationByContainerName.mockReturnValue({
        id: 'op-legacy',
        status: 'queued',
        // no container snapshot
      });

      await expect(
        requestContainerUpdate(
          createContainer({ id: 'c-new', name: 'nginx', agent: 'agent-A', watcher: 'local' }),
          {
            trigger: { type: 'docker', trigger: vi.fn() },
          },
        ),
      ).rejects.toMatchObject<Partial<UpdateRequestError>>({
        statusCode: 409,
      });
    });
  });

  describe('markAcceptedQueuedOperationFailed reclassification (issue #410 Part B)', () => {
    test('reclassifies a Docker 404 (container-not-found) to expired when a recent success exists for the same name', async () => {
      // The trigger throws with a Docker 404 error shape
      const docker404Error = Object.assign(new Error('No such container: nginx'), {
        statusCode: 404,
      });
      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockRejectedValue(docker404Error),
      };

      // Operation is in queued state when we check
      mockGetOperationById.mockImplementation((id: string) => ({
        id,
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
      }));

      // A recent succeeded op for the same container name exists
      mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
        id: 'prev-op',
        containerName: 'nginx',
        status: 'succeeded',
      });

      const accepted = await requestContainerUpdate(createContainer({ name: 'nginx' }), {
        trigger,
      });
      await flushAsyncWork();

      // Should be marked expired, not failed
      expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
        accepted.operationId,
        expect.objectContaining({ status: 'expired' }),
      );
      expect(mockMarkOperationTerminal).not.toHaveBeenCalledWith(
        accepted.operationId,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    test('keeps failed status for Docker 404 when no recent success exists', async () => {
      const docker404Error = Object.assign(new Error('No such container: nginx'), {
        statusCode: 404,
      });
      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockRejectedValue(docker404Error),
      };

      mockGetOperationById.mockImplementation((id: string) => ({
        id,
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
      }));

      // No recent success
      mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);

      const accepted = await requestContainerUpdate(createContainer({ name: 'nginx' }), {
        trigger,
      });
      await flushAsyncWork();

      expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
        accepted.operationId,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    test('reclassifies a 409 conflict error to expired when a recent success exists', async () => {
      // An agent 409 conflict (active-op on the agent side) with a prior success
      const conflict409Error = Object.assign(new Error('Container update already in progress'), {
        response: { status: 409 },
      });
      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockRejectedValue(conflict409Error),
      };

      mockGetOperationById.mockImplementation((id: string) => ({
        id,
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
      }));

      mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
        id: 'prev-op',
        containerName: 'nginx',
        status: 'succeeded',
      });

      const accepted = await requestContainerUpdate(createContainer({ name: 'nginx' }), {
        trigger,
      });
      await flushAsyncWork();

      expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
        accepted.operationId,
        expect.objectContaining({ status: 'expired' }),
      );
    });

    test('keeps failed status for 409 conflict error when no recent success exists', async () => {
      const conflict409Error = Object.assign(new Error('Container update already in progress'), {
        response: { status: 409 },
      });
      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockRejectedValue(conflict409Error),
      };

      mockGetOperationById.mockImplementation((id: string) => ({
        id,
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
      }));

      mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue(undefined);

      const accepted = await requestContainerUpdate(createContainer({ name: 'nginx' }), {
        trigger,
      });
      await flushAsyncWork();

      expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
        accepted.operationId,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    test('does not reclassify unrelated errors (e.g. pull failure) to expired', async () => {
      const pullError = new Error('pull denied');
      const trigger = {
        type: 'docker',
        trigger: vi.fn().mockRejectedValue(pullError),
      };

      mockGetOperationById.mockImplementation((id: string) => ({
        id,
        containerName: 'nginx',
        status: 'queued',
        phase: 'queued',
      }));

      mockGetRecentTerminalSucceededOperationByContainerName.mockReturnValue({
        id: 'prev-op',
        containerName: 'nginx',
        status: 'succeeded',
      });

      const accepted = await requestContainerUpdate(createContainer({ name: 'nginx' }), {
        trigger,
      });
      await flushAsyncWork();

      // A plain pull failure is NOT a container-not-found or 409 error, so stays failed
      expect(mockMarkOperationTerminal).toHaveBeenCalledWith(
        accepted.operationId,
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });
});
