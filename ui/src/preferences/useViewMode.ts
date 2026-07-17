import { computed, type WritableComputedRef } from 'vue';
import type { ViewMode } from './schema';
import { preferences } from './store';
import { isViewMode } from './validators';

/** Every list view wired into the table/cards toggle. As of v1.6 this covers all of
 * them — `audit`, `watchers`, `servers`, `registries`, and `auth` each gained a `mode`
 * field and a card view too. */
type ViewKey =
  | 'containers'
  | 'agents'
  | 'notifications'
  | 'security'
  | 'triggers'
  | 'audit'
  | 'watchers'
  | 'servers'
  | 'registries'
  | 'auth';

/**
 * Shorthand for binding a view's mode preference.
 *
 * @example
 * const viewMode = useViewMode('agents'); // WritableComputedRef<ViewMode>
 */
export function useViewMode(view: ViewKey): WritableComputedRef<ViewMode> {
  return computed({
    get: () => {
      if (view === 'containers') return preferences.containers.viewMode;
      return preferences.views[view].mode;
    },
    set: (v: ViewMode) => {
      if (!isViewMode(v)) return;
      if (view === 'containers') {
        preferences.containers.viewMode = v;
      } else {
        preferences.views[view].mode = v;
      }
    },
  });
}
