/** Update maturity classification based on how long an update has been available. */
import { daysToMs, MS_PER_DAY } from './maturity-policy';

type UpdateMaturity = 'fresh' | 'settled' | null;

const DEFAULT_MATURITY_THRESHOLD_MS = daysToMs(7);

/**
 * Classify an available update as "fresh" (recently detected) or "settled" (available for a while).
 * Returns null when no update is available or no detection timestamp exists.
 */
export function getUpdateMaturity(
  updateDetectedAt: string | undefined,
  hasUpdate: boolean,
  nowMs: number = Date.now(),
  thresholdMs: number = DEFAULT_MATURITY_THRESHOLD_MS,
): UpdateMaturity {
  if (!hasUpdate || !updateDetectedAt) {
    return null;
  }

  const detectedMs = Date.parse(updateDetectedAt);
  if (Number.isNaN(detectedMs)) {
    return null;
  }

  const ageMs = nowMs - detectedMs;
  return ageMs < thresholdMs ? 'fresh' : 'settled';
}

/**
 * Format the age of an available update as a human-readable string.
 * Returns undefined when no update or no detection timestamp.
 */
export function formatUpdateAge(
  updateDetectedAt: string | undefined,
  hasUpdate: boolean,
  nowMs: number = Date.now(),
): string | undefined {
  if (!hasUpdate || !updateDetectedAt) {
    return undefined;
  }

  const detectedMs = Date.parse(updateDetectedAt);
  if (Number.isNaN(detectedMs)) {
    return undefined;
  }

  const ageMs = Math.max(0, nowMs - detectedMs);
  const minutes = Math.floor(ageMs / 60_000);
  const hours = Math.floor(ageMs / 3_600_000);
  const days = Math.floor(ageMs / MS_PER_DAY);

  if (days > 0) {
    return `Available for ${days} day${days === 1 ? '' : 's'}`;
  }
  if (hours > 0) {
    return `Available for ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (minutes > 0) {
    return `Available for ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return 'Available just now';
}
