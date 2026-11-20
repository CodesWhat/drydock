import { createHash } from 'node:crypto';
import { type FSWatcher, watch as fsWatch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';

const joi = JoiCronExpression(Joi);

import debounceImport from 'just-debounce';
import cron, { type ScheduledTask } from 'node-cron';

type DebounceFn = <T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
  atStart?: boolean,
  guarantee?: boolean,
) => (...args: Parameters<T>) => void;
const debounceModule = debounceImport as unknown as { default?: DebounceFn };
const debounce: DebounceFn = debounceModule.default || (debounceImport as unknown as DebounceFn);

import * as event from '../../../event/index.js';
import type { Container, ContainerReport } from '../../../model/container.js';
import { fullName } from '../../../model/container.js';
import { getWatchContainerGauge } from '../../../prometheus/watcher.js';
import type { ComponentConfiguration } from '../../../registry/Component.js';
import { isObservationMode } from '../../../runtime/observation-mode.js';
import * as storeContainer from '../../../store/container.js';
import { getErrorMessage } from '../../../util/error.js';
import Watcher from '../../Watcher.js';
import { resolveEffectiveContainerTagPolicy } from '../docker/container-init.js';
import {
  type DockerContainerWatchOptions,
  mapContainerToContainerReport,
  watchContainer,
} from '../docker/container-processing.js';
import {
  endDigestCachePollCycleForRegistries,
  startDigestCachePollCycleForRegistries,
} from '../docker/digest-cache-lifecycle.js';
import { buildFallbackContainerReport } from '../docker/docker-helpers.js';
import {
  type ContainerWatchLogger,
  type FindNewVersionOptions,
  findNewVersion as findNewVersionState,
} from '../docker/image-comparison.js';
import { applyDockerDeclarativeUpdatePolicy, withStoredSkipTags } from '../docker/update-policy.js';
import { allSettledWithDockerWatchConcurrency } from '../docker/watch-concurrency.js';
import { buildFileContainer } from './file-container.js';
import { type FileImageEntry, FileImageListError, parseImageListFile } from './file-entries.js';

interface FileWatcherConfiguration extends ComponentConfiguration {
  path: string;
  cron: string;
  jitter: number;
  watchfile: boolean;
}

const START_WATCHER_DELAY_MS = 1000;
const FILE_CHANGE_DEBOUNCE_MS = 1000;

/**
 * The container fields an entry declares. They are re-written onto an already stored
 * synthetic container on every scan, so an edit to the file (a new `dd.tag.include`, a
 * different display name) reaches the stored record and not only the scan in flight.
 */
const DECLARED_FIELDS = [
  'displayName',
  'displayIcon',
  'includeTags',
  'excludeTags',
  'transformTags',
  'tagFamily',
  'tagPinInfo',
  'linkTemplate',
  'portLabel',
  'actionTriggerInclude',
  'actionTriggerExclude',
  'notificationTriggerInclude',
  'notificationTriggerExclude',
  'actionTriggerAuto',
  'triggerInclude',
  'triggerExclude',
  'labels',
  'image',
] as const satisfies ReadonlyArray<keyof Container>;

interface CronTaskWithNextMatch {
  destroy: () => void;
  timeMatcher: {
    getNextMatch: (fromDate: Date) => unknown;
  };
}

/**
 * Watcher provider `file`: a static list of images read from a YAML file.
 *
 * Each entry becomes a synthetic container, so tag filters, registry authentication and
 * trigger routing work as they do for a Docker container. Nothing is running behind a
 * synthetic container, so it is notification-only: every action path refuses it.
 */
class File extends Watcher<FileWatcherConfiguration> {
  public watchCron?: ScheduledTask;
  public watchCronTimeout?: ReturnType<typeof setTimeout>;
  public fileWatcher?: FSWatcher;
  public isWatcherDeregistered: boolean = false;
  public cronWatchInFlight?: Promise<ContainerReport[]>;
  public lastLoadError?: string;
  private scanGeneration: number = 0;
  private rescanRequested: boolean = false;
  private entries: FileImageEntry[] = [];
  // Hash of the last content that was parsed, good or bad, so an unchanged file is neither
  // re-parsed nor re-reported on every scan.
  private lastSeenContentHash?: string;
  // Hash of the content the current list came from.
  private goodContentHash?: string;
  private lastReportedLoadFailure?: string;

  getConfigurationSchema() {
    return joi.object().keys({
      path: this.joi.string().required(),
      cron: joi.string().cron().default('0 */6 * * *'),
      jitter: this.joi.number().integer().min(0).default(60000),
      watchfile: this.joi.boolean().default(true),
    });
  }

  override getMetadata(): Record<string, unknown> {
    return {
      ...super.getMetadata(),
      source: 'file',
      path: this.configuration.path,
      imageCount: this.entries.length,
      lastLoadError: this.lastLoadError,
    };
  }

  override getNextRunAt(): string | undefined {
    try {
      const task = cron.createTask(
        this.configuration.cron,
        () => {},
      ) as unknown as CronTaskWithNextMatch;
      task.destroy();
      const nextMatch = task.timeMatcher.getNextMatch(new Date());
      return nextMatch instanceof Date ? nextMatch.toISOString() : undefined;
    } catch {
      return undefined;
    }
  }

