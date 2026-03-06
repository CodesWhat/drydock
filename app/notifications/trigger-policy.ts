const NON_NOTIFICATION_TRIGGER_TYPES = new Set(['docker', 'dockercompose']);

export function isNotificationTriggerType(type: string | undefined): boolean {
  const typeNormalized = `${type || ''}`.trim().toLowerCase();
  if (!typeNormalized) {
    return false;
  }
  return !NON_NOTIFICATION_TRIGGER_TYPES.has(typeNormalized);
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
        .filter((triggerId) => triggerId.length > 0 && allowedTriggerIds.has(triggerId)),
    ),
  ).sort();
}
