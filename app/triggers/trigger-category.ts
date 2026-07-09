import type { Container, TriggerCategory } from '../model/container.js';

/**
 * Trigger types classified as "action" for `dd.action.*` / `dd.notification.*`
 * label-scoping purposes. Mirrors the taxonomy in
 * `triggers/providers/Trigger.ts` (`ACTION_TRIGGER_TYPES`), but is kept in its
 * own leaf module: `Trigger.ts` pulls in the full trigger runtime (registry,
 * stores, agent manager) via `updates/request-update.js`, and that module is
 * imported by `model/update-eligibility.ts` — importing `Trigger.ts` as a
 * value from there (or from this module) would create a require cycle. This
 * module has no such dependencies, so it can be imported anywhere.
 */
const ACTION_TRIGGER_TYPES = new Set(['docker', 'dockercompose', 'command']);

/**
 * Classify a trigger provider `type` string into its configuration category.
 */
export function getTriggerCategoryForType(type: string): TriggerCategory {
  return ACTION_TRIGGER_TYPES.has(type.toLowerCase()) ? 'action' : 'notification';
}

/**
 * Select the category-scoped include/exclude label values for a container.
 *
 * No mirror fallback: this is the strict-scoping decision for #494. A lone
 * `dd.action.include` leaves `notificationTriggerInclude` undefined, so
 * notification triggers are left ungated by an action-only label. The
 * deprecated `triggerInclude`/`triggerExclude` mirror is still written by the
 * label resolver (for /api/v1 readers, the persisted store, and mixed-version
 * agents) but matching code must never read it.
 */
export function getContainerTriggerFiltersForCategory(
  container: Container,
  category: TriggerCategory,
): { include?: string; exclude?: string } {
  return category === 'action'
    ? { include: container.actionTriggerInclude, exclude: container.actionTriggerExclude }
    : {
        include: container.notificationTriggerInclude,
        exclude: container.notificationTriggerExclude,
      };
}
