/** Freshness-fact formatting for available updates — a tooltip string, not a badge state. */
import type { TranslateFn } from '../types/i18n';
import { MS_PER_DAY } from './maturity-policy';

/**
 * Format the age of an available update as a "Detected {duration} ago" tooltip string.
 * Returns undefined when no update or no detection timestamp exists. This replaces the old
 * fresh/settled badge classification (#display-honesty) — the freshness fact is now surfaced
 * as a tooltip on the update-type badge instead of its own NEW/MATURE chrome.
 */
export function formatUpdateAge(
  updateDetectedAt: string | undefined,
  hasUpdate: boolean,
  nowMs: number = Date.now(),
  t?: TranslateFn,
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

  let duration: string | undefined;
  if (days > 0) {
    duration = t
      ? days === 1
        ? t('containerComponents.updateAge.availableDaysSingular')
        : t('containerComponents.updateAge.availableDaysPlural', { count: days })
      : `${days} day${days === 1 ? '' : 's'}`;
  } else if (hours > 0) {
    duration = t
      ? hours === 1
        ? t('containerComponents.updateAge.availableHoursSingular')
        : t('containerComponents.updateAge.availableHoursPlural', { count: hours })
      : `${hours} hour${hours === 1 ? '' : 's'}`;
  } else if (minutes > 0) {
    duration = t
      ? minutes === 1
        ? t('containerComponents.updateAge.availableMinutesSingular')
        : t('containerComponents.updateAge.availableMinutesPlural', { count: minutes })
      : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  if (!duration) {
    return t ? t('containerComponents.updateAge.justNow') : 'Detected just now';
  }
  return t ? t('containerComponents.maturityBadge.new', { duration }) : `Detected ${duration} ago`;
}
