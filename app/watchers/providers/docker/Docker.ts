import fs from 'node:fs';
import Dockerode from 'dockerode';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';

const joi = JoiCronExpression(Joi);

import debounceImport from 'just-debounce';
import cron from 'node-cron';
import parse from 'parse-docker-image-name';

const debounce: typeof import('just-debounce').default =
  (debounceImport as any).default || (debounceImport as any);

import { getPreferredLabelValue } from '../../../docker/legacy-label.js';
import * as event from '../../../event/index.js';
import log from '../../../log/index.js';
import {
  type Container,
  fullName,
  validate as validateContainer,
} from '../../../model/container.js';
import {
  getLoggerInitFailureCounter,
  getMaintenanceSkipCounter,
  getWatchContainerGauge,
} from '../../../prometheus/watcher.js';
import type { ComponentConfiguration } from '../../../registry/Component.js';
import * as registry from '../../../registry/index.js';
import { resolveConfiguredPath } from '../../../runtime/paths.js';
import { failClosedAuth } from '../../../security/auth.js';
import * as storeContainer from '../../../store/container.js';
import { parse as parseSemver, transform as transformTag } from '../../../tag/index.js';
import Watcher from '../../Watcher.js';
import {
  processDockerEvent as processDockerEventState,
  updateContainerFromInspect as updateContainerFromInspectState,
} from './container-event-update.js';
import {
  cleanupDockerEventsStream as cleanupDockerEventsStreamState,
  DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS,
  getDockerEventsOptions,
  isRecoverableDockerEventParseError as isRecoverableDockerEventParseErrorHelper,
  onDockerEventsStreamFailure as onDockerEventsStreamFailureHelper,
  resetDockerEventsReconnectBackoff as resetDockerEventsReconnectBackoffState,
  scheduleDockerEventsReconnect as scheduleDockerEventsReconnectState,
  shouldAttemptBufferedPayloadParse,
  splitDockerEventChunk,
} from './docker-events.js';
import {
  buildFallbackContainerReport,
  getContainerConfigValue,
  getContainerDisplayName,
  getContainerName,
  getErrorMessage,
  getFirstConfigNumber,
  getFirstConfigString,
  getImageForRegistryLookup,
  getImageReferenceCandidatesFromPattern,
  getImgsetSpecificity,
  getInspectValueByPath,
  getOldContainers,
  getRepoDigest,
  getResolvedImgsetConfiguration,
  getSemverTagFromInspectPath,
  isContainerToWatch,
  isDigestToWatch,
  normalizeConfigNumberValue,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';
import { createStderrFallbackLogger, serializeFallbackLogValue } from './fallback-logger.js';
import {
  ddDisplayIcon,
  ddDisplayName,
  ddInspectTagPath,
  ddLinkTemplate,
  ddRegistryLookupImage,
  ddRegistryLookupUrl,
  ddTagExclude,
  ddTagFamily,
  ddTagInclude,
  ddTagTransform,
  ddTriggerExclude,
  ddTriggerInclude,
  ddWatch,
  ddWatchDigest,
  wudDisplayIcon,
  wudDisplayName,
  wudInspectTagPath,
  wudLinkTemplate,
  wudRegistryLookupImage,
  wudRegistryLookupUrl,
  wudTagExclude,
  wudTagInclude,
  wudTagTransform,
  wudTriggerExclude,
  wudTriggerInclude,
  wudWatch,
  wudWatchDigest,
} from './label.js';
import { getNextMaintenanceWindow, isInMaintenanceWindow } from './maintenance.js';
import {
  createMutableOidcState,
  getRemoteAuthResolution,
  initializeRemoteOidcStateFromConfiguration,
  isRemoteOidcTokenRefreshRequired,
  refreshRemoteOidcAccessToken,
} from './oidc.js';
import {
  areRuntimeDetailsEqual,
  getRuntimeDetailsFromContainerSummary,
  getRuntimeDetailsFromInspect,
  mergeRuntimeDetails,
  normalizeRuntimeDetails,
} from './runtime-details.js';
import {
  filterBySegmentCount,
  getCurrentPrefix,
  getFirstDigitIndex,
  getTagCandidates,
} from './tag-candidates.js';

export interface DockerWatcherConfiguration extends ComponentConfiguration {
  socket: string;
  host?: string;
  protocol?: 'http' | 'https' | 'ssh';
  port: number;
  auth?: {
    type?: 'basic' | 'bearer' | 'oidc';
    user?: string;
    password?: string;
    bearer?: string;
    insecure?: boolean;
    oidc?: any;
  };
  cafile?: string;
  certfile?: string;
  keyfile?: string;
  cron: string;
  jitter: number;
  watchbydefault: boolean;
  watchall: boolean;
  watchdigest?: any;
  watchevents: boolean;
  watchatstart: boolean;
  maintenancewindow?: string;
  maintenancewindowtz: string;
  imgset?: Record<string, any>;
}

/**
 * Get a label value, preferring the dd.* key over the wud.* fallback.
 */
const warnedLegacyLabelFallbacks = new Set<string>();

function getLabel(labels: Record<string, string>, ddKey: string, wudKey?: string) {
  return getPreferredLabelValue(labels, ddKey, wudKey, {
    warnedFallbacks: warnedLegacyLabelFallbacks,
    warn: (message) => log.warn(message),
  });
}

// The delay before starting the watcher when the app is started
const START_WATCHER_DELAY_MS = 1000;

// Debounce delay used when performing a watch after a docker event has been received
const DEBOUNCED_WATCH_CRON_MS = 5000;
const DOCKER_EVENTS_BUFFER_MAX_BYTES = 1024 * 1024;
const MAINTENANCE_WINDOW_QUEUE_POLL_MS = 60 * 1000;
const SWARM_SERVICE_ID_LABEL = 'com.docker.swarm.service.id';

interface ResolvedImgset {
  name: string;
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  registryLookupImage?: string;
  registryLookupUrl?: string;
  watchDigest?: string;
  inspectTagPath?: string;
}

interface ContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  registryLookupImage?: string;
  registryLookupUrl?: string;
}

type ContainerLabelOverrideKey = Exclude<
  keyof ContainerLabelOverrides,
  'registryLookupImage' | 'registryLookupUrl'
>;

interface ResolvedContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  lookupImage?: string;
}

const containerLabelOverrideMappings = [
  { key: 'includeTags', ddKey: ddTagInclude, wudKey: wudTagInclude },
  { key: 'excludeTags', ddKey: ddTagExclude, wudKey: wudTagExclude },
  { key: 'transformTags', ddKey: ddTagTransform, wudKey: wudTagTransform },
  { key: 'linkTemplate', ddKey: ddLinkTemplate, wudKey: wudLinkTemplate },
  { key: 'displayName', ddKey: ddDisplayName, wudKey: wudDisplayName },
  { key: 'displayIcon', ddKey: ddDisplayIcon, wudKey: wudDisplayIcon },
  { key: 'triggerInclude', ddKey: ddTriggerInclude, wudKey: wudTriggerInclude },
  { key: 'triggerExclude', ddKey: ddTriggerExclude, wudKey: wudTriggerExclude },
] as const satisfies ReadonlyArray<{
  key: ContainerLabelOverrideKey;
  ddKey: string;
  wudKey: string;
}>;

