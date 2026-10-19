import * as event from '../../../event/index.js';
import { maybeEmitMaturityGateCleared } from '../../../maturity/gate-watch.js';
import {
  type Container,
  type ContainerReport,
  type ContainerResult,
  clearDetectedUpdateState,
  fullName,
} from '../../../model/container.js';
import * as storeContainer from '../../../store/container.js';
import { getErrorMessage } from './docker-helpers.js';
import { enrichContainerWithReleaseNotes } from './release-notes-enrichment.js';

export interface DockerContainerWatchOptions {
  emitBatchEvent?: boolean;
  useRegistryPollCache?: boolean;
  collectReleaseMaturity?: boolean;
  scanGeneration?: number;
}

interface ContainerWatchLogger {
  error: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string | unknown) => void;
}

interface ChildContainerLoggerFactory {
  child: (bindings: { container: string }) => ContainerWatchLogger;
}

interface WatchContainerDependencies {
  ensureLogger: () => void;
  log: ChildContainerLoggerFactory;
  findNewVersion: (
    container: Container,
    logContainer: ContainerWatchLogger,
  ) => Promise<ContainerResult>;
  mapContainerToContainerReport: (
    containerWithResult: Container,
    watchStartedAtMs?: number,
  ) => ContainerReport;
  /**
   * When true, emit a single-element `emitContainerReports` event in addition to
   * `emitContainerReport`. Set this for standalone single-container scans (e.g. API
   * `POST /:id/watch`) so that batch-mode triggers also fire — the bulk `watch()` path
   * already emits `emitContainerReports` for the full set after processing all containers,
   * so it must leave this as false to avoid double-firing batch triggers.
   */
  emitBatchEvent?: boolean;
  /**
   * Checked once findNewVersion() has settled, right before the store write and event
   * emission below. Only the bulk `watch()` loop supplies this (DR-72): the watcher was
   * deregistered while this container was mid-scan, so the store write and report/batch
   * emission are stale side effects and must not land. Absent for standalone single-container
   * scans, which are not part of a generation-tracked bulk scan.
   */
  isScanStale?: () => boolean;
}

interface MapContainerToReportDependencies {
  ensureLogger: () => void;
  log: ChildContainerLoggerFactory;
}

/**
 * Release notes are optional enrichment. Update detection must not wait on a
 * slow or rate-limited provider (the GitHub provider can sit in 60 s retry
 * intervals on a 403), so the lookup gets a short budget. Past it, the result
 * is persisted without notes and the lookup keeps running on a detached copy;
 * whatever it finds is patched onto the stored record when it settles. The
 * provider's own retry and cooldown contract is untouched.
 */
export const RELEASE_NOTES_ENRICHMENT_BUDGET_MS = 5_000;

/**
 * Overrun lookups keep running after their watch slot is freed, so they are
 * capped. At the cap a watch persists without notes and retries next cycle
 * instead of starting another request against a provider that is already slow.
 */
export const MAX_PENDING_RELEASE_NOTES_LOOKUPS = 10;

let pendingDetachedLookups = 0;

/**
 * Per-container watch bookkeeping. `seq` orders watches of the same container
 * so an older overrun lookup can't overwrite notes a newer watch already
 * persisted. An entry lives only while a watch or detached lookup for that
 * container is outstanding, so the map stays bounded by in-flight work and
 * drains on its own after a deregister or container removal.
 */
const watchSequences = new Map<string, { seq: number; active: number; detached: number }>();

function getWatchSequenceEntry(containerId: string) {
  const entry = watchSequences.get(containerId) ?? { seq: 0, active: 0, detached: 0 };
  watchSequences.set(containerId, entry);
  return entry;
}

function beginWatchSequence(containerId: string) {
  const entry = getWatchSequenceEntry(containerId);
  entry.seq += 1;
  entry.active += 1;
  return entry.seq;
}

function releaseWatchSequence(containerId: string, kind: 'active' | 'detached') {
  const entry = getWatchSequenceEntry(containerId);
  entry[kind] -= 1;
  if (entry.active <= 0 && entry.detached <= 0) {
    watchSequences.delete(containerId);
  }
}

function isLatestWatchSequence(containerId: string, seq: number) {
  return watchSequences.get(containerId)?.seq === seq;
}

const BUDGET_EXCEEDED = Symbol('release-notes-budget-exceeded');

function createEnrichmentDraft(container: Container): Container {
  const draft = { ...container } as Container;
  draft.updateAvailable = container.updateAvailable;
  if (container.result) {
    draft.result = { ...container.result };
  }
  return draft;
}

