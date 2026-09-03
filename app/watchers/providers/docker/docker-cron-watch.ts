import type { ContainerReport } from '../../../model/container.js';
import { getMaintenanceSkipCounter } from '../../../prometheus/watcher.js';

export interface CronWatchOptions {
  ignoreMaintenanceWindow?: boolean;
  reason?: string;
}

/**
 * Duck-typed subset of Docker watcher state/methods needed to orchestrate
 * `watchFromCron()`'s single-flight coalescing (#972). Mirrors the pattern in
 * docker-event-orchestration.ts: the state lives on the real Docker instance
 * (mutated in place through this interface), the algorithm lives here.
 */
export interface CronWatchOrchestrationWatcher {
  type: string;
  name: string;
  log?: {
    info?: (message: string) => void;
  };
  configuration: {
    cron: string;
    maintenancewindow?: string;
  };
  isCronWatchInProgress: boolean;
  cronWatchInFlight?: Promise<ContainerReport[]>;
  cronWatchRescanRequested: boolean;
  cronWatchRescanReason?: string;
  ensureLogger: () => void;
  isMaintenanceWindowOpen: () => boolean;
  queueMaintenanceWindowWatch: () => void;
  clearMaintenanceWindowQueue: () => void;
  watch: () => Promise<ContainerReport[]>;
}

/**
 * Watch containers (called by cron scheduled tasks).
 *
 * Single-flight: a full scan on a 70-container host can take minutes, and
 * the cron schedule, the docker-events debounce, the discovery-settle timer
 * and the startup timer can all ask for one while the previous scan is
 * still running. Without a guard each overlapping call ran its own
 * `watch()`, and a tag first seen mid-burst passed the `once=true` history
 * check in every one of them before any of them recorded it, firing the
 * same trigger once per overlapping scan (#972).
 *
 * If a scan is already in flight, this call does not start a second one. It
 * records that a rescan was requested (so a docker event that arrives
 * mid-scan is not lost) and returns the SAME promise as the in-flight scan
 * — the caller awaits and receives that running scan's result, not a fresh
 * one. Once the running scan finishes, exactly one follow-up scan is
 * started (not awaited by the coalesced callers) if a rescan was requested
 * while it ran, however many callers asked for one.
 */
export async function watchFromCronOrchestration(
  watcher: CronWatchOrchestrationWatcher,
  options: CronWatchOptions = {},
): Promise<ContainerReport[]> {
  if (watcher.cronWatchInFlight) {
    watcher.cronWatchRescanRequested = true;
    watcher.cronWatchRescanReason = options.reason;
    watcher.ensureLogger();
    if (watcher.log && typeof watcher.log.info === 'function') {
      watcher.log.info(
        `Cron scan requested (${options.reason ?? 'manual'}) while one is already running - coalescing into a single follow-up scan`,
      );
    }
    return watcher.cronWatchInFlight;
  }

  const inFlight = runCronWatch(watcher, options);
  watcher.cronWatchInFlight = inFlight;
  try {
    return await inFlight;
  } finally {
    watcher.cronWatchInFlight = undefined;
    if (watcher.cronWatchRescanRequested) {
      const rescanReason = watcher.cronWatchRescanReason;
      watcher.cronWatchRescanRequested = false;
      watcher.cronWatchRescanReason = undefined;
      // Fire-and-forget: the caller(s) that coalesced already got this
      // scan's result above, they are not waiting on the follow-up.
      void watchFromCronOrchestration(watcher, { reason: rescanReason }).catch(() => undefined);
    }
  }
}

/**
 * Run a single cron watch cycle. Only called by watchFromCronOrchestration(),
 * which ensures at most one of these runs at a time per watcher.
 */
async function runCronWatch(
  watcher: CronWatchOrchestrationWatcher,
  options: CronWatchOptions = {},
): Promise<ContainerReport[]> {
  const { ignoreMaintenanceWindow = false, reason = 'manual' } = options;
  watcher.ensureLogger();
  if (!watcher.log || typeof watcher.log.info !== 'function') {
    return [];
  }

  // Check maintenance window before proceeding
  if (
    !ignoreMaintenanceWindow &&
    watcher.configuration.maintenancewindow &&
    !watcher.isMaintenanceWindowOpen()
  ) {
    watcher.queueMaintenanceWindowWatch();
    watcher.log.info('Skipping update check - outside maintenance window');
    const counter = getMaintenanceSkipCounter();
    if (counter) {
      counter.labels({ type: watcher.type, name: watcher.name }).inc();
    }
    return [];
  }
  watcher.clearMaintenanceWindowQueue();

  watcher.log.info(`Cron started (${watcher.configuration.cron}, reason: ${reason})`);

  // Get container reports
  watcher.isCronWatchInProgress = true;
  let containerReports: ContainerReport[] = [];
  try {
    containerReports = await watcher.watch();
  } finally {
    watcher.isCronWatchInProgress = false;
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
  watcher.ensureLogger();
  if (watcher.log && typeof watcher.log.info === 'function') {
    watcher.log.info(`Cron finished (${stats})`);
  }
  return containerReports;
}
