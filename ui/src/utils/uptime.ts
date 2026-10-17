import type { TranslateFn } from '../types/i18n';

const DOCKER_ZERO_TIME_PREFIX = '0001-';
type UptimeUnit = 'day' | 'hour' | 'minute' | 'second';
let cachedFormatters: { locale: string; units: Record<UptimeUnit, Intl.NumberFormat> } | undefined;

function getUptimeFormatters(locale: string) {
  if (cachedFormatters?.locale !== locale) {
    const create = (unit: UptimeUnit) =>
      new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' });
    cachedFormatters = {
      locale,
      units: {
        day: create('day'),
        hour: create('hour'),
        minute: create('minute'),
        second: create('second'),
      },
    };
  }
  return cachedFormatters.units;
}

/**
 * Format a container start timestamp as a localized relative uptime string.
 *
 * English examples (the supplied translator localizes the complete phrase):
 *   - `Up Nd Nh`  — days (1+ days)
 *   - `Up Nh Nm`  — hours (1+ hours, less than 1 day)
 *   - `Up Nm`     — minutes (1–59 minutes)
 *   - `Up Ns`     — seconds (0–59 seconds)
 *   - `—`         — when iso is undefined, a Docker zero-time sentinel, or unparseable
 *
 * @param iso   ISO 8601 timestamp string from container `startedAt`.
 * @param nowMs Current epoch milliseconds (defaults to `Date.now()`). Pass an
 *              explicit value to make the function deterministic in tests or
 *              reactive in Vue components via `useNow()`.
 */
export function formatUptimeFromIso(
  iso: string | undefined,
  nowMs: number = Date.now(),
  locale = 'en',
  t?: TranslateFn,
): string {
  if (!iso || iso.startsWith(DOCKER_ZERO_TIME_PREFIX)) {
    return '—';
  }

  const startMs = Date.parse(iso);
  if (Number.isNaN(startMs)) {
    return '—';
  }

  const elapsedMs = nowMs - startMs;
  if (elapsedMs < 0) {
    return '—';
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const units = getUptimeFormatters(locale);
  let duration: string;
  if (days > 0) {
    duration = `${units.day.format(days)} ${units.hour.format(hours)}`;
  } else if (hours > 0) {
    duration = `${units.hour.format(hours)} ${units.minute.format(minutes)}`;
  } else if (minutes > 0) {
    duration = units.minute.format(minutes);
  } else {
    duration = units.second.format(seconds);
  }
  return t ? t('common.uptime', { duration }) : `Up ${duration}`;
}
