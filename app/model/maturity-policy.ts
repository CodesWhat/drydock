export const DEFAULT_MATURITY_MIN_AGE_DAYS = 7;
export const MATURITY_MIN_AGE_DAYS_MIN = 1;
export const MATURITY_MIN_AGE_DAYS_MAX = 365;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MATURITY_MODE_ALL_VALUE: string = 'all';
const MATURITY_MODE_MATURE_VALUE: string = 'mature';

export type MaturityMode = 'all' | 'mature';

export function normalizeMaturityMode(value: unknown): MaturityMode | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === MATURITY_MODE_ALL_VALUE || normalized === MATURITY_MODE_MATURE_VALUE) {
    return normalized as MaturityMode;
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

export type MaturityClockSource = 'publishedAt' | 'detectedAt';

export interface MaturityClock {
  startMs: number | undefined;
  source: MaturityClockSource | undefined;
}

/**
 * Resolve the single clock the maturity policy measures against, and which
 * clock it picked. Trusted registry `publishedAt` wins unless detection
 * happened even earlier (mirrors the historical `Math.min` tie-break exactly
 * — see getMaturityStartMs()). The UI previously re-derived "is this
 * maturity-blocked?" independently in container-mapper.ts and
 * useContainerPolicy.ts using only updateDetectedAt, drifting from this
 * server-side truth; both now consume the resolved clock via
 * updateEligibility blocker details instead (#display-honesty item 4).
 */
export function resolveMaturityClock(
  container: {
    updateDetectedAt?: string;
    result?: { publishedAt?: string; publishedAtTrusted?: boolean };
  },
  nowMs: number = Date.now(),
): MaturityClock {
  const detectedMs = Date.parse(container.updateDetectedAt || '');
  const detectedFinite = Number.isFinite(detectedMs) ? detectedMs : undefined;
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

export function getMaturityStartMs(
  container: {
    updateDetectedAt?: string;
    result?: { publishedAt?: string; publishedAtTrusted?: boolean };
  },
  nowMs: number = Date.now(),
): number | undefined {
  return resolveMaturityClock(container, nowMs).startMs;
}
