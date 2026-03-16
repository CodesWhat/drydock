import * as event from '../../../event/index.js';
import {
  type Container,
  type ContainerReport,
  type ContainerResult,
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
  mapContainerToContainerReport: (containerWithResult: Container) => ContainerReport;
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
  { ensureLogger, log, findNewVersion, mapContainerToContainerReport }: WatchContainerDependencies,
): Promise<ContainerReport> {
  ensureLogger();
  // Child logger for the container to process
  const logContainer = log.child({ container: fullName(container) });
  const containerWithResult = container;

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

  const containerReport = mapContainerToContainerReport(containerWithResult);
  event.emitContainerReport(containerReport);
  return containerReport;
}

/**
 * Process a Container with result and map to a containerReport.
 * @param containerWithResult
 * @return {*}
 */
export function mapContainerToContainerReport(
  containerWithResult: Container,
  { ensureLogger, log }: MapContainerToReportDependencies,
): ContainerReport {
  ensureLogger();
  const logContainer = log.child({
    container: fullName(containerWithResult),
  });

  // Find container in db & compare
  const containerInDb = storeContainer.getContainer(containerWithResult.id);

  if (containerInDb) {
    // Found in DB? => update it
    const updatedContainer = storeContainer.updateContainer(containerWithResult);
    return {
      container: updatedContainer,
      changed: containerInDb.resultChanged(updatedContainer) && containerWithResult.updateAvailable,
    };
  }

  // Not found in DB? => Save it
  logContainer.debug('Container watched for the first time');
  return {
    container: storeContainer.insertContainer(containerWithResult),
    changed: true,
  };
}
