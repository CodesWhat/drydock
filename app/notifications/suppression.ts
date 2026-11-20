/**
 * Decides whether a notification is held back by a silence or by quiet hours.
 *
 * Suppressed notifications are dropped, not queued: the decision runs where the rule check
 * runs, so a dropped one never reaches a provider. Each drop is counted per rule and reason
 * so an operator can see what a window swallowed. An `update-available` notification that is
 * dropped is not recorded as delivered, so the next scan after the window sends it; one-shot
 * events (a container stopping, an agent disconnecting) are gone.
 */
import { getNotificationAlertsConfiguration } from '../configuration/index.js';
import log from '../log/index.js';
import { findMatchingSilence } from '../store/notification-silence.js';
import { getErrorMessage } from '../util/error.js';
import {
  isValidTimezone,
  isWithinQuietHours,
  parseQuietHoursSchedule,
  type QuietHoursRange,
} from './quiet-hours.js';

const suppressionLog = log.child({ component: 'notification-suppression' });

export type NotificationSuppressionReason = 'quiet-hours' | 'silenced';

export interface NotificationSuppressionDecision {
  suppressed: boolean;
  reason?: NotificationSuppressionReason;
  silenceId?: string;
}

export interface QuietHoursPolicy {
  ranges: QuietHoursRange[];
  timezone: string;
  schedule: string;
  /** Rules quiet hours applies to. Empty means every rule that is not exempt. */
  rules: Set<string>;
  /** Rules that quiet hours and global silences never hold back. */
  exempt: Set<string>;
}

function splitRuleList(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((ruleId) => ruleId.trim().toLowerCase())
      .filter((ruleId) => ruleId !== ''),
  );
}

let lastWarning: string | undefined;

function warnOnce(message: string): void {
  if (lastWarning !== message) {
    lastWarning = message;
    suppressionLog.warn(message);
  }
}

type QuietHoursConfiguration = ReturnType<typeof getNotificationAlertsConfiguration>['quiethours'];

const DEFAULT_EXEMPT_RULES: ReadonlySet<string> = new Set(['security-alert', 'update-failed']);

function readQuietHoursConfiguration(): QuietHoursConfiguration | undefined {
  try {
    return getNotificationAlertsConfiguration().quiethours;
  } catch (error: unknown) {
    warnOnce(
      `Ignoring DD_ALERTS_QUIETHOURS_* settings, they are invalid (${getErrorMessage(error)})`,
    );
    return undefined;
  }
}

function buildQuietHoursPolicy(
  configuration: QuietHoursConfiguration,
): QuietHoursPolicy | undefined {
  const schedule = configuration.schedule.trim();
  if (schedule === '') {
    return undefined;
  }
  if (!isValidTimezone(configuration.tz)) {
    warnOnce(`Ignoring quiet hours, unknown timezone '${configuration.tz}'`);
    return undefined;
  }
  try {
    return {
      ranges: parseQuietHoursSchedule(schedule),
      timezone: configuration.tz,
      schedule,
      rules: splitRuleList(configuration.rules),
      exempt: splitRuleList(configuration.exempt),
    };
  } catch (error: unknown) {
    warnOnce(`Ignoring quiet hours (${getErrorMessage(error)})`);
    return undefined;
  }
}

/** The configured quiet-hours policy, or `undefined` when none is set or it is invalid. */
export function getQuietHoursPolicy(): QuietHoursPolicy | undefined {
  const configuration = readQuietHoursConfiguration();
  return configuration ? buildQuietHoursPolicy(configuration) : undefined;
}

/** True when `now` is inside the policy's quiet window, whatever rule asks. */
export function isQuietHoursActive(policy: QuietHoursPolicy, now: Date = new Date()): boolean {
  return isWithinQuietHours(policy.ranges, policy.timezone, now);
}

/**
 * Whether quiet hours or a silence holds `ruleId` back at `now`. A rule-scoped silence is
 * explicit, so it applies even to an exempt rule; quiet hours and global silences spare
 * the exempt rules (`security-alert` and `update-failed` unless configured otherwise).
 */
export function getNotificationSuppression(
  ruleId: string,
  now: Date = new Date(),
): NotificationSuppressionDecision {
  const configuration = readQuietHoursConfiguration();
  const exempt = configuration ? splitRuleList(configuration.exempt) : DEFAULT_EXEMPT_RULES;
  const silence = findMatchingSilence(
    ruleId,
    { respectGlobal: !exempt.has(ruleId) },
    now.getTime(),
  );
  if (silence) {
    return { suppressed: true, reason: 'silenced', silenceId: silence.id };
  }
  const policy = configuration ? buildQuietHoursPolicy(configuration) : undefined;
  if (
    policy &&
    !exempt.has(ruleId) &&
    (policy.rules.size === 0 || policy.rules.has(ruleId)) &&
    isQuietHoursActive(policy, now)
  ) {
    return { suppressed: true, reason: 'quiet-hours' };
  }
  return { suppressed: false };
}

const suppressedCounts = new Map<string, number>();

/** Count one suppressed notification. */
export function recordSuppressed(ruleId: string, reason: NotificationSuppressionReason): void {
  const key = `${ruleId}|${reason}`;
  suppressedCounts.set(key, (suppressedCounts.get(key) ?? 0) + 1);
}

export interface SuppressedCount {
  ruleId: string;
  reason: NotificationSuppressionReason;
  count: number;
}

/** Notifications dropped since this process started, per rule and reason. */
export function getSuppressedCounts(): SuppressedCount[] {
  return [...suppressedCounts.entries()]
    .map(([key, count]) => {
      const [ruleId, reason] = key.split('|');
      return { ruleId, reason: reason as NotificationSuppressionReason, count };
    })
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.reason.localeCompare(b.reason));
}

export function resetSuppressionForTests(): void {
  suppressedCounts.clear();
  lastWarning = undefined;
}
