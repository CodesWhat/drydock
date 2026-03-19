import crypto from 'node:crypto';
import pLimit from 'p-limit';
import parse from 'parse-docker-image-name';
import { getSecurityConfiguration } from '../../../configuration/index.js';
import { getPreferredLabelValue as resolvePreferredLabelValue } from '../../../docker/legacy-label.js';
import {
  emitContainerUpdateApplied,
  emitContainerUpdateFailed,
  emitSecurityAlert,
  emitSelfUpdateStarting,
} from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import { getAuditCounter } from '../../../prometheus/audit.js';
import { getRollbackCounter } from '../../../prometheus/rollback.js';
import { getState } from '../../../registry/index.js';
import {
  generateImageSbom,
  scanImageForVulnerabilities,
  verifyImageSignature,
} from '../../../security/scan.js';
import * as auditStore from '../../../store/audit.js';
import * as backupStore from '../../../store/backup.js';
import * as storeContainer from '../../../store/container.js';
import { cacheSecurityState } from '../../../store/container.js';
import { runHook } from '../../hooks/HookRunner.js';
import Trigger from '../Trigger.js';
import ContainerRuntimeConfigManager from './ContainerRuntimeConfigManager.js';
import ContainerUpdateExecutor from './ContainerUpdateExecutor.js';
import { syncComposeFileTag } from './compose-file-sync.js';
import { startHealthMonitor } from './HealthMonitor.js';
import HookExecutor from './HookExecutor.js';
import RegistryResolver from './RegistryResolver.js';
import RollbackMonitor from './RollbackMonitor.js';
import SecurityGate from './SecurityGate.js';
import SelfUpdateOrchestrator from './SelfUpdateOrchestrator.js';
import UpdateLifecycleExecutor from './UpdateLifecycleExecutor.js';

const PULL_PROGRESS_LOG_INTERVAL_MS = 2000;
const NON_SELF_UPDATE_HEALTH_TIMEOUT_MS = 120_000;
const NON_SELF_UPDATE_HEALTH_POLL_INTERVAL_MS = 1_000;
const TRIGGER_BATCH_CONCURRENCY = 3;
const warnedLegacyTriggerLabelFallbacks = new Set<string>();

type ContainerFullNameReference = {
  name: string;
  watcher?: unknown;
};

function getPreferredLabelValue(labels, ddKey, wudKey, logger) {
  return resolvePreferredLabelValue(labels, ddKey, wudKey, {
    warnedFallbacks: warnedLegacyTriggerLabelFallbacks,
    warn: (message) => logger?.warn?.(message),
  });
}

function hasRepoTags(image) {
  return Array.isArray(image.RepoTags) && image.RepoTags.length > 0;
}

function normalizeListedImage(registry, image) {
  const imageParsed = parse(image.RepoTags[0]);
  return registry.normalizeImage({
    registry: {
      url: imageParsed.domain ? imageParsed.domain : '',
    },
    tag: {
      value: imageParsed.tag,
    },
    name: imageParsed.path,
  });
}

function shouldKeepImage(imageNormalized, container) {
  if (imageNormalized.registry.name !== container.image.registry.name) {
    return true;
  }
  if (imageNormalized.name !== container.image.name) {
    return true;
  }
  if (imageNormalized.tag.value === container.updateKind.localValue) {
    return true;
  }
  if (imageNormalized.tag.value === container.updateKind.remoteValue) {
    return true;
  }
  if (
    container.updateKind.kind === 'digest' &&
    imageNormalized.tag.value === container.image.tag.value
  ) {
    return true;
  }
  return false;
}

function getContainerFullNameForLifecycle(container: ContainerFullNameReference): string {
  return `${container.watcher}_${container.name}`;
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return String(error);
  }
  return String((error as { message?: unknown }).message);
}

function getErrorNumberField(error: unknown, field: 'statusCode' | 'status'): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'number' ? value : undefined;
}

function getErrorStringField(error: unknown, field: 'message' | 'reason'): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : undefined;
}

function getErrorJsonMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const json = (error as { json?: unknown }).json;
  if (!json || typeof json !== 'object') {
    return undefined;
  }
  const jsonMessage = (json as { message?: unknown }).message;
  /* v8 ignore next -- json.message is typically string when present; non-string forms are defensive */
  return typeof jsonMessage === 'string' ? jsonMessage : undefined;
}

const HOOK_EXECUTOR_ORCHESTRATOR_METHODS = ['recordHookAudit'] as const;
const SELF_UPDATE_ORCHESTRATOR_METHODS = [
  'pullImage',
  'cloneContainer',
  'createContainer',
  'insertContainerImageBackup',
] as const;
const CONTAINER_UPDATE_ORCHESTRATOR_METHODS = [
  'stopContainer',
  'waitContainerRemoved',
  'removeContainer',
  'createContainer',
  'startContainer',
  'pullImage',
  'cloneContainer',
  'isContainerNotFoundError',
  'recordRollbackTelemetry',
  'hasHealthcheckConfigured',
  'waitForContainerHealthy',
] as const;
const ROLLBACK_MONITOR_ORCHESTRATOR_METHODS = ['getCurrentContainer', 'inspectContainer'] as const;
const UPDATE_LIFECYCLE_ORCHESTRATOR_METHODS = [
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
] as const;
const SECURITY_GATE_ORCHESTRATOR_METHODS = ['recordSecurityAudit'] as const;

