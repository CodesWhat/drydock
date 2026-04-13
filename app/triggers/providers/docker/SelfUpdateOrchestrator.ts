import crypto from 'node:crypto';
import {
  executeSelfUpdateTransition,
  findDockerSocketBind as findDockerSocketBindFromSpec,
} from './SelfUpdateTransitionShared.js';
import type {
  SelfUpdateConfiguration,
  SelfUpdateContainerRef,
  SelfUpdateContainerSpec,
  SelfUpdateCreatedContainer,
  SelfUpdateDockerApi,
  SelfUpdateExecutionContext,
  SelfUpdateLogger,
  SelfUpdateRuntimeConfigManager,
} from './self-update-types.js';

const SELF_UPDATE_ACK_TIMEOUT_MS = 3_000;

interface SelfUpdateStartingPayload {
  opId: string;
  requiresAck: boolean;
  ackTimeoutMs: number;
  startedAt: string;
}

interface SelfUpdateOrchestratorDependencies {
  getConfiguration: () => SelfUpdateConfiguration;
  runtimeConfigManager: SelfUpdateRuntimeConfigManager;
  pullImage: (
    dockerApi: SelfUpdateDockerApi,
    auth: unknown,
    newImage: string,
    logContainer: SelfUpdateLogger,
  ) => Promise<void>;
  cloneContainer: (
    currentContainerSpec: SelfUpdateContainerSpec,
    newImage: string,
    cloneRuntimeConfigOptions: Record<string, unknown>,
  ) => Record<string, unknown>;
  createContainer: (
    dockerApi: SelfUpdateDockerApi,
    containerToCreateInspect: Record<string, unknown>,
    oldContainerName: string,
    logContainer: SelfUpdateLogger,
  ) => Promise<SelfUpdateCreatedContainer>;
  insertContainerImageBackup: (
    context: SelfUpdateExecutionContext,
    container: SelfUpdateContainerRef,
  ) => void;
  emitSelfUpdateStarting: (payload: SelfUpdateStartingPayload) => Promise<void>;
  createOperationId: () => string;
  resolveFinalizeUrl: () => string;
  resolveFinalizeSecret: () => string;
}

interface SelfUpdateOrchestratorConstructorOptions {
  getConfiguration?: SelfUpdateOrchestratorDependencies['getConfiguration'];
  runtimeConfigManager?: SelfUpdateOrchestratorDependencies['runtimeConfigManager'];
  pullImage?: (
    dockerApi: SelfUpdateDockerApi,
    auth: unknown,
    newImage: string,
    logContainer: SelfUpdateLogger,
  ) => unknown;
  cloneContainer?: (
    currentContainerSpec: SelfUpdateContainerSpec,
    newImage: string,
    cloneRuntimeConfigOptions: Record<string, unknown>,
  ) => unknown;
  createContainer?: (
    dockerApi: SelfUpdateDockerApi,
    containerToCreateInspect: Record<string, unknown>,
    oldContainerName: string,
    logContainer: SelfUpdateLogger,
  ) => unknown;
  insertContainerImageBackup?: SelfUpdateOrchestratorDependencies['insertContainerImageBackup'];
  emitSelfUpdateStarting?: SelfUpdateOrchestratorDependencies['emitSelfUpdateStarting'];
  createOperationId?: SelfUpdateOrchestratorDependencies['createOperationId'];
  resolveFinalizeUrl?: SelfUpdateOrchestratorDependencies['resolveFinalizeUrl'];
  resolveFinalizeSecret?: SelfUpdateOrchestratorDependencies['resolveFinalizeSecret'];
  resolveHelperImage?: (container: SelfUpdateContainerRef) => string | undefined;
}

function missingDependency(dependencyName: string): never {
  throw new TypeError(`SelfUpdateOrchestrator requires dependency "${dependencyName}"`);
}

class SelfUpdateOrchestrator {
  getConfiguration: SelfUpdateOrchestratorDependencies['getConfiguration'];

  runtimeConfigManager: SelfUpdateOrchestratorDependencies['runtimeConfigManager'];

  pullImage: SelfUpdateOrchestratorDependencies['pullImage'];

  cloneContainer: SelfUpdateOrchestratorDependencies['cloneContainer'];

  createContainer: SelfUpdateOrchestratorDependencies['createContainer'];

  insertContainerImageBackup: SelfUpdateOrchestratorDependencies['insertContainerImageBackup'];

  emitSelfUpdateStarting: SelfUpdateOrchestratorDependencies['emitSelfUpdateStarting'];

