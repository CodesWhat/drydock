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
 *
 * `firstSeenAt` is a fallback for `updateDetectedAt`, not a second source:
 * store/container.ts stamps both from the same getUpdateLifecycleTimestamp()
 * helper at the same call sites, so in steady state they carry the same
 * value. The fallback only matters for legacy/partial records where one of
 * the two fields is populated and the other isn't (#556).
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

export function getMaturityStartMs(
  container: {
    updateDetectedAt?: string;
    firstSeenAt?: string;
    result?: { publishedAt?: string; publishedAtTrusted?: boolean };
  },
  nowMs: number = Date.now(),
): number | undefined {
  return resolveMaturityClock(container, nowMs).startMs;
}

/**
 * Trust-aware "how old is this update" in milliseconds — the one addition
 * call sites actually need beyond resolveMaturityClock/getMaturityStartMs.
 * Thin wrapper: resolves the same clock the eligibility gate measures
 * against and returns its age, clamped to >= 0 against clock skew. Replaces
 * the divergent, untrusted `Math.min(firstSeenAt, publishedAt)` blends that
 * used to live in app/model/container.ts's getRawUpdateAge and
 * app/api/container/update-age.ts's own three-way blend (#556).
 */
export function getUpdateAgeMs(
  container: {
    updateDetectedAt?: string;
    firstSeenAt?: string;
    result?: { publishedAt?: string; publishedAtTrusted?: boolean };
  },
  nowMs: number = Date.now(),
): number | undefined {
  const { startMs } = resolveMaturityClock(container, nowMs);
  return startMs === undefined ? undefined : Math.max(0, nowMs - startMs);
}

/**
 * Whether an update is currently withheld by an active maturity gate, i.e.
 * `updatePolicy.maturityMode === 'mature'` and the resolved clock has not yet
 * reached `maturityMinAgeDays`. Mirrors the maturity branch of
 * `isUpdateSuppressed()` in model/container.ts, factored out here so callers
 * that only have the update-policy/result shape (not a full validated
 * Container) — e.g. the store write path stamping `maturityGatePendingSince`
 * — can reuse the same check without a circular import back into
 * model/container.ts.
 */
export function isMaturityGatePending(
  container: {
    updateDetectedAt?: string;
    result?: { publishedAt?: string; publishedAtTrusted?: boolean };
    updatePolicy?: { maturityMode?: MaturityMode; maturityMinAgeDays?: number };
  },
  nowMs: number = Date.now(),
): boolean {
  if (container.updatePolicy?.maturityMode !== MATURITY_MODE_MATURE_VALUE) {
    return false;
  }
  const maturityStartMs = getMaturityStartMs(container, nowMs);
  if (maturityStartMs === undefined) {
    return true;
  }
  const maturityMinAgeDays = resolveMaturityMinAgeDays(container.updatePolicy?.maturityMinAgeDays);
  return nowMs - maturityStartMs < maturityMinAgeDaysToMilliseconds(maturityMinAgeDays);
}
