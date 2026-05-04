import type { ContainerUpdateAppliedEvent } from '../../../event/index.js';
import {
  assertRequiredFunctionDependencies,
  resolveFunctionDependencies,
} from './dependency-constructor.js';
import { getRequestedOperationId } from './update-runtime-context.js';

type UpdateLifecycleOperationLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  debug?: (message: string) => void;
};

type UpdateLifecycleRootLogger = {
  child?: (bindings: Record<string, unknown>) => UpdateLifecycleOperationLogger;
};

type UpdateLifecycleContainer = {
  id?: string;
  name: string;
  watcher?: string;
  labels?: Record<string, string>;
  image?: {
    registry?: {
      name?: string;
    };
    tag?: {
      value?: string;
    };
    digest?: {
      repo?: string;
    };
  };
  result?: {
    digest?: unknown;
  };
  updateKind?: {
    kind?: string;
    localValue?: string | null;
    remoteValue?: string | null;
  };
};

type UpdateLifecycleContext = {
  dockerApi: unknown;
  registry: unknown;
  auth?: unknown;
  newImage?: string;
  operationId?: string;
  currentContainer?: unknown;
  currentContainerSpec?: {
    Id?: string;
    Name?: string;
    State?: {
      Running?: boolean;
    };
    Config?: {
      Labels?: Record<string, string>;
    };
    HostConfig?: {
      Binds?: string[];
    };
  };
};

type UpdateLifecycleExecutorCallbacks = {
  getLogger: () => UpdateLifecycleRootLogger | undefined;
  getContainerFullName: (container: UpdateLifecycleContainer) => string;
  createTriggerContext: (
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
    runtimeContext?: unknown,
  ) => Promise<UpdateLifecycleContext | undefined>;
  maybeScanAndGateUpdate: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
  ) => Promise<void>;
  verifySignaturePreUpdate: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
  ) => Promise<void>;
  scanAndGatePostPull: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
    options?: { setPhase?: (phase: 'scanning' | 'sbom-generating') => void },
  ) => Promise<void>;
  buildHookConfig: (container: UpdateLifecycleContainer) => Record<string, unknown>;
  recordHookConfigurationAudit: (
    container: UpdateLifecycleContainer,
    hookConfig: Record<string, unknown>,
  ) => void;
  runPreUpdateHook: (
    container: UpdateLifecycleContainer,
    hookConfig: Record<string, unknown>,
    logger: UpdateLifecycleOperationLogger,
  ) => Promise<void>;
  isSelfUpdate: (container: UpdateLifecycleContainer) => boolean;
  isInfrastructureUpdate: (container: UpdateLifecycleContainer) => boolean;
  prepareSelfUpdateOperation: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
    runtimeContext?: unknown,
  ) => Promise<string> | string;
  maybeNotifySelfUpdate: (
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
    operationId: string,
  ) => Promise<void>;
  executeSelfUpdate: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
    operationId: string,
    runtimeContext?: unknown,
  ) => Promise<boolean>;
  markSelfUpdateOperationFailed: (operationId: string, lastError: string) => Promise<void> | void;
  runPreRuntimeUpdateLifecycle: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
    runtimeContext?: unknown,
  ) => Promise<void>;
  performContainerUpdate: (
    context: UpdateLifecycleContext,
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
    runtimeContext?: unknown,
    postPullHook?: (operationId: string) => Promise<void>,
  ) => Promise<boolean>;
  runPostUpdateHook: (
    container: UpdateLifecycleContainer,
    hookConfig: Record<string, unknown>,
    logger: UpdateLifecycleOperationLogger,
  ) => Promise<void>;
  cleanupOldImages: (
    dockerApi: unknown,
    registry: unknown,
    container: UpdateLifecycleContainer,
    logger: UpdateLifecycleOperationLogger,
  ) => Promise<void>;
  getRollbackConfig: (container: UpdateLifecycleContainer) => Record<string, unknown>;
  maybeStartAutoRollbackMonitor: (
    dockerApi: unknown,
    container: UpdateLifecycleContainer,
    rollbackConfig: Record<string, unknown>,
    logger: UpdateLifecycleOperationLogger,
  ) => Promise<void>;
  emitContainerUpdateApplied: (payload: ContainerUpdateAppliedEvent) => Promise<void>;
  emitContainerUpdateFailed: (payload: { containerName: string; error: string }) => Promise<void>;
  pruneOldBackups: (containerName: string, backupCount: number | undefined) => void;
  getBackupCount: () => number | undefined;
};

type UpdateLifecycleLoggerServices = Pick<UpdateLifecycleExecutorCallbacks, 'getLogger'>;

type UpdateLifecycleContextServices = Pick<
  UpdateLifecycleExecutorCallbacks,
  'getContainerFullName' | 'createTriggerContext'
>;

