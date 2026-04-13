import type Dockerode from 'dockerode';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';

const joi = JoiCronExpression(Joi);

import debounceImport from 'just-debounce';
import cron, { type ScheduledTask } from 'node-cron';
import parse from 'parse-docker-image-name';

type DebounceFn = <T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
  atStart?: boolean,
  guarantee?: boolean,
) => (...args: Parameters<T>) => void;
const debounceModule = debounceImport as unknown as { default?: DebounceFn };
const debounce: DebounceFn = debounceModule.default || (debounceImport as unknown as DebounceFn);

import { ddEnvVars } from '../../../configuration/index.js';
import * as event from '../../../event/index.js';
import log from '../../../log/index.js';
import { type Container, type ContainerReport, fullName } from '../../../model/container.js';
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
import { consumeFreshContainerScheduledPollSkip } from '../../registry-webhook-fresh.js';
import Watcher from '../../Watcher.js';
import { updateContainerFromInspect as updateContainerFromInspectState } from './container-event-update.js';
import {
  type AliasFilterDecision,
  filterRecreatedContainerAliases,
  getDockerWatcherRegistryId,
  getDockerWatcherSourceKey,
  getLabel,
  getMatchingImgsetConfiguration as getMatchingImgsetConfigurationState,
  isDockerWatcher,
  mergeConfigWithImgset,
  pruneOldContainers,
  resolveLabelsFromContainer,
} from './container-init.js';
import {
  mapContainerToContainerReport as mapContainerToContainerReportState,
  watchContainer as watchContainerState,
} from './container-processing.js';
import {
  endDigestCachePollCycleForRegistries,
  startDigestCachePollCycleForRegistries,
} from './digest-cache-lifecycle.js';
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
  getSemverTagFromInspectPath,
  isContainerToWatch,
  normalizeConfigNumberValue,
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
  type ContainerWatchLogger,
  findNewVersion as findNewVersionState,
  normalizeContainer,
} from './image-comparison.js';
import {
  ddDisplayIcon,
  ddDisplayName,
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
  wudDisplayIcon,
  wudDisplayName,
  wudLinkTemplate,
  wudRegistryLookupImage,
  wudRegistryLookupUrl,
  wudTagExclude,
  wudTagInclude,
  wudTagTransform,
  wudTriggerExclude,
  wudTriggerInclude,
  wudWatch,
} from './label.js';
import { getNextMaintenanceWindow, isInMaintenanceWindow } from './maintenance.js';
import {
  createMutableOidcState,
  getRemoteAuthResolution as getRemoteAuthResolutionState,
} from './oidc.js';
import { filterBySegmentCount, getCurrentPrefix, getFirstDigitIndex } from './tag-candidates.js';

