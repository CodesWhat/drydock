import type Dockerode from 'dockerode';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';

const joi = JoiCronExpression(Joi);

import debounceImport from 'just-debounce';
import cron, { type ScheduledTask } from 'node-cron';
import pLimit from 'p-limit';
import parse from 'parse-docker-image-name';

type DebounceFn = <T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
  atStart?: boolean,
  guarantee?: boolean,
) => (...args: Parameters<T>) => void;
const debounceModule = debounceImport as unknown as { default?: DebounceFn };
const debounce: DebounceFn = debounceModule.default || (debounceImport as unknown as DebounceFn);

import * as event from '../../../event/index.js';
import log from '../../../log/index.js';
import { type Container, type ContainerReport, fullName } from '../../../model/container.js';
import {
  DEFAULT_MAINTENANCE_WINDOW_SCOPE,
  MAINTENANCE_WINDOW_SCOPES,
  type MaintenanceWindowScope,
} from '../../../model/watcher-maintenance-window.js';
import {
  getLoggerInitFailureCounter,
  getWatchContainerGauge,
} from '../../../prometheus/watcher.js';
import type { ComponentConfiguration } from '../../../registry/Component.js';
import * as registry from '../../../registry/index.js';
import { failClosedAuth } from '../../../security/auth.js';
import * as storeContainer from '../../../store/container.js';
import { sleep } from '../../../util/sleep.js';
import {
  forgetControllerLocalEnumeration,
  recordControllerLocalEnumeration,
  seedControllerLocalEnumeration,
} from '../../controller-local-container-ids.js';
import { consumeFreshContainerScheduledPollSkip } from '../../registry-webhook-fresh.js';
import Watcher from '../../Watcher.js';
import { updateContainerFromInspect as updateContainerFromInspectState } from './container-event-update.js';
import {
  type AliasFilterDecision,
  applyEffectiveDockerConfigFromLabels,
  filterRecreatedContainerAliases,
  getDockerWatcherRegistryId,
  getDockerWatcherSourceKey,
  getLabel,
  getMatchingImgsetConfiguration as getMatchingImgsetConfigurationState,
  getPendingDiscoverySettleDelayMs,
  getSettledContainersToWatch,
  isDockerWatcher,
  mergeConfigWithImgset,
  pruneOldContainers,
  resolveEffectiveContainerTagPolicy,
  resolveLabelsFromContainer,
  resolveTriggerLabelOverrides,
} from './container-init.js';
import {
  mapContainerToContainerReport as mapContainerToContainerReportState,
  watchContainer as watchContainerState,
} from './container-processing.js';
import { warnIfCurlHealthcheckOverride } from './curl-healthcheck-warning.js';
import {
  endDigestCachePollCycleForRegistries,
  startDigestCachePollCycleForRegistries,
} from './digest-cache-lifecycle.js';
import {
  type CronWatchDeadlineHandle,
  type CronWatchOptions,
  type CronWatchOrchestrationWatcher,
  resetCronWatchState,
  watchFromCronOrchestration,
} from './docker-cron-watch.js';
import {
  invalidateDockerEventStreamOrchestration,
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
  getStillInWatchScopeContainerIds,
  isContainerToWatch,
  normalizeConfigNumberValue,
  shouldUpdateDisplayNameFromContainerName,
} from './docker-helpers.js';
import {
  appendBoundedHistoryEntry,
  filterAndSliceTimestampedHistory,
  RECENT_ALIAS_FILTER_DECISION_LIMIT,
  RECENT_DOCKER_EVENT_LIMIT,
} from './docker-history.js';
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
  ddPortLabel,
  ddRegistryLookupImage,
  ddRegistryLookupUrl,
  ddTagExclude,
  ddTagFamily,
  ddTagInclude,
  ddTagPinInfo,
  ddTagTransform,
  ddWatch,
} from './label.js';
import {
  getNextMaintenanceWindow,
  hasNarrowMinuteField,
  isInMaintenanceWindow,
  isScanGatedByMaintenanceWindow,
} from './maintenance.js';
import {
  createMutableOidcState,
  getOidcGrantType,
  getRemoteAuthResolution as getRemoteAuthResolutionState,
  isRemoteOidcTokenRefreshRequired,
  OIDC_DEVICE_URL_PATHS,
  OIDC_GRANT_TYPE_PATHS,
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
  watchevents: boolean;
  maintenancewindow?: string;
  maintenancewindowtz: string;
  maintenancewindowscope: MaintenanceWindowScope;
  maturitymode?: 'all' | 'mature';
  maturityminagedays?: number;
  imgset?: Record<string, Record<string, unknown>>;
  tag?: {
    family?: 'strict' | 'loose';
    pin?: {
      info?: boolean;
    };
  };
}

