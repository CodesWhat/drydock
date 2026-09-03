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
    warn?: (message: string) => void;
    debug?: (message: string) => void;
  };
  configuration: {
    cron: string;
    maintenancewindow?: string;
  };
  isCronWatchInProgress: boolean;
  isWatcherDeregistered: boolean;
  cronWatchInFlight?: Promise<ContainerReport[]>;
  cronWatchRescanRequested: boolean;
  cronWatchRescanReason?: string;
  cronWatchRescanIgnoreMaintenanceWindow: boolean;
  ensureLogger: () => void;
  isMaintenanceWindowOpen: () => boolean;
  queueMaintenanceWindowWatch: () => void;
  clearMaintenanceWindowQueue: () => void;
  watch: () => Promise<ContainerReport[]>;
  getNextScheduledRunDate: (fromDate?: Date) => Date | undefined;
}

/**
 * Duck-typed subset needed by getCronIntervalMs(): two consecutive matches
 * of a cron expression, from an arbitrary starting point.
 */
export interface CronIntervalWatcher {
  getNextScheduledRunDate: (fromDate?: Date) => Date | undefined;
}

/**
 * The watcher's own cron interval in milliseconds, derived from two
 * consecutive matches of the configured cron expression. Used to size the
 * single-flight in-flight scan deadline (#979). Returns undefined when the
 * cron expression cannot be matched at all (getNextScheduledRunDate()
 * already handles the unparseable case).
 */
export function getCronIntervalMs(watcher: CronIntervalWatcher): number | undefined {
  const firstRun = watcher.getNextScheduledRunDate();
  if (!firstRun) {
    return undefined;
  }
  const secondRun = watcher.getNextScheduledRunDate(firstRun);
  if (!secondRun) {
    return undefined;
  }
  return secondRun.getTime() - firstRun.getTime();
}

/**
 * Resets the single-flight cron-watch state (#972). Called on deregister so
 * an already-in-flight scan (not cancellable) doesn't find a rescan request
 * waiting for it when it eventually settles; the isWatcherDeregistered guard
 * in watchFromCronOrchestration() covers the remaining window by dropping
 * the follow-up instead of starting a new scan on a torn-down watcher.
 */
export function resetCronWatchState(watcher: CronWatchOrchestrationWatcher): void {
  watcher.cronWatchInFlight = undefined;
  watcher.cronWatchRescanRequested = false;
  watcher.cronWatchRescanReason = undefined;
  watcher.cronWatchRescanIgnoreMaintenanceWindow = false;
}

/**
 * A single-flight scan is raced against a deadline so a stalled `watch()`
 * (Dockerode is built with no request timeout - see docker-remote-auth.ts -
 * so a hung socket proxy can leave `listContainers`/`inspect` pending
 * forever, and `allSettledWithDockerWatchConcurrency` never settles while
 * one input never does) cannot wedge every later cron tick into the
 * coalescing branch forever, logging that it is coalescing into a follow-up
 * scan that would never actually run.
 *
 * Sized as a multiple of the watcher's own cron interval, so a fast-cron
 * watcher is not held hostage for the full floor, with a floor so a
 * slow-cron watcher does not declare a stall after a single missed
 * interval.
 */
const CRON_WATCH_DEADLINE_INTERVAL_MULTIPLIER = 2;
const CRON_WATCH_DEADLINE_FLOOR_MS = 10 * 60 * 1000; // 10 minutes

function getCronWatchDeadlineMs(watcher: CronWatchOrchestrationWatcher): number {
  const intervalMs = getCronIntervalMs(watcher);
  if (!intervalMs || intervalMs <= 0) {
    return CRON_WATCH_DEADLINE_FLOOR_MS;
  }
  return Math.max(
    intervalMs * CRON_WATCH_DEADLINE_INTERVAL_MULTIPLIER,
    CRON_WATCH_DEADLINE_FLOOR_MS,
  );
}

