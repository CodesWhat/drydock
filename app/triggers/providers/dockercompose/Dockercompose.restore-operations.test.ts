import { watch } from 'node:fs';
import { emitBatchUpdateCompleted, emitContainerUpdateFailed } from '../../../event/index.js';
import { getState } from '../../../registry/index.js';
import * as updateOperationStore from '../../../store/update-operation.js';
import Dockercompose from './Dockercompose.js';
import {
  makeCompose,
  makeContainer,
  setupDockercomposeTestContext,
} from './Dockercompose.test.helpers.js';

vi.mock('../../../registry', () => ({
  getState: vi.fn(),
}));

vi.mock('../../../event/index.js', () => ({
  emitBatchUpdateCompleted: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateApplied: vi.fn().mockResolvedValue(undefined),
  emitContainerUpdateFailed: vi.fn().mockResolvedValue(undefined),
  emitSecurityAlert: vi.fn().mockResolvedValue(undefined),
  emitSelfUpdateStarting: vi.fn(),
  emitUpdateOperationChanged: vi.fn(),
}));

vi.mock('../../../model/container.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fullName: vi.fn((c) => `test_${c.name}`),
  };
});

vi.mock('../../../store/backup', () => ({
  insertBackup: vi.fn(),
  pruneOldBackups: vi.fn(),
  getBackupsByName: vi.fn().mockReturnValue([]),
  getBackupsForContainer: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../configuration/index.js', async () => {
  const actual = await vi.importActual('../../../configuration/index.js');
  return { ...actual, getSecurityConfiguration: vi.fn().mockReturnValue({ enabled: false }) };
});
vi.mock('../../../store/audit.js', () => ({ insertAudit: vi.fn() }));
vi.mock('../../../prometheus/audit.js', () => ({ getAuditCounter: vi.fn().mockReturnValue(null) }));
vi.mock('../../../security/scan.js', () => ({
  scanImageForVulnerabilities: vi.fn(),
  verifyImageSignature: vi.fn(),
  generateImageSbom: vi.fn(),
  clearDigestScanCache: vi.fn(),
  getDigestScanCacheSize: vi.fn().mockReturnValue(0),
  updateDigestScanCache: vi.fn(),
  scanImageWithDedup: vi.fn(),
}));
vi.mock('../../../store/container.js', () => ({
  getContainer: vi.fn(),
  getContainers: vi.fn().mockReturnValue([]),
  updateContainer: vi.fn(),
  cacheSecurityState: vi.fn(),
}));
vi.mock('../../hooks/HookRunner.js', () => ({ runHook: vi.fn() }));
vi.mock('../docker/HealthMonitor.js', () => ({ startHealthMonitor: vi.fn() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    watch: vi.fn(),
  };
});

vi.mock('../../../util/sleep.js', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      access: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(Buffer.from('')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    },
    access: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
  };
});

/**
 * Minimal Loki-shaped store so the update-operation collection is the real one:
 * these tests assert on the persisted operation and on the terminal lifecycle
 * event that only the real `markOperationTerminal` emits.
 */
function createUpdateOperationDb() {
  const collections = new Map<string, unknown>();
  const getByPath = (object, path: string) =>
    path.split('.').reduce((accumulator, key) => accumulator?.[key], object);
  const matchesQuery = (doc, query: Record<string, unknown> = {}) =>
    Object.entries(query).every(([key, value]) => {
      const docValue = getByPath(doc, key);
      if (value !== null && typeof value === 'object' && '$in' in (value as object)) {
        return (value as { $in: unknown[] }).$in.includes(docValue);
      }
      return docValue === value;
    });

  return {
    getCollection: (name: string) => collections.get(name) ?? null,
    addCollection: (name: string) => {
      const docs: Record<string, unknown>[] = [];
      const collection = {
        insert: (doc) => {
          doc.$loki = docs.length + 1;
          docs.push(doc);
        },
        find: (query = {}) => docs.filter((doc) => matchesQuery(doc, query)),
        findOne: (query = {}) => docs.find((doc) => matchesQuery(doc, query)) ?? null,
        remove: (doc) => {
          const index = docs.indexOf(doc);
          if (index >= 0) {
            docs.splice(index, 1);
          }
        },
        ensureIndex: () => undefined,
      };
      collections.set(name, collection);
      return collection;
    },
  };
}