interface ImgsetMatchCandidate {
  specificity: number;
  imgset: ResolvedImgset;
}

/**
 * Return all supported registries
 * @returns {*}
 */
function getRegistries() {
  return registry.getState().registry;
}

function normalizeContainer(container: Container) {
  const containerWithNormalizedImage = container;
  const imageForMatching = getImageForRegistryLookup(container.image);
  const registryProvider = Object.values(getRegistries()).find((provider) =>
    provider.match(imageForMatching),
  );
  if (registryProvider) {
    containerWithNormalizedImage.image = registryProvider.normalizeImage(imageForMatching);
    containerWithNormalizedImage.image.registry.name = registryProvider.getId();
  } else {
    log.warn(`${fullName(container)} - No Registry Provider found`);
    containerWithNormalizedImage.image.registry.name = 'unknown';
  }
  return validateContainer(containerWithNormalizedImage);
}

/**
 * Get the Docker Registry by name.
 * @param registryName
 */
function getRegistry(registryName: string) {
  const registryToReturn = getRegistries()[registryName];
  if (!registryToReturn) {
    throw new Error(`Unsupported Registry ${registryName}`);
  }
  return registryToReturn;
}

/**
 * Prune old containers from the store.
 * Containers that still exist in Docker (e.g. stopped) get their status updated
 * instead of being removed, so the UI can still show them with a start button.
 * @param newContainers
 * @param containersFromTheStore
 * @param dockerApi
 */
async function pruneOldContainers(
  newContainers: Container[],
  containersFromTheStore: Container[],
  dockerApi: any,
) {
  const containersToRemove = getOldContainers(newContainers, containersFromTheStore);
  for (const containerToRemove of containersToRemove) {
    try {
      const inspectResult = await dockerApi.getContainer(containerToRemove.id).inspect();
      const newStatus = inspectResult?.State?.Status;
      if (newStatus) {
        storeContainer.updateContainer({ ...containerToRemove, status: newStatus });
      }
    } catch {
      // Container no longer exists in Docker — remove from store
      storeContainer.deleteContainer(containerToRemove.id);
    }
  }
}

function resolveLabelsFromContainer(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides = {},
) {
  const resolvedOverrides: ResolvedContainerLabelOverrides = {
    lookupImage: resolveLookupImageFromContainerLabels(containerLabels, overrides),
    tagFamily: overrides.tagFamily || getLabel(containerLabels, ddTagFamily),
  };

  for (const { key, ddKey, wudKey } of containerLabelOverrideMappings) {
    resolvedOverrides[key] = overrides[key] || getLabel(containerLabels, ddKey, wudKey);
  }

  return resolvedOverrides;
}

function resolveLookupImageFromContainerLabels(
  containerLabels: Record<string, string>,
  overrides: ContainerLabelOverrides,
) {
  return (
    overrides.registryLookupImage ||
    getLabel(containerLabels, ddRegistryLookupImage, wudRegistryLookupImage) ||
    overrides.registryLookupUrl ||
    getLabel(containerLabels, ddRegistryLookupUrl, wudRegistryLookupUrl)
  );
}

function mergeConfigWithImgset(
  labelOverrides: ResolvedContainerLabelOverrides,
  matchingImgset: ResolvedImgset | undefined,
  containerLabels: Record<string, string>,
) {
  return {
    includeTags: getContainerConfigValue(labelOverrides.includeTags, matchingImgset?.includeTags),
    excludeTags: getContainerConfigValue(labelOverrides.excludeTags, matchingImgset?.excludeTags),
    transformTags: getContainerConfigValue(
      labelOverrides.transformTags,
      matchingImgset?.transformTags,
    ),
    tagFamily: getContainerConfigValue(labelOverrides.tagFamily, matchingImgset?.tagFamily),
    linkTemplate: getContainerConfigValue(
      labelOverrides.linkTemplate,
      matchingImgset?.linkTemplate,
    ),
    displayName: getContainerConfigValue(labelOverrides.displayName, matchingImgset?.displayName),
    displayIcon: getContainerConfigValue(labelOverrides.displayIcon, matchingImgset?.displayIcon),
    triggerInclude: getContainerConfigValue(
      labelOverrides.triggerInclude,
      matchingImgset?.triggerInclude,
    ),
    triggerExclude: getContainerConfigValue(
      labelOverrides.triggerExclude,
      matchingImgset?.triggerExclude,
    ),
    lookupImage:
      getContainerConfigValue(labelOverrides.lookupImage, matchingImgset?.registryLookupImage) ||
      getContainerConfigValue(undefined, matchingImgset?.registryLookupUrl),
    inspectTagPath: getContainerConfigValue(
      getLabel(containerLabels, ddInspectTagPath, wudInspectTagPath),
      matchingImgset?.inspectTagPath,
    ),
    watchDigest: getContainerConfigValue(
      getLabel(containerLabels, ddWatchDigest, wudWatchDigest),
      matchingImgset?.watchDigest,
    ),
  };
}

/**
 * Docker Watcher Component.
 */
class Docker extends Watcher {
  public configuration: DockerWatcherConfiguration = {} as DockerWatcherConfiguration;
  public declare dockerApi: Dockerode;
  public watchCron: any;
  public watchCronTimeout: any;
  public watchCronDebounced: any;
  public listenDockerEventsTimeout: any;
  public dockerEventsReconnectTimeout: any;
  public dockerEventsReconnectDelayMs: number = DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS;
  public dockerEventsReconnectAttempt: number = 0;
  public dockerEventsStream: any;
  public isDockerEventsListenerActive: boolean = false;
  public maintenanceWindowQueueTimeout: any;
  public maintenanceWindowWatchQueued: boolean = false;
  public dockerEventsBuffer = '';
  public remoteOidcAccessToken?: string;
  public remoteOidcRefreshToken?: string;
  public remoteOidcAccessTokenExpiresAt?: number;
  public remoteOidcDeviceCodeCompleted?: boolean;
  public remoteAuthBlockedReason?: string;

  ensureLogger() {
    if (!this.log) {
      try {
        this.log = log.child({
          component: `watcher.docker.${this.name || 'default'}`,
        });
      } catch (error) {
        const watcherName = this.name || 'default';
        const watcherType = this.type || 'docker';
        this.log = createStderrFallbackLogger({
          component: `watcher.docker.${watcherName}`,
          fallback: 'stderr-json',
        });

        getLoggerInitFailureCounter()?.labels({ type: watcherType, name: watcherName }).inc();

        this.log.error(
          {
            error: serializeFallbackLogValue(error),
          },
          'Failed to initialize watcher logger; using stderr fallback logger',
        );
      }
    }
  }

