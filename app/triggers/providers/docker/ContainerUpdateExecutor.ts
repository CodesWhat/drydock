import * as updateOperationStore from '../../../store/update-operation.js';
import { OperationCancelledError } from '../../../store/update-operation.js';
import { resolveFunctionDependencies } from './dependency-constructor.js';
import { getRequestedOperationId } from './update-runtime-context.js';

type ContainerUpdateLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

type ContainerInspection = {
  Id?: string;
  State?: {
    Running?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type DockerContainerHandle = {
  inspect: () => Promise<ContainerInspection>;
  stop: () => Promise<void>;
  remove: (options?: { force?: boolean }) => Promise<void>;
  rename: (options: { name: string }) => Promise<void>;
  start: () => Promise<void>;
};

type DockerApiLike = {
  getContainer: (identifier: string) => DockerContainerHandle;
};

type ContainerSpecLike = {
  Name: string;
  Id: string;
  State: {
    Running: boolean;
    [key: string]: unknown;
  };
  HostConfig?: {
    AutoRemove?: boolean;
    [key: string]: unknown;
  };
  Config?: {
    Image?: string;
    [key: string]: unknown;
  };
  Image?: string;
  [key: string]: unknown;
};

type ContainerForUpdate = {
  id: string;
  name: string;
  image: {
    tag: {
      value: string;
    };
  };
  updateKind: {
    localValue?: string | null;
    remoteValue?: string | null;
  };
  [key: string]: unknown;
};

type ContainerUpdateContext = {
  dockerApi: DockerApiLike;
  auth: unknown;
  newImage: string;
  currentContainer: DockerContainerHandle;
  currentContainerSpec: ContainerSpecLike;
};

type PreparedContainerUpdateExecution = {
  dockerApi: DockerApiLike;
  newImage: string;
  currentContainer: DockerContainerHandle;
  currentContainerSpec: ContainerSpecLike;
  cloneRuntimeConfigOptions: unknown;
  oldName: string;
  tempName: string;
  wasRunning: boolean;
  shouldHealthGate: boolean;
  healthGateTimeoutMs?: number;
  operationId: string;
};

type ContainerUpdateAttemptState = {
  newContainer: DockerContainerHandle | undefined;
  oldContainerStopped: boolean;
  failureReason: string;
};

type RollbackTelemetryPayload = {
  container: ContainerForUpdate;
  outcome: 'success' | 'error' | 'info';
  reason: string;
  details: string;
  fromVersion?: string;
  toVersion?: string;
};

type RollbackConfig = {
  autoRollback?: boolean;
  rollbackWindow?: number;
  [key: string]: unknown;
};

type PendingContainerUpdateOperation = NonNullable<
  ReturnType<typeof updateOperationStore.getInProgressOperationByContainerName>
>;

type ContainerUpdateExecutorDependencies = {
  getConfiguration: () => { dryrun?: boolean };
  getTriggerId: () => string;
  getRollbackConfig: (container: ContainerForUpdate) => RollbackConfig;
  stopContainer: (
    container: DockerContainerHandle,
    containerName: string,
    containerId: string,
    logContainer: ContainerUpdateLogger,
  ) => Promise<void>;
  waitContainerRemoved: (
    container: DockerContainerHandle,
    containerName: string,
    containerId: string,
    logContainer: ContainerUpdateLogger,
  ) => Promise<void>;
  removeContainer: (
    container: DockerContainerHandle,
    containerName: string,
    containerId: string,
    logContainer: ContainerUpdateLogger,
  ) => Promise<void>;
  createContainer: (
    dockerApi: DockerApiLike,
    containerToCreateInspect: unknown,
    containerName: string,
    logContainer: ContainerUpdateLogger,
  ) => Promise<DockerContainerHandle>;
  startContainer: (
    container: DockerContainerHandle,
    containerName: string,
    logContainer: ContainerUpdateLogger,
  ) => Promise<void>;
  pullImage: (
    dockerApi: DockerApiLike,
    auth: unknown,
    newImage: string,
    logContainer: ContainerUpdateLogger,
  ) => Promise<void>;
  cloneContainer: (
    currentContainerSpec: ContainerSpecLike,
    newImage: string,
    cloneRuntimeConfigOptions: unknown,
  ) => unknown;
  getCloneRuntimeConfigOptions: (
    dockerApi: DockerApiLike,
    currentContainerSpec: ContainerSpecLike,
    newImage: string,
    logContainer: ContainerUpdateLogger,
  ) => Promise<unknown>;
  isContainerNotFoundError: (error: unknown) => boolean;
  recordRollbackTelemetry: (payload: RollbackTelemetryPayload) => void;
  buildRuntimeConfigCompatibilityError: (
    error: unknown,
    containerName: string,
    currentContainerSpec: ContainerSpecLike,
    targetImage: string,
    rollbackSucceeded: boolean,
  ) => Error | undefined;
  hasHealthcheckConfigured: (currentContainerSpec: ContainerSpecLike) => boolean;
  waitForContainerHealthy: (
    container: DockerContainerHandle,
    containerName: string,
    logContainer: ContainerUpdateLogger,
    timeoutMs?: number,
  ) => Promise<void>;
  scheduleDeferredReconciliation?: (
    containerName: string,
    operationId: string,
    delayMs: number,
  ) => void;
  /**
   * Persist rollback state onto the container record when an update rolls back, or clear
   * it on success. Optional — omitting it skips state persistence (e.g. in tests that
   * don't need it).
   *
   * Called with:
   *   - 'rolled-back': operation terminated as rolled-back; caller provides digest +
   *     reason/lastError from the operation.
   *   - 'succeeded': operation succeeded; caller clears any prior rollback state.
   */
  persistRollbackState?: (
    containerId: string,
    outcome: 'rolled-back' | 'succeeded',
    rollbackInfo?: { reason: string; lastError: string },
  ) => void;
};

type ContainerUpdateExecutorConstructorOptions = Omit<
  ContainerUpdateExecutorDependencies,
  'getConfiguration'
> & {
  getConfiguration?: ContainerUpdateExecutorDependencies['getConfiguration'];
};

const DEFAULT_HEALTH_GATE_TIMEOUT_MS = 120_000;

const REQUIRED_CONTAINER_UPDATE_EXECUTOR_DEPENDENCY_KEYS = [
  'getTriggerId',
  'getRollbackConfig',
  'stopContainer',
  'waitContainerRemoved',
  'removeContainer',
  'createContainer',
  'startContainer',
  'pullImage',
  'cloneContainer',
  'getCloneRuntimeConfigOptions',
  'isContainerNotFoundError',
  'recordRollbackTelemetry',
  'buildRuntimeConfigCompatibilityError',
  'hasHealthcheckConfigured',
  'waitForContainerHealthy',
] as const;

type ErrorWithMessage = {
  message?: unknown;
};

function hasMessage(error: unknown): error is ErrorWithMessage {
  return (
    (typeof error === 'object' || typeof error === 'function') &&
    error !== null &&
    'message' in error
  );
}

function getErrorMessage(error: unknown): string {
  if (hasMessage(error)) {
    return String(error.message ?? error);
  }
  return String(error);
}

const DEFERRED_RECONCILIATION_DELAY_MS = 10_000;

function isConnectionError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('connect etimedout')
  );
}