function applyLateReleaseNotes(
  draft: Container,
  scanned: Container,
  logContainer: ContainerWatchLogger,
  watchSeq: number,
  isScanStale?: () => boolean,
) {
  if (isScanStale?.() || !isLatestWatchSequence(scanned.id, watchSeq)) {
    return;
  }
  const stored = storeContainer.getContainer(scanned.id);
  if (
    !stored ||
    stored.result?.tag !== scanned.result?.tag ||
    stored.image?.tag?.value !== scanned.image?.tag?.value
  ) {
    return;
  }
  const patch: Partial<Container> = {};
  if (draft.sourceRepo !== undefined) {
    patch.sourceRepo = draft.sourceRepo;
  }
  if (draft.currentReleaseNotes) {
    patch.currentReleaseNotes = draft.currentReleaseNotes;
  }
  if (draft.result?.releaseNotes && stored.result) {
    patch.result = { ...stored.result, releaseNotes: draft.result.releaseNotes };
  }
  if (Object.keys(patch).length === 0) {
    return;
  }
  storeContainer.updateContainerFields(scanned.id, patch);
  logContainer.debug('Attached release notes after the watch cycle persisted the result');
}

async function enrichWithinBudget(
  container: Container,
  logContainer: ContainerWatchLogger,
  watchSeq: number,
  isScanStale?: () => boolean,
) {
  if (pendingDetachedLookups >= MAX_PENDING_RELEASE_NOTES_LOOKUPS) {
    logContainer.debug(
      'Too many release notes lookups still pending; persisting the result without notes',
    );
    return;
  }
  const draft = createEnrichmentDraft(container);
  const enrichment = enrichContainerWithReleaseNotes(draft, logContainer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<typeof BUDGET_EXCEEDED>((resolve) => {
    timer = setTimeout(() => resolve(BUDGET_EXCEEDED), RELEASE_NOTES_ENRICHMENT_BUDGET_MS);
  });
  try {
    const outcome = await Promise.race([enrichment, budget]);
    if (outcome === BUDGET_EXCEEDED) {
      logContainer.debug(
        `Release notes lookup exceeded ${RELEASE_NOTES_ENRICHMENT_BUDGET_MS}ms; persisting the result without notes`,
      );
      pendingDetachedLookups += 1;
      getWatchSequenceEntry(container.id).detached += 1;
      enrichment
        .then(() => applyLateReleaseNotes(draft, container, logContainer, watchSeq, isScanStale))
        .catch((error: unknown) =>
          logContainer.debug(`Unable to fetch release notes (${getErrorMessage(error)})`),
        )
        .finally(() => {
          pendingDetachedLookups -= 1;
          releaseWatchSequence(container.id, 'detached');
        });
      return;
    }
  } finally {
    clearTimeout(timer);
  }
  if (draft.sourceRepo !== undefined) {
    container.sourceRepo = draft.sourceRepo;
  }
  if (draft.currentReleaseNotes) {
    container.currentReleaseNotes = draft.currentReleaseNotes;
  }
  if (draft.result?.releaseNotes && container.result) {
    container.result.releaseNotes = draft.result.releaseNotes;
  }
}

/**
 * Watch a Container.
 * @param container
 * @returns {Promise<*>}
 */
export async function watchContainer(
  container: Container,
  dependencies: WatchContainerDependencies,
): Promise<ContainerReport> {
  const watchSeq = beginWatchSequence(container.id);
  try {
    return await runContainerWatch(container, dependencies, watchSeq);
  } finally {
    releaseWatchSequence(container.id, 'active');
  }
}

async function runContainerWatch(
  container: Container,
  {
    ensureLogger,
    log,
    findNewVersion,
    mapContainerToContainerReport,
    emitBatchEvent = false,
    isScanStale,
  }: WatchContainerDependencies,
  watchSeq: number,
): Promise<ContainerReport> {
  ensureLogger();
  // Child logger for the container to process
  const logContainer = log.child({ container: fullName(container) });
  const containerWithResult = container;
  const watchStartedAtMs = Date.now();

  const previousResult = containerWithResult.result;
  const previousCurrentReleaseNotes = containerWithResult.currentReleaseNotes;

  // Reset previous results if so
  delete containerWithResult.result;
  delete containerWithResult.error;
  logContainer.debug('Start watching');

  try {
    containerWithResult.result = await findNewVersion(container, logContainer);
    await enrichWithinBudget(containerWithResult, logContainer, watchSeq, isScanStale);
  } catch (e: unknown) {
    const errorMessage = getErrorMessage(e);
    logContainer.warn(`Error when processing (${errorMessage})`);
    logContainer.debug(e);
    containerWithResult.error = {
      message: errorMessage,
    };
    // Restore only when this cycle produced no fresh comparison. Today the
    // only rejection path is findNewVersion itself (enrichContainerWithReleaseNotes
    // swallows its own errors), so the guard on result is defense-in-depth for
    // if that contract ever changes: a failure after a fresh result must not
    // clobber it with the stale snapshot. Only plain data properties are
    // restored: updateAvailable/updateKind are getter-only derived properties
    // (see addUpdateAvailableProperty in the container model) and recompute
    // from the restored result — assigning them throws on a validated container.
    if (containerWithResult.result === undefined && previousResult !== undefined) {
      containerWithResult.result = previousResult;
      containerWithResult.currentReleaseNotes = previousCurrentReleaseNotes;
    }
  }

  if (isScanStale?.()) {
    logContainer.debug(
      'Skipping stale scan side effects — the watcher was deregistered while this container was being processed',
    );
    return { container: containerWithResult, changed: false };
  }

  const containerReport = mapContainerToContainerReport(containerWithResult, watchStartedAtMs);
  await maybeEmitMaturityGateCleared(containerReport.container);
  await event.emitContainerReport(containerReport);
  if (emitBatchEvent) {
    await event.emitContainerReports([containerReport]);
  }
  return containerReport;
}

function preserveClearedUpdateStateWhenWatchStartedBeforeManualUpdate(
  containerWithResult: Container,
  logContainer: ContainerWatchLogger,
  watchStartedAtMs?: number,
) {
  const clearedAtMs = storeContainer.getPendingFreshStateAfterManualUpdateAt(containerWithResult);
  if (clearedAtMs === undefined) {
    return containerWithResult;
  }

  if (!containerWithResult.updateAvailable) {
    storeContainer.clearPendingFreshStateAfterManualUpdate(containerWithResult);
    return containerWithResult;
  }

  if (watchStartedAtMs !== undefined && watchStartedAtMs <= clearedAtMs) {
    logContainer.debug(
      'Suppressing stale update detection from a watch that started before the manual update completed',
    );
    return clearDetectedUpdateState(containerWithResult);
  }

  storeContainer.clearPendingFreshStateAfterManualUpdate(containerWithResult);
  return containerWithResult;
}

/**
 * Process a Container with result and map to a containerReport.
 * @param containerWithResult
 * @return {*}
 */
export function mapContainerToContainerReport(
  containerWithResult: Container,
  { ensureLogger, log }: MapContainerToReportDependencies,
  watchStartedAtMs?: number,
): ContainerReport {
  ensureLogger();
  const logContainer = log.child({
    container: fullName(containerWithResult),
  });
  const containerToPersist = preserveClearedUpdateStateWhenWatchStartedBeforeManualUpdate(
    containerWithResult,
    logContainer,
    watchStartedAtMs,
  );

  // Find container in db & compare
  const containerInDb = storeContainer.getContainer(containerToPersist.id);

  if (containerInDb) {
    // Found in DB? Write only the fields this scan cycle owns (roadmap
    // 7-STORE, slice 9 / spec 4.3): `result`, `image`, `error` and the
    // release notes derived from `result`. `containerToPersist` also still
    // carries whatever runtime fields (name, status, health, labels,
    // details) this container object had when the cycle started, which can
    // be stale by the time a long registry lookup finishes — a
    // whole-record write here would silently revert an event-path rename or
    // health change that landed mid-cycle. Everything not in this patch is
    // inherited from the row `updateContainerFields` reads fresh.
    // Cast: `containerInDb` was just read synchronously above with no
    // intervening await, so the row cannot have disappeared by the time this
    // patch runs — `updateContainerFields` only returns undefined when the id
    // is not found.
    const updatedContainer = storeContainer.updateContainerFields(containerToPersist.id, {
      result: containerToPersist.result,
      image: containerToPersist.image,
      error: containerToPersist.error,
      currentReleaseNotes: containerToPersist.currentReleaseNotes,
    }) as Container;
    return {
      container: updatedContainer,
      changed: containerInDb.resultChanged(updatedContainer) && containerToPersist.updateAvailable,
    };
  }

  // Not found in DB? => Save it
  logContainer.debug('Container watched for the first time');
  return {
    container: storeContainer.insertContainer(containerToPersist),
    changed: true,
  };
}