type UpdateLifecycleSecurityServices = Pick<
  UpdateLifecycleExecutorCallbacks,
  'maybeScanAndGateUpdate' | 'verifySignaturePreUpdate' | 'scanAndGatePostPull'
>;

type UpdateLifecycleHookServices = Pick<
  UpdateLifecycleExecutorCallbacks,
  'buildHookConfig' | 'recordHookConfigurationAudit' | 'runPreUpdateHook' | 'runPostUpdateHook'
>;

type UpdateLifecycleSelfUpdateServices = Pick<
  UpdateLifecycleExecutorCallbacks,
  | 'isSelfUpdate'
  | 'isInfrastructureUpdate'
  | 'prepareSelfUpdateOperation'
  | 'maybeNotifySelfUpdate'
  | 'executeSelfUpdate'
  | 'markSelfUpdateOperationFailed'
>;

type UpdateLifecycleRuntimeUpdateServices = Pick<
  UpdateLifecycleExecutorCallbacks,
  'runPreRuntimeUpdateLifecycle' | 'performContainerUpdate'
> & {
  setOperationPhase?: (operationId: string, phase: 'scanning' | 'sbom-generating') => void;
};

type UpdateLifecyclePostUpdateServices = Pick<
  UpdateLifecycleExecutorCallbacks,
  'cleanupOldImages' | 'getRollbackConfig' | 'maybeStartAutoRollbackMonitor'
> &
  Partial<Pick<UpdateLifecycleExecutorCallbacks, 'pruneOldBackups' | 'getBackupCount'>>;

type ResolvedUpdateLifecyclePostUpdateServices = Pick<
  UpdateLifecycleExecutorCallbacks,
  | 'cleanupOldImages'
  | 'getRollbackConfig'
  | 'maybeStartAutoRollbackMonitor'
  | 'pruneOldBackups'
  | 'getBackupCount'
>;

type UpdateLifecycleTelemetryServices = Pick<
  UpdateLifecycleExecutorCallbacks,
  'emitContainerUpdateApplied' | 'emitContainerUpdateFailed'
>;

type UpdateLifecycleExecutorConstructorOptions = {
  logger?: UpdateLifecycleLoggerServices;
  context: UpdateLifecycleContextServices;
  security: UpdateLifecycleSecurityServices;
  hooks: UpdateLifecycleHookServices;
  selfUpdate: UpdateLifecycleSelfUpdateServices;
  runtimeUpdate: UpdateLifecycleRuntimeUpdateServices;
  postUpdate: UpdateLifecyclePostUpdateServices;
  telemetry: UpdateLifecycleTelemetryServices;
};

const REQUIRED_UPDATE_LIFECYCLE_EXECUTOR_DEPENDENCY_KEYS = {
  context: ['getContainerFullName', 'createTriggerContext'],
  security: ['maybeScanAndGateUpdate', 'verifySignaturePreUpdate', 'scanAndGatePostPull'],
  hooks: [
    'buildHookConfig',
    'recordHookConfigurationAudit',
    'runPreUpdateHook',
    'runPostUpdateHook',
  ],
  selfUpdate: [
    'isSelfUpdate',
    'isInfrastructureUpdate',
    'prepareSelfUpdateOperation',
    'maybeNotifySelfUpdate',
    'executeSelfUpdate',
    'markSelfUpdateOperationFailed',
  ],
  runtimeUpdate: ['runPreRuntimeUpdateLifecycle', 'performContainerUpdate'],
  postUpdate: ['cleanupOldImages', 'getRollbackConfig', 'maybeStartAutoRollbackMonitor'],
  telemetry: ['emitContainerUpdateApplied', 'emitContainerUpdateFailed'],
} as const;

function assertRequiredDependencies(
  options: unknown,
): asserts options is UpdateLifecycleExecutorConstructorOptions {
  for (const [serviceGroup, dependencyKeys] of Object.entries(
    REQUIRED_UPDATE_LIFECYCLE_EXECUTOR_DEPENDENCY_KEYS,
  )) {
    const group = (options as Record<string, unknown>)?.[serviceGroup] as
      | Record<string, unknown>
      | undefined;
    assertRequiredFunctionDependencies(
      group || {},
      dependencyKeys as readonly string[],
      'UpdateLifecycleExecutor',
      serviceGroup,
    );
  }
}

class UpdateLifecycleExecutor {
  logger: UpdateLifecycleLoggerServices;

  context: UpdateLifecycleContextServices;

  security: UpdateLifecycleSecurityServices;

  hooks: UpdateLifecycleHookServices;

  selfUpdate: UpdateLifecycleSelfUpdateServices;

  runtimeUpdate: UpdateLifecycleRuntimeUpdateServices;

  postUpdate: ResolvedUpdateLifecyclePostUpdateServices;

  telemetry: UpdateLifecycleTelemetryServices;