type DockerTriggerCallbackName =
  | (typeof HOOK_EXECUTOR_ORCHESTRATOR_METHODS)[number]
  | (typeof SELF_UPDATE_ORCHESTRATOR_METHODS)[number]
  | (typeof CONTAINER_UPDATE_ORCHESTRATOR_METHODS)[number]
  | (typeof ROLLBACK_MONITOR_ORCHESTRATOR_METHODS)[number]
  | (typeof UPDATE_LIFECYCLE_ORCHESTRATOR_METHODS)[number]
  | (typeof SECURITY_GATE_ORCHESTRATOR_METHODS)[number];

type DockerTriggerOrchestrator = Pick<Docker, DockerTriggerCallbackName>;

type RollbackTelemetryPayload = {
  container: unknown;
  outcome: 'success' | 'error' | 'info';
  reason: string;
  details: string;
  fromVersion?: string;
  toVersion?: string;
};

function buildOrchestratorCallback<K extends keyof DockerTriggerOrchestrator>(
  orchestrator: DockerTriggerOrchestrator,
  callbackName: K,
): DockerTriggerOrchestrator[K] {
  return ((...args: Parameters<DockerTriggerOrchestrator[K]>) =>
    (
      orchestrator[callbackName] as (
        ...callbackArgs: Parameters<DockerTriggerOrchestrator[K]>
      ) => ReturnType<DockerTriggerOrchestrator[K]>
    ).apply(orchestrator, args)) as DockerTriggerOrchestrator[K];
}

function pickOrchestratorCallbacks<K extends keyof DockerTriggerOrchestrator>(
  orchestrator: DockerTriggerOrchestrator,
  callbackNames: readonly K[],
): Pick<DockerTriggerOrchestrator, K> {
  const callbacks = {} as Pick<DockerTriggerOrchestrator, K>;
  for (const callbackName of callbackNames) {
    callbacks[callbackName] = buildOrchestratorCallback(orchestrator, callbackName);
  }
  return callbacks;
}

/**
 * Replace a Docker container with an updated one.
 */
class Docker extends Trigger {
  public strictAgentMatch = true;

  registryResolver: RegistryResolver;

  runtimeConfigManager: ContainerRuntimeConfigManager;

  securityGate?: SecurityGate;

  hookExecutor: HookExecutor;

  selfUpdateOrchestrator: SelfUpdateOrchestrator;

  containerUpdateExecutor: ContainerUpdateExecutor;

  updateLifecycleExecutor: UpdateLifecycleExecutor;

  rollbackMonitor: RollbackMonitor;

