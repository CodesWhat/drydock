import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as sseRouter from '../api/sse.js';
import * as event from '../event/index.js';
import { type Container, fullName } from '../model/container.js';
import type { NotificationOutboxEntry } from '../model/notification-outbox.js';
import { OutboxWorker } from '../notifications/outbox-worker.js';
import * as registry from '../registry/index.js';
import * as containerStore from '../store/container.js';
import * as notificationOutboxStore from '../store/notification-outbox.js';
import * as updateOperationStore from '../store/update-operation.js';
import Trigger from '../triggers/providers/Trigger.js';
import { recoverQueuedOperationsOnStartup } from './recovery.js';
import {
  buildComposeProjectLockKey,
  buildContainerLockKey,
  getUpdateLockSnapshot,
  withContainerUpdateLocks,
} from './update-locks.js';

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

function getByPath(object: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (typeof acc !== 'object' || acc === null) {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, object);
}

function matchesQueryOperator(actual: unknown, expected: unknown): boolean {
  if (!expected || typeof expected !== 'object') {
    return actual === expected;
  }

  const operators = expected as Record<string, unknown>;
  if ('$lte' in operators) {
    return typeof actual === 'string' && actual <= String(operators.$lte);
  }
  if ('$lt' in operators) {
    return typeof actual === 'string' && actual < String(operators.$lt);
  }
  return actual === expected;
}

function matchesQuery(document: unknown, query: Record<string, unknown> = {}): boolean {
  return Object.entries(query).every(([key, value]) =>
    matchesQueryOperator(getByPath(document, key), value),
  );
}

function createCollection(initialDocuments: unknown[] = []) {
  const documents = [...initialDocuments];

  return {
    ensureIndex: vi.fn(),
    insert: (document: unknown) => {
      documents.push(document);
    },
    find: (query: Record<string, unknown> = {}) =>
      documents.filter((document) => matchesQuery(document, query)),
    findOne: (query: Record<string, unknown> = {}) =>
      documents.find((document) => matchesQuery(document, query)) || null,
    remove: (document: unknown) => {
      const index = documents.indexOf(document);
      if (index >= 0) {
        documents.splice(index, 1);
      }
    },
    update: vi.fn(),
  };
}

function createDb(initialDocuments: Record<string, unknown[]> = {}) {
  const collections = new Map<string, ReturnType<typeof createCollection>>();

  return {
    getCollection: (name: string) => collections.get(name) || null,
    addCollection: (name: string) => {
      const collection = createCollection(initialDocuments[name]);
      collections.set(name, collection);
      return collection;
    },
  };
}

function createContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c-web',
    name: 'web',
    watcher: 'local',
    image: {
      id: 'image-web',
      registry: { name: 'hub', url: 'https://registry-1.docker.io/v2' },
      name: 'library/nginx',
      tag: { value: '1.0.0', semver: true },
      digest: { watch: false },
      architecture: 'amd64',
      os: 'linux',
    },
    result: { tag: '1.0.1' },
    updateAvailable: true,
    updateKind: {
      kind: 'tag',
      localValue: '1.0.0',
      remoteValue: '1.0.1',
      semverDiff: 'patch',
    },
    labels: { 'com.docker.compose.project': 'stack' },
    ...overrides,
  } as Container;
}

function createSseResponseSink() {
  return {
    write: vi.fn(() => true),
    flush: vi.fn(),
  };
}

function parseSseEventPayloads(res: ReturnType<typeof createSseResponseSink>, eventName: string) {
  return res.write.mock.calls
    .map(([chunk]) => (typeof chunk === 'string' ? chunk : ''))
    .filter((chunk) => chunk.includes(`event: ${eventName}\n`))
    .map((chunk) => {
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      return dataLine ? JSON.parse(dataLine.slice('data: '.length)) : {};
    });
}

async function waitForCondition(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
}

class FlakyNotificationTrigger extends Trigger {
  public readonly deliveredContainers: string[] = [];
  public attempts = 0;

  async trigger(container: Container): Promise<unknown> {
    this.attempts += 1;
    if (this.attempts === 1) {
      throw new Error('notification endpoint unavailable');
    }
    this.deliveredContainers.push(container.name);
    return { ok: true };
  }
}