  createOperationId: SelfUpdateOrchestratorDependencies['createOperationId'];

  resolveFinalizeUrl: SelfUpdateOrchestratorDependencies['resolveFinalizeUrl'];

  resolveFinalizeSecret: SelfUpdateOrchestratorDependencies['resolveFinalizeSecret'];

  resolveHelperImage?: (container: SelfUpdateContainerRef) => string | undefined;

  constructor(options: SelfUpdateOrchestratorConstructorOptions = {}) {
    this.getConfiguration = options.getConfiguration || (() => ({}));
    this.runtimeConfigManager = options.runtimeConfigManager || {
      getCloneRuntimeConfigOptions: async () =>
        missingDependency('runtimeConfigManager.getCloneRuntimeConfigOptions'),
    };
    this.pullImage =
      (options.pullImage as SelfUpdateOrchestratorDependencies['pullImage']) ||
      (async (..._args: Parameters<SelfUpdateOrchestratorDependencies['pullImage']>) =>
        missingDependency('pullImage'));
    this.cloneContainer =
      (options.cloneContainer as SelfUpdateOrchestratorDependencies['cloneContainer']) ||
      ((..._args: Parameters<SelfUpdateOrchestratorDependencies['cloneContainer']>) =>
        missingDependency('cloneContainer'));
    this.createContainer =
      (options.createContainer as SelfUpdateOrchestratorDependencies['createContainer']) ||
      (async (..._args: Parameters<SelfUpdateOrchestratorDependencies['createContainer']>) =>
        missingDependency('createContainer'));
    this.insertContainerImageBackup = options.insertContainerImageBackup || (() => undefined);
    this.emitSelfUpdateStarting = options.emitSelfUpdateStarting || (() => Promise.resolve());
    this.createOperationId = options.createOperationId || (() => crypto.randomUUID());
    this.resolveFinalizeUrl =
      options.resolveFinalizeUrl ||
      (() => 'http://127.0.0.1:3000/api/v1/internal/self-update/finalize');
    this.resolveFinalizeSecret =
      options.resolveFinalizeSecret || (() => 'missing-self-update-finalize-secret');
    this.resolveHelperImage = options.resolveHelperImage;
  }

  isSelfUpdate(container: SelfUpdateContainerRef): boolean {
    return container.image.name === 'drydock' || container.image.name.endsWith('/drydock');
  }

  isInfrastructureUpdate(container: SelfUpdateContainerRef): boolean {
    const labels = (container as { labels?: Record<string, string> }).labels;
    return !!labels && typeof labels === 'object' && labels['dd.update.mode'] === 'infrastructure';
  }

  findDockerSocketBind(spec: SelfUpdateContainerSpec | undefined): string | undefined {
    return findDockerSocketBindFromSpec(spec);
  }

  async maybeNotify(
    container: SelfUpdateContainerRef,
    logContainer: SelfUpdateLogger,
    operationId?: string,
  ): Promise<void> {
    if (!this.isSelfUpdate(container)) {
      return;
    }

    logContainer.info('Self-update detected — notifying UI before proceeding');
    await this.emitSelfUpdateStarting({
      opId: operationId || this.createOperationId(),
      requiresAck: true,
      ackTimeoutMs: SELF_UPDATE_ACK_TIMEOUT_MS,
      startedAt: new Date().toISOString(),
    });
  }

  async execute(
    context: SelfUpdateExecutionContext,
    container: SelfUpdateContainerRef,
    logContainer: SelfUpdateLogger,
    operationId?: string,
  ): Promise<boolean> {
    const resolveHelperImage = this.resolveHelperImage;
    return executeSelfUpdateTransition(
      {
        getConfiguration: this.getConfiguration,
        findDockerSocketBind: this.findDockerSocketBind.bind(this),
        insertContainerImageBackup: this.insertContainerImageBackup,
        pullImage: this.pullImage,
        getCloneRuntimeConfigOptions: this.runtimeConfigManager.getCloneRuntimeConfigOptions.bind(
          this.runtimeConfigManager,
        ),
        cloneContainer: this.cloneContainer,
        createContainer: this.createContainer,
        createOperationId: this.createOperationId,
        resolveFinalizeUrl: this.resolveFinalizeUrl,
        resolveFinalizeSecret: this.resolveFinalizeSecret,
        resolveHelperImage: resolveHelperImage ? () => resolveHelperImage(container) : undefined,
      },
      context,
      container,
      logContainer,
      operationId,
    );
  }
}

export default SelfUpdateOrchestrator;
