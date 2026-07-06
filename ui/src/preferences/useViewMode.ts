import { computed, type WritableComputedRef } from 'vue';
import type { ViewMode } from './schema';
import { preferences } from './store';
import { isViewMode } from './validators';

/** The 5 views wired into the v1.6 table/cards toggle. `audit`/`watchers`/`servers`/
 * `registries`/`auth` stay table-only and have no `mode` field to bind to. */
type ViewKey = 'containers' | 'agents' | 'notifications' | 'security' | 'triggers';

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