describe('startup recovery lock and cancel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    event.clearAllListenersForTests();
    sseRouter._resetInitializationStateForTests();
    sseRouter._resetEventCounterForTests();
    sseRouter._clients.clear();
    sseRouter._activeSseClientRegistry.clear();
    sseRouter._connectionsPerIp.clear();
    sseRouter._connectionsPerSession.clear();
    sseRouter._clearPendingSelfUpdateAcks();
    notificationOutboxStore._resetOutboxStoreForTests();
    const state = registry.getState();
    state.trigger = {};
  });

  afterEach(() => {
    event.clearAllListenersForTests();
    sseRouter._resetInitializationStateForTests();
    sseRouter._clients.clear();
    sseRouter._activeSseClientRegistry.clear();
    sseRouter._connectionsPerIp.clear();
    sseRouter._connectionsPerSession.clear();
    sseRouter._clearPendingSelfUpdateAcks();
    notificationOutboxStore._resetOutboxStoreForTests();
  });

  test('recovers a queued compose update through keyed FIFO locks and honours mid-flight cancellation before a solo container update', async () => {
    const operationId = 'op-recovered-compose';
    const container = createContainer();
    const composeProjectKey = buildComposeProjectLockKey(container, 'stack');
    const containerKey = buildContainerLockKey(container);
    const recoveredStarted = deferred();
    const releaseRecovered = deferred();
    const triggerCompleted = deferred();
    const events: string[] = [];
    let triggerError: unknown;

    const db = createDb({
      updateOperations: [
        {
          data: {
            id: operationId,
            containerId: container.id,
            containerName: container.name,
            status: 'in-progress',
            phase: 'pulling',
            createdAt: '2026-02-23T01:00:00.000Z',
            updatedAt: '2026-02-23T01:00:00.000Z',
          },
        },
      ],
    });
    containerStore.createCollections(db);
    containerStore.insertContainer(container);
    updateOperationStore.createCollections(db);

    expect(updateOperationStore.getOperationById(operationId)).toMatchObject({
      status: 'queued',
      phase: 'queued',
      recoveredAt: expect.any(String),
    });

    registry.getState().trigger = {
      'dockercompose.local': {
        type: 'dockercompose',
        trigger: vi.fn(async (_container: Container, runtimeContext?: unknown) => {
          try {
            const requestedOperationId = (runtimeContext as { operationId?: string } | undefined)
              ?.operationId;
            if (requestedOperationId !== operationId) {
              throw new Error(`expected recovered operation ${operationId}`);
            }

            await withContainerUpdateLocks([composeProjectKey, containerKey], async () => {
              events.push('recovered-start');
              updateOperationStore.updateOperation(operationId, {
                status: 'in-progress',
                phase: 'pulling',
              });
              recoveredStarted.resolve();
              await releaseRecovered.promise;

              if (updateOperationStore.isOperationCancelRequested(operationId)) {
                events.push('recovered-cancelled');
                updateOperationStore.markOperationTerminal(operationId, {
                  status: 'failed',
                  phase: 'failed',
                  lastError: 'Cancelled by operator',
                });
                return;
              }

              updateOperationStore.markOperationTerminal(operationId, {
                status: 'succeeded',
                phase: 'succeeded',
              });
            });
          } catch (error: unknown) {
            triggerError = error;
            throw error;
          } finally {
            triggerCompleted.resolve();
          }
        }),
      } as never,
    };

    expect(recoverQueuedOperationsOnStartup()).toEqual({ resumed: 1, abandoned: 0 });
    await recoveredStarted.promise;

    const solo = withContainerUpdateLocks([containerKey], async () => {
      events.push('solo-start');
    });
    await waitForCondition(
      () =>
        getUpdateLockSnapshot().pending.some(
          (entry) => entry.key === containerKey && entry.waiters === 1,
        ),
      'solo container update to wait behind recovered compose update',
    );
    expect(events).toEqual(['recovered-start']);

    expect(updateOperationStore.requestOperationCancellation(operationId)).toMatchObject({
      outcome: 'cancel-requested',
      operation: { id: operationId, cancelRequested: true },
    });

    releaseRecovered.resolve();
    await triggerCompleted.promise;
    if (triggerError) {
      throw triggerError;
    }
    await solo;

    expect(events).toEqual(['recovered-start', 'recovered-cancelled', 'solo-start']);
    expect(updateOperationStore.getOperationById(operationId)).toMatchObject({
      status: 'failed',
      phase: 'failed',
      lastError: 'Cancelled by operator',
    });
    expect(getUpdateLockSnapshot()).toMatchObject({ held: [], pending: [] });
  });

  test('serializes two concurrent recovered compose updates that share the same lock key', async () => {
    const containers = [
      createContainer({ id: 'c-web', name: 'web' }),
      createContainer({ id: 'c-api', name: 'api' }),
    ];
    const operationIds = ['op-recovered-web', 'op-recovered-api'];
    const recoveredAt = new Date().toISOString();
    const composeProjectKey = buildComposeProjectLockKey(containers[0], 'stack');
    const releases = new Map(operationIds.map((operationId) => [operationId, deferred()]));
    const triggerCompleted = deferred();
    const events: string[] = [];
    let activeRecoveryCount = 0;
    let maxActiveRecoveryCount = 0;
    let completedCount = 0;

    const db = createDb({
      updateOperations: operationIds.map((operationId, index) => ({
        data: {
          id: operationId,
          containerId: containers[index].id,
          containerName: containers[index].name,
          status: 'queued',
          phase: 'queued',
          createdAt: recoveredAt,
          updatedAt: recoveredAt,
        },
      })),
    });
    containerStore.createCollections(db);
    containers.forEach((container) => containerStore.insertContainer(container));
    updateOperationStore.createCollections(db);

    registry.getState().trigger = {
      'dockercompose.local': {
        type: 'dockercompose',
        trigger: vi.fn(async (container: Container, runtimeContext?: unknown) => {
          const operationId = (runtimeContext as { operationId?: string } | undefined)?.operationId;
          if (!operationId || !operationIds.includes(operationId)) {
            throw new Error(`unexpected recovered operation ${operationId}`);
          }

          await withContainerUpdateLocks([composeProjectKey], async () => {
            activeRecoveryCount += 1;
            maxActiveRecoveryCount = Math.max(maxActiveRecoveryCount, activeRecoveryCount);
            events.push(`start:${operationId}:${container.name}`);
            updateOperationStore.updateOperation(operationId, {
              status: 'in-progress',
              phase: 'pulling',
            });

            await releases.get(operationId)!.promise;

            events.push(`finish:${operationId}:${container.name}`);
            updateOperationStore.markOperationTerminal(operationId, {
              status: 'succeeded',
              phase: 'succeeded',
            });
            activeRecoveryCount -= 1;
          });

          completedCount += 1;
          if (completedCount === operationIds.length) {
            triggerCompleted.resolve();
          }
        }),
      } as never,
    };

    expect(recoverQueuedOperationsOnStartup()).toEqual({ resumed: 2, abandoned: 0 });

    await waitForCondition(
      () =>
        events.length === 1 &&
        getUpdateLockSnapshot().pending.some(
          (entry) => entry.key === composeProjectKey && entry.waiters === 1,
        ),
      'second recovered compose update to wait behind the shared compose lock',
    );

    const firstOperationId = events[0].split(':')[1];
    const secondOperationId = operationIds.find((operationId) => operationId !== firstOperationId);
    expect(secondOperationId).toBeDefined();
    expect(maxActiveRecoveryCount).toBe(1);
    expect(updateOperationStore.getOperationById(secondOperationId!)).toMatchObject({
      status: 'queued',
      phase: 'queued',
    });

    releases.get(firstOperationId)!.resolve();
    await waitForCondition(
      () => events.length === 3 && events[1].startsWith(`finish:${firstOperationId}:`),
      'first recovered compose update to release the shared compose lock',
    );

    expect(events[2].startsWith(`start:${secondOperationId}:`)).toBe(true);
    expect(maxActiveRecoveryCount).toBe(1);

    releases.get(secondOperationId!)!.resolve();
    await triggerCompleted.promise;

    expect(events).toHaveLength(4);
    expect(events[3].startsWith(`finish:${secondOperationId}:`)).toBe(true);
    expect(maxActiveRecoveryCount).toBe(1);
    expect(
      operationIds.map((operationId) => updateOperationStore.getOperationById(operationId)?.status),
    ).toEqual(['succeeded', 'succeeded']);
    expect(getUpdateLockSnapshot()).toMatchObject({ held: [], pending: [] });
  });

  test('recovers an update and fans out terminal state to SSE while failed notification delivery is retried from the outbox', async () => {
    const operationId = 'op-recovered-sse-outbox';
    const container = createContainer({ id: 'c-outbox', name: 'outbox-web' });
    const operationContainerName = fullName(container);
    const recoveredAt = new Date().toISOString();
    const composeProjectKey = buildComposeProjectLockKey(container, 'stack');
    const containerKey = buildContainerLockKey(container);
    const recoveryCompleted = deferred();

    const db = createDb({
      updateOperations: [
        {
          data: {
            id: operationId,
            containerId: container.id,
            containerName: operationContainerName,
            status: 'queued',
            phase: 'queued',
            createdAt: recoveredAt,
            updatedAt: recoveredAt,
          },
        },
      ],
    });
    containerStore.createCollections(db);
    containerStore.insertContainer(container);
    updateOperationStore.createCollections(db);
    notificationOutboxStore.createCollections(db);

    const notificationTrigger = new FlakyNotificationTrigger();
    await notificationTrigger.register('trigger', 'webhook', 'ops', {
      auto: 'none',
      mode: 'simple',
    });

    const sseRes = createSseResponseSink();
    sseRouter.init();
    sseRouter._clients.add(sseRes);

    registry.getState().trigger = {
      'dockercompose.local': {
        type: 'dockercompose',
        trigger: vi.fn(async (_container: Container, runtimeContext?: unknown) => {
          const requestedOperationId = (runtimeContext as { operationId?: string } | undefined)
            ?.operationId;
          if (requestedOperationId !== operationId) {
            throw new Error(`expected recovered operation ${operationId}`);
          }

          await withContainerUpdateLocks([composeProjectKey, containerKey], async () => {
            updateOperationStore.updateOperation(operationId, {
              status: 'in-progress',
              phase: 'pulling',
            });
            updateOperationStore.markOperationTerminal(operationId, {
              status: 'succeeded',
              phase: 'succeeded',
            });
          });
          recoveryCompleted.resolve();
        }),
      } as never,
      [notificationTrigger.getId()]: notificationTrigger as never,
    };

    expect(recoverQueuedOperationsOnStartup()).toEqual({ resumed: 1, abandoned: 0 });
    await recoveryCompleted.promise;

    await waitForCondition(
      () => notificationOutboxStore.findOutboxEntriesByStatus('pending').length === 1,
      'failed notification delivery to be persisted to the outbox',
    );
    await waitForCondition(
      () => parseSseEventPayloads(sseRes, 'dd:update-applied').length === 1,
      'terminal update-applied SSE event',
    );

    const operationChangedEvents = parseSseEventPayloads(sseRes, 'dd:update-operation-changed');
    expect(operationChangedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId,
          containerId: container.id,
          containerName: operationContainerName,
          status: 'in-progress',
          phase: 'pulling',
        }),
        expect.objectContaining({
          operationId,
          containerId: container.id,
          containerName: operationContainerName,
          status: 'succeeded',
          phase: 'succeeded',
        }),
      ]),
    );
    expect(parseSseEventPayloads(sseRes, 'dd:update-applied')).toEqual([
      expect.objectContaining({
        operationId,
        containerId: container.id,
        containerName: operationContainerName,
      }),
    ]);

    const pendingOutboxEntry = notificationOutboxStore.findOutboxEntriesByStatus('pending')[0];
    expect(pendingOutboxEntry).toMatchObject({
      eventName: 'update-applied',
      triggerId: notificationTrigger.getId(),
      containerId: container.id,
      attempts: 0,
    });
    expect(notificationTrigger.attempts).toBe(1);

    const outboxWorker = new OutboxWorker({
      deliver: async (entry: NotificationOutboxEntry) => {
        const trigger = registry.getState().trigger[entry.triggerId] as
          | { dispatchOutboxEntry?: (entryToDispatch: NotificationOutboxEntry) => Promise<void> }
          | undefined;
        if (!trigger?.dispatchOutboxEntry) {
          throw new Error(`Trigger ${entry.triggerId} not registered for outbox delivery`);
        }
        await trigger.dispatchOutboxEntry(entry);
      },
      maxDrainConcurrency: 1,
      nowFn: () => new Date(Date.parse(pendingOutboxEntry.nextAttemptAt) + 1),
    });

    await outboxWorker.drain();

    expect(notificationOutboxStore.findOutboxEntriesByStatus('pending')).toEqual([]);
    expect(notificationOutboxStore.findOutboxEntriesByStatus('delivered')).toEqual([
      expect.objectContaining({
        id: pendingOutboxEntry.id,
        eventName: 'update-applied',
        triggerId: notificationTrigger.getId(),
        attempts: 1,
        status: 'delivered',
      }),
    ]);
    expect(notificationTrigger.attempts).toBe(2);
    expect(notificationTrigger.deliveredContainers).toEqual([container.name]);
    expect(getUpdateLockSnapshot()).toMatchObject({ held: [], pending: [] });
  });
});
