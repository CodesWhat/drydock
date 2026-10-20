/**
 * In-memory record of the last reason a notification trigger skipped a container (DR-85).
 *
 * The reasons used to live only in DEBUG log lines. This keeps the most recent skip per
 * (trigger, container) pair so the debug dump and the container detail API can answer
 * "why didn't I get a notification?" without raising the log level. An entry is dropped
 * when a notification for that pair is actually sent, and the map is capped so a large
 * fleet cannot grow it without bound.
 */

const NOTIFICATION_SKIP_REASONS = [
  'rule-disabled',
  'threshold-not-met',
  'trigger-excluded',
  'once-already-sent',
  'recently-applied',
  'digest-buffered',
] as const;

export type NotificationSkipReason = (typeof NOTIFICATION_SKIP_REASONS)[number];

export interface NotificationSkip {
  trigger: string;
  containerId: string;
  reason: NotificationSkipReason;
  at: string;
  detail?: string;
}

export const NOTIFICATION_SKIP_MAX_ENTRIES = 1000;
export const NOTIFICATION_SKIP_MAX_DETAIL_LENGTH = 160;

const skips = new Map<string, NotificationSkip>();

function skipKey(trigger: string, containerId: string): string {
  return `${trigger}\u0000${containerId}`;
}

export function recordNotificationSkip(
  trigger: string,
  containerId: string,
  reason: NotificationSkipReason,
  detail?: string,
): void {
  const key = skipKey(trigger, containerId);
  // Delete first so a re-recorded pair moves to the newest position and the oldest
  // entry (first in insertion order) is always the one evicted at the cap.
  skips.delete(key);
  const entry: NotificationSkip = { trigger, containerId, reason, at: new Date().toISOString() };
  if (detail) {
    entry.detail = detail.slice(0, NOTIFICATION_SKIP_MAX_DETAIL_LENGTH);
  }
  skips.set(key, entry);
  if (skips.size > NOTIFICATION_SKIP_MAX_ENTRIES) {
    const oldest = skips.keys().next().value as string;
    skips.delete(oldest);
  }
}

export function clearNotificationSkip(trigger: string, containerId: string): void {
  skips.delete(skipKey(trigger, containerId));
}

/** Last skip per trigger for one container, shaped for the container detail API. */
export function getNotificationSkipsForContainer(
  containerId: string,
): Array<Pick<NotificationSkip, 'trigger' | 'reason' | 'at'>> {
  const result: Array<Pick<NotificationSkip, 'trigger' | 'reason' | 'at'>> = [];
  for (const entry of skips.values()) {
    if (entry.containerId === containerId) {
      result.push({ trigger: entry.trigger, reason: entry.reason, at: entry.at });
    }
  }
  return result;
}

/** Every recorded skip, newest last, for the debug dump. */
export function getNotificationSkipsSnapshot(): NotificationSkip[] {
  return Array.from(skips.values());
}

export function resetNotificationSkips(): void {
  skips.clear();
}
