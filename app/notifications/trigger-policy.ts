import { getTriggerCategoryForType } from '../triggers/trigger-category.js';

export function isNotificationTriggerType(type: string | undefined): boolean {
  const typeNormalized = `${type || ''}`.trim().toLowerCase();
  if (!typeNormalized) {
    return false;
  }
  return getTriggerCategoryForType(typeNormalized) === 'notification';
}

export function getNotificationTriggerIdsFromState(
  triggerState: Record<string, { type?: string } | undefined>,
): Set<string> {
  const triggerIds = new Set<string>();
  Object.entries(triggerState || {}).forEach(([triggerId, trigger]) => {
    if (isNotificationTriggerType(trigger?.type)) {
      triggerIds.add(triggerId);
    }
  });
  return triggerIds;
}

export function doesNotificationTriggerReferenceMatchId(
  triggerReference: string | undefined,
  triggerId: string | undefined,
): boolean {
  const triggerReferenceNormalized = `${triggerReference || ''}`.trim().toLowerCase();
  const triggerIdNormalized = `${triggerId || ''}`.trim().toLowerCase();

  if (!triggerReferenceNormalized || !triggerIdNormalized) {
    return false;
  }

  if (triggerReferenceNormalized === triggerIdNormalized) {
    return true;
  }

  const triggerIdParts = triggerIdNormalized.split('.');
  const triggerName = triggerIdParts.at(-1);
  if (!triggerName) {
    return false;
  }
  if (triggerReferenceNormalized === triggerName) {
    return true;
  }

  if (triggerIdParts.length >= 2) {
    const provider = triggerIdParts.at(-2);
    const providerAndName = `${provider}.${triggerName}`;
    if (triggerReferenceNormalized === providerAndName) {
      return true;
    }
  }

  return false;
}

export function resolveNotificationTriggerIds(
  triggerReference: string | undefined,
  allowedTriggerIds: Set<string>,
): string[] {
  const triggerReferenceNormalized = `${triggerReference || ''}`.trim();
  if (!triggerReferenceNormalized) {
    return [];
  }

  const allowedTriggerIdEntries = Array.from(allowedTriggerIds);
  const exactMatches = allowedTriggerIdEntries.filter(
    (allowedTriggerId) =>
      allowedTriggerId.toLowerCase() === triggerReferenceNormalized.toLowerCase(),
  );
  if (exactMatches.length > 0) {
    return exactMatches.sort();
  }

  return allowedTriggerIdEntries
    .filter((allowedTriggerId) =>
      doesNotificationTriggerReferenceMatchId(triggerReferenceNormalized, allowedTriggerId),
    )
    .sort();
}

export function normalizeNotificationTriggerIds(
  triggerIds: string[] | undefined,
  allowedTriggerIds: Set<string>,
): string[] {
  if (!Array.isArray(triggerIds)) {
    return [];
  }
  return Array.from(
    new Set(
      triggerIds
        .filter((triggerId) => typeof triggerId === 'string')
        .map((triggerId) => triggerId.trim())
        .flatMap((triggerId) => resolveNotificationTriggerIds(triggerId, allowedTriggerIds)),
    ),
  ).sort();
}

export interface OrphanedNotificationRuleReference {
  ruleId: string;
  triggerId: string;
}

/**
 * Every `(ruleId, triggerId)` pair among `rules` whose `triggerId` no longer
 * resolves against `allowedTriggerIds` (spec-7.1-config-file.md section 4.3):
 * a configuration reload that renames or removes a trigger orphans the DB
 * rules that reference it by id. Reuses `resolveNotificationTriggerIds`'s
 * own shorthand-matching rules — the same ones a rule write
 * (`api/notification.ts`) already uses to decide whether a trigger reference
 * is valid — so a reference that would be accepted on write is never flagged
 * as orphaned here. Callers report the result; this never mutates a rule.
 */
export function findOrphanedNotificationRuleReferences(
  rules: readonly { id: string; triggers: readonly string[] }[],
  allowedTriggerIds: Set<string>,
): OrphanedNotificationRuleReference[] {
  const orphaned: OrphanedNotificationRuleReference[] = [];
  for (const rule of rules) {
    for (const triggerId of rule.triggers) {
      if (resolveNotificationTriggerIds(triggerId, allowedTriggerIds).length === 0) {
        orphaned.push({ ruleId: rule.id, triggerId });
      }
    }
  }
  return orphaned;
}
