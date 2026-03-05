import * as updateOperationStore from '../../../store/update-operation.js';

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

type ContainerUpdateExecutorDependencies = {
  getConfiguration: () => { dryrun?: boolean };
  getTriggerId: () => string;
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
  recordRollbackTelemetry: (
    container: ContainerForUpdate,
    status: 'success' | 'error' | 'info',
    reason: string,
    message: string,
    fromVersion: string,
    toVersion: string,
  ) => void;
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
  ) => Promise<void>;
};

type ContainerUpdateExecutorConstructorOptions = Omit<
  ContainerUpdateExecutorDependencies,
  'getConfiguration'
> & {
  getConfiguration?: ContainerUpdateExecutorDependencies['getConfiguration'];
};

const REQUIRED_CONTAINER_UPDATE_EXECUTOR_DEPENDENCY_KEYS = [
  'getTriggerId',
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

function assertRequiredDependencies(
  options: Partial<ContainerUpdateExecutorDependencies>,
): asserts options is ContainerUpdateExecutorConstructorOptions {
  for (const key of REQUIRED_CONTAINER_UPDATE_EXECUTOR_DEPENDENCY_KEYS) {
    if (typeof options[key] !== 'function') {
      throw new TypeError(`ContainerUpdateExecutor requires dependency "${key}"`);
    }
  }
}

function getErrorMessage(error: unknown): string {
  return String((error as Error)?.message ?? error);
}

class ContainerUpdateExecutor {
  getConfiguration: ContainerUpdateExecutorDependencies['getConfiguration'];

  getTriggerId: ContainerUpdateExecutorDependencies['getTriggerId'];

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

  constructor(options: ContainerUpdateExecutorConstructorOptions) {
    assertRequiredDependencies(options);
    this.getConfiguration = options.getConfiguration || (() => ({}));
    this.getTriggerId = options.getTriggerId;
    this.stopContainer = options.stopContainer;
    this.waitContainerRemoved = options.waitContainerRemoved;
    this.removeContainer = options.removeContainer;
    this.createContainer = options.createContainer;
    this.startContainer = options.startContainer;
    this.pullImage = options.pullImage;
    this.cloneContainer = options.cloneContainer;
    this.getCloneRuntimeConfigOptions = options.getCloneRuntimeConfigOptions;
    this.isContainerNotFoundError = options.isContainerNotFoundError;
    this.recordRollbackTelemetry = options.recordRollbackTelemetry;
    this.buildRuntimeConfigCompatibilityError = options.buildRuntimeConfigCompatibilityError;
    this.hasHealthcheckConfigured = options.hasHealthcheckConfigured;
    this.waitForContainerHealthy = options.waitForContainerHealthy;
  }

  async inspectContainerByIdentifier(dockerApi: DockerApiLike, identifier: string | undefined) {
    if (!identifier) {
      return undefined;
    }
    try {
      const container = dockerApi.getContainer(identifier);
      const inspection = await container.inspect();
      return { container, inspection };
    } catch {
      return undefined;
    }
  }

  async stopAndRemoveContainerBestEffort(
    dockerApi: DockerApiLike,
    identifier: string,
    logContainer: ContainerUpdateLogger,
  ) {
    const inspected = await this.inspectContainerByIdentifier(dockerApi, identifier);
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
    );
    const tempByRenamedName = await this.inspectContainerByIdentifier(dockerApi, pending.tempName);

    if (activeByOriginalName && tempByRenamedName) {
      const removedTemp = await this.stopAndRemoveContainerBestEffort(
        dockerApi,
        pending.tempName,
        logContainer,
      );
      updateOperationStore.updateOperation(pending.id, {
        status: 'succeeded',
        phase: 'recovered-cleanup-temp',
        recoveredAt: new Date().toISOString(),
      });
      this.recordRollbackTelemetry(
        container,
        'info',
        'startup_reconcile_cleanup_temp',
        removedTemp
          ? `Recovered stale renamed container ${pending.tempName}`
          : `Detected stale renamed container ${pending.tempName}, cleanup incomplete`,
        pending.fromVersion,
        pending.toVersion,
      );
      return;
    }

    if (!activeByOriginalName && tempByRenamedName) {
      let recoveryError: unknown;
      try {
        await tempByRenamedName.container.rename({ name: pending.oldName });
        if (pending.oldContainerWasRunning && pending.oldContainerStopped) {
          const restored = dockerApi.getContainer(pending.oldName);
          await restored.start();
        }
      } catch (e: unknown) {
        recoveryError = e;
      }

      const recovered = !recoveryError;
      updateOperationStore.updateOperation(pending.id, {
        status: recovered ? 'rolled-back' : 'failed',
        phase: recovered ? 'recovered-rollback' : 'recovery-failed',
        lastError: recoveryError ? getErrorMessage(recoveryError) : undefined,
        recoveredAt: new Date().toISOString(),
      });
      this.recordRollbackTelemetry(
        container,
        recovered ? 'success' : 'error',
        recovered ? 'startup_reconcile_restore_old' : 'startup_reconcile_restore_failed',
        recovered
          ? `Recovered interrupted update by restoring container name ${pending.oldName}`
          : `Failed to recover interrupted update: ${getErrorMessage(recoveryError)}`,
        pending.fromVersion,
        pending.toVersion,
      );
      return;
    }

    if (activeByOriginalName && !tempByRenamedName) {
      updateOperationStore.updateOperation(pending.id, {
        status: 'succeeded',
        phase: 'recovered-active',
        recoveredAt: new Date().toISOString(),
      });
      this.recordRollbackTelemetry(
        container,
        'info',
        'startup_reconcile_active_only',
        `Recovered interrupted update operation ${pending.id} with active container ${pending.oldName}`,
        pending.fromVersion,
        pending.toVersion,
      );
      return;
    }

    updateOperationStore.updateOperation(pending.id, {
      status: 'failed',
      phase: 'recovery-missing-containers',
      lastError: 'No active or temporary container found during update-operation recovery',
      recoveredAt: new Date().toISOString(),
    });
    this.recordRollbackTelemetry(
      container,
      'error',
      'startup_reconcile_missing_containers',
      `Failed to recover interrupted update operation ${pending.id}: no containers found`,
      pending.fromVersion,
      pending.toVersion,
    );
  }

  async execute(
    context: ContainerUpdateContext,
    container: ContainerForUpdate,
    logContainer: ContainerUpdateLogger,
  ) {
    const { dockerApi, auth, newImage, currentContainer, currentContainerSpec } = context;
    const configuration = this.getConfiguration();

    await this.reconcileInProgressContainerUpdateOperation(dockerApi, container, logContainer);
    await this.pullImage(dockerApi, auth, newImage, logContainer);

    if (configuration.dryrun) {
      logContainer.info('Do not replace the existing container because dry-run mode is enabled');
      return false;
    }

    const cloneRuntimeConfigOptions = await this.getCloneRuntimeConfigOptions(
      dockerApi,
      currentContainerSpec,
      newImage,
      logContainer,
    );

    const oldName = currentContainerSpec.Name.replace(/^\//, '');
    const tempName = `${oldName}-old-${Date.now()}`;
    const wasRunning = currentContainerSpec.State.Running;
    const shouldHealthGate = wasRunning && this.hasHealthcheckConfigured(currentContainerSpec);

    const operation = updateOperationStore.insertOperation({
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
      status: 'in-progress',
      phase: 'prepare',
    });

    logContainer.info(`Rename container ${oldName} to ${tempName}`);
    await currentContainer.rename({ name: tempName });
    updateOperationStore.updateOperation(operation.id, { phase: 'renamed' });

    let newContainer: DockerContainerHandle | undefined;
    let oldContainerStopped = false;
    let failureReason = 'update_runtime_failed';

    try {
      failureReason = 'create_new_failed';
      const containerToCreateInspect = this.cloneContainer(
        currentContainerSpec,
        newImage,
        cloneRuntimeConfigOptions,
      );
      newContainer = await this.createContainer(
        dockerApi,
        containerToCreateInspect,
        oldName,
        logContainer,
      );

      let newContainerId: string | undefined;
      try {
        newContainerId = (await newContainer.inspect())?.Id;
      } catch {
        newContainerId = undefined;
      }
      updateOperationStore.updateOperation(operation.id, {
        phase: 'new-created',
        newContainerId,
      });

      if (wasRunning) {
        failureReason = 'stop_old_failed';
        await this.stopContainer(currentContainer, tempName, currentContainerSpec.Id, logContainer);
        oldContainerStopped = true;
        updateOperationStore.updateOperation(operation.id, {
          phase: 'old-stopped',
          oldContainerStopped: true,
        });

        failureReason = 'start_new_failed';
        await this.startContainer(newContainer, oldName, logContainer);
        updateOperationStore.updateOperation(operation.id, { phase: 'new-started' });

        if (shouldHealthGate) {
          failureReason = 'health_gate_failed';
          updateOperationStore.updateOperation(operation.id, { phase: 'health-gate' });
          await this.waitForContainerHealthy(newContainer, oldName, logContainer);
          updateOperationStore.updateOperation(operation.id, { phase: 'health-gate-passed' });
        }
      }

      failureReason = 'cleanup_old_failed';
      try {
        if (currentContainerSpec.HostConfig?.AutoRemove === true && wasRunning) {
          await this.waitContainerRemoved(
            currentContainer,
            tempName,
            currentContainerSpec.Id,
            logContainer,
          );
        } else {
          await this.removeContainer(
            currentContainer,
            tempName,
            currentContainerSpec.Id,
            logContainer,
          );
        }
      } catch (cleanupError: unknown) {
        if (!this.isContainerNotFoundError(cleanupError)) {
          throw cleanupError;
        }
        logContainer.info(
          `Container ${tempName} with id ${currentContainerSpec.Id} was already removed during cleanup`,
        );
      }

      updateOperationStore.updateOperation(operation.id, {
        status: 'succeeded',
        phase: 'succeeded',
      });
      return true;
    } catch (e: unknown) {
      logContainer.warn(
        `Container update failed for ${oldName}, attempting rollback (${getErrorMessage(e)})`,
      );
      updateOperationStore.updateOperation(operation.id, {
        phase: 'rollback-started',
        lastError: getErrorMessage(e),
      });

      if (newContainer) {
        try {
          await newContainer.stop();
        } catch {
          // best effort
        }
        try {
          await newContainer.remove({ force: true });
        } catch {
          // best effort
        }
      }

      let rollbackSucceeded = true;
      let restoreName = tempName;

      try {
        await currentContainer.rename({ name: oldName });
        restoreName = oldName;
      } catch (renameError: unknown) {
        rollbackSucceeded = false;
        logContainer.warn(
          `Rollback failed to restore container name from ${tempName} to ${oldName} (${getErrorMessage(renameError)})`,
        );
      }

      if (wasRunning && oldContainerStopped) {
        try {
          await this.startContainer(currentContainer, restoreName, logContainer);
        } catch (restartError: unknown) {
          rollbackSucceeded = false;
          logContainer.warn(
            `Rollback failed to restart previous container ${restoreName} (${getErrorMessage(restartError)})`,
          );
        }
      }

      updateOperationStore.updateOperation(operation.id, {
        status: rollbackSucceeded ? 'rolled-back' : 'failed',
        phase: rollbackSucceeded ? 'rolled-back' : 'rollback-failed',
        oldContainerStopped,
        rollbackReason: failureReason,
        lastError: getErrorMessage(e),
      });

      this.recordRollbackTelemetry(
        container,
        rollbackSucceeded ? 'success' : 'error',
        rollbackSucceeded ? failureReason : `${failureReason}_rollback_failed`,
        rollbackSucceeded
          ? `Rollback completed after ${failureReason} during container update`
          : `Rollback failed after ${failureReason}: ${getErrorMessage(e)}`,
        container.updateKind.remoteValue ?? container.image.tag.value,
        container.updateKind.localValue ?? container.image.tag.value,
      );

      const compatibilityError = this.buildRuntimeConfigCompatibilityError(
        e,
        oldName,
        currentContainerSpec,
        newImage,
        rollbackSucceeded,
      );
      if (compatibilityError) {
        throw compatibilityError;
      }

      throw e;
    }
  }
}

export default ContainerUpdateExecutor;
