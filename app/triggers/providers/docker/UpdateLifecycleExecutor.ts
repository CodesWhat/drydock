import crypto from 'node:crypto';

type UpdateLifecycleLogContainer = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  debug?: (message: string) => void;
};

type UpdateLifecycleLogger = {
  child?: (bindings: Record<string, unknown>) => UpdateLifecycleLogContainer;
};

type UpdateLifecycleContainer = {
  name: string;
  [key: string]: unknown;
};

type UpdateLifecycleContext = {
  dockerApi: unknown;
  registry: unknown;
  [key: string]: unknown;
};

type UpdateLifecycleExecutorDependencies = {
  getLogger: () => UpdateLifecycleLogger | undefined;
  getContainerFullName: (container: UpdateLifecycleContainer) => string;
  createTriggerContext: (
    container: UpdateLifecycleContainer,
    logContainer: UpdateLifecycleLogContainer,
    runtimeContext?: unknown,
  ) => Promise<UpdateLifecycleContext | undefined>;
  maybeScanAndGateUpdate: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logContainer: UpdateLifecycleLogContainer,
  ) => Promise<void>;
  buildHookConfig: (container: UpdateLifecycleContainer) => Record<string, unknown>;
  recordHookConfigurationAudit: (
    container: UpdateLifecycleContainer,
    hookConfig: Record<string, unknown>,
  ) => void;
  runPreUpdateHook: (
    container: UpdateLifecycleContainer,
    hookConfig: Record<string, unknown>,
    logContainer: UpdateLifecycleLogContainer,
  ) => Promise<void>;
  isSelfUpdate: (container: UpdateLifecycleContainer) => boolean;
  maybeNotifySelfUpdate: (
    container: UpdateLifecycleContainer,
    logContainer: UpdateLifecycleLogContainer,
    operationId: string,
  ) => Promise<void>;
  executeSelfUpdate: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logContainer: UpdateLifecycleLogContainer,
    operationId: string,
    runtimeContext?: unknown,
  ) => Promise<boolean>;
  runPreRuntimeUpdateLifecycle: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logContainer: UpdateLifecycleLogContainer,
    runtimeContext?: unknown,
  ) => Promise<void>;
  performContainerUpdate: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logContainer: UpdateLifecycleLogContainer,
    runtimeContext?: unknown,
  ) => Promise<boolean>;
  runPostUpdateHook: (
    container: UpdateLifecycleContainer,
    hookConfig: Record<string, unknown>,
    logContainer: UpdateLifecycleLogContainer,
  ) => Promise<void>;
  cleanupOldImages: (
    dockerApi: unknown,
    registry: unknown,
    container: UpdateLifecycleContainer,
    logContainer: UpdateLifecycleLogContainer,
  ) => Promise<void>;
  getRollbackConfig: (container: UpdateLifecycleContainer) => Record<string, unknown>;
  maybeStartAutoRollbackMonitor: (
    dockerApi: unknown,
    container: UpdateLifecycleContainer,
    rollbackConfig: Record<string, unknown>,
    logContainer: UpdateLifecycleLogContainer,
  ) => Promise<void>;
  emitContainerUpdateApplied: (containerName: string) => Promise<void>;
  emitContainerUpdateFailed: (payload: { containerName: string; error: string }) => Promise<void>;
  pruneOldBackups: (containerName: string, backupCount: number | undefined) => void;
  getBackupCount: () => number | undefined;
};

type UpdateLifecycleExecutorConstructorOptions = Omit<
  UpdateLifecycleExecutorDependencies,
  'getLogger' | 'pruneOldBackups' | 'getBackupCount'
> & {
  getLogger?: UpdateLifecycleExecutorDependencies['getLogger'];
  pruneOldBackups?: UpdateLifecycleExecutorDependencies['pruneOldBackups'];
  getBackupCount?: UpdateLifecycleExecutorDependencies['getBackupCount'];
};

