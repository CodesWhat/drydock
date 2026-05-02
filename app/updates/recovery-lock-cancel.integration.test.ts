import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Container } from '../model/container.js';
import * as registry from '../registry/index.js';
import * as containerStore from '../store/container.js';
import * as updateOperationStore from '../store/update-operation.js';
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

function matchesQuery(document: unknown, query: Record<string, unknown> = {}): boolean {
  return Object.entries(query).every(([key, value]) => getByPath(document, key) === value);
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

describe('startup recovery lock and cancel integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const state = registry.getState();
    state.trigger = {};
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
});
