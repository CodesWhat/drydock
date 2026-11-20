/**
 * Quiet-hours schedule parsing and matching.
 *
 * A schedule is a comma-separated list of `HH:MM-HH:MM` ranges evaluated in one IANA
 * timezone. The start is inclusive and the end exclusive, so `22:00-07:00` is quiet at
 * 22:00 and again at 06:59 but not at 07:00. A range whose end is earlier than its start
 * crosses midnight. `24:00` is accepted as an end for "until midnight". This is not the
 * cron syntax the maintenance window uses: that one names when work is allowed, minute by
 * minute, and a quiet period is easier to read as a plain time range.
 */

export interface QuietHoursRange {
  /** Minutes after local midnight, 0-1439. */
  startMinutes: number;
  /** Minutes after local midnight, 1-1440. */
  endMinutes: number;
}

const MINUTES_PER_DAY = 24 * 60;
const RANGE_PATTERN = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

function toMinutes(hours: string, minutes: string, allowMidnightEnd: boolean): number | undefined {
  const hourValue = Number.parseInt(hours, 10);
  const minuteValue = Number.parseInt(minutes, 10);
  if (minuteValue > 59) {
    return undefined;
  }
  if (hourValue === 24 && minuteValue === 0 && allowMidnightEnd) {
    return MINUTES_PER_DAY;
  }
  return hourValue > 23 ? undefined : hourValue * 60 + minuteValue;
}

/**
 * Parse a quiet-hours schedule. Throws an `Error` naming the offending range when one
 * is malformed, so a typo is reported instead of silently meaning "never quiet".
 */
export function parseQuietHoursSchedule(schedule: string): QuietHoursRange[] {
  const ranges: QuietHoursRange[] = [];
  for (const rawRange of schedule.split(',')) {
    const range = rawRange.trim();
    if (range === '') {
      continue;
    }
    const match = RANGE_PATTERN.exec(range);
    const startMinutes = match ? toMinutes(match[1], match[2], false) : undefined;
    const endMinutes = match ? toMinutes(match[3], match[4], true) : undefined;
    if (startMinutes === undefined || endMinutes === undefined) {
      throw new Error(`Invalid quiet hours range '${range}', expected HH:MM-HH:MM`);
    }
    if (startMinutes === endMinutes) {
      throw new Error(`Invalid quiet hours range '${range}', start and end must differ`);
    }
    ranges.push({ startMinutes, endMinutes });
  }
  return ranges;
}

/** True when `timezone` is an IANA zone this runtime knows. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Minutes after local midnight at `date` in `timezone`. */
export function getMinutesOfDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hours = Number(parts.find((part) => part.type === 'hour')?.value);
  const minutes = Number(parts.find((part) => part.type === 'minute')?.value);
  return hours * 60 + minutes;
}

/** True when `date` falls inside any of the ranges in `timezone`. */
export function isWithinQuietHours(
  ranges: readonly QuietHoursRange[],
  timezone: string,
  date: Date = new Date(),
): boolean {
  if (ranges.length === 0) {
    return false;
  }
  const minutes = getMinutesOfDay(date, timezone);
  return ranges.some(({ startMinutes, endMinutes }) =>
    startMinutes < endMinutes
      ? minutes >= startMinutes && minutes < endMinutes
      : minutes >= startMinutes || minutes < endMinutes,
  );
}