  constructor(options: UpdateLifecycleExecutorConstructorOptions) {
    assertRequiredDependencies(options);
    this.logger = resolveFunctionDependencies<UpdateLifecycleLoggerServices>(options.logger || {}, {
      defaults: {
        getLogger: () => undefined,
      },
      componentName: 'UpdateLifecycleExecutor',
    });
    this.context = options.context;
    this.security = options.security;
    this.hooks = options.hooks;
    this.selfUpdate = options.selfUpdate;
    this.runtimeUpdate = options.runtimeUpdate;
    this.postUpdate = resolveFunctionDependencies<ResolvedUpdateLifecyclePostUpdateServices>(
      options.postUpdate,
      {
        defaults: {
          pruneOldBackups: () => undefined,
          getBackupCount: () => undefined,
        },
        componentName: 'UpdateLifecycleExecutor',
      },
    );
    this.telemetry = options.telemetry;
  }

  async run(container: UpdateLifecycleContainer, runtimeContext?: unknown) {
    const rootLogger = this.logger.getLogger();
    const containerLogger =
      rootLogger?.child?.({ container: this.context.getContainerFullName(container) }) ?? {};
    let emitFailureFallback = false;
    const requestedOperationId = getRequestedOperationId(container, runtimeContext);

    try {
      const context = await this.context.createTriggerContext(
        container,
        containerLogger,
        runtimeContext,
      );
      if (!context) {
        return;
      }

      await this.security.verifySignaturePreUpdate(context, container, containerLogger);

      const hookConfig = this.hooks.buildHookConfig(container);
      this.hooks.recordHookConfigurationAudit(container, hookConfig);
      await this.hooks.runPreUpdateHook(container, hookConfig, containerLogger);

      if (
        this.selfUpdate.isSelfUpdate(container) ||
        this.selfUpdate.isInfrastructureUpdate(container)
      ) {
        emitFailureFallback = true;
        const selfUpdateOperationId = await this.selfUpdate.prepareSelfUpdateOperation(
          context,
          container,
          containerLogger,
          runtimeContext,
        );
        try {
          await this.selfUpdate.maybeNotifySelfUpdate(
            container,
            containerLogger,
            selfUpdateOperationId,
          );
          const updated = await this.selfUpdate.executeSelfUpdate(
            context,
            container,
            containerLogger,
            selfUpdateOperationId,
            runtimeContext,
          );
          if (!updated) {
            return;
          }
          return;
        } catch (e: unknown) {
          const errorMessage = String((e as Error)?.message ?? e);
          try {
            await this.selfUpdate.markSelfUpdateOperationFailed(
              selfUpdateOperationId,
              errorMessage,
            );
          } catch (markErr: unknown) {
            containerLogger.warn?.(
              `Failed to mark self-update operation ${selfUpdateOperationId} as failed: ${String((markErr as Error)?.message ?? markErr)}`,
            );
          }
          throw e;
        }
      }

      const postPullHook = async (operationId: string) => {
        await this.security.scanAndGatePostPull(context, container, containerLogger, {
          setPhase: (phase) => {
            this.runtimeUpdate.setOperationPhase?.(operationId, phase);
          },
        });
      };

      await this.runtimeUpdate.runPreRuntimeUpdateLifecycle(
        context,
        container,
        containerLogger,
        runtimeContext,
      );
      const updated = await this.runtimeUpdate.performContainerUpdate(
        context,
        container,
        containerLogger,
        runtimeContext,
        postPullHook,
      );
      if (!updated) {
        return;
      }

      await this.hooks.runPostUpdateHook(container, hookConfig, containerLogger);
      await this.postUpdate.cleanupOldImages(
        context.dockerApi,
        context.registry,
        container,
        containerLogger,
      );
      const rollbackConfig = this.postUpdate.getRollbackConfig(container);
      await this.postUpdate.maybeStartAutoRollbackMonitor(
        context.dockerApi,
        container,
        rollbackConfig,
        containerLogger,
      );

      if (!requestedOperationId) {
        await this.telemetry.emitContainerUpdateApplied({
          containerName: this.context.getContainerFullName(container),
          container,
        });
      }
      this.postUpdate.pruneOldBackups(container.name, this.postUpdate.getBackupCount());
    } catch (e: unknown) {
      const errorMessage = String((e as Error)?.message ?? e);
      if (emitFailureFallback || !requestedOperationId) {
        await this.telemetry.emitContainerUpdateFailed({
          containerName: this.context.getContainerFullName(container),
          error: errorMessage,
        });
      }
      try {
        this.postUpdate.pruneOldBackups(container.name, this.postUpdate.getBackupCount());
      } catch (pruneError: unknown) {
        const pruneErrorMessage = String((pruneError as Error)?.message ?? pruneError);
        containerLogger.warn?.(
          `Failed to prune old backups after update failure for ${container.name}: ${pruneErrorMessage}`,
        );
      }
      throw e;
    }
  }
}

export default UpdateLifecycleExecutor;
