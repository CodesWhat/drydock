import type { ContainerReport } from '../../../model/container.js';
import { resolveMaintenanceWindowScope } from '../../../model/watcher-maintenance-window.js';
import { getMaintenanceSkipCounter } from '../../../prometheus/watcher.js';

export interface CronWatchOptions {
  ignoreMaintenanceWindow?: boolean;
  reason?: string;
}

/**
 * Per-scan deadline state for the in-flight single-flight scan (#979). Held
 * on the watcher so `resetCronWatchState()` can reach it: `cancel()` settles
 * the deadline race with the deregistration sentinel so every caller sharing
 * the bounded promise resolves immediately, and `timer` is the ref'ed
 * `setTimeout` that would otherwise hold the event loop open until the
 * deadline and then warn against a torn-down watcher.
 */
export interface CronWatchDeadlineHandle {
  timer: ReturnType<typeof setTimeout>;
  cancel: () => void;
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
    /**
     * `'scan'` gates this scan on the maintenance window; anything else (including the
     * `'install'` default, and an unset value on a watcher configured before the option
     * existed) leaves the scan on its own cron and defers only the install.
     */
    maintenancewindowscope?: string;
  };
  isCronWatchInProgress: boolean;
  isWatcherDeregistered: boolean;
  cronWatchInFlight?: Promise<ContainerReport[]>;
  cronWatchRescanRequested: boolean;
  cronWatchRescanReason?: string;
  cronWatchRescanIgnoreMaintenanceWindow: boolean;
  cronWatchDeadlineHandle?: CronWatchDeadlineHandle;
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
 *
 * The scan itself cannot be cancelled, but its deadline can. Clearing the
 * ref'ed timer stops it holding the event loop open, and cancelling settles
 * the deadline race with the deregistration sentinel so the initiating call
 * and every coalesced caller resolve to the same empty result now instead of
 * hanging on a stalled watch() until the deadline fires and warns that a
 * torn-down watcher missed one.
 */
export function resetCronWatchState(watcher: CronWatchOrchestrationWatcher): void {
  const deadlineHandle = watcher.cronWatchDeadlineHandle;
  watcher.cronWatchDeadlineHandle = undefined;
  watcher.cronWatchInFlight = undefined;
  watcher.cronWatchRescanRequested = false;
  watcher.cronWatchRescanReason = undefined;
  watcher.cronWatchRescanIgnoreMaintenanceWindow = false;
  if (deadlineHandle) {
    clearTimeout(deadlineHandle.timer);
    deadlineHandle.cancel();
  }
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

// Sentinel for "resetCronWatchState() settled this race on deregister".
// Distinct from CRON_WATCH_DEADLINE so the deregistration path returns the
// same empty result without the "exceeded its deadline" warning - nothing
// was late here, the watcher was torn down.
const CRON_WATCH_DEREGISTERED = Symbol('cron-watch-deregistered');

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
 * every later cron tick into the coalescing branch forever.
 * `watcher.cronWatchInFlight` stores the deadline-bounded promise itself
 * (not the raw scan), so every coalesced caller shares the same race and,
 * when the deadline wins, resolves to the same empty result (matching the
 * existing "nothing to report this cycle" shape used by the
 * maintenance-window skip below) - not just the call that initiated the
 * scan. The deadline branch also clears the single-flight state so the next
 * cron tick starts a fresh scan. If the original scan later settles anyway,
 * its own settlement handler is a no-op: `watcher.cronWatchInFlight` no
 * longer identifies the bounded promise it was assigned to, so a stale
 * settlement cannot clobber whatever newer scan has since taken its place.
 */
export async function watchFromCronOrchestration(
  watcher: CronWatchOrchestrationWatcher,
  options: CronWatchOptions = {},
): Promise<ContainerReport[]> {
  if (watcher.isWatcherDeregistered) {
    // A timer captured before teardown can still fire after
    // deregisterComponent() has run resetCronWatchState(): the docker-events
    // debounce (just-debounce@1.1.0 exposes no cancel, so its pending timeout
    // outlives the watcher), the startup delay, the discovery-settle timer and
    // the maintenance-window queue all call in here from a closure. Starting a
    // scan at that point runs a full watch() against a torn-down watcher and
    // publishes a fresh refed deadline handle that the reset can no longer
    // reach, so answer with the same empty result the deregistration path uses
    // instead. init() clears this flag, so a re-registered watcher scans again.
    return [];
  }

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

  // Declared before settleAndFollowUp so the closure below can reference it;
  // assigned further down, but not read until inFlight settles, which is
  // always after the assignment below has run.
  let bounded: Promise<ContainerReport[]>;

  // Runs once this exact scan settles, whether it wins the race below or
  // settles later after the deadline already cleared it. The identity check
  // compares against the deadline-bounded promise stored on the watcher
  // (what coalesced callers actually hold), not the raw scan, so it makes
  // the latter case a no-op.
  const settleAndFollowUp = () => {
    if (watcher.cronWatchInFlight !== bounded) {
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
  // The Promise executor below runs synchronously, so both are always
  // assigned before this statement finishes executing.
  let deadlineTimer!: ReturnType<typeof setTimeout>;
  let cancelDeadline!: () => void;
  const deadline = new Promise<typeof CRON_WATCH_DEADLINE | typeof CRON_WATCH_DEREGISTERED>(
    (resolve) => {
      deadlineTimer = setTimeout(() => resolve(CRON_WATCH_DEADLINE), deadlineMs);
      cancelDeadline = () => resolve(CRON_WATCH_DEREGISTERED);
    },
  );
  // Published on the watcher so deregistration can reach this scan's timer
  // and settle its race; see resetCronWatchState().
  const deadlineHandle: CronWatchDeadlineHandle = {
    timer: deadlineTimer,
    cancel: cancelDeadline,
  };
  watcher.cronWatchDeadlineHandle = deadlineHandle;

  // Stored on the watcher below so a coalesced caller shares this exact
  // race instead of the raw (unbounded) scan promise - otherwise only the
  // initiating call resolves at the deadline and every coalesced caller
  // stays pending until the stalled watch() eventually settles, if ever.
  bounded = (async (): Promise<ContainerReport[]> => {
    try {
      const winner = await Promise.race([inFlight, deadline]);
      if (winner === CRON_WATCH_DEREGISTERED) {
        // resetCronWatchState() already cleared the single-flight state and
        // nobody wants this scan's result any more. Settle the initiating
        // call and every coalesced caller with the same empty result the
        // maintenance-window skip uses, and log nothing: no deadline was
        // missed.
        return [];
      }
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
      // Per-scan identity: after a deregister-and-restart the watcher may
      // already carry a newer scan's handle, and clearing that one would
      // leave its timer unreachable to the next reset.
      if (watcher.cronWatchDeadlineHandle === deadlineHandle) {
        watcher.cronWatchDeadlineHandle = undefined;
      }
    }
  })();

  watcher.cronWatchInFlight = bounded;
  return bounded;
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

  // Check maintenance window before proceeding. Only the `scan` scope gates the scan
  // itself; under the default `install` scope the scan runs on its own cron whatever the
  // window says, so discovery, registry checks, container-state refresh and update
  // notifications are never held back, and only the automatic install is deferred (see
  // Trigger.deferAutoUpdateForMaintenanceWindow, which also queues the catch-up below).
  if (
    !ignoreMaintenanceWindow &&
    resolveMaintenanceWindowScope(watcher.configuration.maintenancewindowscope) === 'scan' &&
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
