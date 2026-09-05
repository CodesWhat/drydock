/**
 * DR-60: minimal watcher shape accepted by `triggerManualWatch()` below.
 * Generic over the `watch()` return type so it accepts both the registry's
 * real `Watcher` (`Promise<ContainerReport[]>`) and the narrower duck-typed
 * watcher interfaces individual API handler contexts define for themselves
 * (e.g. `LocalContainerWatcher` in `app/api/container/crud-context.ts`).
 */
interface MinimalWatcher<TReports> {
  watch: () => Promise<TReports>;
}

/**
 * Duck-typed subset of the Docker watcher's single-flight cron-scan
 * orchestration (`watchFromCron()` / `watchFromCronOrchestration()` in
 * docker-cron-watch.ts, #972/#979). Only the Docker watcher implements this
 * today; a future watcher type that does not is routed through `watch()`
 * directly by `triggerManualWatch()` below, exactly as every watcher type
 * was before this change.
 */
interface CronCapableWatcher<TReports> extends MinimalWatcher<TReports> {
  watchFromCron: (options?: {
    ignoreMaintenanceWindow?: boolean;
    reason?: string;
  }) => Promise<TReports>;
  cronWatchInFlight?: Promise<TReports>;
}

function isCronCapableWatcher<TReports>(
  watcher: MinimalWatcher<TReports>,
): watcher is CronCapableWatcher<TReports> {
  return typeof (watcher as Partial<CronCapableWatcher<TReports>>).watchFromCron === 'function';
}

export interface ManualWatchResult<TReports> {
  reports: TReports;
  /**
   * True when this call landed while a scan (cron, another manual request, a
   * docker-events debounce, ...) was already in flight and was coalesced into
   * that scan's single follow-up rather than starting an independent one.
   */
  coalesced: boolean;
}

/**
 * DR-60: routes a manual "check now" request (the UI/API `POST .../watch`
 * endpoints, the webhook API, and the agent's own watcher API that the
 * controller polls) through the same single-flight scan orchestration the
 * cron schedule uses, instead of calling `watch()` directly. `watch()` has no
 * re-entrancy guard of its own: a manual scan landing while a cron scan (or
 * another manual scan) is already running started a second, fully
 * independent `handleContainerReports` pass, and under `once=true` both
 * passes could read "not yet notified" before either had finished, so the
 * same update was sent to a trigger twice.
 *
 * `ignoreMaintenanceWindow: true` preserves the existing behavior of manual
 * and API-triggered scans, which have always run regardless of a configured
 * maintenance window — only automatic installation is deferred by the
 * window, never discovery/notification, and that is unchanged here.
 */
export async function triggerManualWatch<TReports>(
  watcher: MinimalWatcher<TReports>,
  reason: string,
): Promise<ManualWatchResult<TReports>> {
  if (!isCronCapableWatcher(watcher)) {
    return { reports: await watcher.watch(), coalesced: false };
  }
  const coalesced = watcher.cronWatchInFlight !== undefined;
  const reports = await watcher.watchFromCron({ ignoreMaintenanceWindow: true, reason });
  return { reports, coalesced };
}
