import { computed, type WritableComputedRef } from 'vue';

/**
 * Preference-binding convention for UI state backed by persisted preferences.
 *
 * Use this helper whenever a component needs a `WritableComputedRef` that reads
 * from and writes to a single preference field. The getter and setter should
 * reference the same preference path to keep bindings predictable and consistent
 * across views.
 *
 * @example
 * const sidebar = usePreference(
 *   () => preferences.layout.sidebarCollapsed,
 *   (v) => { preferences.layout.sidebarCollapsed = v; },
 * );
 */
export function usePreference<T>(
  getter: () => T,
  setter: (value: T) => void,
): WritableComputedRef<T> {
  return computed({
    get: getter,
    set: setter,
  });
}