  async init() {
    this.isWatcherDeregistered = false;
    await this.reload();
    // The one-shot `scan` command drives watch() itself and exits, so it gets no cron,
    // startup scan or file watch.
    if (isObservationMode()) {
      return;
    }
    this.log.info(`Cron scheduled (${this.configuration.cron})`);
    this.watchCron = cron.schedule(
      this.configuration.cron,
      () => this.watchFromCron({ reason: 'schedule' }),
      { maxRandomDelay: this.configuration.jitter },
    );
    this.watchCronTimeout = setTimeout(
      () => void this.watchFromCron({ reason: 'startup' }).catch(() => undefined),
      START_WATCHER_DELAY_MS,
    );
    if (this.configuration.watchfile) {
      this.startFileWatch();
    }
  }

  async deregisterComponent() {
    this.isWatcherDeregistered = true;
    // Invalidates a scan already in flight so it discards its results instead of emitting.
    this.scanGeneration++;
    this.rescanRequested = false;
    this.cronWatchInFlight = undefined;
    if (this.watchCron) {
      this.watchCron.stop();
      delete this.watchCron;
    }
    if (this.watchCronTimeout) {
      clearTimeout(this.watchCronTimeout);
      delete this.watchCronTimeout;
    }
    if (this.fileWatcher) {
      this.fileWatcher.close();
      delete this.fileWatcher;
    }
  }

  /**
   * Watch the file's directory rather than the file: editors and config management often
   * replace the file (a new inode), which a watch on the file itself would lose. The cron
   * run re-reads the file too, so a platform where this watch does not fire still catches up.
   */
  private startFileWatch() {
    const filePath = path.resolve(this.configuration.path);
    const directory = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const onFileChanged = debounce(() => {
      if (this.isWatcherDeregistered) {
        return;
      }
      void this.watchFromCron({ reason: 'file-change' }).catch(() => undefined);
    }, FILE_CHANGE_DEBOUNCE_MS);
    try {
      this.fileWatcher = fsWatch(directory, { persistent: false }, (_eventType, changedName) => {
        if (changedName === null || changedName === undefined || changedName === fileName) {
          onFileChanged();
        }
      });
      this.fileWatcher.on('error', (error: unknown) => {
        this.log.warn(`File watch on ${directory} failed (${getErrorMessage(error)})`);
      });
    } catch (error: unknown) {
      this.log.warn(
        `Unable to watch ${directory} for changes (${getErrorMessage(error)}); the list is still re-read on every cron run`,
      );
    }
  }

