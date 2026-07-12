import {
  ddActionExclude,
  ddActionInclude,
  ddNotificationExclude,
  ddNotificationInclude,
  ddTriggerExclude,
  ddTriggerInclude,
} from './label.js';

export type TriggerLabelDirection = 'include' | 'exclude';

export interface ResolvedTriggerLabelValues {
  action?: string;
  notification?: string;
  /** Compat mirror: first scoped value, then the deprecated dd.trigger.* fallback. */
  mirror?: string;
}

export interface ResolvedTriggerLabelFields {
  actionTriggerInclude?: string;
  actionTriggerExclude?: string;
  notificationTriggerInclude?: string;
  notificationTriggerExclude?: string;
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

function getDdLegacyKey(direction: TriggerLabelDirection): string {
  return direction === 'include' ? ddTriggerInclude : ddTriggerExclude;
}

/**
 * Pure (no warn/telemetry side effects) resolution of one direction of the
 * trigger labels into category-scoped values plus the deprecated compat
 * mirror.
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
  const legacyValue = labels[getDdLegacyKey(direction)];

  if (actionValue === undefined && notificationValue === undefined && legacyValue === undefined) {
    return {};
  }

  return {
    action: actionValue ?? legacyValue,
    notification: notificationValue ?? legacyValue,
    mirror: actionValue ?? notificationValue ?? legacyValue,
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
    triggerInclude: includeResolved.mirror,
    triggerExclude: excludeResolved.mirror,
  };
}