  getConfigurationSchema() {
    return joi.object().keys({
      socket: this.joi.string().default('/var/run/docker.sock'),
      host: this.joi.string(),
      protocol: this.joi.string().valid('http', 'https'),
      port: this.joi.number().port().default(2375),
      auth: this.joi.object({
        type: this.joi.string().valid('basic', 'bearer', 'oidc').insensitive(),
        user: this.joi.string(),
        password: this.joi.string(),
        bearer: this.joi.string(),
        insecure: this.joi.boolean().default(false),
        oidc: this.joi.object().unknown(true),
      }),
      cafile: this.joi.string(),
      certfile: this.joi.string(),
      keyfile: this.joi.string(),
      cron: joi.string().cron().default('0 * * * *'),
      jitter: this.joi.number().integer().min(0).default(60000),
      watchbydefault: this.joi.boolean().default(true),
      watchall: this.joi.boolean().default(false),
      watchdigest: this.joi.any(),
      watchevents: this.joi.boolean().default(true),
      watchatstart: this.joi.boolean().default(true),
      maintenancewindow: joi.string().cron().optional(),
      maintenancewindowtz: this.joi.string().default('UTC'),
      imgset: this.joi
        .object()
        .pattern(
          this.joi.string(),
          this.joi.object({
            image: this.joi.string().required(),
            include: this.joi.string(),
            exclude: this.joi.string(),
            transform: this.joi.string(),
            tagFamily: this.joi.string().valid('strict', 'loose'),
            tag: this.joi.object({
              include: this.joi.string(),
              exclude: this.joi.string(),
              transform: this.joi.string(),
              family: this.joi.string().valid('strict', 'loose'),
            }),
            link: this.joi.object({
              template: this.joi.string(),
            }),
            display: this.joi.object({
              name: this.joi.string(),
              icon: this.joi.string(),
            }),
            trigger: this.joi.object({
              include: this.joi.string(),
              exclude: this.joi.string(),
            }),
            registry: this.joi.object({
              lookup: this.joi.object({
                image: this.joi.string(),
                url: this.joi.string(),
              }),
            }),
            watch: this.joi.object({
              digest: this.joi.string().valid('true', 'false'),
            }),
            inspect: this.joi.object({
              tag: this.joi.object({
                path: this.joi.string(),
              }),
            }),
          }),
        )
        .default({}),
    });
  }

  maskConfiguration() {
    const hasMaintenanceWindow = !!this.configuration.maintenancewindow;
    const nextMaintenanceWindow = hasMaintenanceWindow
      ? this.getNextMaintenanceWindowDate()?.toISOString()
      : undefined;

    return {
      ...this.configuration,
      maintenancewindowopen: hasMaintenanceWindow ? this.isMaintenanceWindowOpen() : undefined,
      maintenancewindowqueued: hasMaintenanceWindow ? this.maintenanceWindowWatchQueued : false,
      maintenancenextwindow: nextMaintenanceWindow,
      authblocked: this.remoteAuthBlockedReason !== undefined,
      authblockedreason: this.remoteAuthBlockedReason,
      auth: this.configuration.auth
        ? {
            type: this.configuration.auth.type,
            user: Docker.mask(this.configuration.auth.user),
            password: Docker.mask(this.configuration.auth.password),
            bearer: Docker.mask(this.configuration.auth.bearer),
            insecure: this.configuration.auth.insecure,
            oidc: this.configuration.auth.oidc
              ? {
                  ...this.configuration.auth.oidc,
                  clientsecret: Docker.mask(
                    getFirstConfigString(this.configuration.auth.oidc, ['clientsecret']),
                  ),
                  accesstoken: Docker.mask(
                    getFirstConfigString(this.configuration.auth.oidc, ['accesstoken']),
                  ),
                  refreshtoken: Docker.mask(
                    getFirstConfigString(this.configuration.auth.oidc, ['refreshtoken']),
                  ),
                }
              : undefined,
          }
        : undefined,
    };
  }

  isMaintenanceWindowOpen() {
    if (!this.configuration.maintenancewindow) {
      return true;
    }
    return isInMaintenanceWindow(
      this.configuration.maintenancewindow,
      this.configuration.maintenancewindowtz,
    );
  }

  getNextMaintenanceWindowDate(fromDate: Date = new Date()) {
    if (!this.configuration.maintenancewindow) {
      return undefined;
    }
    return getNextMaintenanceWindow(
      this.configuration.maintenancewindow,
      this.configuration.maintenancewindowtz,
      fromDate,
    );
  }

  clearMaintenanceWindowQueue() {
    if (this.maintenanceWindowQueueTimeout) {
      clearTimeout(this.maintenanceWindowQueueTimeout);
      this.maintenanceWindowQueueTimeout = undefined;
    }
    this.maintenanceWindowWatchQueued = false;
  }

  queueMaintenanceWindowWatch() {
    this.maintenanceWindowWatchQueued = true;
    if (this.maintenanceWindowQueueTimeout) {
      return;
    }
    this.maintenanceWindowQueueTimeout = setTimeout(
      () => this.checkQueuedMaintenanceWindowWatch(),
      MAINTENANCE_WINDOW_QUEUE_POLL_MS,
    );
  }