function getHealthGateTimeoutMs(rollbackConfig: RollbackConfig): number {
  return Number.isFinite(rollbackConfig.rollbackWindow) && rollbackConfig.rollbackWindow > 0
    ? rollbackConfig.rollbackWindow
    : DEFAULT_HEALTH_GATE_TIMEOUT_MS;
}

class ContainerUpdateExecutor {
  getConfiguration: ContainerUpdateExecutorDependencies['getConfiguration'];

  getTriggerId: ContainerUpdateExecutorDependencies['getTriggerId'];

  getRollbackConfig: ContainerUpdateExecutorDependencies['getRollbackConfig'];

  stopContainer: ContainerUpdateExecutorDependencies['stopContainer'];

  waitContainerRemoved: ContainerUpdateExecutorDependencies['waitContainerRemoved'];

  removeContainer: ContainerUpdateExecutorDependencies['removeContainer'];

  createContainer: ContainerUpdateExecutorDependencies['createContainer'];

  startContainer: ContainerUpdateExecutorDependencies['startContainer'];

  pullImage: ContainerUpdateExecutorDependencies['pullImage'];

  cloneContainer: ContainerUpdateExecutorDependencies['cloneContainer'];

  getCloneRuntimeConfigOptions: ContainerUpdateExecutorDependencies['getCloneRuntimeConfigOptions'];