export interface DockerWatcherConfiguration extends ComponentConfiguration {
  socket: string;
  host?: string;
  protocol?: 'http' | 'https';
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

// The delay before starting the watcher when the app is started
const START_WATCHER_DELAY_MS = 1000;

// Debounce delay used when performing a watch after a docker event has been received
const DEBOUNCED_WATCH_CRON_MS = 5000;
const DOCKER_EVENTS_BUFFER_MAX_BYTES = 1024 * 1024;
const MAINTENANCE_WINDOW_QUEUE_POLL_MS = 60 * 1000;
const SWARM_SERVICE_ID_LABEL = 'com.docker.swarm.service.id';
const RECENT_DOCKER_EVENT_LIMIT = 1000;
const RECENT_ALIAS_FILTER_DECISION_LIMIT = 1000;
const joiWildcardSchema = (joi as unknown as Record<string, () => Joi.Schema>)[`a${'ny'}`].bind(
  joi,
);

interface DockerEventsStream {
  on: (eventName: string, handler: (...args: unknown[]) => unknown) => unknown;
  removeAllListeners?: (eventName?: string) => unknown;
  destroy?: () => void;
}

interface CronTaskWithNextMatch {
  timeMatcher: {
    getNextMatch: (fromDate: Date) => unknown;
  };
}

interface DockerApiWithMutableModemHeaders {
  modem?: {
    headers?: Record<string, string>;
  };
}

interface DockerContainerSummaryLike {
  Id: string;
  Image: string;
  Labels?: Record<string, string>;
  Names?: string[];
  State?: string;
  Ports?: unknown;
  Mounts?: unknown;
  [key: string]: unknown;
}

interface DockerContainerSummaryWithLabels extends DockerContainerSummaryLike {
  Labels: Record<string, string>;
}

interface DockerImageInspectPayloadLike {
  RepoTags?: string[];
  RepoDigests?: string[];
  [key: string]: unknown;
}

interface ParsedImageReferenceLike {
  tag?: string;
  [key: string]: unknown;
}

type DockerRemoteAuthWatcher = Parameters<typeof initWatcherWithRemoteAuth>[0];
type DockerRemoteAuthResolutionInput = Parameters<typeof getRemoteAuthResolutionState>[0];
type DockerEventsWatcher = Parameters<typeof listenDockerEventsOrchestration>[0];
type DockerEventsReconnectError = Parameters<typeof scheduleDockerEventsReconnectState>[3];
type DockerEventsFailureStream = Parameters<typeof onDockerEventsStreamFailureHelper>[2];
type DockerEventsFailureError = Parameters<typeof onDockerEventsStreamFailureHelper>[4];
type DockerEventParseErrorInput = Parameters<typeof isRecoverableDockerEventParseErrorHelper>[0];
type DockerEventPayload = Parameters<typeof processDockerEventPayloadOrchestration>[1];
type DockerEvent = Parameters<typeof processDockerEventOrchestration>[1];
type DockerEventChunk = Parameters<typeof onDockerEventOrchestration>[1];
type DockerContainerInspectPayload = Parameters<typeof updateContainerFromInspectState>[1];
type DockerImageDetailsWatcher = Parameters<typeof addImageDetailsToContainerOrchestration>[0];
type DockerImageDetailsContainer = Parameters<typeof addImageDetailsToContainerOrchestration>[1];

interface DockerRecentEvent {
  timestamp: string;
  action?: string;
  type?: string;
  id?: string;
  actorId?: string;
}

type DockerWatcherSourceProbe = {
  name: string;
  agent?: string;
  configuration: Pick<DockerWatcherConfiguration, 'host' | 'socket' | 'protocol' | 'port'>;
};

function normalizeAgentValue(agent: unknown): string | undefined {
  if (typeof agent !== 'string') {
    return undefined;
  }
  return agent === '' ? undefined : agent;
}

function getContainersFromSameDockerSource(
  currentWatcher: DockerWatcherSourceProbe,
  containersInStore: Container[],
) {
  const currentWatcherSourceKey = getDockerWatcherSourceKey(currentWatcher);
  const currentWatcherAgent = normalizeAgentValue(currentWatcher.agent);
  const watcherRegistryState = registry.getState().watcher;

  return containersInStore.filter((storedContainer) => {
    if (normalizeAgentValue(storedContainer.agent) !== currentWatcherAgent) {
      return false;
    }

    if (storedContainer.watcher === currentWatcher.name) {
      return true;
    }

    const staleWatcherId = getDockerWatcherRegistryId(
      storedContainer.watcher,
      normalizeAgentValue(storedContainer.agent),
    );
    if (staleWatcherId === '') {
      return false;
    }
    const staleWatcher = watcherRegistryState[staleWatcherId];
    if (!isDockerWatcher(staleWatcher)) {
      return false;
    }

    return getDockerWatcherSourceKey(staleWatcher) === currentWatcherSourceKey;
  });
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
  public isCronWatchInProgress: boolean = false;
  public recentDockerEvents: DockerRecentEvent[] = [];
  public recentAliasFilterDecisions: AliasFilterDecision[] = [];

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
      watchdigest: joiWildcardSchema(),
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

  getNextScheduledRunDate(fromDate: Date = new Date()) {
    if (!this.configuration.cron) {
      return undefined;
    }

    try {
      const task = cron.createTask(
        this.configuration.cron,
        () => {},
      ) as unknown as CronTaskWithNextMatch;
      const nextMatch = task.timeMatcher.getNextMatch(fromDate);
      return nextMatch instanceof Date ? nextMatch : undefined;
    } catch {
      return undefined;
    }
  }

  override getNextRunAt(): string | undefined {
    const now = new Date();

    if (!this.configuration.maintenancewindow) {
      return this.getNextScheduledRunDate(now)?.toISOString();
    }

    if (this.maintenanceWindowWatchQueued) {
      return this.getNextMaintenanceWindowDate(now)?.toISOString();
    }

    const nextScheduledRun = this.getNextScheduledRunDate(now);
    if (!nextScheduledRun) {
      return undefined;
    }

    if (
      isInMaintenanceWindow(
        this.configuration.maintenancewindow,
        this.configuration.maintenancewindowtz,
        nextScheduledRun,
      )
    ) {
      return nextScheduledRun.toISOString();
    }

    return this.getNextMaintenanceWindowDate(nextScheduledRun)?.toISOString();
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
    } catch (e: unknown) {
      this.ensureLogger();
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn(`Unable to run queued maintenance watch (${getErrorMessage(e)})`);
      }
    }
  }

  /**
   * Init the Watcher.
   */
  async init() {
    this.ensureLogger();
    this.isWatcherDeregistered = false;
    await this.initWatcher();
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

  async initWatcher() {
    await initWatcherWithRemoteAuth(this.asRemoteAuthWatcher());
  }

  async recreateDockerClient() {
    await initWatcherWithRemoteAuth(this.asRemoteAuthWatcher());
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

  private asRemoteAuthWatcher(): DockerRemoteAuthWatcher {
    return this as unknown as DockerRemoteAuthWatcher;
  }

  private asDockerEventsWatcher(): DockerEventsWatcher {
    return this as unknown as DockerEventsWatcher;
  }

  private asDockerImageDetailsWatcher(): DockerImageDetailsWatcher {
    return this as unknown as DockerImageDetailsWatcher;
  }

  getRemoteAuthResolution(auth: DockerRemoteAuthResolutionInput) {
    return getRemoteAuthResolutionState(auth, getFirstConfigString);
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
    const dockerApiWithModem = this.dockerApi as unknown as DockerApiWithMutableModemHeaders;
    if (!dockerApiWithModem.modem) {
      dockerApiWithModem.modem = {};
    }
    dockerApiWithModem.modem.headers = {
      ...(dockerApiWithModem.modem.headers || {}),
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

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used through remote-auth watcher adapter
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

  private appendBoundedHistoryEntry<T>(history: T[], entry: T, maxEntries: number): void {
    history.push(entry);
    if (history.length <= maxEntries * 2) {
      return;
    }
    history.splice(0, history.length - maxEntries);
  }

  private toEventTimestamp(rawDockerEvent: Record<string, unknown>): string {
    const rawTimeNano = rawDockerEvent.timeNano;
    if (typeof rawTimeNano === 'number' && Number.isFinite(rawTimeNano) && rawTimeNano > 0) {
      return new Date(Math.trunc(rawTimeNano / 1_000_000)).toISOString();
    }

    const rawTime = rawDockerEvent.time;
    if (typeof rawTime === 'number' && Number.isFinite(rawTime) && rawTime > 0) {
      const timestampMs =
        rawTime > 1_000_000_000_000 ? Math.trunc(rawTime) : Math.trunc(rawTime * 1000);
      return new Date(timestampMs).toISOString();
    }

    return new Date().toISOString();
  }

  private recordRecentDockerEvent(dockerEvent: unknown): void {
    if (!dockerEvent || typeof dockerEvent !== 'object') {
      return;
    }

    const dockerEventRecord = dockerEvent as Record<string, unknown>;
    const actor = dockerEventRecord.Actor;
    const actorId =
      actor &&
      typeof actor === 'object' &&
      typeof (actor as Record<string, unknown>).ID === 'string'
        ? ((actor as Record<string, unknown>).ID as string)
        : undefined;

    const recentEvent: DockerRecentEvent = {
      timestamp: this.toEventTimestamp(dockerEventRecord),
      action:
        typeof dockerEventRecord.Action === 'string'
          ? dockerEventRecord.Action
          : typeof dockerEventRecord.status === 'string'
            ? dockerEventRecord.status
            : undefined,
      type:
        typeof dockerEventRecord.Type === 'string'
          ? dockerEventRecord.Type
          : typeof dockerEventRecord.scope === 'string'
            ? dockerEventRecord.scope
            : undefined,
      id: typeof dockerEventRecord.id === 'string' ? dockerEventRecord.id : undefined,
      actorId,
    };

    this.appendBoundedHistoryEntry(this.recentDockerEvents, recentEvent, RECENT_DOCKER_EVENT_LIMIT);
  }

  private recordAliasFilterDecisions(decisions: AliasFilterDecision[]): void {
    decisions.forEach((decision) => {
      this.appendBoundedHistoryEntry(
        this.recentAliasFilterDecisions,
        decision,
        RECENT_ALIAS_FILTER_DECISION_LIMIT,
      );
    });
  }

  getRecentDockerEvents(options: { sinceMs?: number; limit?: number } = {}): DockerRecentEvent[] {
    const { sinceMs, limit = RECENT_DOCKER_EVENT_LIMIT } = options;
    const filteredEvents = this.recentDockerEvents.filter((recentEvent) => {
      if (sinceMs === undefined) {
        return true;
      }
      const timestampMs = Date.parse(recentEvent.timestamp);
      return Number.isNaN(timestampMs) ? false : timestampMs >= sinceMs;
    });

    if (!Number.isFinite(limit) || limit <= 0) {
      return filteredEvents;
    }
    return filteredEvents.slice(-Math.trunc(limit));
  }

  getRecentAliasFilterDecisions(
    options: { sinceMs?: number; limit?: number } = {},
  ): AliasFilterDecision[] {
    const { sinceMs, limit = RECENT_ALIAS_FILTER_DECISION_LIMIT } = options;
    const filteredDecisions = this.recentAliasFilterDecisions.filter((decision) => {
      if (sinceMs === undefined) {
        return true;
      }
      const timestampMs = Date.parse(decision.timestamp);
      return Number.isNaN(timestampMs) ? false : timestampMs >= sinceMs;
    });

    if (!Number.isFinite(limit) || limit <= 0) {
      return filteredDecisions;
    }
    return filteredDecisions.slice(-Math.trunc(limit));
  }

  async ensureRemoteAuthHeaders() {
    await ensureRemoteAuthHeadersForWatcher(this.asRemoteAuthWatcher());
  }

  applyRemoteAuthHeaders(options: Dockerode.DockerOptions) {
    applyRemoteAuthHeadersForWatcher(this.asRemoteAuthWatcher(), options);
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

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used through docker-event watcher adapter
  private resetDockerEventsReconnectBackoff() {
    resetDockerEventsReconnectBackoffState(this);
  }

  private cleanupDockerEventsStream(destroy = false) {
    cleanupDockerEventsStreamState(this, destroy);
  }

  private scheduleDockerEventsReconnect(reason: string, err?: DockerEventsReconnectError) {
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

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used through docker-event watcher adapter
  private onDockerEventsStreamFailure(
    stream: DockerEventsFailureStream,
    reason: string,
    err?: DockerEventsFailureError,
  ) {
    onDockerEventsStreamFailureHelper(
      this,
      {
        scheduleDockerEventsReconnect: (failureReason: string, failureError?: unknown) =>
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
    await listenDockerEventsOrchestration(this.asDockerEventsWatcher());
  }

  isRecoverableDockerEventParseError(error: DockerEventParseErrorInput) {
    return isRecoverableDockerEventParseErrorHelper(error);
  }

  async processDockerEventPayload(
    dockerEventPayload: DockerEventPayload,
    shouldTreatRecoverableErrorsAsPartial = false,
  ) {
    return processDockerEventPayloadOrchestration(
      this.asDockerEventsWatcher(),
      dockerEventPayload,
      shouldTreatRecoverableErrorsAsPartial,
    );
  }

  async processDockerEvent(dockerEvent: DockerEvent) {
    this.recordRecentDockerEvent(dockerEvent);
    await processDockerEventOrchestration(this.asDockerEventsWatcher(), dockerEvent);
  }

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used through docker-event watcher adapter
  private updateContainerFromInspect(
    containerFound: Container,
    containerInspect: DockerContainerInspectPayload,
  ) {
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
  async onDockerEvent(dockerEventChunk: DockerEventChunk) {
    await onDockerEventOrchestration(
      this.asDockerEventsWatcher(),
      dockerEventChunk,
      DOCKER_EVENTS_BUFFER_MAX_BYTES,
    );
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
    this.isCronWatchInProgress = true;
    let containerReports: ContainerReport[] = [];
    try {
      containerReports = await this.watch();
    } finally {
      this.isCronWatchInProgress = false;
    }

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
    startDigestCachePollCycleForRegistries();

    // Dispatch event to notify start watching
    event.emitWatcherStart(this);

    // List images to watch
    try {
      containers = await this.getContainers();
    } catch (e: unknown) {
      this.log.warn(
        `Error when trying to get the list of the containers to watch (${getErrorMessage(e)})`,
      );
    }
    try {
      if (this.isCronWatchInProgress) {
        containers = containers.filter((container) => {
          const shouldSkip = consumeFreshContainerScheduledPollSkip(container.id);
          if (shouldSkip) {
            this.log.debug(
              `${fullName(container)} - Skipping scheduled poll because a registry webhook already triggered an immediate check`,
            );
          }
          return !shouldSkip;
        });
      }

      const containerReportsSettled = await Promise.allSettled(
        containers.map((container) => this.watchContainer(container)),
      );
      const containerReports: ContainerReport[] = [];
      for (const [index, containerReport] of containerReportsSettled.entries()) {
        if (containerReport.status === 'fulfilled') {
          containerReports.push(containerReport.value);
          continue;
        }
        const message = getErrorMessage(containerReport.reason);
        this.log.warn(
          `Error when processing container ${fullName(containers[index])} (${message})`,
        );
        const fallbackContainerReport = buildFallbackContainerReport(containers[index], message);
        await event.emitContainerReport(fallbackContainerReport);
        containerReports.push(fallbackContainerReport);
      }
      await event.emitContainerReports(containerReports);
      await event.emitWatcherSnapshot({
        watcher: {
          type: this.type,
          name: this.name,
        },
        containers: containerReports.map((containerReport) => containerReport.container),
      });
      return containerReports;
    } finally {
      endDigestCachePollCycleForRegistries();
      // Dispatch event to notify stop watching
      event.emitWatcherStop(this);
      this.lastRunAt = new Date().toISOString();
    }
  }

  /**
   * Watch a Container.
   * @param container
   * @returns {Promise<*>}
   */
  async watchContainer(container: Container) {
    this.ensureLogger();
    return watchContainerState(container, {
      ensureLogger: () => this.ensureLogger(),
      log: this.log,
      findNewVersion: (containerToCheck, logContainer) =>
        this.findNewVersion(containerToCheck, logContainer),
      mapContainerToContainerReport: (containerWithResult, watchStartedAtMs) =>
        this.mapContainerToContainerReport(containerWithResult, watchStartedAtMs),
    });
  }

  /**
   * Get all containers to watch.
   * @returns {Promise<unknown[]>}
   */
  async getContainers(): Promise<Container[]> {
    this.ensureLogger();
    await this.ensureRemoteAuthHeaders();
    let containersFromTheStore: Container[] = [];
    let sameSourceContainersFromTheStore: Container[] = [];
    try {
      containersFromTheStore = storeContainer.getContainers({
        watcher: this.name,
      });
    } catch (e: unknown) {
      this.log.warn(
        `Error when trying to get the existing containers from the store (${getErrorMessage(e)})`,
      );
    }
    try {
      sameSourceContainersFromTheStore = getContainersFromSameDockerSource(this, [
        ...storeContainer.getContainers(),
      ]);
    } catch (e: unknown) {
      this.log.warn(
        `Error when trying to get same-source containers from the store (${getErrorMessage(e)})`,
      );
      sameSourceContainersFromTheStore = [...containersFromTheStore];
    }
    const listContainersOptions: Dockerode.ContainerListOptions = {};
    if (this.configuration.watchall) {
      listContainersOptions.all = true;
    }
    const containers = (await this.dockerApi.listContainers(
      listContainersOptions,
    )) as unknown as DockerContainerSummaryLike[];

    const swarmServiceLabelsCache = new Map<string, Promise<Record<string, string>>>();
    const containersWithResolvedLabels: DockerContainerSummaryWithLabels[] = await Promise.all(
      containers.map(async (container) => ({
        ...container,
        Labels: await this.getEffectiveContainerLabels(container, swarmServiceLabelsCache),
      })),
    );

    // Filter on containers to watch
    const filteredContainers = containersWithResolvedLabels.filter((container) =>
      isContainerToWatch(
        getLabel(container.Labels, ddWatch, wudWatch),
        this.configuration.watchbydefault,
      ),
    );
    const { containersToWatch, skippedContainerIds, decisions } = filterRecreatedContainerAliases(
      filteredContainers,
      containersFromTheStore,
    );
    this.recordAliasFilterDecisions(decisions);

    const containerPromises = containersToWatch.map((container) =>
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
      }).catch((error: unknown) => {
        const errorMessage = getErrorMessage(error);
        this.log.warn(
          `${container.Names?.[0]?.replace(/^\//, '') || container.Id?.substring(0, 12)}: Failed to fetch image detail (${errorMessage || `${error}`})`,
        );
        return error;
      }),
    );
    const containersToReturn = (await Promise.all(containerPromises)).filter(
      (result): result is Container => !(result instanceof Error) && result != null,
    );

    // Prune old containers from the store
    try {
      await pruneOldContainers(containersToReturn, containersFromTheStore, this.dockerApi, {
        forceRemoveContainerIds: skippedContainerIds,
        sameSourceContainersFromStore: sameSourceContainersFromTheStore,
      });
    } catch (e: unknown) {
      this.log.warn(`Error when trying to prune the old containers (${getErrorMessage(e)})`);
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
    } catch (e: unknown) {
      this.log.warn(
        `Unable to inspect swarm service ${serviceId} for container ${containerId} (${getErrorMessage(
          e,
        )}); deploy-level labels will not be available`,
      );
      return {};
    }
  }

  async getEffectiveContainerLabels(
    container: DockerContainerSummaryLike,
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

  getMatchingImgsetConfiguration(
    parsedImage: Parameters<typeof getMatchingImgsetConfigurationState>[0],
  ) {
    return getMatchingImgsetConfigurationState(parsedImage, this.configuration.imgset);
  }

  /**
   * Find new version for a Container.
   */

  async findNewVersion(container: Container, logContainer: ContainerWatchLogger) {
    return findNewVersionState(container, logContainer);
  }

  /**
   * Add image detail to Container.
   */
  async addImageDetailsToContainer(
    container: DockerImageDetailsContainer,
    labelOverrides: ContainerLabelOverrides = {},
  ) {
    return addImageDetailsToContainerOrchestration(
      this.asDockerImageDetailsWatcher(),
      container,
      labelOverrides,
      {
        resolveLabelsFromContainer,
        mergeConfigWithImgset,
        normalizeContainer,
        resolveImageName: (imageName: string, image: unknown, containerName?: string) =>
          this.resolveImageName(imageName, image, containerName),
        resolveTagName: (
          parsedImage: ParsedImageReferenceLike,
          image: unknown,
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
        getMatchingImgsetConfiguration: (
          parsedImage: Parameters<typeof getMatchingImgsetConfigurationState>[0],
        ) => this.getMatchingImgsetConfiguration(parsedImage),
      },
    );
  }

  private resolveImageName(imageName: string, image: unknown, containerName?: string) {
    const imageRecord = image as DockerImageInspectPayloadLike;
    let imageNameToParse = imageName;
    if (imageNameToParse.includes('sha256:')) {
      if (!imageRecord.RepoTags || imageRecord.RepoTags.length === 0) {
        this.ensureLogger();
        const namePrefix = containerName ? `${containerName}: ` : '';
        this.log.warn(
          `${namePrefix}Cannot get a reliable tag for this image [${imageNameToParse}]`,
        );
        return this.resolveDigestOnlyImage(imageRecord, imageNameToParse);
      }
      [imageNameToParse] = imageRecord.RepoTags;
    }
    return parse(imageNameToParse);
  }

  /**
   * Build a parsed image reference for a digest-only image (no RepoTags).
   * Uses RepoDigests to extract the image name when available, otherwise
   * falls back to a minimal representation so the container remains visible.
   */
  private resolveDigestOnlyImage(imageRecord: DockerImageInspectPayloadLike, rawName: string) {
    if (imageRecord.RepoDigests && imageRecord.RepoDigests.length > 0) {
      const repoDigest = imageRecord.RepoDigests[0];
      const atIndex = repoDigest.indexOf('@');
      if (atIndex > 0) {
        const imageRef = repoDigest.substring(0, atIndex);
        const parsed = parse(imageRef);
        // Use the sha256 digest as the tag since no tag is available
        const digest = repoDigest.substring(atIndex + 1);
        return { ...parsed, tag: digest };
      }
    }
    // No useful metadata at all — use a truncated digest as the tag
    const digest = rawName.startsWith('sha256:') ? rawName : `sha256:${rawName}`;
    return { path: digest, tag: 'unknown' };
  }

  private resolveTagName(
    parsedImage: ParsedImageReferenceLike,
    image: unknown,
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
  mapContainerToContainerReport(containerWithResult: Container, watchStartedAtMs?: number) {
    this.ensureLogger();
    return mapContainerToContainerReportState(
      containerWithResult,
      {
        ensureLogger: () => this.ensureLogger(),
        log: this.log,
      },
      watchStartedAtMs,
    );
  }
}
export default Docker;
export {
  filterBySegmentCount as testable_filterBySegmentCount,
  filterRecreatedContainerAliases as testable_filterRecreatedContainerAliases,
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