const START_WATCHER_DELAY_MS = 1000;

const DEBOUNCED_WATCH_CRON_MS = 5000;
const DOCKER_EVENTS_BUFFER_MAX_BYTES = 1024 * 1024;
const MAINTENANCE_WINDOW_QUEUE_POLL_MS = 60 * 1000;
const SWARM_SERVICE_ID_LABEL = 'com.docker.swarm.service.id';
const DOCKER_WATCH_CONCURRENCY = 10;

function mapWithDockerWatchConcurrency<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R> | R,
) {
  const limit = pLimit(DOCKER_WATCH_CONCURRENCY);
  return Promise.all(items.map((item, index) => limit(() => mapper(item, index))));
}

function allSettledWithDockerWatchConcurrency<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R> | R,
) {
  const limit = pLimit(DOCKER_WATCH_CONCURRENCY);
  return Promise.allSettled(items.map((item, index) => limit(() => mapper(item, index))));
}

interface DockerEventsStream {
  on: (eventName: string, handler: (...args: unknown[]) => unknown) => unknown;
  removeAllListeners?: (eventName?: string) => unknown;
  destroy?: () => void;
}

interface CronTaskWithNextMatch {
  destroy: () => void;
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
class Docker extends Watcher<DockerWatcherConfiguration> {
  public configuration: DockerWatcherConfiguration = {} as DockerWatcherConfiguration;
  public declare dockerApi: Dockerode;
  public watchCron?: ScheduledTask;
  public watchCronTimeout?: ReturnType<typeof setTimeout>;
  public watchCronDebounced?: (reason?: string) => void;
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
  // Single-flight state for watchFromCron; see watchFromCronOrchestration()
  // in docker-cron-watch.ts for the coalescing contract.
  public cronWatchInFlight?: Promise<ContainerReport[]>;
  public cronWatchRescanRequested: boolean = false;
  public cronWatchRescanReason?: string;
  public cronWatchRescanIgnoreMaintenanceWindow: boolean = false;
  public cronWatchDeadlineHandle?: CronWatchDeadlineHandle;
  public recentDockerEvents: DockerRecentEvent[] = [];
  public recentAliasFilterDecisions: AliasFilterDecision[] = [];
  public pendingDiscoveries: Map<string, { firstSeenAtMs: number; name: string }> = new Map();
  public pendingDiscoverySettleTimeout?: NodeJS.Timeout;
  public unregisterContainerUpdateApplied?: () => void;
  #cachedTimeMatcher: { cron: string; matcher: CronTaskWithNextMatch['timeMatcher'] } | undefined;

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
      cron: joi.string().cron().default('0 */6 * * *'),
      jitter: this.joi.number().integer().min(0).default(60000),
      watchbydefault: this.joi.boolean().default(true),
      watchall: this.joi.boolean().default(false),
      watchevents: this.joi.boolean().default(true),
      maintenancewindow: joi.string().cron().optional(),
      maintenancewindowtz: this.joi.string().default('UTC'),
      maintenancewindowscope: this.joi
        .string()
        .valid(...MAINTENANCE_WINDOW_SCOPES)
        .default(DEFAULT_MAINTENANCE_WINDOW_SCOPE),
      maturitymode: this.joi.string().valid('all', 'mature'),
      maturityminagedays: this.joi.number().integer().min(1).max(365),
      discoverysettlems: this.joi.number().integer().min(0).default(30_000), // sync w/ DEFAULT_DISCOVERY_SETTLE_MS
      tag: this.joi.object({
        family: this.joi.string().valid('strict', 'loose').default('strict'),
        pin: this.joi.object({
          info: this.joi.boolean().default(true),
        }),
      }),
      imgset: this.joi
        .object()
        .pattern(
          this.joi.string(),
          this.joi.object({
            image: this.joi.string().required(),
            include: this.joi.string(),
            exclude: this.joi.string(),
            transform: this.joi.string(),
            tag: this.joi.object({
              include: this.joi.string(),
              exclude: this.joi.string(),
              transform: this.joi.string(),
              family: this.joi.string().valid('strict', 'loose'),
              pin: this.joi.object({
                info: this.joi.boolean(),
              }),
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
      if (this.#cachedTimeMatcher?.cron !== this.configuration.cron) {
        const task = cron.createTask(
          this.configuration.cron,
          () => {},
        ) as unknown as CronTaskWithNextMatch;
        task.destroy();
        this.#cachedTimeMatcher = { cron: this.configuration.cron, matcher: task.timeMatcher };
      }
      const nextMatch = this.#cachedTimeMatcher.matcher.getNextMatch(fromDate);
      return nextMatch instanceof Date ? nextMatch : undefined;
    } catch {
      this.#cachedTimeMatcher = undefined;
      return undefined;
    }
  }

  override getNextRunAt(): string | undefined {
    const now = new Date();

    // Under the install scope the scan is never held back by the window, so the next run is
    // just the next cron match; reporting the next window would say the watcher is asleep
    // until 2am when it is in fact scanning on schedule.
    if (!isScanGatedByMaintenanceWindow(this.configuration)) {
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

  /**
   * Tell a digest-mode action trigger that this watcher's window is open and the scan that
   * consumed the queued catch-up has finished, so it can flush the installs it deferred
   * instead of holding them until its next digest cron.
   *
   * A failure here is logged and swallowed: the scan itself has already done its work by
   * this point, and a trigger that cannot be told is no reason to report the scan as failed.
   */
  async announceMaintenanceWindowOpened(): Promise<void> {
    try {
      await event.emitMaintenanceWindowOpened({ watcherId: this.getId() });
    } catch (e: unknown) {
      this.ensureLogger();
      if (this.log && typeof this.log.warn === 'function') {
        this.log.warn(`Unable to announce the maintenance window opening (${getErrorMessage(e)})`);
      }
    }
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
      // The scan itself announces the opening once it has run: it is the one that consumes
      // the armed queue, and an ordinary cron tick can reach the open window before this
      // poll does.
      await this.watchFromCron({
        ignoreMaintenanceWindow: true,
        reason: 'maintenance-window',
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
    this.warnIfNarrowMaintenanceWindow();
    await warnIfCurlHealthcheckOverride(this.log);
    await this.initWatcher();
    // A remote watcher's OIDC bearer header is not set by initWatcher(); it
    // is refreshed lazily, the same way getContainers() refreshes it before
    // its own listContainers() call below. Skipping this would send the
    // seed's listContainers() out with no Authorization header on a remote
    // OIDC watcher, so it fails and the seed swallows the failure, silently
    // seeding nothing. A blocked-auth watcher (remoteAuthBlockedReason set)
    // throws here; catch it the same way getContainers() callers do, so a
    // watcher that registers in blocked mode still finishes init() rather
    // than failing registration outright.
    //
    // Exception: a watcher that still needs its first-time interactive OIDC
    // device authorization is left alone here. registerWatchers() awaits
    // every watcher's init() via Promise.all(), so awaiting a flow that
    // waits on a human to visit a URL and enter a code (up to
    // OIDC_DEVICE_POLL_TIMEOUT_MS) would stall the whole controller's
    // startup, not just this watcher. That watcher's first scheduled scan
    // still runs the flow, same as before this change; only the seed below
    // goes out unauthenticated this once.
    if (this.wouldRefreshRequireInteractiveOidcDeviceFlow()) {
      this.log.info(
        `Remote watcher ${this.name} needs first-time OIDC device authorization; deferring it to the first scheduled scan instead of blocking startup`,
      );
    } else {
      try {
        await this.ensureRemoteAuthHeaders();
      } catch (e: unknown) {
        this.log.warn(
          `Unable to refresh remote auth before seeding controller-local container ids (${getErrorMessage(e)})`,
        );
      }
    }
    await seedControllerLocalEnumeration(this, this.dockerApi, this.log);
    this.log.info(`Cron scheduled (${this.configuration.cron})`);
    this.watchCron = cron.schedule(
      this.configuration.cron,
      () => this.watchFromCron({ reason: 'schedule' }),
      {
        maxRandomDelay: this.configuration.jitter,
      },
    );

    this.unregisterContainerUpdateApplied = event.registerContainerUpdateApplied(
      async (containerName) => {
        await this.maybeFastResyncAfterUpdate(containerName).catch(() => undefined);
      },
      { id: this.getId(), order: 0 },
    );

    // Watch at startup after all components have been registered.
    this.watchCronTimeout = setTimeout(
      () => this.watchFromCron({ reason: 'startup' }),
      START_WATCHER_DELAY_MS,
    );

    // listen to docker events
    if (this.configuration.watchevents) {
      this.isDockerEventsListenerActive = true;
      this.watchCronDebounced = debounce((reason: string = 'docker-event') => {
        // just-debounce exposes no cancel, so deregisterComponent() cannot
        // clear a pending timeout and this fires up to DEBOUNCED_WATCH_CRON_MS
        // after teardown. watchFromCronOrchestration() refuses a deregistered
        // watcher too; stopping here keeps the dead scan off the call stack
        // entirely. The catch matches the discovery-settle fallback below: a
        // bare `void` would surface a failed scan as an unhandled rejection.
        if (this.isWatcherDeregistered) {
          return;
        }
        void this.watchFromCron({ reason }).catch(() => undefined);
      }, DEBOUNCED_WATCH_CRON_MS);
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

  /**
   * Warn once at init when the configured maintenance window has a fixed
   * minute field, since it only opens the window for that exact minute per
   * matching hour rather than the whole hour(s) (#639).
   */
  warnIfNarrowMaintenanceWindow() {
    const { maintenancewindow } = this.configuration;
    if (maintenancewindow && hasNarrowMinuteField(maintenancewindow)) {
      this.log.warn(
        `Maintenance window '${maintenancewindow}' has a fixed minute field, so the window ` +
          'is only open during those exact minutes (cron is matched per minute, not as a ' +
          "range). Use '*' in the minute field to keep the window open for the whole hour(s), " +
          "e.g. '* 2-3 * * *'.",
      );
    }
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

  /**
   * True when refreshing this watcher's remote auth right now would start
   * (or resume) an interactive OIDC device-code authorization rather than a
   * plain network round trip. `init()` uses this to decide whether it is
   * safe to await `ensureRemoteAuthHeaders()` before the controller-local
   * seed. A cached, still-valid token or a non-interactive grant
   * (client_credentials, refresh_token) returns false: those refresh in a
   * single HTTP round trip and are safe to await inline. Mirrors
   * `determineGrantType()`'s own device-flow eligibility check (grant type
   * resolves to device_code AND a device authorization URL is configured);
   * a device_code grant with no device URL falls back to client_credentials
   * there too, so it is not treated as interactive here either.
   */
  private wouldRefreshRequireInteractiveOidcDeviceFlow(): boolean {
    const auth = this.configuration.auth;
    if (!this.configuration.host || !auth) {
      return false;
    }
    const { authType } = this.getRemoteAuthResolution(auth);
    if (authType !== 'oidc') {
      return false;
    }
    if (!isRemoteOidcTokenRefreshRequired(this.getOidcStateAdapter())) {
      return false;
    }
    const deviceUrl = this.getOidcAuthString(OIDC_DEVICE_URL_PATHS);
    if (!deviceUrl) {
      return false;
    }
    const grantType = getOidcGrantType({
      configuredGrantType: this.getOidcAuthString(OIDC_GRANT_TYPE_PATHS),
      refreshToken: this.remoteOidcRefreshToken,
      deviceUrl,
    });
    return grantType === 'urn:ietf:params:oauth:grant-type:device_code';
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

  recordRecentDockerEvent(dockerEvent: unknown): void {
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

    appendBoundedHistoryEntry(this.recentDockerEvents, recentEvent, RECENT_DOCKER_EVENT_LIMIT);
  }

  private recordAliasFilterDecisions(decisions: AliasFilterDecision[]): void {
    decisions.forEach((decision) => {
      appendBoundedHistoryEntry(
        this.recentAliasFilterDecisions,
        decision,
        RECENT_ALIAS_FILTER_DECISION_LIMIT,
      );
    });
  }

  private schedulePendingDiscoverySettleWatch(): void {
    if (this.pendingDiscoverySettleTimeout) {
      clearTimeout(this.pendingDiscoverySettleTimeout);
      delete this.pendingDiscoverySettleTimeout;
    }
    const delayMs = getPendingDiscoverySettleDelayMs(this);
    if (delayMs === undefined || this.isWatcherDeregistered) {
      return;
    }
    this.pendingDiscoverySettleTimeout = setTimeout(() => {
      delete this.pendingDiscoverySettleTimeout;
      // watchCronDebounced only exists when watchevents is on — else watch directly.
      const watch =
        this.watchCronDebounced ??
        ((reason?: string) => {
          void this.watchFromCron({ reason }).catch(() => undefined);
        });
      watch('discovery-settle');
    }, delayMs);
  }

  getRecentDockerEvents(options: { sinceMs?: number; limit?: number } = {}): DockerRecentEvent[] {
    const { sinceMs, limit = RECENT_DOCKER_EVENT_LIMIT } = options;
    return filterAndSliceTimestampedHistory(this.recentDockerEvents, sinceMs, limit);
  }

  getRecentAliasFilterDecisions(
    options: { sinceMs?: number; limit?: number } = {},
  ): AliasFilterDecision[] {
    const { sinceMs, limit = RECENT_ALIAS_FILTER_DECISION_LIMIT } = options;
    return filterAndSliceTimestampedHistory(this.recentAliasFilterDecisions, sinceMs, limit);
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
    forgetControllerLocalEnumeration(this);

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
    this.schedulePendingDiscoverySettleWatch(); // clears the timer; never reschedules once deregistered
    delete this.watchCronDebounced;
    this.unregisterContainerUpdateApplied?.();
    this.unregisterContainerUpdateApplied = undefined;
    this.clearMaintenanceWindowQueue();
    // See resetCronWatchState() in docker-cron-watch.ts for why this runs
    // on deregister.
    resetCronWatchState(this.asCronWatchWatcher());
  }

  private async maybeFastResyncAfterUpdate(
    payload: import('../../../event/index.js').ContainerUpdateAppliedEvent,
  ): Promise<void> {
    const containerName = event.getContainerUpdateAppliedEventContainerName(payload);
    if (!containerName) {
      return;
    }
    const containers = storeContainer.getContainers({ watcher: this.name });
    const currentWatcherAgent = normalizeAgentValue(this.agent);
    // Only match containers owned by THIS watcher's agent — remote-agent rows
    // share the same default watcher name ('local') and would otherwise produce
    // a cross-agent match leaving a stale "update available" badge (#386).
    const matched = containers.find(
      (c) =>
        `${c.watcher}_${c.name}` === containerName &&
        normalizeAgentValue(c.agent) === currentWatcherAgent,
    );
    if (!matched) {
      return;
    }
    // Gate the fast resync by the maintenance window — if the window is closed, skip
    // the resync scan just as watchFromCron does. Scan scope only: the install scope keeps
    // every detection path running so container state never goes stale.
    if (isScanGatedByMaintenanceWindow(this.configuration) && !this.isMaintenanceWindowOpen()) {
      this.log.debug(
        `Skipping fast resync after update for "${matched.name}" — outside maintenance window`,
      );
      return;
    }
    // Mark the epoch BEFORE starting the resync scan so that any cron scan
    // already in-flight (watchStartedAtMs <= clearedAtMs) is suppressed by
    // the preserveClearedUpdateState guard in container-processing.ts and
    // cannot re-raise a spurious updateAvailable=true badge (#265 regression).
    storeContainer.markPendingFreshStateAfterManualUpdate(matched, Date.now());
    await this.watchContainer(matched, { emitBatchEvent: false });
  }

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used through docker-event watcher adapter
  private resetDockerEventsReconnectBackoff() {
    resetDockerEventsReconnectBackoffState(this);
  }

  private cleanupDockerEventsStream(destroy = false) {
    invalidateDockerEventStreamOrchestration(this.asDockerEventsWatcher());
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

  processDockerEventPayload(
    dockerEventPayload: string,
    shouldTreatRecoverableErrorsAsPartial = false,
    streamGeneration?: number,
  ) {
    return processDockerEventPayloadOrchestration(
      this.asDockerEventsWatcher(),
      dockerEventPayload,
      shouldTreatRecoverableErrorsAsPartial,
      streamGeneration,
    );
  }

  processDockerEvent(dockerEvent: unknown, streamGeneration?: number) {
    return processDockerEventOrchestration(
      this.asDockerEventsWatcher(),
      dockerEvent,
      streamGeneration,
    );
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
      getCustomDisplayNameFromLabels: (labels) => getLabel(labels, ddDisplayName),
      updateContainer: (container) => storeContainer.updateContainer(container),
      logInfo: (message) => logContainer.info(message),
      applyDerivedLabelFieldsToContainer: (container, labels) =>
        applyEffectiveDockerConfigFromLabels(
          container,
          labels,
          this.configuration,
          (image) => this.getMatchingImgsetConfiguration(image),
          { logger: logContainer, containerName: fullName(containerFound) },
        ),
    });
  }

  onDockerEvent(dockerEventChunk: unknown, streamGeneration?: number) {
    return onDockerEventOrchestration(
      this.asDockerEventsWatcher(),
      dockerEventChunk,
      DOCKER_EVENTS_BUFFER_MAX_BYTES,
      streamGeneration,
    );
  }

  /**
   * Watch containers (called by cron scheduled tasks). Single-flight: see
   * watchFromCronOrchestration() in docker-cron-watch.ts for the coalescing
   * contract (#972).
   * @returns {Promise<*[]>}
   */
  watchFromCron(options: CronWatchOptions = {}): Promise<ContainerReport[]> {
    return watchFromCronOrchestration(this.asCronWatchWatcher(), options);
  }

  private asCronWatchWatcher(): CronWatchOrchestrationWatcher {
    return this as unknown as CronWatchOrchestrationWatcher;
  }

  /**
   * Watch main method.
   * @returns {Promise<*[]>}
   */
  async watch() {
    this.ensureLogger();
    let containers: Container[] = [];
    let containerEnumerationFailed = false;
    const enumerationDiagnostics: { enrichmentErrors: number } = { enrichmentErrors: 0 };
    const digestCachePollCycle = startDigestCachePollCycleForRegistries();

    // Dispatch event to notify start watching
    event.emitWatcherStart(this);

    // List images to watch
    try {
      containers = await this.getContainers(enumerationDiagnostics);
    } catch (e: unknown) {
      this.log.warn(
        `Error when trying to get the list of the containers to watch (${getErrorMessage(e)})`,
      );
      containerEnumerationFailed = true;
    }
    if (enumerationDiagnostics.enrichmentErrors > 0) {
      this.log.warn(
        `Container enumeration degraded: ${enumerationDiagnostics.enrichmentErrors} container(s) could not be inspected this cycle; suppressing the watcher snapshot so the controller keeps its last-known state`,
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

      const containerReportsSettled = await allSettledWithDockerWatchConcurrency(
        containers,
        (container) => this.watchContainer(container, { useRegistryPollCache: true }),
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
      this.lastRunAt = new Date().toISOString();
      // Skip the snapshot emit when container enumeration itself failed, or
      // when per-container image-detail enrichment dropped one or more
      // containers. The snapshot is authoritative — the controller prunes
      // everything not in `containers` — so emitting a short or empty list
      // after a transient docker / socket-proxy hiccup would wipe the
      // controller's view of this agent (issues #362, #386). Per-container
      // reports are still emitted above; only the authoritative prune is
      // deferred until a fully clean cycle. Preserve last-known state.
      if (!containerEnumerationFailed && enumerationDiagnostics.enrichmentErrors === 0) {
        await event.emitWatcherSnapshot({
          watcher: {
            type: this.type,
            name: this.name,
            configuration: this.maskConfiguration() as Record<string, unknown>,
            metadata: this.getMetadata(),
          },
          containers: containerReports.map((containerReport) => containerReport.container),
        });
      }
      return containerReports;
    } finally {
      endDigestCachePollCycleForRegistries(digestCachePollCycle);
      // Dispatch event to notify stop watching
      event.emitWatcherStop(this);
      this.lastRunAt = new Date().toISOString();
    }
  }

  /**
   * Watch a Container.
   * @param container
   * @param options.emitBatchEvent - When true, also emit a single-element
   *   `emitContainerReports` event so that batch-mode triggers fire for
   *   standalone per-container scans. Must be false (default) when called
   *   from the bulk `watch()` loop because that path emits its own
   *   `emitContainerReports` for the full set at the end.
   * @returns {Promise<*>}
   */
  async watchContainer(
    container: Container,
    {
      emitBatchEvent = false,
      useRegistryPollCache = false,
    }: { emitBatchEvent?: boolean; useRegistryPollCache?: boolean } = {},
  ) {
    this.ensureLogger();
    return watchContainerState(container, {
      ensureLogger: () => this.ensureLogger(),
      log: this.log,
      findNewVersion: (containerToCheck, logContainer) =>
        this.findNewVersion(containerToCheck, logContainer, { useRegistryPollCache }),
      mapContainerToContainerReport: (containerWithResult, watchStartedAtMs) =>
        this.mapContainerToContainerReport(containerWithResult, watchStartedAtMs),
      emitBatchEvent,
    });
  }

  /**
   * Get all containers to watch.
   * @returns {Promise<unknown[]>}
   */
  async getContainers(diagnostics?: { enrichmentErrors: number }): Promise<Container[]> {
    this.ensureLogger();
    await this.ensureRemoteAuthHeaders();
    let containersFromTheStore: Container[] = [];
    let sameSourceContainersFromTheStore: Container[] = [];
    try {
      const currentWatcherAgent = normalizeAgentValue(this.agent);
      containersFromTheStore = storeContainer
        .getContainers({
          watcher: this.name,
        })
        // Only prune containers owned by THIS watcher's agent. Remote agent
        // containers are stored under the same default watcher name ('local')
        // as the controller's own watcher, so an unscoped query would let the
        // controller's local prune delete every agent's containers each cycle
        // (#386).
        .filter(
          (storedContainer) => normalizeAgentValue(storedContainer.agent) === currentWatcherAgent,
        );
    } catch (e: unknown) {
      this.log.warn(
        `Error when trying to get the existing containers from the store (${getErrorMessage(e)})`,
      );
    }
    try {
      sameSourceContainersFromTheStore = getContainersFromSameDockerSource(this, [
        ...storeContainer.getContainersRaw(),
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
    // getContainers() can still be in flight when deregisterComponent()
    // already called forgetControllerLocalEnumeration(this). Recording the
    // claim set here would resurrect it for a dead watcher, permanently
    // blocking any agent that reuses that container id (nothing else ever
    // clears a claim for a watcher that's gone).
    if (!this.isWatcherDeregistered) {
      recordControllerLocalEnumeration(
        this,
        containers.map((container) => container.Id),
      );
    }

    const swarmServiceLabelsCache = new Map<string, Promise<Record<string, string>>>();
    const containersWithResolvedLabels: DockerContainerSummaryWithLabels[] =
      await mapWithDockerWatchConcurrency(containers, async (container) => ({
        ...container,
        Labels: await this.getEffectiveContainerLabels(container, swarmServiceLabelsCache),
      }));

    // Filter on containers to watch
    const filteredContainers = containersWithResolvedLabels.filter((container) =>
      isContainerToWatch(getLabel(container.Labels, ddWatch), this.configuration.watchbydefault),
    );
    const { containersToWatch, skippedContainerIds, decisions } = filterRecreatedContainerAliases(
      filteredContainers,
      containersFromTheStore,
    );
    this.recordAliasFilterDecisions(decisions);
    const settled = getSettledContainersToWatch(containersToWatch, containersFromTheStore, this);
    this.schedulePendingDiscoverySettleWatch();
    const enrichmentResults = await mapWithDockerWatchConcurrency(settled, (container) =>
      this.addImageDetailsToContainer(container, {
        includeTags: getLabel(container.Labels, ddTagInclude),
        excludeTags: getLabel(container.Labels, ddTagExclude),
        transformTags: getLabel(container.Labels, ddTagTransform),
        tagFamily: getLabel(container.Labels, ddTagFamily),
        tagPinInfo: getLabel(container.Labels, ddTagPinInfo),
        linkTemplate: getLabel(container.Labels, ddLinkTemplate),
        portLabel: getLabel(container.Labels, ddPortLabel),
        displayName: getLabel(container.Labels, ddDisplayName),
        displayIcon: getLabel(container.Labels, ddDisplayIcon),
        ...resolveTriggerLabelOverrides(container.Labels),
        registryLookupImage: getLabel(container.Labels, ddRegistryLookupImage),
        registryLookupUrl: getLabel(container.Labels, ddRegistryLookupUrl),
      }).catch((error: unknown) => {
        const errorMessage = getErrorMessage(error);
        this.log.warn(
          `${container.Names?.[0]?.replace(/^\//, '') || container.Id?.substring(0, 12)}: Failed to fetch image detail (${errorMessage || `${error}`})`,
        );
        return error instanceof Error ? error : new Error(String(error));
      }),
    );
    // A thrown enrichment failure (e.g. a transient docker / socket-proxy
    // hiccup during image inspect) drops that container from the result set.
    // Surface the count so `watch()` can suppress the authoritative watcher
    // snapshot rather than prune the dropped containers off the controller
    // (issue #386). `undefined` results are intentional skips (e.g. podman
    // pod infra containers) and are not counted as errors.
    if (diagnostics) {
      diagnostics.enrichmentErrors = enrichmentResults.filter(
        (result) => result instanceof Error,
      ).length;
    }
    const containersToReturn = enrichmentResults.filter(
      (result): result is Container => !(result instanceof Error) && result != null,
    );

    // Prune old containers from the store (#869; see getStillInWatchScopeContainerIds in docker-helpers.ts).
    const stillInWatchScopeContainerIds = getStillInWatchScopeContainerIds(
      containersWithResolvedLabels,
      filteredContainers,
      containersFromTheStore,
    );
    try {
      await pruneOldContainers(containersToReturn, containersFromTheStore, this.dockerApi, {
        forceRemoveContainerIds: skippedContainerIds,
        sameSourceContainersFromStore: sameSourceContainersFromTheStore,
        stillInWatchScopeContainerIds,
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
              .filter((k) => k.startsWith('dd.'))
              .join(',') || 'none'
          }, task labels=${
            Object.keys(taskContainerLabels)
              .filter((k) => k.startsWith('dd.'))
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

  async findNewVersion(
    container: Container,
    logContainer: ContainerWatchLogger,
    { useRegistryPollCache = false }: { useRegistryPollCache?: boolean } = {},
  ) {
    const tagPolicy = resolveEffectiveContainerTagPolicy(
      container,
      this.configuration.tag,
      (image) => this.getMatchingImgsetConfiguration(image),
    );
    return findNewVersionState({ ...container, tagFamily: tagPolicy.tagFamily }, logContainer, {
      pinInfoEnabled: tagPolicy.tagPinInfo,
      useRegistryPollCache,
    });
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
          inspectTagVersionOnly?: boolean,
        ) =>
          this.resolveTagName(
            parsedImage,
            image,
            inspectTagPath,
            transformTagsFromLabel,
            containerId,
            inspectTagVersionOnly,
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
      // Hybrid form: image:tag@sha256:digest — a colon (for the tag) appears
      // before the '@sha256:' suffix. The deploy ref already carries an
      // authoritative tag — return it directly without consulting RepoTags.
      const atDigestIndex = imageNameToParse.indexOf('@sha256:');
      if (atDigestIndex > 0 && imageNameToParse.lastIndexOf(':', atDigestIndex) > 0) {
        const parsedHybrid = parse(imageNameToParse.substring(0, atDigestIndex));
        if (parsedHybrid.tag) {
          return parsedHybrid;
        }
      }
      // Raw image ID (sha256:...) or digest-pinned ref without a tag
      // (image@sha256:...): need a tag from RepoTags, or fall back to
      // resolveDigestOnlyImage.
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
    inspectTagVersionOnly?: boolean,
  ) {
    let tagName = parsedImage.tag || 'latest';
    if (inspectTagPath) {
      const semverTagFromInspect = getSemverTagFromInspectPath(
        image,
        inspectTagPath,
        transformTagsFromLabel,
      );
      if (semverTagFromInspect) {
        if (!inspectTagVersionOnly) {
          tagName = semverTagFromInspect; // default: overwrite tag (behavior unchanged)
        }
        // dual-write happens in orchestration.ts softwareVersion field, not here
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