  isContainerNotFoundError: ContainerUpdateExecutorDependencies['isContainerNotFoundError'];

  recordRollbackTelemetry: ContainerUpdateExecutorDependencies['recordRollbackTelemetry'];

  buildRuntimeConfigCompatibilityError: ContainerUpdateExecutorDependencies['buildRuntimeConfigCompatibilityError'];

  hasHealthcheckConfigured: ContainerUpdateExecutorDependencies['hasHealthcheckConfigured'];

  waitForContainerHealthy: ContainerUpdateExecutorDependencies['waitForContainerHealthy'];

  scheduleDeferredReconciliation?: ContainerUpdateExecutorDependencies['scheduleDeferredReconciliation'];

  persistRollbackState?: ContainerUpdateExecutorDependencies['persistRollbackState'];

  constructor(options: ContainerUpdateExecutorConstructorOptions) {
    const dependencies = resolveFunctionDependencies<ContainerUpdateExecutorDependencies>(options, {
      requiredKeys: REQUIRED_CONTAINER_UPDATE_EXECUTOR_DEPENDENCY_KEYS,
      defaults: {
        getConfiguration: () => ({}),
      },
      componentName: 'ContainerUpdateExecutor',
    });
    Object.assign(this, dependencies);
  }

  async inspectContainerByIdentifier(
    dockerApi: DockerApiLike,
    identifier: string | undefined,
    logContainer?: ContainerUpdateLogger,
  ) {
    if (!identifier) {
      return undefined;
    }
    try {
      const container = dockerApi.getContainer(identifier);
      const inspection = await container.inspect();
      return { container, inspection };
    } catch (e: unknown) {
      if (!this.isContainerNotFoundError(e)) {
        logContainer?.warn(
          `Unable to inspect container ${identifier} during recovery (${getErrorMessage(e)})`,
        );
      }
      return undefined;
    }
  }

  async stopAndRemoveContainerBestEffort(
    dockerApi: DockerApiLike,
    identifier: string,
    logContainer: ContainerUpdateLogger,
  ) {
    const inspected = await this.inspectContainerByIdentifier(dockerApi, identifier, logContainer);
    if (!inspected) {
      return false;
    }
    try {
      if (inspected.inspection?.State?.Running) {
        await inspected.container.stop();
      }
    } catch (e: unknown) {
      logContainer.warn(
        `Failed to stop stale container ${identifier} during recovery (${getErrorMessage(e)})`,
      );
    }
    try {
      await inspected.container.remove({ force: true });
      return true;
    } catch (e: unknown) {
      logContainer.warn(
        `Failed to remove stale container ${identifier} during recovery (${getErrorMessage(e)})`,
      );
      return false;
    }
  }

  async reconcileInProgressContainerUpdateOperation(
    dockerApi: DockerApiLike,
    container: ContainerForUpdate,
    logContainer: ContainerUpdateLogger,
  ) {
    const pending = updateOperationStore.getInProgressOperationByContainerName(container.name);
    if (!pending) {
      return;
    }

    logContainer.warn(
      `Found in-progress update operation ${pending.id} for ${container.name}; attempting recovery`,
    );

    const activeByOriginalName = await this.inspectContainerByIdentifier(
      dockerApi,
      pending.oldName,
      logContainer,
    );
    const tempByRenamedName = await this.inspectContainerByIdentifier(
      dockerApi,
      pending.tempName,
      logContainer,
    );

    if (activeByOriginalName && tempByRenamedName) {
      await this.reconcileWithActiveAndTempContainers(dockerApi, pending, container, logContainer);
      return;
    }

    if (tempByRenamedName) {
      await this.reconcileWithTempContainerOnly(
        dockerApi,
        pending,
        container,
        tempByRenamedName.container,
      );
      return;
    }

    if (activeByOriginalName) {
      this.reconcileWithActiveContainerOnly(pending, container);
      return;
    }

    this.reconcileWithMissingContainers(pending, container);
  }

