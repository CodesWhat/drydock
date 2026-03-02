// @ts-nocheck
import * as updateOperationStore from '../../../store/update-operation.js';

class ContainerUpdateExecutor {
  getConfiguration;

  getTriggerId;

  stopContainer;

  waitContainerRemoved;

  removeContainer;

  createContainer;

  startContainer;

  pullImage;

  cloneContainer;

  getCloneRuntimeConfigOptions;

  isContainerNotFoundError;

  recordRollbackTelemetry;

  buildRuntimeConfigCompatibilityError;

  hasHealthcheckConfigured;

  waitForContainerHealthy;

  constructor(options = {}) {
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

  async inspectContainerByIdentifier(dockerApi, identifier) {
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

  async stopAndRemoveContainerBestEffort(dockerApi, identifier, logContainer) {
    const inspected = await this.inspectContainerByIdentifier(dockerApi, identifier);
    if (!inspected) {
      return false;
    }
    try {
      if (inspected.inspection?.State?.Running) {
        await inspected.container.stop();
      }
    } catch (e) {
      logContainer.warn(
        `Failed to stop stale container ${identifier} during recovery (${e.message})`,
      );
    }
    try {
      await inspected.container.remove({ force: true });
      return true;
    } catch (e) {
      logContainer.warn(
        `Failed to remove stale container ${identifier} during recovery (${e.message})`,
      );
      return false;
    }
  }

  async reconcileInProgressContainerUpdateOperation(dockerApi, container, logContainer) {
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
      let recoveryError;
      try {
        await tempByRenamedName.container.rename({ name: pending.oldName });
        if (pending.oldContainerWasRunning && pending.oldContainerStopped) {
          const restored = dockerApi.getContainer(pending.oldName);
          await restored.start();
        }
      } catch (e) {
        recoveryError = e;
      }

      const recovered = !recoveryError;
      updateOperationStore.updateOperation(pending.id, {
        status: recovered ? 'rolled-back' : 'failed',
        phase: recovered ? 'recovered-rollback' : 'recovery-failed',
        lastError: recoveryError ? String(recoveryError?.message || recoveryError) : undefined,
        recoveredAt: new Date().toISOString(),
      });
      this.recordRollbackTelemetry(
        container,
        recovered ? 'success' : 'error',
        recovered ? 'startup_reconcile_restore_old' : 'startup_reconcile_restore_failed',
        recovered
          ? `Recovered interrupted update by restoring container name ${pending.oldName}`
          : `Failed to recover interrupted update: ${String(recoveryError?.message || recoveryError)}`,
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

  async execute(context, container, logContainer) {
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

    let newContainer;
    let oldContainerStopped = false;
    let failureReason = 'update_runtime_failed';

    try {
      failureReason = 'create_new_failed';
      const containerToCreateInspect = this.cloneContainer(
        currentContainerSpec,
        newImage,
        cloneRuntimeConfigOptions,
      );
      newContainer = await this.createContainer(dockerApi, containerToCreateInspect, oldName, logContainer);

      let newContainerId;
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
          await this.removeContainer(currentContainer, tempName, currentContainerSpec.Id, logContainer);
        }
      } catch (cleanupError) {
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
    } catch (e) {
      logContainer.warn(
        `Container update failed for ${oldName}, attempting rollback (${e.message})`,
      );
      updateOperationStore.updateOperation(operation.id, {
        phase: 'rollback-started',
        lastError: e.message,
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
      } catch (renameError) {
        rollbackSucceeded = false;
        logContainer.warn(
          `Rollback failed to restore container name from ${tempName} to ${oldName} (${renameError.message})`,
        );
      }

      if (wasRunning && oldContainerStopped) {
        try {
          await this.startContainer(currentContainer, restoreName, logContainer);
        } catch (restartError) {
          rollbackSucceeded = false;
          logContainer.warn(
            `Rollback failed to restart previous container ${restoreName} (${restartError.message})`,
          );
        }
      }

      updateOperationStore.updateOperation(operation.id, {
        status: rollbackSucceeded ? 'rolled-back' : 'failed',
        phase: rollbackSucceeded ? 'rolled-back' : 'rollback-failed',
        oldContainerStopped,
        rollbackReason: failureReason,
        lastError: e.message,
      });

      this.recordRollbackTelemetry(
        container,
        rollbackSucceeded ? 'success' : 'error',
        rollbackSucceeded ? failureReason : `${failureReason}_rollback_failed`,
        rollbackSucceeded
          ? `Rollback completed after ${failureReason} during container update`
          : `Rollback failed after ${failureReason}: ${e.message}`,
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