  /**
   * Re-read the file. A file that cannot be read or does not validate leaves the last good
   * list in force, so a bad edit or a deleted file never empties the watch list.
   */
  async reload(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.configuration.path, 'utf8');
    } catch (error: unknown) {
      this.reportLoadFailure(
        `read:${getErrorMessage(error)}`,
        `Unable to read ${this.configuration.path} (${getErrorMessage(error)}); keeping the last good list of ${this.entries.length} image(s)`,
      );
      return;
    }
    const contentHash = createHash('sha256').update(content).digest('hex');
    if (contentHash === this.lastSeenContentHash) {
      if (contentHash === this.goodContentHash) {
        this.markHealthy();
      }
      return;
    }
    let entries: FileImageEntry[];
    try {
      entries = parseImageListFile(content);
    } catch (error: unknown) {
      this.lastSeenContentHash = contentHash;
      const problems =
        error instanceof FileImageListError ? error.errors : [getErrorMessage(error)];
      this.reportLoadFailure(
        `parse:${contentHash}`,
        `${this.configuration.path} is invalid, keeping the last good list of ${this.entries.length} image(s): ${problems.join('; ')}`,
      );
      return;
    }
    this.lastSeenContentHash = contentHash;
    this.goodContentHash = contentHash;
    this.markHealthy();
    this.entries = entries;
    this.log.info(`Loaded ${entries.length} image(s) from ${this.configuration.path}`);
    this.pruneRemovedEntries();
  }

  /** The file reads and validates again, so the next failure is a new one to report. */
  private markHealthy() {
    this.lastLoadError = undefined;
    this.lastReportedLoadFailure = undefined;
  }

  private reportLoadFailure(key: string, message: string) {
    this.lastLoadError = message;
    if (this.lastReportedLoadFailure === key) {
      return;
    }
    this.lastReportedLoadFailure = key;
    this.log.error(message);
  }

  /** Delete the stored records of entries that are no longer in the list. */
  private pruneRemovedEntries() {
    const currentNames = new Set(this.entries.map((entry) => entry.name));
    for (const stored of storeContainer.getContainersRaw({ watcher: this.name })) {
      if (!currentNames.has(stored.name)) {
        this.log.debug(`${fullName(stored)} - Removed from the list`);
        storeContainer.deleteContainer(stored.id);
      }
    }
  }

  /**
   * The synthetic containers for the current list. One already in the store keeps its
   * record (overrides, update history) and only has the fields the file declares rewritten.
   */
  async getContainers(): Promise<Container[]> {
    const containers: Container[] = [];
    for (const entry of this.entries) {
      try {
        containers.push(this.getContainerForEntry(entry));
      } catch (error: unknown) {
        this.log.warn(`${entry.name} - Unable to build the container (${getErrorMessage(error)})`);
      }
    }
    getWatchContainerGauge()?.set({ type: this.type, name: this.name }, containers.length);
    return containers;
  }

  private getContainerForEntry(entry: FileImageEntry): Container {
    const declared = buildFileContainer(this.name, entry, this.log);
    if (!storeContainer.getContainer(declared.id)) {
      return declared;
    }
    const patch = Object.fromEntries(DECLARED_FIELDS.map((field) => [field, declared[field]]));
    const persisted = storeContainer.updateContainerFields(declared.id, patch, undefined, {
      labelOwned: 'declared',
    }) as Container;
    applyDockerDeclarativeUpdatePolicy(
      persisted,
      entry.labels,
      {},
      {
        logger: this.log,
        containerName: entry.name,
      },
    );
    return persisted;
  }

  /**
   * Single-flight scan: a request that lands while one is running is coalesced into one
   * follow-up scan, so a burst of file edits or a manual check never overlaps itself.
   */
  watchFromCron(_options: { ignoreMaintenanceWindow?: boolean; reason?: string } = {}) {
    if (this.isWatcherDeregistered) {
      return Promise.resolve([] as ContainerReport[]);
    }
    if (this.cronWatchInFlight) {
      this.rescanRequested = true;
      return this.cronWatchInFlight;
    }
    const inFlight: Promise<ContainerReport[]> = this.watch().finally(() => {
      if (this.cronWatchInFlight !== inFlight) {
        return;
      }
      this.cronWatchInFlight = undefined;
      if (this.rescanRequested) {
        this.rescanRequested = false;
        void this.watchFromCron({ reason: 'coalesced' }).catch(() => undefined);
      }
    });
    this.cronWatchInFlight = inFlight;
    return inFlight;
  }

  async watch(): Promise<ContainerReport[]> {
    const scanGeneration = this.scanGeneration;
    const digestCachePollCycle = startDigestCachePollCycleForRegistries();
    event.emitWatcherStart(this);
    try {
      await this.reload();
      const containers = await this.getContainers();
      const settled = await allSettledWithDockerWatchConcurrency(containers, (container) =>
        this.watchContainer(container, { useRegistryPollCache: true, scanGeneration }),
      );
      if (scanGeneration !== this.scanGeneration) {
        return [];
      }
      const reports: ContainerReport[] = [];
      for (const [index, result] of settled.entries()) {
        if (result.status === 'fulfilled') {
          reports.push(result.value);
          continue;
        }
        const message = getErrorMessage(result.reason);
        this.log.warn(
          `Error when processing container ${fullName(containers[index])} (${message})`,
        );
        const fallbackReport = buildFallbackContainerReport(containers[index], message);
        await event.emitContainerReport(fallbackReport);
        reports.push(fallbackReport);
      }
      await event.emitContainerReports(reports);
      if (scanGeneration !== this.scanGeneration) {
        return [];
      }
      this.lastRunAt = new Date().toISOString();
      return reports;
    } finally {
      endDigestCachePollCycleForRegistries(digestCachePollCycle);
      event.emitWatcherStop(this);
    }
  }

  async watchContainer(
    container: Container,
    options: DockerContainerWatchOptions = {},
  ): Promise<ContainerReport> {
    const {
      emitBatchEvent = false,
      useRegistryPollCache = false,
      collectReleaseMaturity,
    } = options;
    const { scanGeneration } = options;
    return watchContainer(container, {
      ensureLogger: () => undefined,
      log: this.log,
      findNewVersion: (containerToCheck, logContainer) =>
        this.findNewVersion(containerToCheck, logContainer, {
          useRegistryPollCache,
          collectReleaseMaturity,
        }),
      mapContainerToContainerReport: (containerWithResult, watchStartedAtMs) =>
        mapContainerToContainerReport(
          containerWithResult,
          { ensureLogger: () => undefined, log: this.log },
          watchStartedAtMs,
        ),
      emitBatchEvent,
      isScanStale:
        scanGeneration === undefined ? undefined : () => scanGeneration !== this.scanGeneration,
      isRenamedPredecessorOfReplacement: storeContainer.isRenamedPredecessorOfReplacement,
    });
  }

  async findNewVersion(
    container: Container,
    logContainer: ContainerWatchLogger,
    options: FindNewVersionOptions = {},
  ) {
    const tagPolicy = resolveEffectiveContainerTagPolicy(container, undefined, () => undefined);
    const watchedContainer = withStoredSkipTags(
      { ...container, tagFamily: tagPolicy.tagFamily },
      storeContainer.getContainer(container.id)?.updatePolicy?.skipTags,
    );
    return findNewVersionState(watchedContainer, logContainer, {
      ...options,
      pinInfoEnabled: tagPolicy.tagPinInfo,
    });
  }
}

export default File;
