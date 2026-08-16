import {
  ddActionAuto,
  ddActionExclude,
  ddActionInclude,
  ddNotificationExclude,
  ddNotificationInclude,
} from './label.js';

export type TriggerLabelDirection = 'include' | 'exclude';

export interface ResolvedTriggerLabelValues {
  action?: string;
  notification?: string;
  /** Compat mirror: the scoped value, for old API/agent consumers. */
  mirror?: string;
}

export interface ResolvedTriggerLabelFields {
  actionTriggerInclude?: string;
  actionTriggerExclude?: string;
  notificationTriggerInclude?: string;
  notificationTriggerExclude?: string;
  /**
   * Action category only — no notification counterpart, and (unlike
   * include/exclude) no deprecated mirror; `dd.action.auto` was never
   * conflated with a category-agnostic label.
   */
  actionTriggerAuto?: string;
  /** @deprecated compat mirror. */
  triggerInclude?: string;
  /** @deprecated compat mirror. */
  triggerExclude?: string;
}

function getDdActionKey(direction: TriggerLabelDirection): string {
  return direction === 'include' ? ddActionInclude : ddActionExclude;
}

function getDdNotificationKey(direction: TriggerLabelDirection): string {
  return direction === 'include' ? ddNotificationInclude : ddNotificationExclude;
}

/**
 * Pure (no warn/telemetry side effects) resolution of one direction of the
 * trigger labels into category-scoped values plus the deprecated compat
 * mirror.
 *
 * The legacy `dd.trigger.<dir>` fallback was removed in v1.7.0 — only
 * `dd.action.<dir>` / `dd.notification.<dir>` are read here. Callers that
 * still need to detect (and warn about) a `dd.trigger.<dir>` label present
 * on a container do so separately; it is no longer consulted for value
 * resolution.
 *
 * Kept dependency-free (only imports the label key constants, which have no
 * imports of their own) so it can be shared by the live label-resolution path
 * in container-init.ts — which layers deprecation warnings/telemetry on top —
 * and the store migration / container-validation normalization paths in
 * store/container.ts and store/migrate.ts, which only need the values and
 * must not re-emit deprecation warnings for labels already parsed once at
 * discovery time. Importing container-init.ts from the store layer (or vice
 * versa) would create a require cycle through store/container.ts, so the
 * shared algorithm lives here instead.
 */
export function resolveTriggerLabelValuesPure(
  labels: Record<string, string>,
  direction: TriggerLabelDirection,
): ResolvedTriggerLabelValues {
  const actionValue = labels[getDdActionKey(direction)];
  const notificationValue = labels[getDdNotificationKey(direction)];

  if (actionValue === undefined && notificationValue === undefined) {
    return {};
  }

  return {
    action: actionValue,
    notification: notificationValue,
    mirror: actionValue ?? notificationValue,
  };
}

/**
 * Resolve both directions into the four category-scoped fields plus the
 * deprecated triggerInclude/triggerExclude mirror.
 */
export function resolveTriggerLabelFieldsPure(
  labels: Record<string, string>,
): ResolvedTriggerLabelFields {
  const includeResolved = resolveTriggerLabelValuesPure(labels, 'include');
  const excludeResolved = resolveTriggerLabelValuesPure(labels, 'exclude');

  return {
    actionTriggerInclude: includeResolved.action,
    actionTriggerExclude: excludeResolved.action,
    notificationTriggerInclude: includeResolved.notification,
    notificationTriggerExclude: excludeResolved.notification,
    actionTriggerAuto: labels[ddActionAuto],
    triggerInclude: includeResolved.mirror,
    triggerExclude: excludeResolved.mirror,
  };
}
