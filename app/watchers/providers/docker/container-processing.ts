import * as event from '../../../event/index.js';
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
}

interface MapContainerToReportDependencies {
  ensureLogger: () => void;
  log: ChildContainerLoggerFactory;
}

/**
 * Watch a Container.
 * @param container
 * @returns {Promise<*>}
 */
export async function watchContainer(
  container: Container,
  {
    ensureLogger,
    log,
    findNewVersion,
    mapContainerToContainerReport,
    emitBatchEvent = false,
  }: WatchContainerDependencies,
): Promise<ContainerReport> {
  ensureLogger();
  // Child logger for the container to process
  const logContainer = log.child({ container: fullName(container) });
  const containerWithResult = container;
  const watchStartedAtMs = Date.now();

  // Reset previous results if so
  delete containerWithResult.result;
  delete containerWithResult.error;
  logContainer.debug('Start watching');

  try {
    containerWithResult.result = await findNewVersion(container, logContainer);
    await enrichContainerWithReleaseNotes(containerWithResult, logContainer);
  } catch (e: unknown) {
    const errorMessage = getErrorMessage(e);
    logContainer.warn(`Error when processing (${errorMessage})`);
    logContainer.debug(e);
    containerWithResult.error = {
      message: errorMessage,
    };
  }

  const containerReport = mapContainerToContainerReport(containerWithResult, watchStartedAtMs);
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
    // Found in DB? => update it
    const updatedContainer = storeContainer.updateContainer(containerToPersist);
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