// Sentinel distinguishing "the deadline timer fired" from a real, possibly
// empty, watch() result racing it.
const CRON_WATCH_DEADLINE = Symbol('cron-watch-deadline');

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
 * The caller awaits and receives that running scan's result, not a fresh
 * one. Once the running scan finishes, exactly one follow-up scan is
 * started (not awaited by the coalesced callers) if a rescan was requested
 * while it ran, however many callers asked for one. If any coalesced
 * request had `ignoreMaintenanceWindow: true`, the follow-up carries that
 * flag too, so a maintenance-window catch-up requested mid-scan is not
 * silently downgraded to a normal (window-respecting) scan.
 *
 * The in-flight scan is raced against a deadline (see
 * getCronWatchDeadlineMs()) so a `watch()` that never settles cannot wedge
 * every later cron tick into the coalescing branch forever. When the
 * deadline wins the race, this call resolves to an empty result (matching
 * the existing "nothing to report this cycle" shape used by the
 * maintenance-window skip below) and clears the single-flight state so the
 * next cron tick starts a fresh scan. If the original scan later settles
 * anyway, its own settlement handler is a no-op: `watcher.cronWatchInFlight`
 * no longer identifies it, so a stale settlement cannot clobber whatever
 * newer scan has since taken its place.
 */
export async function watchFromCronOrchestration(
  watcher: CronWatchOrchestrationWatcher,
  options: CronWatchOptions = {},
): Promise<ContainerReport[]> {
  if (watcher.cronWatchInFlight) {
    watcher.cronWatchRescanRequested = true;
    watcher.cronWatchRescanReason = options.reason;
    if (options.ignoreMaintenanceWindow) {
      watcher.cronWatchRescanIgnoreMaintenanceWindow = true;
    }
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

  // Runs once this exact scan settles, whether it wins the race below or
  // settles later after the deadline already cleared it. The identity
  // check makes the latter case a no-op.
  const settleAndFollowUp = () => {
    if (watcher.cronWatchInFlight !== inFlight) {
      return;
    }
    watcher.cronWatchInFlight = undefined;
    if (!watcher.cronWatchRescanRequested) {
      return;
    }
    const rescanReason = watcher.cronWatchRescanReason;
    const rescanIgnoreMaintenanceWindow = watcher.cronWatchRescanIgnoreMaintenanceWindow;
    watcher.cronWatchRescanRequested = false;
    watcher.cronWatchRescanReason = undefined;
    watcher.cronWatchRescanIgnoreMaintenanceWindow = false;
    if (watcher.isWatcherDeregistered) {
      watcher.ensureLogger();
      if (watcher.log && typeof watcher.log.debug === 'function') {
        watcher.log.debug(
          `Dropping the coalesced follow-up scan (${rescanReason ?? 'manual'}) - the watcher was deregistered while the previous scan was running`,
        );
      }
      return;
    }
    // Fire-and-forget: the caller(s) that coalesced already got this
    // scan's result above, they are not waiting on the follow-up.
    void watchFromCronOrchestration(watcher, {
      reason: rescanReason,
      ignoreMaintenanceWindow: rescanIgnoreMaintenanceWindow,
    }).catch(() => undefined);
  };
  // Observed independently of the deadline race below so the follow-up
  // still runs (or is correctly dropped as stale) even when the deadline
  // wins the race first.
  inFlight.then(settleAndFollowUp, settleAndFollowUp);

  const deadlineMs = getCronWatchDeadlineMs(watcher);
  // The Promise executor below runs synchronously, so deadlineTimer is
  // always assigned before this line finishes executing.
  let deadlineTimer!: ReturnType<typeof setTimeout>;
  const deadline = new Promise<typeof CRON_WATCH_DEADLINE>((resolve) => {
    deadlineTimer = setTimeout(() => resolve(CRON_WATCH_DEADLINE), deadlineMs);
  });

  try {
    const winner = await Promise.race([inFlight, deadline]);
    if (winner !== CRON_WATCH_DEADLINE) {
      return winner;
    }
    // Deadline won the race, so inFlight has not settled yet: nothing else
    // in this single-flight design clears cronWatchInFlight while a scan is
    // still running, so it still identifies this exact scan here.
    watcher.ensureLogger();
    if (watcher.log && typeof watcher.log.warn === 'function') {
      watcher.log.warn(
        `Cron scan exceeded its ${deadlineMs}ms deadline without settling (a stalled watch()?) - clearing the single-flight state so the next cron tick starts a fresh scan`,
      );
    }
    watcher.cronWatchInFlight = undefined;
    watcher.cronWatchRescanRequested = false;
    watcher.cronWatchRescanReason = undefined;
    watcher.cronWatchRescanIgnoreMaintenanceWindow = false;
    return [];
  } finally {
    clearTimeout(deadlineTimer);
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
