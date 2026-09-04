import cron from 'node-cron';
import { resolveMaintenanceWindowScope } from '../../../model/watcher-maintenance-window.js';

/**
 * True when a configured maintenance window should gate a *scan*, not just an install.
 * Only `maintenancewindowscope=scan` does; the default `install` scope leaves discovery,
 * registry checks and container-state refresh running on the watcher's own cron and defers
 * the automatic install instead. See app/model/watcher-maintenance-window.ts.
 */
export function isScanGatedByMaintenanceWindow(configuration: {
  maintenancewindow?: string;
  maintenancewindowscope?: unknown;
}): boolean {
  return (
    Boolean(configuration.maintenancewindow) &&
    resolveMaintenanceWindowScope(configuration.maintenancewindowscope) === 'scan'
  );
}

interface MaintenanceWindowTask {
  timeMatcher: {
    match: (date: Date) => boolean;
    getNextMatch: (fromDate: Date) => unknown;
  };
}

function createMaintenanceWindowTask(cronExpr: string, tz: string): MaintenanceWindowTask {
  return cron.createTask(cronExpr, () => {}, { timezone: tz }) as unknown as MaintenanceWindowTask;
}

/**
 * Check if the current time falls within a maintenance window defined by a cron expression.
 * The cron expression defines WHEN updates are ALLOWED (the maintenance window).
 * Returns true if the current minute matches the cron schedule.
 *
 * @param cronExpr - A standard 5-field cron expression (minute hour day month weekday)
 * @param tz - IANA timezone string (defaults to 'UTC')
 * @returns true if now is inside the maintenance window
 */
export function isInMaintenanceWindow(
  cronExpr: string,
  tz: string = 'UTC',
  atDate: Date = new Date(),
): boolean {
  if (!cronExpr || !cron.validate(cronExpr)) {
    return false;
  }

  const task = createMaintenanceWindowTask(cronExpr, tz);

  // node-cron's timeMatcher.match() checks seconds too; for 5-field cron
  // the seconds expression defaults to [0], so we normalize to second 0
  // to get a pure minute-level match.
  const now = new Date(atDate);
  now.setSeconds(0);
  now.setMilliseconds(0);

  return task.timeMatcher.match(now);
}

/**
 * Detect whether a cron expression's minute field is "narrow", i.e. it matches
 * only specific minute(s) rather than every minute of the matching hour(s).
 *
 * Maintenance windows are matched minute-by-minute (see isInMaintenanceWindow),
 * so a fixed minute field like `0 2-6 * * *` only opens the window for one
 * minute per matching hour instead of the whole hour range. Step values such
 * as "every 5th minute" are intentional and still contain '*', so they are
 * not flagged.
 *
 * @param cronExpr - A standard 5-field cron expression (minute hour day month weekday)
 * @returns true if the minute field does not contain '*' (a fixed value/list/range)
 */
export function hasNarrowMinuteField(cronExpr: string): boolean {
  if (!cronExpr) {
    return false;
  }
  const minuteField = cronExpr.trim().split(/\s+/)[0];
  return !minuteField?.includes('*');
}

/**
 * Return the next date/time matching the maintenance window cron expression.
 *
 * @param cronExpr - A standard 5-field cron expression (minute hour day month weekday)
 * @param tz - IANA timezone string (defaults to 'UTC')
 * @param fromDate - Starting point used to compute the next match (defaults to now)
 * @returns next matching date, or undefined when expression/timezone is invalid
 */
export function getNextMaintenanceWindow(
  cronExpr: string,
  tz: string = 'UTC',
  fromDate: Date = new Date(),
): Date | undefined {
  if (!cronExpr || !cron.validate(cronExpr)) {
    return undefined;
  }

  try {
    const task = createMaintenanceWindowTask(cronExpr, tz);
    const nextMatch = task.timeMatcher.getNextMatch(fromDate);
    return nextMatch instanceof Date ? nextMatch : undefined;
  } catch {
    return undefined;
  }
}