  private async reconcileWithActiveAndTempContainers(
    dockerApi: DockerApiLike,
    pending: PendingContainerUpdateOperation,
    container: ContainerForUpdate,
    logContainer: ContainerUpdateLogger,
  ): Promise<void> {
    const removedTemp = await this.stopAndRemoveContainerBestEffort(
      dockerApi,
      pending.tempName,
      logContainer,
    );

    updateOperationStore.markOperationTerminal(pending.id, {
      status: 'succeeded',
      phase: 'recovered-cleanup-temp',
      recoveredAt: new Date().toISOString(),
    });
    this.recordRollbackTelemetry({
      container,
      outcome: 'info',
      reason: 'startup_reconcile_cleanup_temp',
      details: removedTemp
        ? `Recovered stale renamed container ${pending.tempName}`
        : `Detected stale renamed container ${pending.tempName}, cleanup incomplete`,
      fromVersion: pending.fromVersion,
      toVersion: pending.toVersion,
    });
  }

  private async reconcileWithTempContainerOnly(
    dockerApi: DockerApiLike,
    pending: PendingContainerUpdateOperation,
    container: ContainerForUpdate,
    tempContainer: DockerContainerHandle,
  ): Promise<void> {
    let recoveryError: unknown;
    try {
      await tempContainer.rename({ name: pending.oldName });
      if (pending.oldContainerWasRunning && pending.oldContainerStopped) {
        const restored = dockerApi.getContainer(pending.oldName);
        await restored.start();
      }
    } catch (e: unknown) {
      recoveryError = e;
    }

    const recovered = !recoveryError;
    if (recovered) {
      updateOperationStore.markOperationTerminal(pending.id, {
        status: 'rolled-back',
        phase: 'recovered-rollback',
        recoveredAt: new Date().toISOString(),
      });
      this.persistRollbackState?.(container.id, 'rolled-back', {
        reason: pending.rollbackReason ?? '',
        lastError: pending.lastError ?? '',
      });
    } else {
      updateOperationStore.markOperationTerminal(pending.id, {
        status: 'failed',
        phase: 'recovery-failed',
        lastError: getErrorMessage(recoveryError),
        recoveredAt: new Date().toISOString(),
      });
    }
    this.recordRollbackTelemetry({
      container,
      outcome: recovered ? 'success' : 'error',
      reason: recovered ? 'startup_reconcile_restore_old' : 'startup_reconcile_restore_failed',
      details: recovered
        ? `Recovered interrupted update by restoring container name ${pending.oldName}`
        : `Failed to recover interrupted update: ${getErrorMessage(recoveryError)}`,
      fromVersion: pending.fromVersion,
      toVersion: pending.toVersion,
    });
  }

  private reconcileWithActiveContainerOnly(
    pending: PendingContainerUpdateOperation,
    container: ContainerForUpdate,
  ): void {
    updateOperationStore.markOperationTerminal(pending.id, {
      status: 'succeeded',
      phase: 'recovered-active',
      recoveredAt: new Date().toISOString(),
    });
    this.recordRollbackTelemetry({
      container,
      outcome: 'info',
      reason: 'startup_reconcile_active_only',
      details: `Recovered interrupted update operation ${pending.id} with active container ${pending.oldName}`,
      fromVersion: pending.fromVersion,
      toVersion: pending.toVersion,
    });
  }

  private reconcileWithMissingContainers(
    pending: PendingContainerUpdateOperation,
    container: ContainerForUpdate,
  ): void {
    updateOperationStore.markOperationTerminal(pending.id, {
      status: 'failed',
      phase: 'recovery-missing-containers',
      lastError: 'No active or temporary container found during update-operation recovery',
      recoveredAt: new Date().toISOString(),
    });
    this.recordRollbackTelemetry({
      container,
      outcome: 'error',
      reason: 'startup_reconcile_missing_containers',
      details: `Failed to recover interrupted update operation ${pending.id}: no containers found`,
      fromVersion: pending.fromVersion,
      toVersion: pending.toVersion,
    });
  }

