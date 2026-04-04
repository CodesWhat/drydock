import { computed, type WritableComputedRef } from 'vue';
import type { ViewMode } from './schema';
import { preferences } from './store';
import { isViewMode } from './validators';

type ViewKey = Exclude<keyof typeof preferences.views, 'logs'> | 'containers';

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
