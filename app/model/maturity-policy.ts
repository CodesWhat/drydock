export const DEFAULT_MATURITY_MIN_AGE_DAYS = 7;
export const MATURITY_MIN_AGE_DAYS_MIN = 1;
export const MATURITY_MIN_AGE_DAYS_MAX = 365;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type MaturityMode = 'all' | 'mature';

export function normalizeMaturityMode(value: unknown): MaturityMode | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all' || normalized === 'mature') {
    return normalized;
  }
  return undefined;
}

export function parseMaturityMinAgeDays(value: unknown): number | undefined {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < MATURITY_MIN_AGE_DAYS_MIN ||
    parsed > MATURITY_MIN_AGE_DAYS_MAX
  ) {
    return undefined;
  }
  return parsed;
}

export function resolveMaturityMinAgeDays(
  value: unknown,
  fallbackDays = DEFAULT_MATURITY_MIN_AGE_DAYS,
): number {
  const normalizedFallback = parseMaturityMinAgeDays(fallbackDays) ?? DEFAULT_MATURITY_MIN_AGE_DAYS;
  return parseMaturityMinAgeDays(value) ?? normalizedFallback;
}

export function daysToMs(days: number): number {
  return days * MS_PER_DAY;
}

export function maturityMinAgeDaysToMilliseconds(days: number): number {
  return daysToMs(days);
}
