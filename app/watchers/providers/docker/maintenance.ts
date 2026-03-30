import cron from 'node-cron';

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
export function isInMaintenanceWindow(cronExpr: string, tz: string = 'UTC'): boolean {
  if (!cronExpr || !cron.validate(cronExpr)) {
    return false;
  }

  const task = createMaintenanceWindowTask(cronExpr, tz);

  // node-cron's timeMatcher.match() checks seconds too; for 5-field cron
  // the seconds expression defaults to [0], so we normalize to second 0
  // to get a pure minute-level match.
  const now = new Date();
  now.setSeconds(0);
  now.setMilliseconds(0);

  return task.timeMatcher.match(now);
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
