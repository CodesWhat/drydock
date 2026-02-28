// @ts-nocheck
import crypto from 'node:crypto';
import parse from 'parse-docker-image-name';
import { getSecurityConfiguration } from '../../../configuration/index.js';
import {
  emitContainerUpdateApplied,
  emitContainerUpdateFailed,
  emitSecurityAlert,
  emitSelfUpdateStarting,
} from '../../../event/index.js';
import { fullName } from '../../../model/container.js';
import { getAuditCounter } from '../../../prometheus/audit.js';
import { recordLegacyInput } from '../../../prometheus/compatibility.js';
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
import * as updateOperationStore from '../../../store/update-operation.js';
import { runHook } from '../../hooks/HookRunner.js';
import Trigger from '../Trigger.js';
import { startHealthMonitor } from './HealthMonitor.js';

const PULL_PROGRESS_LOG_INTERVAL_MS = 2000;
const SELF_UPDATE_START_TIMEOUT_MS = 30_000;
const SELF_UPDATE_HEALTH_TIMEOUT_MS = 120_000;
const SELF_UPDATE_POLL_INTERVAL_MS = 1_000;
const SELF_UPDATE_ACK_TIMEOUT_MS = 3_000;
const NON_SELF_UPDATE_HEALTH_TIMEOUT_MS = 120_000;
const NON_SELF_UPDATE_HEALTH_POLL_INTERVAL_MS = 1_000;
const warnedLegacyTriggerLabelFallbacks = new Set<string>();
const RUNTIME_PROCESS_FIELDS = ['Entrypoint', 'Cmd'];
const RUNTIME_ORIGIN_EXPLICIT = 'explicit';
const RUNTIME_ORIGIN_INHERITED = 'inherited';
const RUNTIME_ORIGIN_UNKNOWN = 'unknown';
const RUNTIME_FIELD_ORIGIN_LABELS = {
  Entrypoint: {
    dd: 'dd.runtime.entrypoint.origin',
    wud: 'wud.runtime.entrypoint.origin',
  },
  Cmd: {
    dd: 'dd.runtime.cmd.origin',
    wud: 'wud.runtime.cmd.origin',
  },
};