  async checkQueuedMaintenanceWindowWatch() {
    this.maintenanceWindowQueueTimeout = undefined;
    if (!this.configuration.maintenancewindow || !this.maintenanceWindowWatchQueued) {
      this.clearMaintenanceWindowQueue();
      return;
    }

    if (!this.isMaintenanceWindowOpen()) {
      this.queueMaintenanceWindowWatch();
      return;
    }

    try {
      this.ensureLogger();
      if (this.log && typeof this.log.info === 'function') {
        this.log.info('Maintenance window opened - running queued update check');
      }
      await this.watchFromCron({
        ignoreMaintenanceWindow: true,
      });
    } catch (e: any) {
      this.ensureLogger();
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn(`Unable to run queued maintenance watch (${e.message})`);
      }
    }
  }

  /**
   * Init the Watcher.
   */
  async init() {
    this.ensureLogger();
    this.initWatcher();
    if (this.configuration.watchdigest !== undefined) {
      this.log.warn(
        "DD_WATCHER_{watcher_name}_WATCHDIGEST environment variable is deprecated and won't be supported in upcoming versions",
      );
    }
    this.log.info(`Cron scheduled (${this.configuration.cron})`);
    this.watchCron = cron.schedule(this.configuration.cron, () => this.watchFromCron(), {
      maxRandomDelay: this.configuration.jitter,
    });

    // Resolve watchatstart based on this watcher persisted state.
    // Keep explicit "false" untouched; default "true" is disabled only when
    // this watcher already has containers in store.
    const isWatcherStoreEmpty =
      storeContainer.getContainers({
        watcher: this.name,
      }).length === 0;
    this.configuration.watchatstart = this.configuration.watchatstart && isWatcherStoreEmpty;

    // watch at startup if enabled (after all components have been registered)
    if (this.configuration.watchatstart) {
      this.watchCronTimeout = setTimeout(this.watchFromCron.bind(this), START_WATCHER_DELAY_MS);
    }

    // listen to docker events
    if (this.configuration.watchevents) {
      this.isDockerEventsListenerActive = true;
      this.watchCronDebounced = debounce(this.watchFromCron.bind(this), DEBOUNCED_WATCH_CRON_MS);
      this.listenDockerEventsTimeout = setTimeout(
        this.listenDockerEvents.bind(this),
        START_WATCHER_DELAY_MS,
      );
    } else {
      this.isDockerEventsListenerActive = false;
    }
  }

  initWatcher() {
    const options: Dockerode.DockerOptions = {};
    this.remoteAuthBlockedReason = undefined;
    if (this.configuration.host) {
      options.host = this.configuration.host;
      options.port = this.configuration.port;
      if (this.configuration.protocol) {
        options.protocol = this.configuration.protocol;
      }
      if (this.configuration.cafile) {
        options.ca = fs.readFileSync(
          resolveConfiguredPath(this.configuration.cafile, {
            label: `watcher ${this.name} CA file path`,
          }),
        );
      }
      if (this.configuration.certfile) {
        options.cert = fs.readFileSync(
          resolveConfiguredPath(this.configuration.certfile, {
            label: `watcher ${this.name} certificate file path`,
          }),
        );
      }
      if (this.configuration.keyfile) {
        options.key = fs.readFileSync(
          resolveConfiguredPath(this.configuration.keyfile, {
            label: `watcher ${this.name} key file path`,
          }),
        );
      }
      try {
        this.applyRemoteAuthHeaders(options);
      } catch (e: any) {
        const authFailureMessage = getErrorMessage(
          e,
          `Unable to authenticate remote watcher ${this.name}`,
        );
        this.remoteAuthBlockedReason = authFailureMessage;
        this.log.warn(
          `Remote watcher ${this.name} auth is blocked (${authFailureMessage}); watcher remains registered but remote sync is disabled until auth is fixed or auth.insecure=true is set`,
        );
      }
    } else {
      options.socketPath = this.configuration.socket;
    }
    this.dockerApi = new Dockerode(options);
  }

  isHttpsRemoteWatcher(options: Dockerode.DockerOptions) {
    if (options.protocol === 'https') {
      return true;
    }
    return Boolean(options.ca || options.cert || options.key);
  }

  getOidcAuthConfiguration() {
    return this.configuration.auth?.oidc || {};
  }

  getOidcAuthString(paths: string[]) {
    return getFirstConfigString(this.getOidcAuthConfiguration(), paths);
  }

  getOidcAuthNumber(paths: string[]) {
    return getFirstConfigNumber(this.getOidcAuthConfiguration(), paths);
  }

  getRemoteAuthResolution(auth: any) {
    return getRemoteAuthResolution(auth, getFirstConfigString);
  }

  isRemoteAuthInsecureModeEnabled() {
    return this.configuration.auth?.insecure === true;
  }

  handleRemoteAuthFailure(message: string) {
    this.ensureLogger();
    failClosedAuth(message, {
      allowInsecure: this.isRemoteAuthInsecureModeEnabled(),
      logger: this.log,
      insecureFlagName: 'auth.insecure',
    });
  }

  setRemoteAuthorizationHeader(authorizationValue: string) {
    if (!authorizationValue) {
      return;
    }
    const dockerApiAny = this.dockerApi as any;
    if (!dockerApiAny.modem) {
      dockerApiAny.modem = {};
    }
    dockerApiAny.modem.headers = {
      ...(dockerApiAny.modem.headers || {}),
      Authorization: authorizationValue,
    };
  }

  private getOidcStateAdapter() {
    return createMutableOidcState({
      getAccessToken: () => this.remoteOidcAccessToken,
      setAccessToken: (value: string | undefined) => {
        this.remoteOidcAccessToken = value;
      },
      getRefreshToken: () => this.remoteOidcRefreshToken,
      setRefreshToken: (value: string | undefined) => {
        this.remoteOidcRefreshToken = value;
      },
      getAccessTokenExpiresAt: () => this.remoteOidcAccessTokenExpiresAt,
      setAccessTokenExpiresAt: (value: number | undefined) => {
        this.remoteOidcAccessTokenExpiresAt = value;
      },
      getDeviceCodeCompleted: () => this.remoteOidcDeviceCodeCompleted,
      setDeviceCodeCompleted: (value: boolean | undefined) => {
        this.remoteOidcDeviceCodeCompleted = value;
      },
    });
  }

  private getOidcContext() {
    return {
      watcherName: this.name,
      log: this.log,
      state: this.getOidcStateAdapter(),
      getOidcAuthString: (paths: string[]) => this.getOidcAuthString(paths),
      getOidcAuthNumber: (paths: string[]) => this.getOidcAuthNumber(paths),
      normalizeNumber: normalizeConfigNumberValue,
      sleep: (ms: number) => this.sleep(ms),
    };
  }

  /**
   * Sleep utility for polling loops. Extracted as a method for testability.
   */
  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async ensureRemoteAuthHeaders() {
    if (this.remoteAuthBlockedReason) {
      throw new Error(this.remoteAuthBlockedReason);
    }

    if (!this.configuration.host || !this.configuration.auth) {
      return;
    }

    const auth = this.configuration.auth;
    const { authType } = this.getRemoteAuthResolution(auth);
    if (authType !== 'oidc') {
      return;
    }
    if (
      !this.isHttpsRemoteWatcher({
        protocol: this.configuration.protocol,
        ca: this.configuration.cafile,
        cert: this.configuration.certfile,
        key: this.configuration.keyfile,
      } as Dockerode.DockerOptions)
    ) {
      this.handleRemoteAuthFailure(
        `Unable to authenticate remote watcher ${this.name}: HTTPS is required for OIDC auth (set protocol=https or TLS certificates)`,
      );
      return;
    }

    initializeRemoteOidcStateFromConfiguration(this.getOidcContext());

    if (isRemoteOidcTokenRefreshRequired(this.getOidcStateAdapter())) {
      await refreshRemoteOidcAccessToken(this.getOidcContext());
    }
    if (!this.remoteOidcAccessToken) {
      throw new Error(
        `Unable to authenticate remote watcher ${this.name}: no OIDC access token available`,
      );
    }
    this.setRemoteAuthorizationHeader(`Bearer ${this.remoteOidcAccessToken}`);
  }

  applyRemoteAuthHeaders(options: Dockerode.DockerOptions) {
    const auth = this.configuration.auth;
    if (!auth) {
      return;
    }

    const { authType, hasBearer, hasBasic, hasOidcConfig } = this.getRemoteAuthResolution(auth);
    if (!hasBearer && !hasBasic && !hasOidcConfig && authType !== 'oidc') {
      this.handleRemoteAuthFailure(
        `Unable to authenticate remote watcher ${this.name}: credentials are incomplete`,
      );
      return;
    }

    if (!this.isHttpsRemoteWatcher(options)) {
      this.handleRemoteAuthFailure(
        `Unable to authenticate remote watcher ${this.name}: HTTPS is required for remote auth (set protocol=https or TLS certificates)`,
      );
      return;
    }

    if (authType === 'basic') {
      if (!hasBasic) {
        this.handleRemoteAuthFailure(
          `Unable to authenticate remote watcher ${this.name}: basic credentials are incomplete`,
        );
        return;
      }
      const token = Buffer.from(`${auth.user}:${auth.password}`).toString('base64');
      options.headers = {
        ...options.headers,
        Authorization: `Basic ${token}`,
      };
      return;
    }

    if (authType === 'bearer') {
      if (!hasBearer) {
        this.handleRemoteAuthFailure(
          `Unable to authenticate remote watcher ${this.name}: bearer token is missing`,
        );
        return;
      }
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${auth.bearer}`,
      };
      return;
    }

    if (authType === 'oidc') {
      initializeRemoteOidcStateFromConfiguration(this.getOidcContext());
      if (this.remoteOidcAccessToken) {
        options.headers = {
          ...options.headers,
          Authorization: `Bearer ${this.remoteOidcAccessToken}`,
        };
      }
      return;
    }

    this.handleRemoteAuthFailure(
      `Unable to authenticate remote watcher ${this.name}: auth type "${authType || auth.type}" is unsupported`,
    );
  }

  /**
   * Deregister the component.
   * @returns {Promise<void>}
   */
  async deregisterComponent() {
    this.isDockerEventsListenerActive = false;

    if (this.watchCron) {
      this.watchCron.stop();
      delete this.watchCron;
    }
    if (this.watchCronTimeout) {
      clearTimeout(this.watchCronTimeout);
      delete this.watchCronTimeout;
    }
    if (this.listenDockerEventsTimeout) {
      clearTimeout(this.listenDockerEventsTimeout);
      delete this.listenDockerEventsTimeout;
    }
    if (this.dockerEventsReconnectTimeout) {
      clearTimeout(this.dockerEventsReconnectTimeout);
      delete this.dockerEventsReconnectTimeout;
    }
    this.cleanupDockerEventsStream(true);
    delete this.watchCronDebounced;
    this.clearMaintenanceWindowQueue();
  }

  private resetDockerEventsReconnectBackoff() {
    resetDockerEventsReconnectBackoffState(this);
  }

  private cleanupDockerEventsStream(destroy = false) {
    cleanupDockerEventsStreamState(this, destroy);
  }

  private scheduleDockerEventsReconnect(reason: string, err?: any) {
    this.ensureLogger();
    scheduleDockerEventsReconnectState(
      this,
      {
        cleanupDockerEventsStream: (destroy = false) => this.cleanupDockerEventsStream(destroy),
        listenDockerEvents: async () => this.listenDockerEvents(),
      },
      reason,
      err,
    );
  }

  private onDockerEventsStreamFailure(stream: any, reason: string, err?: any) {
    onDockerEventsStreamFailureHelper(
      this,
      {
        scheduleDockerEventsReconnect: (failureReason: string, failureError?: any) =>
          this.scheduleDockerEventsReconnect(failureReason, failureError),
      },
      stream,
      reason,
      err,
    );
  }

  /**
   * Listen and react to docker events.
   * @return {Promise<void>}
   */
  async listenDockerEvents() {
    this.ensureLogger();
    if (!this.log || typeof this.log.info !== 'function') {
      return;
    }
    if (!this.configuration.watchevents || !this.isDockerEventsListenerActive) {
      return;
    }
    if (this.dockerEventsReconnectTimeout) {
      clearTimeout(this.dockerEventsReconnectTimeout);
      delete this.dockerEventsReconnectTimeout;
    }

    try {
      await this.ensureRemoteAuthHeaders();
    } catch (e: any) {
      this.log.warn(`Unable to initialize remote watcher auth for docker events (${e.message})`);
      this.scheduleDockerEventsReconnect('auth initialization failure', e);
      return;
    }

    this.cleanupDockerEventsStream(true);
    this.dockerEventsBuffer = '';
    this.log.info('Listening to docker events');
    const options: Dockerode.GetEventsOptions = getDockerEventsOptions();
    this.dockerApi.getEvents(options, (err, stream) => {
      if (err) {
        if (this.log && typeof this.log.warn === 'function') {
          this.log.warn(`Unable to listen to Docker events [${err.message}]`);
          this.log.debug(err);
        }
        this.scheduleDockerEventsReconnect('connection failure', err);
      } else {
        this.dockerEventsStream = stream;
        this.resetDockerEventsReconnectBackoff();
        stream.on('data', (chunk: any) => this.onDockerEvent(chunk));
        stream.on('error', (streamError: any) =>
          this.onDockerEventsStreamFailure(stream, 'error', streamError),
        );
        stream.on('close', () => this.onDockerEventsStreamFailure(stream, 'close'));
        stream.on('end', () => this.onDockerEventsStreamFailure(stream, 'end'));
      }
    });
  }

  isRecoverableDockerEventParseError(error: any) {
    return isRecoverableDockerEventParseErrorHelper(error);
  }

  async processDockerEventPayload(
    dockerEventPayload: string,
    shouldTreatRecoverableErrorsAsPartial = false,
  ) {
    const payloadTrimmed = dockerEventPayload.trim();
    if (payloadTrimmed === '') {
      return true;
    }
    try {
      const dockerEvent = JSON.parse(payloadTrimmed);
      await this.processDockerEvent(dockerEvent);
      return true;
    } catch (e: any) {
      if (shouldTreatRecoverableErrorsAsPartial && this.isRecoverableDockerEventParseError(e)) {
        return false;
      }
      this.log.debug(`Unable to process Docker event (${e.message})`);
      return true;
    }
  }

  async processDockerEvent(dockerEvent: any) {
    await processDockerEventState(dockerEvent, {
      watchCronDebounced: async () => this.watchCronDebounced(),
      ensureRemoteAuthHeaders: async () => this.ensureRemoteAuthHeaders(),
      inspectContainer: async (containerId: string) => {
        const container = await this.dockerApi.getContainer(containerId);
        return container.inspect();
      },
      getContainerFromStore: (containerId: string) => storeContainer.getContainer(containerId),
      updateContainerFromInspect: (containerFound: Container, containerInspect: any) =>
        this.updateContainerFromInspect(containerFound, containerInspect),
      debug: (message: string) => this.log.debug(message),
    });
  }

  private updateContainerFromInspect(containerFound: Container, containerInspect: any) {
    const logContainer = this.log.child({
      container: fullName(containerFound),
    });

    updateContainerFromInspectState(containerFound, containerInspect, {
      getCustomDisplayNameFromLabels: (labels) => getLabel(labels, ddDisplayName, wudDisplayName),
      updateContainer: (container) => storeContainer.updateContainer(container),
      logInfo: (message) => logContainer.info(message),
    });
  }

  /**
   * Process a docker event.
   * @param dockerEventChunk
   * @return {Promise<void>}
   */
  async onDockerEvent(dockerEventChunk: any) {
    this.ensureLogger();
    const splitPayloads = splitDockerEventChunk(this.dockerEventsBuffer, dockerEventChunk);
    this.dockerEventsBuffer = splitPayloads.buffer;

    for (const dockerEventPayload of splitPayloads.payloads) {
      await this.processDockerEventPayload(dockerEventPayload);
    }

    if (Buffer.byteLength(this.dockerEventsBuffer, 'utf8') > DOCKER_EVENTS_BUFFER_MAX_BYTES) {
      this.scheduleDockerEventsReconnect(
        `buffer overflow (> ${DOCKER_EVENTS_BUFFER_MAX_BYTES} bytes)`,
      );
      return;
    }

    if (shouldAttemptBufferedPayloadParse(this.dockerEventsBuffer)) {
      const processed = await this.processDockerEventPayload(this.dockerEventsBuffer.trim(), true);
      if (processed) {
        this.dockerEventsBuffer = '';
      }
    }
  }

  /**
   * Watch containers (called by cron scheduled tasks).
   * @returns {Promise<*[]>}
   */
  async watchFromCron(options: { ignoreMaintenanceWindow?: boolean } = {}) {
    const { ignoreMaintenanceWindow = false } = options;
    this.ensureLogger();
    if (!this.log || typeof this.log.info !== 'function') {
      return [];
    }

    // Check maintenance window before proceeding
    if (
      !ignoreMaintenanceWindow &&
      this.configuration.maintenancewindow &&
      !this.isMaintenanceWindowOpen()
    ) {
      this.queueMaintenanceWindowWatch();
      this.log.info('Skipping update check - outside maintenance window');
      const counter = getMaintenanceSkipCounter();
      if (counter) {
        counter.labels({ type: this.type, name: this.name }).inc();
      }
      return [];
    }
    this.clearMaintenanceWindowQueue();

    this.log.info(`Cron started (${this.configuration.cron})`);

    // Get container reports
    const containerReports = await this.watch();

    // Count container reports
    const containerReportsCount = containerReports.length;

    // Count container available updates
    const containerUpdatesCount = containerReports.filter(
      (containerReport) => containerReport.container.updateAvailable,
    ).length;

    // Count container errors
    const containerErrorsCount = containerReports.filter(
      (containerReport) => containerReport.container.error !== undefined,
    ).length;

    const stats = `${containerReportsCount} containers watched, ${containerErrorsCount} errors, ${containerUpdatesCount} available updates`;
    this.ensureLogger();
    if (this.log && typeof this.log.info === 'function') {
      this.log.info(`Cron finished (${stats})`);
    }
    return containerReports;
  }

  /**
   * Watch main method.
   * @returns {Promise<*[]>}
   */
  async watch() {
    this.ensureLogger();
    let containers: Container[] = [];

    // Dispatch event to notify start watching
    event.emitWatcherStart(this);

    // List images to watch
    try {
      containers = await this.getContainers();
    } catch (e: any) {
      this.log.warn(`Error when trying to get the list of the containers to watch (${e.message})`);
    }
    try {
      const containerReportsSettled = await Promise.allSettled(
        containers.map((container) => this.watchContainer(container)),
      );
      const containerReports = containerReportsSettled.map((containerReport, index) => {
        if (containerReport.status === 'fulfilled') {
          return containerReport.value;
        }
        const message = getErrorMessage(containerReport.reason);
        this.log.warn(`Error when processing some containers (${message})`);
        const fallbackContainerReport = buildFallbackContainerReport(containers[index], message);
        event.emitContainerReport(fallbackContainerReport);
        return fallbackContainerReport;
      });
      event.emitContainerReports(containerReports);
      return containerReports;
    } finally {
      // Dispatch event to notify stop watching
      event.emitWatcherStop(this);
    }
  }

  /**
   * Watch a Container.
   * @param container
   * @returns {Promise<*>}
   */
  async watchContainer(container: Container) {
    this.ensureLogger();
    // Child logger for the container to process
    const logContainer = this.log.child({ container: fullName(container) });
    const containerWithResult = container;

    // Reset previous results if so
    delete containerWithResult.result;
    delete containerWithResult.error;
    logContainer.debug('Start watching');

    try {
      containerWithResult.result = await this.findNewVersion(container, logContainer);
    } catch (e: any) {
      const errorMessage = getErrorMessage(e);
      logContainer.warn(`Error when processing (${errorMessage})`);
      logContainer.debug(e);
      containerWithResult.error = {
        message: errorMessage,
      };
    }

    const containerReport = this.mapContainerToContainerReport(containerWithResult);
    event.emitContainerReport(containerReport);
    return containerReport;
  }

  /**
   * Get all containers to watch.
   * @returns {Promise<unknown[]>}
   */
  async getContainers(): Promise<Container[]> {
    this.ensureLogger();
    await this.ensureRemoteAuthHeaders();
    const listContainersOptions: Dockerode.ContainerListOptions = {};
    if (this.configuration.watchall) {
      listContainersOptions.all = true;
    }
    const containers = await this.dockerApi.listContainers(listContainersOptions);

    const swarmServiceLabelsCache = new Map<string, Promise<Record<string, string>>>();
    const containersWithResolvedLabels = await Promise.all(
      containers.map(async (container: any) => ({
        ...container,
        Labels: await this.getEffectiveContainerLabels(container, swarmServiceLabelsCache),
      })),
    );

    // Filter on containers to watch
    const filteredContainers = containersWithResolvedLabels.filter((container: any) =>
      isContainerToWatch(
        getLabel(container.Labels, ddWatch, wudWatch),
        this.configuration.watchbydefault,
      ),
    );
    const containerPromises = filteredContainers.map((container: any) =>
      this.addImageDetailsToContainer(container, {
        includeTags: getLabel(container.Labels, ddTagInclude, wudTagInclude),
        excludeTags: getLabel(container.Labels, ddTagExclude, wudTagExclude),
        transformTags: getLabel(container.Labels, ddTagTransform, wudTagTransform),
        tagFamily: getLabel(container.Labels, ddTagFamily),
        linkTemplate: getLabel(container.Labels, ddLinkTemplate, wudLinkTemplate),
        displayName: getLabel(container.Labels, ddDisplayName, wudDisplayName),
        displayIcon: getLabel(container.Labels, ddDisplayIcon, wudDisplayIcon),
        triggerInclude: getLabel(container.Labels, ddTriggerInclude, wudTriggerInclude),
        triggerExclude: getLabel(container.Labels, ddTriggerExclude, wudTriggerExclude),
        registryLookupImage: getLabel(
          container.Labels,
          ddRegistryLookupImage,
          wudRegistryLookupImage,
        ),
        registryLookupUrl: getLabel(container.Labels, ddRegistryLookupUrl, wudRegistryLookupUrl),
      }).catch((e) => {
        this.log.warn(`Failed to fetch image detail for container ${container.Id}: ${e.message}`);
        return e;
      }),
    );
    const containersToReturn = (await Promise.all(containerPromises)).filter(
      (result): result is Container => !(result instanceof Error) && result != null,
    );

    // Prune old containers from the store
    try {
      const containersFromTheStore = storeContainer.getContainers({
        watcher: this.name,
      });
      await pruneOldContainers(containersToReturn, containersFromTheStore, this.dockerApi);
    } catch (e: any) {
      this.log.warn(`Error when trying to prune the old containers (${e.message})`);
    }
    getWatchContainerGauge()?.set(
      {
        type: this.type,
        name: this.name,
      },
      containersToReturn.length,
    );

    return containersToReturn;
  }

  async getSwarmServiceLabels(
    serviceId: string,
    containerId: string,
  ): Promise<Record<string, string>> {
    this.ensureLogger();
    if (typeof this.dockerApi.getService !== 'function') {
      this.log.debug(
        `Docker API does not support getService; skipping swarm label lookup for container ${containerId}`,
      );
      return {};
    }

    try {
      const swarmService = await this.dockerApi.getService(serviceId).inspect();
      const serviceLabels = swarmService?.Spec?.Labels || {};
      const taskContainerLabels = swarmService?.Spec?.TaskTemplate?.ContainerSpec?.Labels || {};

      const hasDeployLabels = Object.keys(serviceLabels).length > 0;
      const hasTaskLabels = Object.keys(taskContainerLabels).length > 0;
      if (!hasDeployLabels && !hasTaskLabels) {
        this.log.debug(
          `Swarm service ${serviceId} (container ${containerId}) has no labels in Spec.Labels or TaskTemplate.ContainerSpec.Labels`,
        );
      } else {
        this.log.debug(
          `Swarm service ${serviceId} (container ${containerId}): deploy labels=${
            Object.keys(serviceLabels)
              .filter((k) => k.startsWith('dd.') || k.startsWith('wud.'))
              .join(',') || 'none'
          }, task labels=${
            Object.keys(taskContainerLabels)
              .filter((k) => k.startsWith('dd.') || k.startsWith('wud.'))
              .join(',') || 'none'
          }`,
        );
      }

      return {
        ...serviceLabels,
        ...taskContainerLabels,
      };
    } catch (e: any) {
      this.log.warn(
        `Unable to inspect swarm service ${serviceId} for container ${containerId} (${e.message}); deploy-level labels will not be available`,
      );
      return {};
    }
  }

  async getEffectiveContainerLabels(
    container: any,
    serviceLabelsCache: Map<string, Promise<Record<string, string>>>,
  ): Promise<Record<string, string>> {
    const containerLabels = container.Labels || {};
    const serviceId = containerLabels[SWARM_SERVICE_ID_LABEL];

    if (!serviceId) {
      return containerLabels;
    }

    if (!serviceLabelsCache.has(serviceId)) {
      serviceLabelsCache.set(serviceId, this.getSwarmServiceLabels(serviceId, container.Id));
    }
    const swarmServiceLabels = await serviceLabelsCache.get(serviceId);

    // Keep container labels as highest-priority override.
    return {
      ...(swarmServiceLabels || {}),
      ...containerLabels,
    };
  }

  private getImgsetMatchCandidate(
    imgsetName: string,
    imgsetConfiguration: any,
    parsedImage: any,
  ): ImgsetMatchCandidate | undefined {
    const imagePattern = getFirstConfigString(imgsetConfiguration, ['image', 'match']);
    if (!imagePattern) {
      return undefined;
    }

    const specificity = getImgsetSpecificity(imagePattern, parsedImage);
    if (specificity < 0) {
      return undefined;
    }

    return {
      specificity,
      imgset: getResolvedImgsetConfiguration(imgsetName, imgsetConfiguration),
    };
  }

  private isBetterImgsetMatch(
    candidate: ImgsetMatchCandidate,
    currentBest: ImgsetMatchCandidate,
  ): boolean {
    if (candidate.specificity !== currentBest.specificity) {
      return candidate.specificity > currentBest.specificity;
    }

    return candidate.imgset.name.localeCompare(currentBest.imgset.name) < 0;
  }

  getMatchingImgsetConfiguration(parsedImage: any): ResolvedImgset | undefined {
    const configuredImgsets = this.configuration.imgset;
    if (!configuredImgsets || typeof configuredImgsets !== 'object') {
      return undefined;
    }

    let bestMatch: ImgsetMatchCandidate | undefined;
    for (const [imgsetName, imgsetConfiguration] of Object.entries(configuredImgsets)) {
      const candidate = this.getImgsetMatchCandidate(imgsetName, imgsetConfiguration, parsedImage);
      if (!candidate) {
        continue;
      }

      if (!bestMatch || this.isBetterImgsetMatch(candidate, bestMatch)) {
        bestMatch = candidate;
      }
    }

    return bestMatch?.imgset;
  }

  /**
   * Find new version for a Container.
   */

  /**
   * Resolve remote digest information when digest watching is enabled.
   * Updates `container.image.digest.value` and populates digest/created on `result`.
   */
  private async handleDigestWatch(
    container: Container,
    registryProvider: any,
    tagsCandidates: string[],
    result: any,
  ) {
    const imageToGetDigestFrom = structuredClone(container.image);
    if (tagsCandidates.length > 0) {
      [imageToGetDigestFrom.tag.value] = tagsCandidates;
    }

    const remoteDigest = await registryProvider.getImageManifestDigest(imageToGetDigestFrom);

    result.digest = remoteDigest.digest;
    result.created = remoteDigest.created;

    if (remoteDigest.version === 2) {
      const digestV2 = await registryProvider.getImageManifestDigest(
        imageToGetDigestFrom,
        container.image.digest.repo,
      );
      container.image.digest.value = digestV2.digest;
    } else {
      container.image.digest.value = container.image.digest.repo;
    }
  }

  async findNewVersion(container: Container, logContainer: any) {
    let registryProvider;
    try {
      registryProvider = getRegistry(container.image.registry.name);
    } catch {
      logContainer.error(`Unsupported registry (${container.image.registry.name})`);
      return { tag: container.image.tag.value };
    }

    const result: any = { tag: container.image.tag.value };

    // Get all available tags
    const tags = await registryProvider.getTags(container.image);

    // Get candidate tags (based on tag name)
    const { tags: tagsCandidates, noUpdateReason } = getTagCandidates(
      container,
      tags,
      logContainer,
    );
    if (noUpdateReason) {
      result.noUpdateReason = noUpdateReason;
    }

    // Must watch digest? => Find local/remote digests on registry
    if (container.image.digest.watch && container.image.digest.repo) {
      await this.handleDigestWatch(container, registryProvider, tagsCandidates, result);
    }

    // The first one in the array is the highest
    if (tagsCandidates && tagsCandidates.length > 0) {
      [result.tag] = tagsCandidates;
    }
    return result;
  }

  /**
   * Add image detail to Container.
   */
  async addImageDetailsToContainer(container: any, labelOverrides: ContainerLabelOverrides = {}) {
    const containerId = container.Id;
    const containerLabels = container.Labels || {};
    const runtimeDetailsFromSummary = getRuntimeDetailsFromContainerSummary(container);

    // Is container already in store? Refresh volatile image fields, then return it
    const containerInStore = storeContainer.getContainer(containerId);
    if (containerInStore !== undefined && containerInStore.error === undefined) {
      this.ensureLogger();
      this.log.debug(`Container ${containerInStore.id} already in store`);
      const cachedRuntimeDetails = normalizeRuntimeDetails(containerInStore.details);
      let runtimeDetailsToApply = mergeRuntimeDetails(
        runtimeDetailsFromSummary,
        cachedRuntimeDetails,
      );

      // When Docker events are enabled, runtime detail updates are handled by event-driven inspect calls.
      // Skip per-cron container inspect to avoid doubling inspect API calls for every tracked container.
      if (!this.configuration.watchevents) {
        try {
          const containerInspect = await this.dockerApi.getContainer(containerId).inspect();
          runtimeDetailsToApply = mergeRuntimeDetails(
            getRuntimeDetailsFromInspect(containerInspect),
            runtimeDetailsToApply,
          );
        } catch {
          // Degrade gracefully to summary and cached details.
        }
      }
      if (!areRuntimeDetailsEqual(containerInStore.details, runtimeDetailsToApply)) {
        containerInStore.details = runtimeDetailsToApply;
      }

      try {
        const currentImage = await this.dockerApi.getImage(container.Image).inspect();
        const freshDigestRepo = getRepoDigest(currentImage);
        const freshImageId = currentImage.Id;
        // Keep local digest value populated for digest-watch containers, even when
        // image id/repo digest are unchanged from cached state.
        if (freshDigestRepo !== undefined && containerInStore.image.digest.value === undefined) {
          containerInStore.image.digest.value = freshDigestRepo;
        }
        if (
          freshDigestRepo !== containerInStore.image.digest.repo ||
          freshImageId !== containerInStore.image.id
        ) {
          containerInStore.image.digest.repo = freshDigestRepo;
          if (freshDigestRepo !== undefined) {
            containerInStore.image.digest.value = freshDigestRepo;
          }
          containerInStore.image.id = freshImageId;
          if (currentImage.Created) {
            containerInStore.image.created = currentImage.Created;
          }
        }
      } catch {
        // Degrade gracefully to cached values
      }
      return containerInStore;
    }

    // Get container image details
    let image;
    try {
      await this.ensureRemoteAuthHeaders();
      image = await this.dockerApi.getImage(container.Image).inspect();
    } catch (e: any) {
      throw new Error(`Unable to inspect image for container ${containerId}: ${e.message}`);
    }

    const parsedImage = this.resolveImageName(container.Image, image);
    if (!parsedImage) {
      return undefined;
    }

    const resolvedLabelOverrides = resolveLabelsFromContainer(containerLabels, labelOverrides);

    const matchingImgset = this.getMatchingImgsetConfiguration(parsedImage);
    if (matchingImgset) {
      this.ensureLogger();
      this.log.debug(`Apply imgset "${matchingImgset.name}" to container ${containerId}`);
    }

    const resolvedConfig = mergeConfigWithImgset(
      resolvedLabelOverrides,
      matchingImgset,
      containerLabels,
    );

    const tagName = this.resolveTagName(
      parsedImage,
      image,
      resolvedConfig.inspectTagPath,
      resolvedLabelOverrides.transformTags,
      containerId,
    );

    const isSemver = parseSemver(transformTag(resolvedConfig.transformTags, tagName)) != null;
    const watchDigest = isDigestToWatch(resolvedConfig.watchDigest, parsedImage, isSemver);
    const repoDigest = getRepoDigest(image);
    let runtimeDetails = runtimeDetailsFromSummary;
    try {
      const containerInspect = await this.dockerApi.getContainer(containerId).inspect();
      runtimeDetails = mergeRuntimeDetails(
        getRuntimeDetailsFromInspect(containerInspect),
        runtimeDetailsFromSummary,
      );
    } catch {
      // Degrade gracefully to summary details.
    }
    if (!isSemver && !watchDigest) {
      this.ensureLogger();
      this.log.warn(
        "Image is not a semver and digest watching is disabled so drydock won't report any update. Please review the configuration to enable digest watching for this container or exclude this container from being watched",
      );
    }
    const containerName = getContainerName(container);
    return normalizeContainer({
      id: containerId,
      name: containerName,
      status: container.State,
      watcher: this.name,
      includeTags: resolvedConfig.includeTags,
      excludeTags: resolvedConfig.excludeTags,
      transformTags: resolvedConfig.transformTags,
      tagFamily: resolvedConfig.tagFamily,
      linkTemplate: resolvedConfig.linkTemplate,
      displayName: getContainerDisplayName(
        containerName,
        parsedImage.path,
        resolvedConfig.displayName,
      ),
      displayIcon: resolvedConfig.displayIcon,
      triggerInclude: resolvedConfig.triggerInclude,
      triggerExclude: resolvedConfig.triggerExclude,
      image: {
        id: image.Id,
        registry: {
          name: 'unknown', // Will be overwritten by normalizeContainer
          url: parsedImage.domain,
          lookupImage: resolvedConfig.lookupImage,
        },
        name: parsedImage.path,
        tag: {
          value: tagName,
          semver: isSemver,
        },
        digest: {
          watch: watchDigest,
          repo: repoDigest,
          value: repoDigest,
        },
        architecture: image.Architecture,
        os: image.Os,
        variant: image.Variant,
        created: image.Created,
      },
      labels: containerLabels,
      details: runtimeDetails,
      result: {
        tag: tagName,
      },
      updateAvailable: false,
      updateKind: { kind: 'unknown' },
    } as Container);
  }

  private resolveImageName(imageName: string, image: any) {
    let imageNameToParse = imageName;
    if (imageNameToParse.includes('sha256:')) {
      if (!image.RepoTags || image.RepoTags.length === 0) {
        this.ensureLogger();
        this.log.warn(`Cannot get a reliable tag for this image [${imageNameToParse}]`);
        return undefined;
      }
      [imageNameToParse] = image.RepoTags;
    }
    return parse(imageNameToParse);
  }

  private resolveTagName(
    parsedImage: any,
    image: any,
    inspectTagPath: string | undefined,
    transformTagsFromLabel: string | undefined,
    containerId: string,
  ) {
    let tagName = parsedImage.tag || 'latest';
    if (inspectTagPath) {
      const semverTagFromInspect = getSemverTagFromInspectPath(
        image,
        inspectTagPath,
        transformTagsFromLabel,
      );
      if (semverTagFromInspect) {
        tagName = semverTagFromInspect;
      } else {
        this.ensureLogger();
        this.log.debug(
          `No semver value found at inspect path ${inspectTagPath} for container ${containerId}; falling back to parsed image tag`,
        );
      }
    }
    return tagName;
  }

  /**
   * Process a Container with result and map to a containerReport.
   * @param containerWithResult
   * @return {*}
   */
  mapContainerToContainerReport(containerWithResult: Container) {
    this.ensureLogger();
    const logContainer = this.log.child({
      container: fullName(containerWithResult),
    });

    // Find container in db & compare
    const containerInDb = storeContainer.getContainer(containerWithResult.id);

    if (containerInDb) {
      // Found in DB? => update it
      const updatedContainer = storeContainer.updateContainer(containerWithResult);
      return {
        container: updatedContainer,
        changed:
          containerInDb.resultChanged(updatedContainer) && containerWithResult.updateAvailable,
      };
    }
    // Not found in DB? => Save it
    logContainer.debug('Container watched for the first time');
    return {
      container: storeContainer.insertContainer(containerWithResult),
      changed: true,
    };
  }
}

export default Docker;

export {
  getLabel as testable_getLabel,
  getCurrentPrefix as testable_getCurrentPrefix,
  filterBySegmentCount as testable_filterBySegmentCount,
  getContainerName as testable_getContainerName,
  getContainerDisplayName as testable_getContainerDisplayName,
  normalizeConfigNumberValue as testable_normalizeConfigNumberValue,
  shouldUpdateDisplayNameFromContainerName as testable_shouldUpdateDisplayNameFromContainerName,
  getFirstDigitIndex as testable_getFirstDigitIndex,
  getImageForRegistryLookup as testable_getImageForRegistryLookup,
  getOldContainers as testable_getOldContainers,
  pruneOldContainers as testable_pruneOldContainers,
  getImageReferenceCandidatesFromPattern as testable_getImageReferenceCandidatesFromPattern,
  getImgsetSpecificity as testable_getImgsetSpecificity,
  getInspectValueByPath as testable_getInspectValueByPath,
};
