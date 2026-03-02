// @ts-nocheck
import crypto from 'node:crypto';

class UpdateLifecycleExecutor {
  getLogger;

  getContainerFullName;

  createTriggerContext;

  maybeScanAndGateUpdate;

  buildHookConfig;

  recordHookConfigurationAudit;

  runPreUpdateHook;

  isSelfUpdate;

  maybeNotifySelfUpdate;

  executeSelfUpdate;

  runPreRuntimeUpdateLifecycle;

  performContainerUpdate;

  runPostUpdateHook;

  cleanupOldImages;

  getRollbackConfig;

  maybeStartAutoRollbackMonitor;

  emitContainerUpdateApplied;

  emitContainerUpdateFailed;

  pruneOldBackups;

  getBackupCount;

  constructor(options = {}) {
    this.getLogger = options.getLogger || (() => undefined);
    this.getContainerFullName = options.getContainerFullName;
    this.createTriggerContext = options.createTriggerContext;
    this.maybeScanAndGateUpdate = options.maybeScanAndGateUpdate;
    this.buildHookConfig = options.buildHookConfig;
    this.recordHookConfigurationAudit = options.recordHookConfigurationAudit;
    this.runPreUpdateHook = options.runPreUpdateHook;
    this.isSelfUpdate = options.isSelfUpdate;
    this.maybeNotifySelfUpdate = options.maybeNotifySelfUpdate;
    this.executeSelfUpdate = options.executeSelfUpdate;
    this.runPreRuntimeUpdateLifecycle = options.runPreRuntimeUpdateLifecycle;
    this.performContainerUpdate = options.performContainerUpdate;
    this.runPostUpdateHook = options.runPostUpdateHook;
    this.cleanupOldImages = options.cleanupOldImages;
    this.getRollbackConfig = options.getRollbackConfig;
    this.maybeStartAutoRollbackMonitor = options.maybeStartAutoRollbackMonitor;
    this.emitContainerUpdateApplied = options.emitContainerUpdateApplied;
    this.emitContainerUpdateFailed = options.emitContainerUpdateFailed;
    this.pruneOldBackups = options.pruneOldBackups || (() => undefined);
    this.getBackupCount = options.getBackupCount || (() => undefined);
  }

  async run(container, runtimeContext?: unknown) {
    const log = this.getLogger();
    const logContainer = log.child({ container: this.getContainerFullName(container) });

    try {
      const context = await this.createTriggerContext(container, logContainer, runtimeContext);
      if (!context) {
        return;
      }

      await this.maybeScanAndGateUpdate(context, container, logContainer);

      const hookConfig = this.buildHookConfig(container);
      this.recordHookConfigurationAudit(container, hookConfig);
      await this.runPreUpdateHook(container, hookConfig, logContainer);

      if (this.isSelfUpdate(container)) {
        const selfUpdateOperationId = crypto.randomUUID();
        await this.maybeNotifySelfUpdate(container, logContainer, selfUpdateOperationId);
        const updated = await this.executeSelfUpdate(
          context,
          container,
          logContainer,
          selfUpdateOperationId,
          runtimeContext,
        );
        if (!updated) {
          return;
        }
        return;
      }

      await this.runPreRuntimeUpdateLifecycle(context, container, logContainer, runtimeContext);
      const updated = await this.performContainerUpdate(
        context,
        container,
        logContainer,
        runtimeContext,
      );
      if (!updated) {
        return;
      }

      await this.runPostUpdateHook(container, hookConfig, logContainer);
      await this.cleanupOldImages(context.dockerApi, context.registry, container, logContainer);
      const rollbackConfig = this.getRollbackConfig(container);
      await this.maybeStartAutoRollbackMonitor(
        context.dockerApi,
        container,
        rollbackConfig,
        logContainer,
      );

      await this.emitContainerUpdateApplied(this.getContainerFullName(container));
      this.pruneOldBackups(container.name, this.getBackupCount());
    } catch (e: any) {
      await this.emitContainerUpdateFailed({
        containerName: this.getContainerFullName(container),
        error: e.message,
      });
      throw e;
    }
  }
}

export default UpdateLifecycleExecutor;
