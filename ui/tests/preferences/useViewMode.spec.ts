import { DEFAULTS, type ViewMode } from '@/preferences/schema';
import { preferences, resetPreferences } from '@/preferences/store';
import { useViewMode } from '@/preferences/useViewMode';

const viewKeys = ['containers', 'agents', 'notifications', 'security', 'triggers'] as const;
type ViewKey = (typeof viewKeys)[number];

interface ViewCase {
  key: ViewKey;
  defaultMode: ViewMode;
  read: () => ViewMode;
  write: (mode: ViewMode) => void;
}

const viewCases: ViewCase[] = [
  {
    key: 'containers',
    defaultMode: DEFAULTS.containers.viewMode,
    read: () => preferences.containers.viewMode,
    write: (mode) => {
      preferences.containers.viewMode = mode;
    },
  },
  {
    key: 'agents',
    defaultMode: DEFAULTS.views.agents.mode,
    read: () => preferences.views.agents.mode,
    write: (mode) => {
      preferences.views.agents.mode = mode;
    },
  },
  {
    key: 'notifications',
    defaultMode: DEFAULTS.views.notifications.mode,
    read: () => preferences.views.notifications.mode,
    write: (mode) => {
      preferences.views.notifications.mode = mode;
    },
  },
  {
    key: 'security',
    defaultMode: DEFAULTS.views.security.mode,
    read: () => preferences.views.security.mode,
    write: (mode) => {
      preferences.views.security.mode = mode;
    },
  },
  {
    key: 'triggers',
    defaultMode: DEFAULTS.views.triggers.mode,
    read: () => preferences.views.triggers.mode,
    write: (mode) => {
      preferences.views.triggers.mode = mode;
    },
  },
];

describe('useViewMode', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferences();
  });

  for (const view of viewCases) {
    describe(view.key, () => {
      it('returns the default view mode', () => {
        const mode = useViewMode(view.key);
        expect(mode.value).toBe(view.defaultMode);
      });

      it('reads from the matching preference path', () => {
        view.write('cards');
        const mode = useViewMode(view.key);
        expect(mode.value).toBe('cards');
      });

      it('writes to the matching preference path', () => {
        const mode = useViewMode(view.key);
        mode.value = 'cards';
        expect(view.read()).toBe('cards');

        mode.value = 'table';
        expect(view.read()).toBe('table');
      });

      it('rejects invalid view modes', () => {
        const mode = useViewMode(view.key);
        mode.value = 'cards';

        mode.value = 'timeline' as any;

        expect(view.read()).toBe('cards');
        expect(mode.value).toBe('cards');
      });
    });
  }

  describe('cross-view isolation', () => {
    it('does not affect other view modes when changing one view', () => {
      const containers = useViewMode('containers');
      const agents = useViewMode('agents');
      const notifications = useViewMode('notifications');
      const security = useViewMode('security');
      const triggers = useViewMode('triggers');

      containers.value = 'cards';
      security.value = 'cards';

      expect(containers.value).toBe('cards');
      expect(agents.value).toBe('table');
      expect(notifications.value).toBe('table');
      expect(security.value).toBe('cards');
      expect(triggers.value).toBe('table');
    });
  });
});