describe('Dockercompose compose restore operation records', () => {
  let trigger;
  const composeFile = '/opt/drydock/test/stack.yml';
  const restoreFailureError =
    'runtime refresh failed (compose file restore failed: Failed to restore compose file ' +
    'mutations (/opt/drydock/test/stack.yml: compose restore write failed))';

  beforeEach(() => {
    ({ trigger } = setupDockercomposeTestContext({
      DockercomposeCtor: Dockercompose,
      watchMock: watch,
      getStateMock: getState,
    }));
    updateOperationStore.createCollections(createUpdateOperationDb() as never);
  });

  /**
   * A runtime refresh that fails after the compose file was mutated, with the
   * restore write failing too. `rollbackSucceeds` picks whether the container
   * rollback recovers (operation ends `rolled-back`) or fails as well
   * (operation ends `failed` / `rollback-failed`).
   */
  function arrangeRestoreFailure({ rollbackSucceeds = true } = {}) {
    trigger.configuration.dryrun = false;
    const composeFileContent = ['services:', '  nginx:', '    image: nginx:1.0.0', ''].join('\n');
    const container = makeContainer({
      id: 'nginx-1',
      name: 'nginx',
      updateAvailable: true,
      labels: { 'com.docker.compose.service': 'nginx' },
    });

    vi.spyOn(trigger, 'getComposeFile').mockResolvedValue(Buffer.from(composeFileContent));
    vi.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue(
      makeCompose({ nginx: { image: 'nginx:1.0.0' } }),
    );
    // First write is the compose mutation, second is the restore that fails.
    vi.spyOn(trigger, 'writeComposeFile')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('compose restore write failed'));
    vi.spyOn(trigger, 'pullImage').mockResolvedValue();
    vi.spyOn(trigger, 'stopContainer').mockResolvedValue();
    vi.spyOn(trigger, 'removeContainer').mockResolvedValue();
    // The replacement fails to start, then the captured spec is recreated.
    const createContainer = vi.spyOn(trigger, 'createContainer').mockResolvedValueOnce({
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    } as never);
    if (rollbackSucceeds) {
      createContainer.mockResolvedValueOnce({
        start: vi.fn().mockResolvedValue(undefined),
      } as never);
    } else {
      createContainer.mockRejectedValueOnce(new Error('rollback recreate failed'));
    }
    vi.spyOn(trigger, 'startContainer')
      .mockRejectedValueOnce(new Error('runtime refresh failed'))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(trigger, 'maybeStartAutoRollbackMonitor').mockResolvedValue();

    return { container };
  }

  function runComposeUpdate(container, operationId: string) {
    return trigger
      .processComposeFile(composeFile, [container], undefined, {
        operationIds: new Map([['nginx-1', operationId]]),
      })
      .catch((error) => error);
  }

  function insertInProgressOperation(id: string) {
    updateOperationStore.insertOperation({
      id,
      containerName: 'nginx',
      containerId: 'nginx-1',
      status: 'in-progress',
      phase: 'prepare',
      batchId: 'batch-1',
      queuePosition: 1,
      queueTotal: 1,
    } as never);
  }

  test('a failed compose restore corrects an operation already terminalized as rolled-back', async () => {
    const { container } = arrangeRestoreFailure();
    insertInProgressOperation('op-nginx');

    const thrownError = await runComposeUpdate(container, 'op-nginx');

    expect(thrownError.message).toBe(restoreFailureError);
    expect(updateOperationStore.getOperationById('op-nginx')).toMatchObject({
      status: 'failed',
      phase: 'rollback-failed',
      rollbackReason: 'compose_runtime_refresh_failed',
      lastError: restoreFailureError,
      // The correction reopens the row, which clears the batch fields unless
      // they are carried across.
      batchId: 'batch-1',
      queuePosition: 1,
      queueTotal: 1,
    });
    expect(emitContainerUpdateFailed).toHaveBeenCalledTimes(2);
    expect(vi.mocked(emitContainerUpdateFailed).mock.calls[0][0]).toMatchObject({
      phase: 'rolled-back',
      error: 'runtime refresh failed',
      batchId: 'batch-1',
    });
    expect(vi.mocked(emitContainerUpdateFailed).mock.calls[1][0]).toMatchObject({
      phase: 'rollback-failed',
      error: restoreFailureError,
      batchId: 'batch-1',
    });
    // The batch completed once, when the rollback terminalized the row. The
    // correction re-terminalizes it, which must not complete the batch again.
    expect(emitBatchUpdateCompleted).toHaveBeenCalledTimes(1);
  });

  test('an operation that already records a failed rollback is left alone', async () => {
    const { container } = arrangeRestoreFailure({ rollbackSucceeds: false });
    insertInProgressOperation('op-nginx');

    const thrownError = await runComposeUpdate(container, 'op-nginx');

    expect(thrownError.message).toBe(restoreFailureError);
    const operation = updateOperationStore.getOperationById('op-nginx');
    expect(operation).toMatchObject({ status: 'failed', phase: 'rollback-failed' });
    expect(operation?.lastError).not.toBe(restoreFailureError);
    // No second terminal event: the record already says the rollback failed.
    expect(emitContainerUpdateFailed).toHaveBeenCalledTimes(1);
  });

  test('an unknown operation id is skipped instead of throwing over the restore failure', async () => {
    const { container } = arrangeRestoreFailure();

    const thrownError = await runComposeUpdate(container, 'op-missing');

    expect(thrownError.message).toBe(restoreFailureError);
    expect(updateOperationStore.getOperationById('op-missing')).toBeUndefined();
    expect(emitContainerUpdateFailed).not.toHaveBeenCalled();
  });

  /**
   * A single-container update request carries a bare `operationId` that every
   * mapping in the compose batch resolves to, so the correction has to identify
   * the row by container rather than trust the id it was handed.
   */
  describe('under an operation id shared by every mapping', () => {
    const sharedRuntimeContext = { operationId: 'op-shared' };

    function makeReplicaMapping(id: string) {
      return {
        service: 'nginx',
        container: makeContainer({
          id,
          name: id,
          labels: { 'com.docker.compose.service': 'nginx' },
        }),
      };
    }

    function insertRolledBackOperation(overrides: Record<string, unknown>) {
      updateOperationStore.insertOperation({
        id: 'op-shared',
        containerName: 'nginx',
        containerId: 'nginx-2',
        status: 'rolled-back',
        phase: 'rolled-back',
        rollbackReason: 'compose_runtime_refresh_failed',
        lastError: 'runtime refresh failed',
        completedAt: new Date().toISOString(),
        ...overrides,
      } as never);
    }

    function correct() {
      trigger.correctRolledBackOperationsAfterComposeRestoreFailure(
        [makeReplicaMapping('nginx-1'), makeReplicaMapping('nginx-2')],
        sharedRuntimeContext,
        new Error(restoreFailureError),
      );
    }

    test('the record is matched to its own container rather than the first mapping', () => {
      // Two different operation ids for two different containers, so a match
      // that ignores container identity (first-mapping order or status alone)
      // is distinguishable from one that checks it. The first mapping's
      // operation ("op-1") is stamped with a containerId that belongs to
      // neither its own container (nginx-1) nor the container that is
      // actually corrected (nginx-2), so a container-identity-aware match
      // must leave it alone while still correcting "op-2".
      const perContainerRuntimeContext = {
        operationIds: new Map([
          ['nginx-1', 'op-1'],
          ['nginx-2', 'op-2'],
        ]),
      };
      updateOperationStore.insertOperation({
        id: 'op-1',
        containerName: 'nginx',
        containerId: 'redis-1',
        status: 'rolled-back',
        phase: 'rolled-back',
        rollbackReason: 'compose_runtime_refresh_failed',
        lastError: 'runtime refresh failed',
        completedAt: new Date().toISOString(),
      } as never);
      updateOperationStore.insertOperation({
        id: 'op-2',
        containerName: 'nginx',
        containerId: 'nginx-2',
        status: 'rolled-back',
        phase: 'rolled-back',
        rollbackReason: 'compose_runtime_refresh_failed',
        lastError: 'runtime refresh failed',
        completedAt: new Date().toISOString(),
      } as never);

      trigger.correctRolledBackOperationsAfterComposeRestoreFailure(
        [makeReplicaMapping('nginx-1'), makeReplicaMapping('nginx-2')],
        perContainerRuntimeContext,
        new Error(restoreFailureError),
      );

      expect(updateOperationStore.getOperationById('op-2')).toMatchObject({
        status: 'failed',
        phase: 'rollback-failed',
        lastError: restoreFailureError,
      });
      expect(updateOperationStore.getOperationById('op-1')).toMatchObject({
        status: 'rolled-back',
        phase: 'rolled-back',
        lastError: 'runtime refresh failed',
      });
    });

    test('a rollback this provider did not perform is left alone', () => {
      insertRolledBackOperation({ rollbackReason: 'health_check_failed' });

      correct();

      expect(updateOperationStore.getOperationById('op-shared')).toMatchObject({
        status: 'rolled-back',
        lastError: 'runtime refresh failed',
      });
      expect(emitContainerUpdateFailed).not.toHaveBeenCalled();
    });

    test('a self-update record is left alone', () => {
      insertRolledBackOperation({ kind: 'self-update' });

      correct();

      expect(updateOperationStore.getOperationById('op-shared')).toMatchObject({
        status: 'rolled-back',
        lastError: 'runtime refresh failed',
      });
    });

    test('a record for a container outside the batch is left alone', () => {
      insertRolledBackOperation({ containerId: 'redis-1' });

      correct();

      expect(updateOperationStore.getOperationById('op-shared')).toMatchObject({
        status: 'rolled-back',
        lastError: 'runtime refresh failed',
      });
    });
  });
});