function getPreferredLabelValue(labels, ddKey, wudKey, logger) {
  const ddValue = labels?.[ddKey];
  if (ddValue !== undefined) {
    return ddValue;
  }

  const wudValue = labels?.[wudKey];
  if (wudValue === undefined) {
    return undefined;
  }

  recordLegacyInput('label', wudKey);
  if (!warnedLegacyTriggerLabelFallbacks.has(wudKey)) {
    warnedLegacyTriggerLabelFallbacks.add(wudKey);
    logger?.warn?.(
      `Legacy Docker label "${wudKey}" is deprecated. Please migrate to "${ddKey}" before fallback support is removed.`,
    );
  }

  return wudValue;
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

/**
 * Replace a Docker container with an updated one.
 */
class Docker extends Trigger {
  public strictAgentMatch = true;

  sanitizeEndpointConfig(endpointConfig, currentContainerId) {
    if (!endpointConfig) {
      return {};
    }

    const sanitizedEndpointConfig: Record<string, any> = {};

    if (endpointConfig.IPAMConfig) {
      sanitizedEndpointConfig.IPAMConfig = endpointConfig.IPAMConfig;
    }
    if (endpointConfig.Links) {
      sanitizedEndpointConfig.Links = endpointConfig.Links;
    }
    if (endpointConfig.DriverOpts) {
      sanitizedEndpointConfig.DriverOpts = endpointConfig.DriverOpts;
    }
    if (endpointConfig.MacAddress) {
      sanitizedEndpointConfig.MacAddress = endpointConfig.MacAddress;
    }
    if (endpointConfig.Aliases?.length > 0) {
      sanitizedEndpointConfig.Aliases = endpointConfig.Aliases.filter(
        (alias) => !currentContainerId.startsWith(alias),
      );
    }

    return sanitizedEndpointConfig;
  }

  getPrimaryNetworkName(containerToCreate, networkNames) {
    const networkMode = containerToCreate?.HostConfig?.NetworkMode;
    if (networkMode && networkNames.includes(networkMode)) {
      return networkMode;
    }
    return networkNames[0];
  }

  normalizeContainerProcessArgs(processArgs) {
    if (processArgs === undefined || processArgs === null) {
      return undefined;
    }
    if (Array.isArray(processArgs)) {
      return processArgs.map((arg) => String(arg));
    }
    return [String(processArgs)];
  }

  areContainerProcessArgsEqual(left, right) {
    const leftNormalized = this.normalizeContainerProcessArgs(left);
    const rightNormalized = this.normalizeContainerProcessArgs(right);

    if (leftNormalized === undefined && rightNormalized === undefined) {
      return true;
    }
    if (leftNormalized === undefined || rightNormalized === undefined) {
      return false;
    }
    if (leftNormalized.length !== rightNormalized.length) {
      return false;
    }
    return leftNormalized.every((value, index) => value === rightNormalized[index]);
  }

  normalizeRuntimeFieldOrigin(origin) {
    const normalizedOrigin = String(origin || '').toLowerCase();
    if (
      normalizedOrigin === RUNTIME_ORIGIN_EXPLICIT ||
      normalizedOrigin === RUNTIME_ORIGIN_INHERITED
    ) {
      return normalizedOrigin;
    }
    return RUNTIME_ORIGIN_UNKNOWN;
  }

  getRuntimeFieldOrigin(containerConfig, runtimeField) {
    const runtimeOriginLabels = RUNTIME_FIELD_ORIGIN_LABELS[runtimeField];
    const originFromLabel = getPreferredLabelValue(
      containerConfig?.Labels,
      runtimeOriginLabels.dd,
      runtimeOriginLabels.wud,
      this.log,
    );
    const normalizedOrigin = this.normalizeRuntimeFieldOrigin(originFromLabel);
    if (normalizedOrigin !== RUNTIME_ORIGIN_UNKNOWN) {
      return normalizedOrigin;
    }

    if (containerConfig?.[runtimeField] === undefined) {
      return RUNTIME_ORIGIN_INHERITED;
    }
    return RUNTIME_ORIGIN_UNKNOWN;
  }

  getRuntimeFieldOrigins(containerConfig) {
    return RUNTIME_PROCESS_FIELDS.reduce((runtimeFieldOrigins, runtimeField) => {
      runtimeFieldOrigins[runtimeField] = this.getRuntimeFieldOrigin(containerConfig, runtimeField);
      return runtimeFieldOrigins;
    }, {});
  }

  annotateClonedRuntimeFieldOrigins(containerConfig, runtimeFieldOrigins, targetImageConfig) {
    const labels = { ...(containerConfig?.Labels || {}) };

    for (const runtimeField of RUNTIME_PROCESS_FIELDS) {
      const runtimeValue = containerConfig?.[runtimeField];
      let nextRuntimeOrigin = RUNTIME_ORIGIN_INHERITED;

      if (runtimeValue !== undefined) {
        const currentRuntimeOrigin = this.normalizeRuntimeFieldOrigin(
          runtimeFieldOrigins?.[runtimeField],
        );
        if (currentRuntimeOrigin === RUNTIME_ORIGIN_INHERITED) {
          nextRuntimeOrigin = this.areContainerProcessArgsEqual(
            runtimeValue,
            targetImageConfig?.[runtimeField],
          )
            ? RUNTIME_ORIGIN_INHERITED
            : RUNTIME_ORIGIN_EXPLICIT;
        } else {
          nextRuntimeOrigin = RUNTIME_ORIGIN_EXPLICIT;
        }
      }

      labels[RUNTIME_FIELD_ORIGIN_LABELS[runtimeField].dd] = nextRuntimeOrigin;
    }

    return {
      ...(containerConfig || {}),
      Labels: labels,
    };
  }

  buildCloneRuntimeConfigOptions(runtimeOptionsOrLogContainer) {
    if (!runtimeOptionsOrLogContainer) {
      return {};
    }

    const hasRuntimeConfigOptions =
      Object.hasOwn(runtimeOptionsOrLogContainer, 'sourceImageConfig') ||
      Object.hasOwn(runtimeOptionsOrLogContainer, 'targetImageConfig') ||
      Object.hasOwn(runtimeOptionsOrLogContainer, 'runtimeFieldOrigins') ||
      Object.hasOwn(runtimeOptionsOrLogContainer, 'logContainer');

    if (hasRuntimeConfigOptions) {
      return runtimeOptionsOrLogContainer;
    }

    // Backward compatibility for existing callsites that passed logContainer
    return { logContainer: runtimeOptionsOrLogContainer };
  }

  sanitizeClonedRuntimeConfig(
    containerConfig,
    sourceImageConfig,
    targetImageConfig,
    runtimeFieldOrigins,
    logContainer,
  ) {
    const sanitizedConfig = { ...(containerConfig || {}) };

    for (const runtimeField of RUNTIME_PROCESS_FIELDS) {
      const clonedValue = containerConfig?.[runtimeField];
      if (clonedValue === undefined) {
        continue;
      }

      const runtimeOrigin = this.normalizeRuntimeFieldOrigin(runtimeFieldOrigins?.[runtimeField]);
      const inheritedFromSource = this.areContainerProcessArgsEqual(
        clonedValue,
        sourceImageConfig?.[runtimeField],
      );
      if (runtimeOrigin !== RUNTIME_ORIGIN_INHERITED) {
        if (runtimeOrigin === RUNTIME_ORIGIN_UNKNOWN && inheritedFromSource) {
          logContainer?.debug?.(
            `Preserving ${runtimeField} because runtime origin is unknown; avoiding stale-default cleanup to prevent dropping explicit pins`,
          );
        }
        continue;
      }

      if (!inheritedFromSource) {
        continue;
      }

      const matchesTargetDefault = this.areContainerProcessArgsEqual(
        clonedValue,
        targetImageConfig?.[runtimeField],
      );
      if (matchesTargetDefault) {
        continue;
      }

      delete sanitizedConfig[runtimeField];
      logContainer?.info?.(
        `Dropping stale ${runtimeField} from cloned container spec so target image defaults can be used`,
      );
    }

    return sanitizedConfig;
  }

  async inspectImageConfig(dockerApi, imageRef, logContainer) {
    if (!dockerApi?.getImage || !imageRef) {
      return undefined;
    }

    try {
      const image = await dockerApi.getImage(imageRef);
      if (!image?.inspect) {
        return undefined;
      }
      const imageSpec = await image.inspect();
      return imageSpec?.Config;
    } catch (e) {
      logContainer?.debug?.(
        `Unable to inspect image ${imageRef} for runtime defaults (${e.message})`,
      );
      return undefined;
    }
  }

  async getCloneRuntimeConfigOptions(dockerApi, currentContainerSpec, newImage, logContainer) {
    const sourceImageRef = currentContainerSpec?.Config?.Image ?? currentContainerSpec?.Image;
    const [sourceImageConfig, targetImageConfig] = await Promise.all([
      this.inspectImageConfig(dockerApi, sourceImageRef, logContainer),
      this.inspectImageConfig(dockerApi, newImage, logContainer),
    ]);

    return {
      sourceImageConfig,
      targetImageConfig,
      runtimeFieldOrigins: this.getRuntimeFieldOrigins(currentContainerSpec?.Config),
      logContainer,
    };
  }

  isRuntimeConfigCompatibilityError(errorMessage) {
    if (typeof errorMessage !== 'string') {
      return false;
    }

    const normalizedMessage = errorMessage.toLowerCase();
    return (
      normalizedMessage.includes('exec:') &&
      (normalizedMessage.includes('no such file or directory') ||
        normalizedMessage.includes('executable file not found') ||
        normalizedMessage.includes('permission denied'))
    );
  }

  buildRuntimeConfigCompatibilityError(
    error,
    containerName,
    currentContainerSpec,
    targetImage,
    rollbackSucceeded,
  ) {
    const originalMessage = error?.message ?? String(error);
    if (!this.isRuntimeConfigCompatibilityError(originalMessage)) {
      return undefined;
    }

    const sourceImage =
      currentContainerSpec?.Config?.Image ?? currentContainerSpec?.Image ?? 'unknown';
    const rollbackStatus = rollbackSucceeded
      ? 'Rollback completed.'
      : 'Rollback attempted but did not fully complete.';

    return new Error(
      `Container ${containerName} runtime command is incompatible with target image ${targetImage} (source image: ${sourceImage}). ${rollbackStatus} Review Entrypoint/Cmd overrides and retry. Original error: ${originalMessage}`,
    );
  }

  isContainerNotFoundError(error) {
    if (!error) {
      return false;
    }

    const statusCode = error?.statusCode ?? error?.status;
    if (statusCode === 404) {
      return true;
    }

    const errorMessage = `${error?.message ?? ''} ${error?.reason ?? ''} ${error?.json?.message ?? ''}`;
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
    return getState().watcher[`docker.${container.watcher}`];
  }

  normalizeRegistryHost(registryUrlOrName) {
    if (typeof registryUrlOrName !== 'string') {
      return undefined;
    }
    const registryHostCandidate = registryUrlOrName.trim();
    if (registryHostCandidate === '') {
      return undefined;
    }

    try {
      if (/^https?:\/\//i.test(registryHostCandidate)) {
        return new URL(registryHostCandidate).host;
      }
    } catch {
      return undefined;
    }

    return registryHostCandidate
      .replace(/^https?:\/\//i, '')
      .replace(/\/v2\/?$/i, '')
      .replace(/\/+$/, '');
  }

  buildRegistryLookupCandidates(image) {
    if (!image) {
      return [];
    }
    const candidates = [image];
    const registryUrl = image.registry?.url;

    if (typeof registryUrl !== 'string' || registryUrl.trim() === '') {
      return candidates;
    }

    const trimmedRegistryUrl = registryUrl.trim();
    const normalizedRegistryHost = this.normalizeRegistryHost(trimmedRegistryUrl);
    if (normalizedRegistryHost) {
      candidates.push({
        ...image,
        registry: {
          ...image.registry,
          url: normalizedRegistryHost,
        },
      });
      candidates.push({
        ...image,
        registry: {
          ...image.registry,
          url: `http://${normalizedRegistryHost}`,
        },
      });
      candidates.push({
        ...image,
        registry: {
          ...image.registry,
          url: `https://${normalizedRegistryHost}`,
        },
      });
    }

    const registryUrlWithoutV2 = trimmedRegistryUrl.replace(/\/v2\/?$/i, '');
    if (registryUrlWithoutV2 !== trimmedRegistryUrl) {
      candidates.push({
        ...image,
        registry: {
          ...image.registry,
          url: registryUrlWithoutV2,
        },
      });
    }

    return candidates;
  }

  isRegistryManagerCompatible(registry, options = {}) {
    const { requireNormalizeImage = false } = options;
    if (!registry || typeof registry !== 'object') {
      return false;
    }
    if (typeof registry.getAuthPull !== 'function') {
      return false;
    }
    if (typeof registry.getImageFullName !== 'function') {
      return false;
    }
    if (requireNormalizeImage && typeof registry.normalizeImage !== 'function') {
      return false;
    }
    return true;
  }

  createAnonymousRegistryManager(container, logContainer) {
    const registryName = container?.image?.registry?.name;
    const registryUrl = container?.image?.registry?.url;
    const registryHost = this.normalizeRegistryHost(registryUrl);

    if (!registryHost) {
      return undefined;
    }

    const imageName = container?.image?.name;
    if (typeof imageName !== 'string' || imageName.trim() === '') {
      return undefined;
    }

    logContainer.info?.(
      `Registry manager "${registryName}" is not configured; using anonymous pull mode for "${registryHost}"`,
    );

    return {
      getAuthPull: async () => undefined,
      getImageFullName: (image, tagOrDigest) => {
        const imageNameResolved = String(image?.name ?? '').replace(/^\/+/, '');
        if (imageNameResolved === '') {
          throw new Error('Container image name is missing');
        }

        const tagOrDigestResolved = String(tagOrDigest ?? '').trim();
        if (tagOrDigestResolved === '') {
          throw new Error('Container image tag/digest is missing');
        }

        const separator = tagOrDigestResolved.includes(':') ? '@' : ':';
        return `${registryHost}/${imageNameResolved}${separator}${tagOrDigestResolved}`;
      },
      normalizeImage: (image) => {
        const normalizedImage = structuredClone(image);
        normalizedImage.registry = normalizedImage.registry || {};
        normalizedImage.registry.url = registryHost;
        normalizedImage.registry.name =
          registryName || normalizedImage.registry.name || 'anonymous';
        return normalizedImage;
      },
    };
  }

  resolveRegistryManager(container, logContainer, options = {}) {
    const { allowAnonymousFallback = false } = options;
    const registryName = container?.image?.registry?.name;
    const registryState = getState().registry || {};
    const requireNormalizeImage =
      this.configuration.prune === true && !this.isSelfUpdate(container);
    const requiredMethods = ['getAuthPull', 'getImageFullName'];
    if (requireNormalizeImage) {
      requiredMethods.push('normalizeImage');
    }

    const ensureCompatible = (registryManager, source) => {
      if (!registryManager) {
        return undefined;
      }
      if (
        !this.isRegistryManagerCompatible(registryManager, {
          requireNormalizeImage,
        })
      ) {
        throw new Error(
          `Registry manager "${registryName}" is misconfigured (${source}); expected methods: ${requiredMethods.join(', ')}`,
        );
      }
      return registryManager;
    };

    const byName = ensureCompatible(registryState[registryName], 'lookup by name');
    if (byName) {
      return byName;
    }

    const lookupCandidates = this.buildRegistryLookupCandidates(container?.image);
    for (const imageCandidate of lookupCandidates) {
      const byMatch = Object.values(registryState).find((registryManager) => {
        if (typeof registryManager?.match !== 'function') {
          return false;
        }
        try {
          return registryManager.match(imageCandidate);
        } catch {
          return false;
        }
      });
      if (byMatch) {
        const byMatchCompatible = ensureCompatible(byMatch, 'lookup by image match');
        if (byMatchCompatible) {
          const matchedRegistryId =
            typeof byMatchCompatible.getId === 'function' ? byMatchCompatible.getId() : 'unknown';
          logContainer.debug?.(
            `Resolved registry manager "${registryName}" using matcher "${matchedRegistryId}"`,
          );
          return byMatchCompatible;
        }
      }
    }

    if (allowAnonymousFallback) {
      const anonymousRegistryManager = this.createAnonymousRegistryManager(container, logContainer);
      if (anonymousRegistryManager) {
        return anonymousRegistryManager;
      }
    }

    const knownRegistries = Object.keys(registryState);
    const knownRegistriesAsString =
      knownRegistries.length > 0 ? knownRegistries.join(', ') : 'none';
    throw new Error(
      `Unsupported registry manager "${registryName}". Known registries: ${knownRegistriesAsString}. Configure a matching registry or provide a valid registry URL.`,
    );
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
      logContainer.warn(`Some errors occurred when trying to prune previous tags (${e.message})`);
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
    } catch (e) {
      logContainer.warn(`Error when pulling image ${newImage} (${e.message})`);
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
        const primaryNetworkName = this.getPrimaryNetworkName(
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
    } catch (e) {
      logContainer.warn(`Error when creating container ${containerName} (${e.message})`);
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
    } catch (e) {
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
    } catch (e) {
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
      this.buildCloneRuntimeConfigOptions(runtimeOptionsOrLogContainer);
    const containerName = currentContainer.Name.replace('/', '');
    const currentContainerNetworks = currentContainer.NetworkSettings?.Networks || {};
    const endpointsConfig = Object.entries(currentContainerNetworks).reduce(
      (acc: Record<string, any>, [networkName, endpointConfig]) => {
        acc[networkName] = this.sanitizeEndpointConfig(endpointConfig, currentContainer.Id);
        return acc;
      },
      {},
    );
    const sanitizedContainerConfig = this.sanitizeClonedRuntimeConfig(
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
      ? this.annotateClonedRuntimeFieldOrigins(
          sanitizedContainerConfig,
          runtimeFieldOrigins,
          targetImageConfig,
        )
      : sanitizedContainerConfig;

    const containerClone = {
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
      } catch (e) {
        logContainer.debug(`Unable to remove previous digest image (${e.message})`);
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
    const logger = this.log?.child?.({});
    return {
      hookPre: getPreferredLabelValue(container.labels, 'dd.hook.pre', 'wud.hook.pre', logger),
      hookPost: getPreferredLabelValue(container.labels, 'dd.hook.post', 'wud.hook.post', logger),
      hookPreAbort:
        (
          getPreferredLabelValue(
            container.labels,
            'dd.hook.pre.abort',
            'wud.hook.pre.abort',
            logger,
          ) ?? 'true'
        ).toLowerCase() === 'true',
      hookTimeout: Number.parseInt(
        getPreferredLabelValue(container.labels, 'dd.hook.timeout', 'wud.hook.timeout', logger) ??
          '60000',
        10,
      ),
      hookEnv: {
        DD_CONTAINER_NAME: container.name,
        DD_CONTAINER_ID: container.id,
        DD_IMAGE_NAME: container.image.name,
        DD_IMAGE_TAG: container.image.tag.value,
        DD_UPDATE_KIND: container.updateKind.kind,
        DD_UPDATE_FROM: container.updateKind.localValue ?? '',
        DD_UPDATE_TO: container.updateKind.remoteValue ?? '',
      },
    };
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

  recordRollbackTelemetry(
    container,
    outcome: 'success' | 'error' | 'info',
    reason: string,
    details: string,
    fromVersion?: string,
    toVersion?: string,
  ) {
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

  recordHookAudit(action, container, status, details) {
    this.recordAudit(action, container, status, details);
  }

  recordSecurityAudit(action, container, status, details) {
    this.recordAudit(action, container, status, details);
  }

  isHookFailure(hookResult) {
    return hookResult.exitCode !== 0 || hookResult.timedOut;
  }

  getHookFailureDetails(prefix, hookResult, hookTimeout) {
    if (hookResult.timedOut) {
      return `${prefix} hook timed out after ${hookTimeout}ms`;
    }
    return `${prefix} hook exited with code ${hookResult.exitCode}: ${hookResult.stderr}`;
  }

  async runPreUpdateHook(container, hookConfig, logContainer) {
    if (!hookConfig.hookPre) {
      return;
    }

    const preResult = await runHook(hookConfig.hookPre, {
      timeout: hookConfig.hookTimeout,
      env: hookConfig.hookEnv,
      label: 'pre-update',
    });

    if (this.isHookFailure(preResult)) {
      const details = this.getHookFailureDetails('Pre-update', preResult, hookConfig.hookTimeout);
      this.recordHookAudit('hook-pre-failed', container, 'error', details);
      logContainer.warn(details);
      if (hookConfig.hookPreAbort) {
        throw new Error(details);
      }
      return;
    }

    this.recordHookAudit(
      'hook-pre-success',
      container,
      'success',
      `Pre-update hook completed: ${preResult.stdout}`.trim(),
    );
  }

  async runPostUpdateHook(container, hookConfig, logContainer) {
    if (!hookConfig.hookPost) {
      return;
    }

    const postResult = await runHook(hookConfig.hookPost, {
      timeout: hookConfig.hookTimeout,
      env: hookConfig.hookEnv,
      label: 'post-update',
    });

    if (this.isHookFailure(postResult)) {
      const details = this.getHookFailureDetails('Post-update', postResult, hookConfig.hookTimeout);
      this.recordHookAudit('hook-post-failed', container, 'error', details);
      logContainer.warn(details);
      return;
    }

    this.recordHookAudit(
      'hook-post-success',
      container,
      'success',
      `Post-update hook completed: ${postResult.stdout}`.trim(),
    );
  }

  isSelfUpdate(container) {
    return container.image.name === 'drydock' || container.image.name.endsWith('/drydock');
  }

  findDockerSocketBind(spec) {
    const binds = spec?.HostConfig?.Binds;
    if (!Array.isArray(binds)) return undefined;
    for (const bind of binds) {
      const parts = bind.split(':');
      if (parts.length >= 2 && parts[1] === '/var/run/docker.sock') {
        return parts[0];
      }
    }
    return undefined;
  }

  async executeSelfUpdate(context, container, logContainer, operationId?: string) {
    const { dockerApi, auth, newImage, currentContainer, currentContainerSpec } = context;

    if (this.configuration.dryrun) {
      logContainer.info('Do not replace the existing container because dry-run mode is enabled');
      return false;
    }

    const socketPath = this.findDockerSocketBind(currentContainerSpec);
    if (!socketPath) {
      throw new Error(
        'Self-update requires the Docker socket to be bind-mounted (e.g. /var/run/docker.sock:/var/run/docker.sock)',
      );
    }

    // Insert backup before starting the update.
    this.insertContainerImageBackup(context, container);

    // Pull the new image while we're still alive
    await this.pullImage(dockerApi, auth, newImage, logContainer);
    const cloneRuntimeConfigOptions = await this.getCloneRuntimeConfigOptions(
      dockerApi,
      currentContainerSpec,
      newImage,
      logContainer,
    );

    const oldName = currentContainerSpec.Name.replace(/^\//, '');
    const tempName = `drydock-old-${Date.now()}`;

    // Rename old container to free the name
    logContainer.info(`Rename container ${oldName} to ${tempName}`);
    await currentContainer.rename({ name: tempName });

    let newContainer;
    try {
      // Create new container with original name (don't start — port conflict)
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
    } catch (e) {
      // Rollback: rename old container back to original name
      logContainer.warn(`Failed to create new container, rolling back rename: ${e.message}`);
      await currentContainer.rename({ name: oldName });
      throw e;
    }

    // Spawn a helper container to orchestrate the stop/start/cleanup
    let newContainerId;
    try {
      newContainerId = (await newContainer.inspect()).Id;
    } catch (e) {
      logContainer.warn(`Failed to inspect new container, rolling back: ${e.message}`);
      try {
        await newContainer.remove({ force: true });
      } catch {
        /* best effort */
      }
      await currentContainer.rename({ name: oldName });
      throw e;
    }
    const oldContainerId = currentContainerSpec.Id;
    const socketMount = `${socketPath}:/var/run/docker.sock`;
    const selfUpdateOperationId = operationId || crypto.randomUUID();

    logContainer.info('Spawning helper container for self-update transition');
    try {
      await dockerApi
        .createContainer({
          Image: newImage,
          Cmd: ['node', 'dist/triggers/providers/docker/self-update-controller.js'],
          Env: [
            `DD_SELF_UPDATE_OP_ID=${selfUpdateOperationId}`,
            `DD_SELF_UPDATE_OLD_CONTAINER_ID=${oldContainerId}`,
            `DD_SELF_UPDATE_NEW_CONTAINER_ID=${newContainerId}`,
            `DD_SELF_UPDATE_OLD_CONTAINER_NAME=${oldName}`,
            `DD_SELF_UPDATE_START_TIMEOUT_MS=${SELF_UPDATE_START_TIMEOUT_MS}`,
            `DD_SELF_UPDATE_HEALTH_TIMEOUT_MS=${SELF_UPDATE_HEALTH_TIMEOUT_MS}`,
            `DD_SELF_UPDATE_POLL_INTERVAL_MS=${SELF_UPDATE_POLL_INTERVAL_MS}`,
          ],
          Labels: {
            'dd.self-update.helper': 'true',
            'dd.self-update.operation-id': selfUpdateOperationId,
          },
          HostConfig: {
            AutoRemove: true,
            Binds: [socketMount],
          },
          name: `drydock-self-update-${Date.now()}`,
        })
        .then((helperContainer) => helperContainer.start());
    } catch (e) {
      // Rollback: remove new container, rename old back
      logContainer.warn(`Failed to spawn helper container, rolling back: ${e.message}`);
      try {
        await newContainer.remove({ force: true });
      } catch {
        /* best effort */
      }
      await currentContainer.rename({ name: oldName });
      throw e;
    }

    logContainer.info('Helper container started — process will terminate when old container stops');
    return true;
  }

  async maybeNotifySelfUpdate(container, logContainer, operationId?: string) {
    if (!this.isSelfUpdate(container)) {
      return;
    }

    logContainer.info('Self-update detected — notifying UI before proceeding');
    await emitSelfUpdateStarting({
      opId: operationId || crypto.randomUUID(),
      requiresAck: true,
      ackTimeoutMs: SELF_UPDATE_ACK_TIMEOUT_MS,
      startedAt: new Date().toISOString(),
    });
  }

  async persistSecurityState(container, securityPatch, logContainer) {
    try {
      const containerCurrent = storeContainer.getContainer(container.id);
      const containerWithSecurity = {
        ...(containerCurrent || container),
        security: {
          ...((containerCurrent || container).security || {}),
          ...securityPatch,
        },
      };
      storeContainer.updateContainer(containerWithSecurity);
      cacheSecurityState(container.watcher, container.name, containerWithSecurity.security);
    } catch (e: any) {
      logContainer.warn(`Unable to persist security state (${e.message})`);
    }
  }

  async maybeScanAndGateUpdate(context, container, logContainer) {
    const securityConfiguration = getSecurityConfiguration();
    if (!securityConfiguration.enabled || securityConfiguration.scanner !== 'trivy') {
      return;
    }

    if (securityConfiguration.signature.verify) {
      logContainer.info(`Verifying image signature for candidate image ${context.newImage}`);
      const signatureResult = await verifyImageSignature({
        image: context.newImage,
        auth: context.auth,
      });
      await this.persistSecurityState(container, { signature: signatureResult }, logContainer);

      if (signatureResult.status !== 'verified') {
        const details = `Image signature verification failed: ${
          signatureResult.error || 'no valid signatures found'
        }`;
        this.recordSecurityAudit(
          signatureResult.status === 'unverified'
            ? 'security-signature-blocked'
            : 'security-signature-failed',
          container,
          'error',
          details,
        );
        throw new Error(details);
      }

      this.recordSecurityAudit(
        'security-signature-verified',
        container,
        'success',
        `Image signature verified (${signatureResult.signatures} signatures)`,
      );
    }

    logContainer.info(`Running security scan for candidate image ${context.newImage}`);
    const scanResult = await scanImageForVulnerabilities({
      image: context.newImage,
      auth: context.auth,
    });
    await this.persistSecurityState(container, { scan: scanResult }, logContainer);

    if (securityConfiguration.sbom.enabled) {
      logContainer.info(`Generating SBOM for candidate image ${context.newImage}`);
      const sbomResult = await generateImageSbom({
        image: context.newImage,
        auth: context.auth,
        formats: securityConfiguration.sbom.formats,
      });
      await this.persistSecurityState(container, { sbom: sbomResult }, logContainer);

      if (sbomResult.status === 'error') {
        this.recordSecurityAudit(
          'security-sbom-failed',
          container,
          'error',
          `SBOM generation failed: ${sbomResult.error || 'unknown SBOM error'}`,
        );
      } else {
        this.recordSecurityAudit(
          'security-sbom-generated',
          container,
          'success',
          `SBOM generated (${sbomResult.formats.join(', ')})`,
        );
      }
    }

    if (scanResult.status === 'error') {
      const details = `Security scan failed: ${scanResult.error || 'unknown scanner error'}`;
      this.recordSecurityAudit('security-scan-failed', container, 'error', details);
      throw new Error(details);
    }

    const summary = scanResult.summary;
    const details = `critical=${summary.critical}, high=${summary.high}, medium=${summary.medium}, low=${summary.low}, unknown=${summary.unknown}`;

    if (summary.critical > 0 || summary.high > 0) {
      await emitSecurityAlert({
        containerName: fullName(container),
        details,
        status: scanResult.status,
        summary,
        blockingCount: scanResult.blockingCount,
        container,
      });
    }

    if (scanResult.status === 'blocked') {
      const blockedDetails = `Security scan blocked update (${scanResult.blockingCount} vulnerabilities matched block severities: ${scanResult.blockSeverities.join(', ')}). Summary: ${details}`;
      this.recordSecurityAudit('security-scan-blocked', container, 'error', blockedDetails);
      throw new Error(blockedDetails);
    }

    this.recordSecurityAudit(
      'security-scan-passed',
      container,
      'success',
      `Security scan passed. Summary: ${details}`,
    );
  }

  async createTriggerContext(container, logContainer) {
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

  async runPreRuntimeUpdateLifecycle(context, container, logContainer) {
    const { dockerApi, registry } = context;

    if (this.configuration.prune) {
      await this.pruneImages(dockerApi, registry, container, logContainer);
    }

    this.insertContainerImageBackup(context, container);
  }

  async executeContainerUpdate(context, container, logContainer) {
    const { dockerApi, auth, newImage, currentContainer, currentContainerSpec } = context;

    await this.reconcileInProgressContainerUpdateOperation(dockerApi, container, logContainer);

    await this.pullImage(dockerApi, auth, newImage, logContainer);

    if (this.configuration.dryrun) {
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
      triggerName: this.getId(),
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
      newContainer = await this.createContainer(
        dockerApi,
        containerToCreateInspect,
        oldName,
        logContainer,
      );
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
          await this.removeContainer(
            currentContainer,
            tempName,
            currentContainerSpec.Id,
            logContainer,
          );
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

  /**
   * Perform the container update (pull, stop, recreate).
   * Subclasses (e.g. Dockercompose) override this to use their own runtime
   * mechanics while reusing the shared lifecycle orchestrator.
   */
  async performContainerUpdate(context, container, logContainer) {
    return this.executeContainerUpdate(context, container, logContainer);
  }

  getRollbackConfig(container) {
    const DEFAULT_ROLLBACK_WINDOW = 300000;
    const DEFAULT_ROLLBACK_INTERVAL = 10000;
    const logger = this.log?.child?.({});

    const parsedWindow = Number.parseInt(
      getPreferredLabelValue(
        container.labels,
        'dd.rollback.window',
        'wud.rollback.window',
        logger,
      ) ?? String(DEFAULT_ROLLBACK_WINDOW),
      10,
    );
    const parsedInterval = Number.parseInt(
      getPreferredLabelValue(
        container.labels,
        'dd.rollback.interval',
        'wud.rollback.interval',
        logger,
      ) ?? String(DEFAULT_ROLLBACK_INTERVAL),
      10,
    );

    const rollbackWindow =
      Number.isFinite(parsedWindow) && parsedWindow > 0 ? parsedWindow : DEFAULT_ROLLBACK_WINDOW;
    const rollbackInterval =
      Number.isFinite(parsedInterval) && parsedInterval > 0
        ? parsedInterval
        : DEFAULT_ROLLBACK_INTERVAL;

    if (rollbackWindow !== parsedWindow) {
      this.log
        ?.child?.({})
        ?.warn?.(
          `Invalid rollback window label value — using default ${DEFAULT_ROLLBACK_WINDOW}ms`,
        );
    }
    if (rollbackInterval !== parsedInterval) {
      this.log
        ?.child?.({})
        ?.warn?.(
          `Invalid rollback interval label value — using default ${DEFAULT_ROLLBACK_INTERVAL}ms`,
        );
    }

    return {
      autoRollback:
        (
          getPreferredLabelValue(
            container.labels,
            'dd.rollback.auto',
            'wud.rollback.auto',
            logger,
          ) ?? 'false'
        ).toLowerCase() === 'true',
      rollbackWindow,
      rollbackInterval,
    };
  }

  async maybeStartAutoRollbackMonitor(dockerApi, container, rollbackConfig, logContainer) {
    if (!rollbackConfig.autoRollback) {
      return;
    }

    // Look up the newly-recreated container by name (the old container.id
    // no longer exists after executeContainerUpdate recreated it).
    const newContainer = await this.getCurrentContainer(dockerApi, { id: container.name });
    if (newContainer == null) {
      logContainer.warn('Cannot find recreated container by name — skipping health monitoring');
      return;
    }

    const newContainerSpec = await this.inspectContainer(newContainer, logContainer);
    const hasHealthcheck = !!newContainerSpec?.State?.Health;
    if (!hasHealthcheck) {
      logContainer.warn(
        'Auto-rollback enabled but container has no HEALTHCHECK defined — skipping health monitoring',
      );
      return;
    }

    const newContainerId = newContainerSpec.Id;

    logContainer.info(
      `Starting health monitor (window=${rollbackConfig.rollbackWindow}ms, interval=${rollbackConfig.rollbackInterval}ms)`,
    );
    startHealthMonitor({
      dockerApi,
      containerId: newContainerId,
      containerName: container.name,
      backupImageTag: container.image.tag.value,
      backupImageDigest: container.image.digest?.repo,
      window: rollbackConfig.rollbackWindow,
      interval: rollbackConfig.rollbackInterval,
      triggerInstance: this,
      log: logContainer,
    });
  }

  /**
   * Shared per-container update lifecycle. Handles security scanning, hooks,
   * prune/backup preparation, backup pruning, rollback monitoring, and events.
   * Delegates the actual runtime update to `performContainerUpdate()` which
   * subclasses can override.
   */
  async runContainerUpdateLifecycle(container) {
    const logContainer = this.log.child({ container: fullName(container) });

    try {
      const context = await this.createTriggerContext(container, logContainer);
      if (!context) {
        return;
      }

      await this.maybeScanAndGateUpdate(context, container, logContainer);

      const hookConfig = this.buildHookConfig(container);
      await this.runPreUpdateHook(container, hookConfig, logContainer);

      if (this.isSelfUpdate(container)) {
        const selfUpdateOperationId = crypto.randomUUID();
        await this.maybeNotifySelfUpdate(container, logContainer, selfUpdateOperationId);
        const updated = await this.executeSelfUpdate(
          context,
          container,
          logContainer,
          selfUpdateOperationId,
        );
        if (!updated) {
          return;
        }
        // Process will die when helper stops old container — skip post-update steps
        return;
      }

      await this.runPreRuntimeUpdateLifecycle(context, container, logContainer);
      const updated = await this.performContainerUpdate(context, container, logContainer);
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

      // Notify that this container has been updated so notification
      // triggers can dismiss previously sent messages.
      await emitContainerUpdateApplied(fullName(container));

      // Prune old backups, keeping only the configured number
      backupStore.pruneOldBackups(container.name, this.configuration.backupcount);
    } catch (e: any) {
      await emitContainerUpdateFailed({
        containerName: fullName(container),
        error: e.message,
      });
      throw e;
    }
  }

  /**
   * Update the container.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    await this.runContainerUpdateLifecycle(container);
  }

  /**
   * Update the containers.
   * @param containers
   * @returns {Promise<unknown[]>}
   */
  async triggerBatch(containers) {
    return Promise.all(containers.map((container) => this.trigger(container)));
  }
}

export default Docker;