  constructor() {
    super();

    this.registryResolver = new RegistryResolver();
    this.runtimeConfigManager = new ContainerRuntimeConfigManager({
      getPreferredLabelValue,
      getLogger: () => this.log,
    });
    const getCloneRuntimeConfigOptions =
      this.runtimeConfigManager.getCloneRuntimeConfigOptions.bind(this.runtimeConfigManager);
    const buildRuntimeConfigCompatibilityError =
      this.runtimeConfigManager.buildRuntimeConfigCompatibilityError.bind(
        this.runtimeConfigManager,
      );
    this.hookExecutor = new HookExecutor({
      runHook,
      getPreferredLabelValue,
      getLogger: () => this.log,
      ...pickOrchestratorCallbacks(this, HOOK_EXECUTOR_ORCHESTRATOR_METHODS),
    });
    this.selfUpdateOrchestrator = new SelfUpdateOrchestrator({
      getConfiguration: () => this.configuration,
      runtimeConfigManager: this.runtimeConfigManager,
      ...pickOrchestratorCallbacks(this, SELF_UPDATE_ORCHESTRATOR_METHODS),
      emitSelfUpdateStarting,
    });
    this.containerUpdateExecutor = new ContainerUpdateExecutor({
      getConfiguration: () => this.configuration,
      getTriggerId: () => this.getId(),
      ...pickOrchestratorCallbacks(this, CONTAINER_UPDATE_ORCHESTRATOR_METHODS),
      getCloneRuntimeConfigOptions,
      buildRuntimeConfigCompatibilityError,
    });
    this.rollbackMonitor = new RollbackMonitor({
      getPreferredLabelValue,
      getLogger: () => this.log,
      ...pickOrchestratorCallbacks(this, ROLLBACK_MONITOR_ORCHESTRATOR_METHODS),
      startHealthMonitor,
      getTriggerInstance: () => this,
    });
    const updateLifecycleCallbacks = pickOrchestratorCallbacks(
      this,
      UPDATE_LIFECYCLE_ORCHESTRATOR_METHODS,
    );
    this.updateLifecycleExecutor = new UpdateLifecycleExecutor({
      logger: {
        getLogger: () => this.log,
      },
      context: {
        getContainerFullName: (container) => getContainerFullNameForLifecycle(container),
        createTriggerContext: updateLifecycleCallbacks.createTriggerContext,
      },
      security: {
        maybeScanAndGateUpdate: updateLifecycleCallbacks.maybeScanAndGateUpdate,
      },
      hooks: {
        buildHookConfig: updateLifecycleCallbacks.buildHookConfig,
        recordHookConfigurationAudit: updateLifecycleCallbacks.recordHookConfigurationAudit,
        runPreUpdateHook: updateLifecycleCallbacks.runPreUpdateHook,
        runPostUpdateHook: updateLifecycleCallbacks.runPostUpdateHook,
      },
      selfUpdate: {
        isSelfUpdate: updateLifecycleCallbacks.isSelfUpdate,
        maybeNotifySelfUpdate: updateLifecycleCallbacks.maybeNotifySelfUpdate,
        executeSelfUpdate: updateLifecycleCallbacks.executeSelfUpdate,
      },
      runtimeUpdate: {
        runPreRuntimeUpdateLifecycle: updateLifecycleCallbacks.runPreRuntimeUpdateLifecycle,
        performContainerUpdate: updateLifecycleCallbacks.performContainerUpdate,
      },
      postUpdate: {
        cleanupOldImages: updateLifecycleCallbacks.cleanupOldImages,
        getRollbackConfig: updateLifecycleCallbacks.getRollbackConfig,
        maybeStartAutoRollbackMonitor: updateLifecycleCallbacks.maybeStartAutoRollbackMonitor,
        pruneOldBackups: backupStore.pruneOldBackups,
        getBackupCount: () => this.configuration?.backupcount,
      },
      telemetry: {
        emitContainerUpdateApplied,
        emitContainerUpdateFailed,
      },
    });
  }

  getSecurityGate() {
    if (!this.securityGate) {
      this.securityGate = new SecurityGate({
        getSecurityConfiguration,
        verifyImageSignature,
        scanImageForVulnerabilities,
        generateImageSbom,
        getContainer: (id) => storeContainer.getContainer(id),
        updateContainer: storeContainer.updateContainer,
        cacheSecurityState,
        emitSecurityAlert,
        fullName,
        ...pickOrchestratorCallbacks(this, SECURITY_GATE_ORCHESTRATOR_METHODS),
      });
    }
    return this.securityGate;
  }