  async execute(
    context: ContainerUpdateContext,
    container: ContainerForUpdate,
    logContainer: ContainerUpdateLogger,
    runtimeContext?: unknown,
    postPullHook?: (operationId: string) => Promise<void>,
  ) {
    const preparedExecution = await this.prepareContainerUpdateExecution(
      context,
      container,
      logContainer,
      runtimeContext,
      postPullHook,
    );
    if (!preparedExecution) {
      return false;
    }

    const attemptState: ContainerUpdateAttemptState = {
      newContainer: undefined,
      oldContainerStopped: false,
      failureReason: 'update_runtime_failed',
    };

    try {
      attemptState.newContainer = await this.createAndStartReplacementContainer(
        preparedExecution,
        logContainer,
        attemptState,
      );
      await this.cleanupRenamedContainer(preparedExecution, logContainer, attemptState);
      this.markOperationSucceeded(preparedExecution.operationId);
      this.persistRollbackState?.(container.id, 'succeeded');
      return true;
    } catch (e: unknown) {
      return this.rollbackFailedContainerUpdate(
        e,
        preparedExecution,
        attemptState,
        container,
        logContainer,
      );
    }
  }

  private async prepareContainerUpdateExecution(
    context: ContainerUpdateContext,
    container: ContainerForUpdate,
    logContainer: ContainerUpdateLogger,
    runtimeContext?: unknown,
    postPullHook?: (operationId: string) => Promise<void>,
  ): Promise<PreparedContainerUpdateExecution | undefined> {
    const { dockerApi, auth, newImage, currentContainer, currentContainerSpec } = context;
    const configuration = this.getConfiguration();
    const requestedOperationId = getRequestedOperationId(container, runtimeContext);

    await this.reconcileInProgressContainerUpdateOperation(dockerApi, container, logContainer);

    const oldName = currentContainerSpec.Name.replace(/^\//, '');
    const tempName = `${oldName}-old-${Date.now()}`;
    const wasRunning = currentContainerSpec.State.Running;
    const rollbackConfig = this.getRollbackConfig(container);
    const shouldHealthGate = wasRunning && this.hasHealthcheckConfigured(currentContainerSpec);
    const healthGateTimeoutMs = shouldHealthGate
      ? getHealthGateTimeoutMs(rollbackConfig)
      : undefined;

    const operationFields = {
      containerId: container.id,
      containerName: container.name,
      triggerName: this.getTriggerId(),
      oldContainerId: currentContainerSpec.Id,
      oldName,
      tempName,
      oldContainerWasRunning: wasRunning,
      oldContainerStopped: false,
      fromVersion: container.updateKind.localValue ?? container.image.tag.value,
      toVersion: container.updateKind.remoteValue ?? container.image.tag.value,
      targetImage: newImage,
      status: 'in-progress' as const,
      phase: 'pulling' as const,
    };

    // If an operation was pre-created by the API handler, always reuse that row
    // so the original operationId stays stable even if queued TTL expiry
    // already transitioned it to a terminal state before execution begins.
    const existingOperation = requestedOperationId
      ? updateOperationStore.getOperationById(requestedOperationId)
      : undefined;
    const operation = existingOperation
      ? existingOperation.status === 'queued' || existingOperation.status === 'in-progress'
        ? updateOperationStore.updateOperation(requestedOperationId!, {
            ...operationFields,
            lastError: undefined,
            rollbackReason: undefined,
            newContainerId: undefined,
            completedAt: undefined,
          })!
        : updateOperationStore.reopenTerminalOperation(requestedOperationId!, {
            ...operationFields,
          })!
      : updateOperationStore.insertOperation({
          ...(requestedOperationId ? { id: requestedOperationId } : {}),
          ...operationFields,
        });

    try {
      await this.pullImage(dockerApi, auth, newImage, logContainer);
    } catch (pullError: unknown) {
      updateOperationStore.markOperationTerminal(operation.id, {
        status: 'failed',
        phase: 'pull-failed',
        lastError: getErrorMessage(pullError),
      });
      throw pullError;
    }

    if (postPullHook) {
      try {
        await postPullHook(operation.id);
      } catch (hookError: unknown) {
        updateOperationStore.markOperationTerminal(operation.id, {
          status: 'failed',
          phase: 'failed',
          lastError: getErrorMessage(hookError),
        });
        throw hookError;
      }
    }

    if (configuration.dryrun) {
      logContainer.info('Do not replace the existing container because dry-run mode is enabled');
      updateOperationStore.markOperationTerminal(operation.id, {
        status: 'succeeded',
        phase: 'dryrun',
      });
      return undefined;
    }

    if (updateOperationStore.isOperationCancelRequested(operation.id)) {
      logContainer.info(
        `Cancellation requested for ${oldName} before rename; aborting cleanly without rollback`,
      );
      updateOperationStore.markOperationTerminal(operation.id, {
        status: 'failed',
        phase: 'failed',
        lastError: 'Cancelled by operator',
      });
      return undefined;
    }

    const cloneRuntimeConfigOptions = await this.getCloneRuntimeConfigOptions(
      dockerApi,
      currentContainerSpec,
      newImage,
      logContainer,
    );

    updateOperationStore.updateOperation(operation.id, { phase: 'prepare' });

    logContainer.info(`Rename container ${oldName} to ${tempName}`);
    await currentContainer.rename({ name: tempName });
    updateOperationStore.updateOperation(operation.id, { phase: 'renamed' });

    return {
      dockerApi,
      newImage,
      currentContainer,
      currentContainerSpec,
      cloneRuntimeConfigOptions,
      oldName,
      tempName,
      wasRunning,
      shouldHealthGate,
      healthGateTimeoutMs,
      operationId: operation.id,
    };
  }

  private throwIfCancelled(operationId: string) {
    if (updateOperationStore.isOperationCancelRequested(operationId)) {
      throw new OperationCancelledError(operationId);
    }
  }

  private async createAndStartReplacementContainer(
    preparedExecution: PreparedContainerUpdateExecution,
    logContainer: ContainerUpdateLogger,
    attemptState: ContainerUpdateAttemptState,
  ): Promise<DockerContainerHandle> {
    this.throwIfCancelled(preparedExecution.operationId);
    attemptState.failureReason = 'create_new_failed';
    const containerToCreateInspect = this.cloneContainer(
      preparedExecution.currentContainerSpec,
      preparedExecution.newImage,
      preparedExecution.cloneRuntimeConfigOptions,
    );

    const newContainer = await this.createContainer(
      preparedExecution.dockerApi,
      containerToCreateInspect,
      preparedExecution.oldName,
      logContainer,
    );
    attemptState.newContainer = newContainer;

    const newContainerId = await this.getContainerIdBestEffort(
      newContainer,
      preparedExecution.oldName,
      logContainer,
    );
    updateOperationStore.updateOperation(preparedExecution.operationId, {
      phase: 'new-created',
      newContainerId,
    });

    if (preparedExecution.wasRunning) {
      await this.runReplacementContainerTransition(
        preparedExecution,
        newContainer,
        logContainer,
        attemptState,
      );
    }

    return newContainer;
  }

  private async getContainerIdBestEffort(
    container: DockerContainerHandle,
    containerName: string,
    logContainer: ContainerUpdateLogger,
  ) {
    try {
      return (await container.inspect())?.Id;
    } catch (inspectError: unknown) {
      logContainer.warn(
        `Unable to inspect candidate container ${containerName} after creation (${getErrorMessage(
          inspectError,
        )})`,
      );
      return undefined;
    }
  }

  private async runReplacementContainerTransition(
    preparedExecution: PreparedContainerUpdateExecution,
    newContainer: DockerContainerHandle,
    logContainer: ContainerUpdateLogger,
    attemptState: ContainerUpdateAttemptState,
  ) {
    this.throwIfCancelled(preparedExecution.operationId);
    attemptState.failureReason = 'stop_old_failed';
    await this.stopContainer(
      preparedExecution.currentContainer,
      preparedExecution.tempName,
      preparedExecution.currentContainerSpec.Id,
      logContainer,
    );
    attemptState.oldContainerStopped = true;
    updateOperationStore.updateOperation(preparedExecution.operationId, {
      phase: 'old-stopped',
      oldContainerStopped: true,
    });

    attemptState.failureReason = 'start_new_failed';
    await this.startContainer(newContainer, preparedExecution.oldName, logContainer);
    updateOperationStore.updateOperation(preparedExecution.operationId, { phase: 'new-started' });

    if (!preparedExecution.shouldHealthGate) {
      return;
    }

    attemptState.failureReason = 'health_gate_failed';
    updateOperationStore.updateOperation(preparedExecution.operationId, { phase: 'health-gate' });
    await this.waitForContainerHealthy(
      newContainer,
      preparedExecution.oldName,
      logContainer,
      preparedExecution.healthGateTimeoutMs,
    );
    updateOperationStore.updateOperation(preparedExecution.operationId, {
      phase: 'health-gate-passed',
    });
  }

  private async cleanupRenamedContainer(
    preparedExecution: PreparedContainerUpdateExecution,
    logContainer: ContainerUpdateLogger,
    attemptState: ContainerUpdateAttemptState,
  ) {
    attemptState.failureReason = 'cleanup_old_failed';
    try {
      if (
        preparedExecution.currentContainerSpec.HostConfig?.AutoRemove === true &&
        preparedExecution.wasRunning
      ) {
        await this.waitContainerRemoved(
          preparedExecution.currentContainer,
          preparedExecution.tempName,
          preparedExecution.currentContainerSpec.Id,
          logContainer,
        );
      } else {
        await this.removeContainer(
          preparedExecution.currentContainer,
          preparedExecution.tempName,
          preparedExecution.currentContainerSpec.Id,
          logContainer,
        );
      }
    } catch (cleanupError: unknown) {
      if (!this.isContainerNotFoundError(cleanupError)) {
        throw cleanupError;
      }
      logContainer.info(
        `Container ${preparedExecution.tempName} with id ${preparedExecution.currentContainerSpec.Id} was already removed during cleanup`,
      );
    }
  }

  private markOperationSucceeded(operationId: string) {
    updateOperationStore.markOperationTerminal(operationId, {
      status: 'succeeded',
      phase: 'succeeded',
    });
  }

  private async rollbackFailedContainerUpdate(
    error: unknown,
    preparedExecution: PreparedContainerUpdateExecution,
    attemptState: ContainerUpdateAttemptState,
    container: ContainerForUpdate,
    logContainer: ContainerUpdateLogger,
  ): Promise<never> {
    if (error instanceof OperationCancelledError) {
      attemptState.failureReason = 'cancelled';
    }
    logContainer.warn(
      `Container update failed for ${preparedExecution.oldName}, attempting rollback (${getErrorMessage(error)})`,
    );
    updateOperationStore.updateOperation(preparedExecution.operationId, {
      phase: 'rollback-started',
      lastError: getErrorMessage(error),
    });

    await this.cleanupNewContainerBestEffort(
      attemptState.newContainer,
      preparedExecution.oldName,
      logContainer,
    );

    const rollbackSucceeded = await this.restoreOriginalContainerState(
      preparedExecution,
      attemptState.oldContainerStopped,
      logContainer,
    );

    const shouldDeferReconciliation =
      !rollbackSucceeded && isConnectionError(error) && this.scheduleDeferredReconciliation;

    if (shouldDeferReconciliation) {
      updateOperationStore.updateOperation(preparedExecution.operationId, {
        status: 'in-progress',
        phase: 'rollback-deferred',
        oldContainerStopped: attemptState.oldContainerStopped,
        rollbackReason: attemptState.failureReason,
        lastError: getErrorMessage(error),
      });
      this.scheduleDeferredReconciliation(
        preparedExecution.oldName,
        preparedExecution.operationId,
        DEFERRED_RECONCILIATION_DELAY_MS,
      );
    } else if (rollbackSucceeded) {
      updateOperationStore.markOperationTerminal(preparedExecution.operationId, {
        status: 'rolled-back',
        phase: 'rolled-back',
        oldContainerStopped: attemptState.oldContainerStopped,
        rollbackReason: attemptState.failureReason,
        lastError: getErrorMessage(error),
      });
      this.persistRollbackState?.(container.id, 'rolled-back', {
        reason: attemptState.failureReason,
        lastError: getErrorMessage(error),
      });
    } else {
      updateOperationStore.markOperationTerminal(preparedExecution.operationId, {
        status: 'failed',
        phase: 'rollback-failed',
        oldContainerStopped: attemptState.oldContainerStopped,
        rollbackReason: attemptState.failureReason,
        lastError: getErrorMessage(error),
      });
    }

    this.recordRollbackTelemetry({
      container,
      outcome: rollbackSucceeded ? 'success' : 'error',
      reason: rollbackSucceeded
        ? attemptState.failureReason
        : shouldDeferReconciliation
          ? `${attemptState.failureReason}_rollback_deferred`
          : `${attemptState.failureReason}_rollback_failed`,
      details: rollbackSucceeded
        ? `Rollback completed after ${attemptState.failureReason} during container update`
        : shouldDeferReconciliation
          ? `Rollback deferred after ${attemptState.failureReason}: Docker API unavailable, scheduled reconciliation in ${DEFERRED_RECONCILIATION_DELAY_MS}ms`
          : `Rollback failed after ${attemptState.failureReason}: ${getErrorMessage(error)}`,
      fromVersion: container.updateKind.remoteValue ?? container.image.tag.value,
      toVersion: container.updateKind.localValue ?? container.image.tag.value,
    });

    const compatibilityError = this.buildRuntimeConfigCompatibilityError(
      error,
      preparedExecution.oldName,
      preparedExecution.currentContainerSpec,
      preparedExecution.newImage,
      rollbackSucceeded,
    );
    if (compatibilityError) {
      throw compatibilityError;
    }

    throw error;
  }

  private async cleanupNewContainerBestEffort(
    newContainer: DockerContainerHandle | undefined,
    containerName: string,
    logContainer: ContainerUpdateLogger,
  ) {
    if (!newContainer) {
      return;
    }
    try {
      await newContainer.stop();
    } catch (stopError: unknown) {
      logContainer.warn(
        `Unable to stop failed candidate container ${containerName} during rollback (${getErrorMessage(
          stopError,
        )})`,
      );
    }
    try {
      await newContainer.remove({ force: true });
    } catch (removeError: unknown) {
      logContainer.warn(
        `Unable to remove failed candidate container ${containerName} during rollback (${getErrorMessage(
          removeError,
        )})`,
      );
    }
  }

  private async restoreOriginalContainerState(
    preparedExecution: PreparedContainerUpdateExecution,
    oldContainerStopped: boolean,
    logContainer: ContainerUpdateLogger,
  ): Promise<boolean> {
    let rollbackSucceeded = true;
    let restoreName = preparedExecution.tempName;

    try {
      await preparedExecution.currentContainer.rename({ name: preparedExecution.oldName });
      restoreName = preparedExecution.oldName;
    } catch (renameError: unknown) {
      rollbackSucceeded = false;
      logContainer.warn(
        `Rollback failed to restore container name from ${preparedExecution.tempName} to ${preparedExecution.oldName} (${getErrorMessage(renameError)})`,
      );
    }

    if (preparedExecution.wasRunning && oldContainerStopped) {
      try {
        await this.startContainer(preparedExecution.currentContainer, restoreName, logContainer);
      } catch (restartError: unknown) {
        rollbackSucceeded = false;
        logContainer.warn(
          `Rollback failed to restart previous container ${restoreName} (${getErrorMessage(restartError)})`,
        );
      }
    }

    return rollbackSucceeded;
  }
}

export default ContainerUpdateExecutor;
