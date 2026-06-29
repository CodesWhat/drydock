const DOCKER_ZERO_TIME_PREFIX = '0001-';

/**
 * Format a container start timestamp as a human-readable relative uptime string.
 *
 * Returns one of:
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
export function formatUptimeFromIso(iso: string | undefined, nowMs: number = Date.now()): string {
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

  if (days > 0) {
    return `Up ${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `Up ${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `Up ${minutes}m`;
  }
  return `Up ${seconds}s`;
}