  isContainerNotFoundError(error: unknown) {
    if (!error) {
      return false;
    }

    const statusCode =
      getErrorNumberField(error, 'statusCode') ?? getErrorNumberField(error, 'status');
    if (statusCode === 404) {
      return true;
    }

    const errorMessage = `${getErrorStringField(error, 'message') ?? ''} ${getErrorStringField(error, 'reason') ?? ''} ${getErrorJsonMessage(error) ?? ''}`;
    return errorMessage.toLowerCase().includes('no such container');
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      prune: this.joi.boolean().default(false),
      dryrun: this.joi.boolean().default(false),
      autoremovetimeout: this.joi.number().default(10_000),
      backupcount: this.joi.number().default(3),
    });
  }

  /**
   * Get watcher responsible for the container.
   * @param container
   * @returns {*}
   */

  getWatcher(container) {
    const watcherId = container?.agent
      ? `${container.agent}.docker.${container.watcher}`
      : `docker.${container.watcher}`;
    const watcher = getState().watcher[watcherId];
    if (!watcher) {
      const containerIdOrName = container?.id || container?.name || 'unknown';
      throw new Error(
        `No watcher found for container ${containerIdOrName} (${watcherId || 'docker.unknown'})`,
      );
    }
    return watcher;
  }

  normalizeRegistryHost(registryUrlOrName) {
    return this.registryResolver.normalizeRegistryHost(registryUrlOrName);
  }

  buildRegistryLookupCandidates(image) {
    return this.registryResolver.buildRegistryLookupCandidates(image);
  }

  isRegistryManagerCompatible(registry, options = {}) {
    return this.registryResolver.isRegistryManagerCompatible(registry, options);
  }

  createAnonymousRegistryManager(container, logContainer) {
    return this.registryResolver.createAnonymousRegistryManager(container, logContainer);
  }

  resolveRegistryManager(container, logContainer, options = {}) {
    const registryName = container?.image?.registry?.name;
    const registryState = getState().registry || {};
    const requireNormalizeImage =
      this.configuration.prune === true && !this.isSelfUpdate(container);
    return this.registryResolver.resolveRegistryManager(container, logContainer, registryState, {
      ...options,
      requireNormalizeImage,
      registryName,
    });
  }

  /**
   * Get current container.
   * @param dockerApi
   * @param container
   * @returns {Promise<*>}
   */
  async getCurrentContainer(dockerApi, container) {
    this.log.debug(`Get container ${container.id}`);
    try {
      return await dockerApi.getContainer(container.id);
    } catch (e: unknown) {
      this.log.warn(`Error when getting container ${container.id}`);
      throw e;
    }
  }

  /**
   * Inspect container.
   * @param container
   * @returns {Promise<*>}
   */
  async inspectContainer(container, logContainer) {
    this.log.debug(`Inspect container ${container.id}`);
    try {
      return await container.inspect();
    } catch (e: unknown) {
      logContainer.warn(`Error when inspecting container ${container.id}`);
      throw e;
    }
  }

  /**
   * Prune previous image versions.
   * @param dockerApi
   * @param registry
   * @param container
   * @param logContainer
   * @returns {Promise<void>}
   */
  async pruneImages(dockerApi, registry, container, logContainer) {
    logContainer.info('Pruning previous tags');
    try {
      // Get all pulled images
      const images = await dockerApi.listImages();

      // Find all pulled images to remove
      const imagesToRemove = images
        .filter((image) => hasRepoTags(image))
        .map((image) => ({
          image,
          normalizedImage: normalizeListedImage(registry, image),
        }))
        .filter(({ normalizedImage }) => !shouldKeepImage(normalizedImage, container))
        .map(({ image }) => image)
        .map((imageToRemove) => dockerApi.getImage(imageToRemove.Id));
      await Promise.all(
        imagesToRemove.map((imageToRemove) => {
          logContainer.info(`Prune image ${imageToRemove.name}`);
          return imageToRemove.remove();
        }),
      );
    } catch (e: unknown) {
      logContainer.warn(
        `Some errors occurred when trying to prune previous tags (${getErrorMessage(e)})`,
      );
    }
  }

  formatPullProgress(progressEvent) {
    const progressDetail = progressEvent?.progressDetail || {};
    if (
      typeof progressDetail.current === 'number' &&
      typeof progressDetail.total === 'number' &&
      progressDetail.total > 0
    ) {
      const percentage = Math.round((progressDetail.current * 100) / progressDetail.total);
      return `${progressDetail.current}/${progressDetail.total} (${percentage}%)`;
    }
    if (
      progressEvent &&
      typeof progressEvent.progress === 'string' &&
      progressEvent.progress.trim() !== ''
    ) {
      return progressEvent.progress;
    }
    return undefined;
  }

  createPullProgressLogger(logContainer, imageName) {
    let lastLogAt = 0;
    let lastProgressSnapshot = '';
    const logProgress = (progressEvent, force = false) => {
      if (!progressEvent || typeof logContainer.debug !== 'function') {
        return;
      }

      const status = progressEvent.status || 'progress';
      const layer = progressEvent.id ? ` layer=${progressEvent.id}` : '';
      const progress = this.formatPullProgress(progressEvent);
      const progressSnapshot = progress ? `${status}${layer} ${progress}` : `${status}${layer}`;
      const now = Date.now();

      if (
        !force &&
        now - lastLogAt < PULL_PROGRESS_LOG_INTERVAL_MS &&
        progressSnapshot === lastProgressSnapshot
      ) {
        return;
      }
      if (!force && now - lastLogAt < PULL_PROGRESS_LOG_INTERVAL_MS) {
        return;
      }

      lastLogAt = now;
      lastProgressSnapshot = progressSnapshot;
      logContainer.debug(`Pull progress for ${imageName}: ${progressSnapshot}`);
    };

    return {
      onProgress: (progressEvent) => logProgress(progressEvent),
      onDone: (progressEvent) => logProgress(progressEvent, true),
    };
  }

  /**
   * Pull new image.
   * @param dockerApi
   * @param auth
   * @param newImage
   * @param logContainer
   * @returns {Promise<void>}
   */

  async pullImage(dockerApi, auth, newImage, logContainer) {
    logContainer.info(`Pull image ${newImage}`);
    try {
      const pullStream = await dockerApi.pull(newImage, {
        authconfig: auth,
      });
      const pullProgressLogger = this.createPullProgressLogger(logContainer, newImage);

      await new Promise((resolve, reject) =>
        dockerApi.modem.followProgress(
          pullStream,
          (error, output) => {
            if (Array.isArray(output) && output.length > 0) {
              pullProgressLogger.onDone(output.at(-1));
            }
            if (error) {
              reject(error);
            } else {
              resolve(undefined);
            }
          },
          (progressEvent) => {
            pullProgressLogger.onProgress(progressEvent);
          },
        ),
      );
      logContainer.info(`Image ${newImage} pulled with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when pulling image ${newImage} (${getErrorMessage(e)})`);
      throw e;
    }
  }

  /**
   * Stop a container.
   * @param container
   * @param containerName
   * @param containerId
   * @param logContainer
   * @returns {Promise<void>}
   */

  async stopContainer(container, containerName, containerId, logContainer) {
    logContainer.info(`Stop container ${containerName} with id ${containerId}`);
    try {
      await container.stop();
      logContainer.info(`Container ${containerName} with id ${containerId} stopped with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when stopping container ${containerName} with id ${containerId}`);
      throw e;
    }
  }

  /**
   * Remove a container.
   * @param container
   * @param containerName
   * @param containerId
   * @param logContainer
   * @returns {Promise<void>}
   */
  async removeContainer(container, containerName, containerId, logContainer) {
    logContainer.info(`Remove container ${containerName} with id ${containerId}`);
    try {
      await container.remove();
      logContainer.info(`Container ${containerName} with id ${containerId} removed with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when removing container ${containerName} with id ${containerId}`);
      throw e;
    }
  }

  /**
   * Wait for a container to be removed.
   */
  async waitContainerRemoved(container, containerName, containerId, logContainer) {
    logContainer.info(`Wait container ${containerName} with id ${containerId}`);
    try {
      await container.wait({
        condition: 'removed',
        abortSignal: AbortSignal.timeout(this.configuration.autoremovetimeout),
      });
      logContainer.info(
        `Container ${containerName} with id ${containerId} auto-removed successfully`,
      );
    } catch (e: unknown) {
      logContainer.warn(
        e,
        `Error while waiting for container ${containerName} with id ${containerId}`,
      );
      throw e;
    }
  }

  /**
   * Create a new container.
   * @param dockerApi
   * @param containerToCreate
   * @param containerName
   * @param logContainer
   * @returns {Promise<*>}
   */
  async createContainer(dockerApi, containerToCreate, containerName, logContainer) {
    logContainer.info(`Create container ${containerName}`);
    try {
      let containerToCreatePayload = containerToCreate;
      const endpointsConfig = containerToCreate.NetworkingConfig?.EndpointsConfig || {};
      const endpointNetworkNames = Object.keys(endpointsConfig);
      const additionalNetworkNames = [];

      if (endpointNetworkNames.length > 1) {
        const primaryNetworkName = this.runtimeConfigManager.getPrimaryNetworkName(
          containerToCreate,
          endpointNetworkNames,
        );

        containerToCreatePayload = {
          ...containerToCreate,
          NetworkingConfig: {
            EndpointsConfig: {
              [primaryNetworkName]: endpointsConfig[primaryNetworkName],
            },
          },
        };
        additionalNetworkNames.push(
          ...endpointNetworkNames.filter((networkName) => networkName !== primaryNetworkName),
        );
      }

      const newContainer = await dockerApi.createContainer(containerToCreatePayload);

      for (const networkName of additionalNetworkNames) {
        logContainer.info(`Connect container ${containerName} to network ${networkName}`);
        const network = dockerApi.getNetwork(networkName);
        await network.connect({
          Container: containerName,
          EndpointConfig: endpointsConfig[networkName],
        });
        logContainer.info(
          `Container ${containerName} connected to network ${networkName} with success`,
        );
      }

      logContainer.info(`Container ${containerName} recreated on new image with success`);
      return newContainer;
    } catch (e: unknown) {
      logContainer.warn(`Error when creating container ${containerName} (${getErrorMessage(e)})`);
      throw e;
    }
  }

  /**
   * Start container.
   * @param container
   * @param containerName
   * @param logContainer
   * @returns {Promise<void>}
   */
  async startContainer(container, containerName, logContainer) {
    logContainer.info(`Start container ${containerName}`);
    try {
      await container.start();
      logContainer.info(`Container ${containerName} started with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when starting container ${containerName}`);
      throw e;
    }
  }

  /**
   * Remove an image.
   * @param dockerApi
   * @param imageToRemove
   * @param logContainer
   * @returns {Promise<void>}
   */
  async removeImage(dockerApi, imageToRemove, logContainer) {
    logContainer.info(`Remove image ${imageToRemove}`);
    try {
      const image = await dockerApi.getImage(imageToRemove);
      await image.remove();
      logContainer.info(`Image ${imageToRemove} removed with success`);
    } catch (e: unknown) {
      logContainer.warn(`Error when removing image ${imageToRemove}`);
      throw e;
    }
  }

  /**
   * Clone container specs.
   * @param currentContainer
   * @param newImage
   * @returns {*}
   */
  cloneContainer(currentContainer, newImage, runtimeOptionsOrLogContainer = {}) {
    const { sourceImageConfig, targetImageConfig, runtimeFieldOrigins, logContainer } =
      this.runtimeConfigManager.buildCloneRuntimeConfigOptions(runtimeOptionsOrLogContainer);
    const containerName = currentContainer.Name.replace('/', '');
    const currentContainerNetworks = currentContainer.NetworkSettings?.Networks || {};
    const endpointsConfig = Object.entries(currentContainerNetworks).reduce(
      (acc: Record<string, unknown>, [networkName, endpointConfig]) => {
        acc[networkName] = this.runtimeConfigManager.sanitizeEndpointConfig(
          endpointConfig as Record<string, unknown> | null | undefined,
          currentContainer.Id,
        );
        return acc;
      },
      {},
    );
    const sanitizedContainerConfig = this.runtimeConfigManager.sanitizeClonedRuntimeConfig(
      currentContainer.Config,
      sourceImageConfig,
      targetImageConfig,
      runtimeFieldOrigins,
      logContainer,
    );
    const shouldAnnotateRuntimeFieldOrigins =
      sourceImageConfig !== undefined ||
      targetImageConfig !== undefined ||
      runtimeFieldOrigins !== undefined;
    const clonedContainerConfig = shouldAnnotateRuntimeFieldOrigins
      ? this.runtimeConfigManager.annotateClonedRuntimeFieldOrigins(
          sanitizedContainerConfig,
          runtimeFieldOrigins,
          targetImageConfig,
        )
      : sanitizedContainerConfig;

    const containerClone: {
      HostConfig?: { NetworkMode?: string };
      Hostname?: unknown;
      ExposedPorts?: unknown;
      [key: string]: unknown;
    } = {
      ...clonedContainerConfig,
      name: containerName,
      Image: newImage,
      HostConfig: currentContainer.HostConfig,
      NetworkingConfig: {
        EndpointsConfig: endpointsConfig,
      },
    };
    // Handle situation when container is using network_mode: service:other_service
    if (containerClone.HostConfig?.NetworkMode?.startsWith('container:')) {
      delete containerClone.Hostname;
      delete containerClone.ExposedPorts;
    }

    return containerClone;
  }

  /**
   * Get image full name.
   * @param registry the registry
   * @param container the container
   */
  getNewImageFullName(registry, container) {
    // Tag to pull/run is
    // either the same (when updateKind is digest)
    // or the new one (when updateKind is tag)
    const tagOrDigest =
      container.updateKind.kind === 'digest'
        ? container.image.tag.value
        : (container.updateKind.remoteValue ?? container.image.tag.value);

    // Rebuild image definition string
    return registry.getImageFullName(container.image, tagOrDigest);
  }

  /**
   * Stop and remove (or wait for auto-removal of) a container.
   */
  async stopAndRemoveContainer(currentContainer, currentContainerSpec, container, logContainer) {
    if (currentContainerSpec.State.Running) {
      await this.stopContainer(currentContainer, container.name, container.id, logContainer);
    }

    if (currentContainerSpec.HostConfig?.AutoRemove !== true) {
      await this.removeContainer(currentContainer, container.name, container.id, logContainer);
    } else {
      await this.waitContainerRemoved(currentContainer, container.name, container.id, logContainer);
    }
  }

  /**
   * Create a new container from the cloned spec and start it if
   * the previous container was running.
   */
  async recreateContainer(dockerApi, currentContainerSpec, newImage, container, logContainer) {
    const containerToCreateInspect = this.cloneContainer(
      currentContainerSpec,
      newImage,
      logContainer,
    );

    const newContainer = await this.createContainer(
      dockerApi,
      containerToCreateInspect,
      container.name,
      logContainer,
    );

    if (currentContainerSpec.State.Running) {
      await this.startContainer(newContainer, container.name, logContainer);
    }
  }

  /**
   * Remove old images after a container update when pruning is enabled.
   */
  async cleanupOldImages(dockerApi, registry, container, logContainer) {
    if (!this.configuration.prune) return;

    // Don't prune images that are retained as backups — they're needed for rollback
    const retainedBackups = backupStore.getBackupsByName(container.name) || [];
    const retainedTags = new Set(retainedBackups.map((b) => b.imageTag));

    if (container.updateKind.kind === 'tag') {
      if (retainedTags.has(container.image.tag.value)) {
        logContainer.info(`Skipping prune of ${container.image.tag.value} — retained for rollback`);
        return;
      }
      const oldImage = registry.getImageFullName(container.image, container.image.tag.value);
      await this.removeImage(dockerApi, oldImage, logContainer);
    } else if (container.updateKind.kind === 'digest' && container.image.digest.repo) {
      try {
        const oldImage = registry.getImageFullName(container.image, container.image.digest.repo);
        await this.removeImage(dockerApi, oldImage, logContainer);
      } catch (e: unknown) {
        logContainer.warn(`Unable to remove previous digest image (${getErrorMessage(e)})`);
      }
    }
  }

  /**
   * Preview what an update would do without performing it.
   * @param container the container
   * @returns {Promise<object>} preview info
   */
  async preview(container) {
    const logContainer = this.log.child({ container: fullName(container) });
    const watcher = this.getWatcher(container);
    const { dockerApi } = watcher;
    const registry = this.resolveRegistryManager(container, logContainer, {
      allowAnonymousFallback: true,
    });
    const newImage = this.getNewImageFullName(registry, container);

    const currentContainer = await this.getCurrentContainer(dockerApi, container);
    if (currentContainer) {
      const currentContainerSpec = await this.inspectContainer(currentContainer, logContainer);

      return {
        containerName: container.name,
        currentImage: `${container.image.registry.name}/${container.image.name}:${container.image.tag.value}`,
        newImage,
        updateKind: container.updateKind,
        isRunning: currentContainerSpec.State.Running,
        networks: Object.keys(currentContainerSpec.NetworkSettings?.Networks || {}),
      };
    }
    return { error: 'Container not found in Docker' };
  }

  buildHookConfig(container) {
    return this.hookExecutor.buildHookConfig(container);
  }

  recordAudit(action, container, status, details) {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action,
      containerName: fullName(container),
      containerImage: container.image.name,
      status,
      details,
    });
    getAuditCounter()?.inc({ action });
  }

  recordRollbackAudit(container, status, details, fromVersion?: string, toVersion?: string) {
    auditStore.insertAudit({
      id: '',
      timestamp: new Date().toISOString(),
      action: 'rollback',
      containerName: fullName(container),
      containerImage: container.image.name,
      status,
      details,
      fromVersion,
      toVersion,
    });
    getAuditCounter()?.inc({ action: 'rollback' });
  }

  recordRollbackTelemetry({
    container,
    outcome,
    reason,
    details,
    fromVersion,
    toVersion,
  }: RollbackTelemetryPayload) {
    const reasonLabel = String(reason || 'unspecified')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 63);

    getRollbackCounter()?.inc({
      type: this.type || 'docker',
      name: this.name || 'update',
      outcome,
      reason: reasonLabel || 'unspecified',
    });

    const auditStatus = outcome === 'error' ? 'error' : outcome === 'success' ? 'success' : 'info';
    this.recordRollbackAudit(container, auditStatus, details, fromVersion, toVersion);
  }

  hasHealthcheckConfigured(containerSpec) {
    return !!(containerSpec?.Config?.Healthcheck || containerSpec?.State?.Health);
  }

  async waitForContainerHealthy(containerToCheck, containerName, logContainer) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < NON_SELF_UPDATE_HEALTH_TIMEOUT_MS) {
      const inspection = await containerToCheck.inspect();
      const healthState = inspection?.State?.Health;
      const healthStatus = healthState?.Status;

      if (!healthState) {
        logContainer.debug?.(
          `Container ${containerName} health state not yet available — waiting for health gate`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, NON_SELF_UPDATE_HEALTH_POLL_INTERVAL_MS),
        );
        continue;
      }

      if (healthStatus === 'healthy') {
        logContainer.info(`Container ${containerName} passed health gate`);
        return;
      }

      if (healthStatus === 'unhealthy') {
        throw new Error(`Health gate failed: container ${containerName} reported unhealthy`);
      }

      await new Promise((resolve) => setTimeout(resolve, NON_SELF_UPDATE_HEALTH_POLL_INTERVAL_MS));
    }

    throw new Error(
      `Health gate timed out after ${NON_SELF_UPDATE_HEALTH_TIMEOUT_MS}ms for container ${containerName}`,
    );
  }

  async reconcileInProgressContainerUpdateOperation(dockerApi, container, logContainer) {
    return this.containerUpdateExecutor.reconcileInProgressContainerUpdateOperation(
      dockerApi,
      container,
      logContainer,
    );
  }

  recordHookAudit(action, container, status, details) {
    this.recordAudit(action, container, status, details);
  }

  recordHookConfigurationAudit(container, hookConfig) {
    const hasPreHook = Boolean(hookConfig.hookPre);
    const hasPostHook = Boolean(hookConfig.hookPost);
    if (!hasPreHook && !hasPostHook) {
      return;
    }

    this.recordHookAudit(
      'hook-configured',
      container,
      'info',
      `Lifecycle hooks configured from labels (pre=${hasPreHook}, post=${hasPostHook}, preAbort=${hookConfig.hookPreAbort}, timeout=${hookConfig.hookTimeout}ms)`,
    );
  }

  recordSecurityAudit(action, container, status, details) {
    this.recordAudit(action, container, status, details);
  }

  isHookFailure(hookResult) {
    return this.hookExecutor.isHookFailure(hookResult);
  }

  getHookFailureDetails(prefix, hookResult, hookTimeout) {
    return this.hookExecutor.getHookFailureDetails(prefix, hookResult, hookTimeout);
  }

  async runPreUpdateHook(container, hookConfig, logContainer) {
    await this.hookExecutor.runPreUpdateHook(container, hookConfig, logContainer);
  }

  async runPostUpdateHook(container, hookConfig, logContainer) {
    await this.hookExecutor.runPostUpdateHook(container, hookConfig, logContainer);
  }

  isSelfUpdate(container) {
    return this.selfUpdateOrchestrator.isSelfUpdate(container);
  }

  findDockerSocketBind(spec) {
    return this.selfUpdateOrchestrator.findDockerSocketBind(spec);
  }

  async executeSelfUpdate(
    context,
    container,
    logContainer,
    operationId?: string,
    _runtimeContext?: unknown,
  ) {
    return this.selfUpdateOrchestrator.execute(context, container, logContainer, operationId);
  }

  async maybeNotifySelfUpdate(container, logContainer, operationId?: string) {
    await this.selfUpdateOrchestrator.maybeNotify(container, logContainer, operationId);
  }

  async persistSecurityState(container, securityPatch, logContainer) {
    await this.getSecurityGate().persistSecurityState(container, securityPatch, logContainer);
  }

  async maybeScanAndGateUpdate(context, container, logContainer) {
    await this.getSecurityGate().maybeScanAndGateUpdate(context, container, logContainer);
  }

  async createTriggerContext(container, logContainer, _runtimeContext?: unknown) {
    const watcher = this.getWatcher(container);
    const { dockerApi } = watcher;

    logContainer.debug(`Get ${container.image.registry.name} registry manager`);
    const registry = this.resolveRegistryManager(container, logContainer, {
      allowAnonymousFallback: true,
    });

    logContainer.debug(`Get ${container.image.registry.name} registry credentials`);
    const auth = await registry.getAuthPull();

    const newImage = this.getNewImageFullName(registry, container);
    const currentContainer = await this.getCurrentContainer(dockerApi, container);

    if (!currentContainer) {
      logContainer.warn('Unable to update the container because it does not exist');
      return undefined;
    }

    const currentContainerSpec = await this.inspectContainer(currentContainer, logContainer);
    return {
      dockerApi,
      registry,
      auth,
      newImage,
      currentContainer,
      currentContainerSpec,
    };
  }

  insertContainerImageBackup(context, container) {
    const { registry } = context;
    // Store the Docker-pullable image reference (e.g. "nginx") not the
    // internal registry-prefixed name (e.g. "hub.public/library/nginx").
    // Use a sentinel tag to extract just the base name, since
    // getImageFullName returns "name:tag" and we store tag separately.
    const baseImageName = registry
      .getImageFullName(container.image, '__TAG__')
      .replace(/:__TAG__$/, '');
    backupStore.insertBackup({
      id: crypto.randomUUID(),
      containerId: container.id,
      containerName: container.name,
      imageName: baseImageName,
      imageTag: container.image.tag.value,
      imageDigest: container.image.digest?.repo,
      timestamp: new Date().toISOString(),
      triggerName: this.getId(),
    });
  }

  async runPreRuntimeUpdateLifecycle(context, container, logContainer, _runtimeContext?: unknown) {
    const { dockerApi, registry } = context;

    if (this.configuration.prune) {
      await this.pruneImages(dockerApi, registry, container, logContainer);
    }

    this.insertContainerImageBackup(context, container);
  }

  async executeContainerUpdate(context, container, logContainer) {
    return this.containerUpdateExecutor.execute(context, container, logContainer);
  }

  /**
   * Perform the container update (pull, stop, recreate).
   * Subclasses (e.g. Dockercompose) override this to use their own runtime
   * mechanics while reusing the shared lifecycle orchestrator.
   */
  async performContainerUpdate(context, container, logContainer, _runtimeContext?: unknown) {
    const updated = await this.executeContainerUpdate(context, container, logContainer);
    if (updated && container.updateKind?.kind === 'tag') {
      await syncComposeFileTag({
        labels: context.currentContainerSpec?.Config?.Labels,
        newImage: context.newImage,
        logContainer,
      });
    }
    return updated;
  }

  getRollbackConfig(container) {
    return this.rollbackMonitor.getConfig(container);
  }

  async maybeStartAutoRollbackMonitor(dockerApi, container, rollbackConfig, logContainer) {
    return this.rollbackMonitor.start(dockerApi, container, rollbackConfig, logContainer);
  }

  /**
   * Shared per-container update lifecycle. Handles security scanning, hooks,
   * prune/backup preparation, backup pruning, rollback monitoring, and events.
   * Delegates the actual runtime update to `performContainerUpdate()` which
   * subclasses can override.
   */
  async runContainerUpdateLifecycle(container, runtimeContext?: unknown) {
    return this.updateLifecycleExecutor.run(container, runtimeContext);
  }

  /**
   * Update the container.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container, runtimeContext?: unknown) {
    await this.runContainerUpdateLifecycle(container, runtimeContext);
  }

  /**
   * Update the containers.
   * @param containers
   * @returns {Promise<unknown[]>}
   */
  async triggerBatch(containers): Promise<unknown[]> {
    const limit = pLimit(TRIGGER_BATCH_CONCURRENCY);
    return Promise.all(containers.map((container) => limit(() => this.trigger(container))));
  }
}

export default Docker;
