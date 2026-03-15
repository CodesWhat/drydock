import type Dockerode from 'dockerode';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';

const joi = JoiCronExpression(Joi);

import debounceImport from 'just-debounce';
import cron, { type ScheduledTask } from 'node-cron';
import parse from 'parse-docker-image-name';

const debounce: typeof import('just-debounce').default =
  (debounceImport as any).default || (debounceImport as any);

import { ddEnvVars } from '../../../configuration/index.js';
import { getPreferredLabelValue } from '../../../docker/legacy-label.js';
import * as event from '../../../event/index.js';
import log from '../../../log/index.js';
import {
  type Container,
  type ContainerResult,
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
import { failClosedAuth } from '../../../security/auth.js';
import * as storeContainer from '../../../store/container.js';
import { sleep } from '../../../util/sleep.js';
import Watcher from '../../Watcher.js';
import { updateContainerFromInspect as updateContainerFromInspectState } from './container-event-update.js';
import {
  listenDockerEventsOrchestration,
  onDockerEventOrchestration,
  processDockerEventOrchestration,
  processDockerEventPayloadOrchestration,
} from './docker-event-orchestration.js';
import {
  cleanupDockerEventsStream as cleanupDockerEventsStreamState,
  DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS,
  isRecoverableDockerEventParseError as isRecoverableDockerEventParseErrorHelper,
  onDockerEventsStreamFailure as onDockerEventsStreamFailureHelper,
  resetDockerEventsReconnectBackoff as resetDockerEventsReconnectBackoffState,
  scheduleDockerEventsReconnect as scheduleDockerEventsReconnectState,
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
  getResolvedImgsetConfiguration,
  getSemverTagFromInspectPath,
  isContainerToWatch,
  normalizeConfigNumberValue,
  type ResolvedImgset,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';
import {
  addImageDetailsToContainerOrchestration,
  type ContainerLabelOverrides,
} from './docker-image-details-orchestration.js';
import {
  applyRemoteAuthHeadersForWatcher,
  ensureRemoteAuthHeadersForWatcher,
  initWatcherWithRemoteAuth,
} from './docker-remote-auth.js';
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
import { createMutableOidcState, getRemoteAuthResolution } from './oidc.js';
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
    oidc?: Record<string, unknown>;
  };
  cafile?: string;
  certfile?: string;
  keyfile?: string;
  cron: string;
  jitter: number;
  watchbydefault: boolean;
  watchall: boolean;
  watchdigest?: unknown;
  watchevents: boolean;
  watchatstart: boolean;
  maintenancewindow?: string;
  maintenancewindowtz: string;
  imgset?: Record<string, Record<string, unknown>>;
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

type ContainerLabelOverrideKey = Exclude<
  keyof ContainerLabelOverrides,
  'registryLookupImage' | 'registryLookupUrl'
>;

interface ResolvedContainerLabelOverrides {
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  tagFamily?: string;
  inspectTagPath?: string;
  linkTemplate?: string;
  displayName?: string;
  displayIcon?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  lookupImage?: string;
}

const containerLabelOverrideMappings = [
  { key: 'includeTags', ddKey: ddTagInclude, wudKey: wudTagInclude, overrideKey: 'includeTags' },
  { key: 'excludeTags', ddKey: ddTagExclude, wudKey: wudTagExclude, overrideKey: 'excludeTags' },
  {
    key: 'transformTags',
    ddKey: ddTagTransform,
    wudKey: wudTagTransform,
    overrideKey: 'transformTags',
  },
  {
    key: 'tagFamily',
    ddKey: ddTagFamily,
    wudKey: undefined,
    overrideKey: 'tagFamily',
  },
  {
    key: 'inspectTagPath',
    ddKey: ddInspectTagPath,
    wudKey: wudInspectTagPath,
    overrideKey: undefined,
  },
  {
    key: 'linkTemplate',
    ddKey: ddLinkTemplate,
    wudKey: wudLinkTemplate,
    overrideKey: 'linkTemplate',
  },
  { key: 'displayName', ddKey: ddDisplayName, wudKey: wudDisplayName, overrideKey: 'displayName' },
  { key: 'displayIcon', ddKey: ddDisplayIcon, wudKey: wudDisplayIcon, overrideKey: 'displayIcon' },
  {
    key: 'triggerInclude',
    ddKey: ddTriggerInclude,
    wudKey: wudTriggerInclude,
    overrideKey: 'triggerInclude',
  },
  {
    key: 'triggerExclude',
    ddKey: ddTriggerExclude,
    wudKey: wudTriggerExclude,
    overrideKey: 'triggerExclude',
  },
] as const satisfies ReadonlyArray<{
  key: keyof ResolvedContainerLabelOverrides;
  ddKey: string;
  wudKey?: string;
  overrideKey?: ContainerLabelOverrideKey;
}>;

interface ImgsetMatchCandidate {
  specificity: number;
  imgset: ResolvedImgset;
}

interface DockerApiContainerInspector {
  getContainer: (containerId: string) => {
    inspect: () => Promise<{
      State?: {
        Status?: string;
      };
    }>;
  };
}

interface DockerEventsStream {
  on: (eventName: string, handler: (...args: unknown[]) => unknown) => unknown;
  removeAllListeners?: (eventName?: string) => unknown;
  destroy?: () => void;
}

interface ContainerTagLookupProvider {
  getTags: (image: Container['image']) => Promise<string[]>;
  getImageManifestDigest: (
    image: Container['image'],
    digest?: string,
  ) => Promise<{
    digest?: string;
    created?: string;
    version?: number;
  }>;
}

interface ContainerWatchLogger {
  error: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
}

/**
 * Return all supported registries
 * @returns {*}
 */
function getRegistries() {
  return registry.getState().registry;
}

function normalizeContainer(container: Container) {
  const containerWithNormalizedImage = structuredClone(container);
  const imageForMatching = getImageForRegistryLookup(containerWithNormalizedImage.image);
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
  dockerApi: DockerApiContainerInspector,
) {
  const containersToRemove = getOldContainers(newContainers, containersFromTheStore);
  const newContainerNameKeys = new Set(
    newContainers
      .filter((container) => typeof container.name === 'string' && container.name !== '')
      .map((container) => `${container.watcher || ''}::${container.name}`),
  );
  for (const containerToRemove of containersToRemove) {
    const staleContainerNameKey = `${containerToRemove.watcher || ''}::${containerToRemove.name || ''}`;
    if (
      typeof containerToRemove.name === 'string' &&
      containerToRemove.name !== '' &&
      newContainerNameKeys.has(staleContainerNameKey)
    ) {
      storeContainer.deleteContainer(containerToRemove.id);
      continue;
    }
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
  };

  for (const { key, ddKey, wudKey, overrideKey } of containerLabelOverrideMappings) {
    const overrideValue = overrideKey ? overrides[overrideKey] : undefined;
    resolvedOverrides[key] = overrideValue || getLabel(containerLabels, ddKey, wudKey);
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
      labelOverrides.inspectTagPath,
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
  public watchCron?: ScheduledTask;
  public watchCronTimeout?: ReturnType<typeof setTimeout>;
  public watchCronDebounced?: () => void;
  public listenDockerEventsTimeout?: ReturnType<typeof setTimeout>;
  public dockerEventsReconnectTimeout?: ReturnType<typeof setTimeout>;
  public dockerEventsReconnectDelayMs: number = DOCKER_EVENTS_RECONNECT_BASE_DELAY_MS;
  public dockerEventsReconnectAttempt: number = 0;
  public dockerEventsStream?: DockerEventsStream;
  public isDockerEventsListenerActive: boolean = false;
  public maintenanceWindowQueueTimeout?: ReturnType<typeof setTimeout>;
  public maintenanceWindowWatchQueued: boolean = false;
  public dockerEventsBuffer = '';
  public remoteOidcAccessToken?: string;
  public remoteOidcRefreshToken?: string;
  public remoteOidcAccessTokenExpiresAt?: number;
  public remoteOidcDeviceCodeCompleted?: boolean;
  public remoteAuthBlockedReason?: string;
  public isWatcherDeregistered: boolean = false;

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
    this.isWatcherDeregistered = false;
    this.initWatcher();
    if (this.configuration.watchdigest !== undefined) {
      this.log.warn(
        'DD_WATCHER_{watcher_name}_WATCHDIGEST environment variable is deprecated and will be removed in v1.6.0. Use the dd.watch.digest=true container label instead.',
      );
    }
    const watchAtStartEnvKey = `DD_WATCHER_${this.name.toUpperCase()}_WATCHATSTART`;
    if (Object.hasOwn(ddEnvVars, watchAtStartEnvKey)) {
      this.log.warn(
        `${watchAtStartEnvKey} environment variable is deprecated and will be removed in v1.6.0. Drydock watches at startup by default.`,
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
    initWatcherWithRemoteAuth(this as any);
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

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: called via docker-event-orchestration through `this as any`
  private getOidcContext() {
    return {
      watcherName: this.name,
      log: this.log,
      state: this.getOidcStateAdapter(),
      getOidcAuthString: (paths: string[]) => this.getOidcAuthString(paths),
      getOidcAuthNumber: (paths: string[]) => this.getOidcAuthNumber(paths),
      normalizeNumber: normalizeConfigNumberValue,
      sleep: (ms: number) => this.sleep(ms),
      isDeviceCodePollingCancelled: () => this.isWatcherDeregistered,
    };
  }

  /**
   * Sleep utility for polling loops. Extracted as a method for testability.
   */
  async sleep(ms: number): Promise<void> {
    return sleep(ms);
  }

  async ensureRemoteAuthHeaders() {
    await ensureRemoteAuthHeadersForWatcher(this as any);
  }

  applyRemoteAuthHeaders(options: Dockerode.DockerOptions) {
    applyRemoteAuthHeadersForWatcher(this as any, options);
  }

  /**
   * Deregister the component.
   * @returns {Promise<void>}
   */
  async deregisterComponent() {
    this.isWatcherDeregistered = true;
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

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: called via docker-event-orchestration through `this as any`
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

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: called via docker-event-orchestration through `this as any`
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
    await listenDockerEventsOrchestration(this as any);
  }

  isRecoverableDockerEventParseError(error: any) {
    return isRecoverableDockerEventParseErrorHelper(error);
  }

  async processDockerEventPayload(
    dockerEventPayload: string,
    shouldTreatRecoverableErrorsAsPartial = false,
  ) {
    return processDockerEventPayloadOrchestration(
      this as any,
      dockerEventPayload,
      shouldTreatRecoverableErrorsAsPartial,
    );
  }

  async processDockerEvent(dockerEvent: any) {
    await processDockerEventOrchestration(this as any, dockerEvent);
  }

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: called via docker-event-orchestration through `this as any`
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
    await onDockerEventOrchestration(this as any, dockerEventChunk, DOCKER_EVENTS_BUFFER_MAX_BYTES);
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
    registryProvider: ContainerTagLookupProvider,
    tagsCandidates: string[],
    result: ContainerResult,
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

  async findNewVersion(container: Container, logContainer: ContainerWatchLogger) {
    let registryProvider: ContainerTagLookupProvider;
    try {
      registryProvider = getRegistry(container.image.registry.name) as ContainerTagLookupProvider;
    } catch {
      logContainer.error(`Unsupported registry (${container.image.registry.name})`);
      return { tag: container.image.tag.value };
    }

    const result: ContainerResult = { tag: container.image.tag.value };

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
    return addImageDetailsToContainerOrchestration(this as any, container, labelOverrides, {
      resolveLabelsFromContainer,
      mergeConfigWithImgset,
      normalizeContainer,
      resolveImageName: (imageName: string, image: any) => this.resolveImageName(imageName, image),
      resolveTagName: (
        parsedImage: any,
        image: any,
        inspectTagPath: string | undefined,
        transformTagsFromLabel: string | undefined,
        containerId: string,
      ) =>
        this.resolveTagName(
          parsedImage,
          image,
          inspectTagPath,
          transformTagsFromLabel,
          containerId,
        ),
      getMatchingImgsetConfiguration: (parsedImage: any) =>
        this.getMatchingImgsetConfiguration(parsedImage),
    });
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
  filterBySegmentCount as testable_filterBySegmentCount,
  getContainerDisplayName as testable_getContainerDisplayName,
  getContainerName as testable_getContainerName,
  getCurrentPrefix as testable_getCurrentPrefix,
  getFirstDigitIndex as testable_getFirstDigitIndex,
  getImageForRegistryLookup as testable_getImageForRegistryLookup,
  getImageReferenceCandidatesFromPattern as testable_getImageReferenceCandidatesFromPattern,
  getImgsetSpecificity as testable_getImgsetSpecificity,
  getInspectValueByPath as testable_getInspectValueByPath,
  getLabel as testable_getLabel,
  getOldContainers as testable_getOldContainers,
  normalizeConfigNumberValue as testable_normalizeConfigNumberValue,
  normalizeContainer as testable_normalizeContainer,
  pruneOldContainers as testable_pruneOldContainers,
  shouldUpdateDisplayNameFromContainerName as testable_shouldUpdateDisplayNameFromContainerName,
};
