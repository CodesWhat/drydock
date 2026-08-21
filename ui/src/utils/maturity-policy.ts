export const DEFAULT_MATURITY_MIN_AGE_DAYS = 7;
export const MATURITY_MIN_AGE_DAYS_MIN = 1;
export const MATURITY_MIN_AGE_DAYS_MAX = 365;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

type MaturityMode = 'all' | 'mature';

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

type MaturityClockSource = 'publishedAt' | 'detectedAt';

export interface MaturityClock {
  startMs: number | undefined;
  source: MaturityClockSource | undefined;
}

/**
 * Ported mirror of app/model/maturity-policy.ts's resolveMaturityClock() — same
 * established pattern as the four functions above. Used by container-mapper.ts and
 * useContainerPolicy.ts's fallback branches (when the backend eligibility payload
 * doesn't carry a `maturity-not-reached` blocker to read the resolved clock off of)
 * instead of each hand-rolling its own untrusted, updateDetectedAt-only heuristic
 * (#556 — see the app-side function's docstring for the resolution rules).
 *
 * `firstSeenAt` is a fallback for `updateDetectedAt`, mirroring the app-side
 * resolver exactly: legacy/partial records that carry only one of the two
 * fields must resolve the same clock here as they do server-side, or this
 * fallback branch reintroduces the exact drift #556 set out to eliminate.
 */
export function resolveMaturityClock(
  container: {
    updateDetectedAt?: string;
    firstSeenAt?: string;
    result?: { publishedAt?: string; publishedAtTrusted?: boolean };
  },
  nowMs: number = Date.now(),
): MaturityClock {
  const detectedMs = Date.parse(container.updateDetectedAt || '');
  const firstSeenMs = Date.parse(container.firstSeenAt || '');
  const detectedFinite = Number.isFinite(detectedMs)
    ? detectedMs
    : Number.isFinite(firstSeenMs)
      ? firstSeenMs
      : undefined;
  if (container.result?.publishedAtTrusted === true) {
    const publishedMs = Date.parse(container.result.publishedAt || '');
    if (Number.isFinite(publishedMs) && publishedMs <= nowMs) {
      if (detectedFinite !== undefined && detectedFinite < publishedMs) {
        return { startMs: detectedFinite, source: 'detectedAt' };
      }
      return { startMs: publishedMs, source: 'publishedAt' };
    }
  }
  return {
    startMs: detectedFinite,
    source: detectedFinite !== undefined ? 'detectedAt' : undefined,
  };
}