const REQUIRED_UPDATE_LIFECYCLE_EXECUTOR_DEPENDENCY_KEYS = [
  'getContainerFullName',
  'createTriggerContext',
  'maybeScanAndGateUpdate',
  'buildHookConfig',
  'recordHookConfigurationAudit',
  'runPreUpdateHook',
  'isSelfUpdate',
  'maybeNotifySelfUpdate',
  'executeSelfUpdate',
  'runPreRuntimeUpdateLifecycle',
  'performContainerUpdate',
  'runPostUpdateHook',
  'cleanupOldImages',
  'getRollbackConfig',
  'maybeStartAutoRollbackMonitor',
  'emitContainerUpdateApplied',
  'emitContainerUpdateFailed',
] as const;

function assertRequiredDependencies(
  options: Partial<UpdateLifecycleExecutorDependencies>,
): asserts options is UpdateLifecycleExecutorConstructorOptions {
  for (const key of REQUIRED_UPDATE_LIFECYCLE_EXECUTOR_DEPENDENCY_KEYS) {
    if (typeof options[key] !== 'function') {
      throw new TypeError(`UpdateLifecycleExecutor requires dependency "${key}"`);
    }
  }
}

class UpdateLifecycleExecutor {
  getLogger: UpdateLifecycleExecutorDependencies['getLogger'];

  getContainerFullName: UpdateLifecycleExecutorDependencies['getContainerFullName'];

  createTriggerContext: UpdateLifecycleExecutorDependencies['createTriggerContext'];

  maybeScanAndGateUpdate: UpdateLifecycleExecutorDependencies['maybeScanAndGateUpdate'];

  buildHookConfig: UpdateLifecycleExecutorDependencies['buildHookConfig'];

  recordHookConfigurationAudit: UpdateLifecycleExecutorDependencies['recordHookConfigurationAudit'];

  runPreUpdateHook: UpdateLifecycleExecutorDependencies['runPreUpdateHook'];

  isSelfUpdate: UpdateLifecycleExecutorDependencies['isSelfUpdate'];

  maybeNotifySelfUpdate: UpdateLifecycleExecutorDependencies['maybeNotifySelfUpdate'];

  executeSelfUpdate: UpdateLifecycleExecutorDependencies['executeSelfUpdate'];

  runPreRuntimeUpdateLifecycle: UpdateLifecycleExecutorDependencies['runPreRuntimeUpdateLifecycle'];

  performContainerUpdate: UpdateLifecycleExecutorDependencies['performContainerUpdate'];

  runPostUpdateHook: UpdateLifecycleExecutorDependencies['runPostUpdateHook'];

  cleanupOldImages: UpdateLifecycleExecutorDependencies['cleanupOldImages'];

  getRollbackConfig: UpdateLifecycleExecutorDependencies['getRollbackConfig'];

  maybeStartAutoRollbackMonitor: UpdateLifecycleExecutorDependencies['maybeStartAutoRollbackMonitor'];

  emitContainerUpdateApplied: UpdateLifecycleExecutorDependencies['emitContainerUpdateApplied'];

  emitContainerUpdateFailed: UpdateLifecycleExecutorDependencies['emitContainerUpdateFailed'];

  pruneOldBackups: UpdateLifecycleExecutorDependencies['pruneOldBackups'];

  getBackupCount: UpdateLifecycleExecutorDependencies['getBackupCount'];

  constructor(options: UpdateLifecycleExecutorConstructorOptions) {
    assertRequiredDependencies(options);
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

  async run(container: UpdateLifecycleContainer, runtimeContext?: unknown) {
    const log = this.getLogger();
    const logContainer = log?.child?.({ container: this.getContainerFullName(container) }) ?? {};

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
    } catch (e: unknown) {
      const errorMessage = String((e as Error)?.message ?? e);
      await this.emitContainerUpdateFailed({
        containerName: this.getContainerFullName(container),
        error: errorMessage,
      });
      throw e;
    }
  }
}

export default UpdateLifecycleExecutor;
