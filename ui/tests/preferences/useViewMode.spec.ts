import { DEFAULTS } from '@/preferences/schema';
import { preferences, resetPreferences } from '@/preferences/store';
import { useViewMode } from '@/preferences/useViewMode';

describe('useViewMode', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferences();
  });

  describe('containers', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('containers');
      expect(mode.value).toBe('table');
    });

    it('should read from preferences.containers.viewMode', () => {
      preferences.containers.viewMode = 'cards';
      const mode = useViewMode('containers');
      expect(mode.value).toBe('cards');
    });

    it('should write to preferences.containers.viewMode', () => {
      const mode = useViewMode('containers');
      mode.value = 'list';
      expect(preferences.containers.viewMode).toBe('list');
    });

    it('should reject invalid view modes', () => {
      const mode = useViewMode('containers');
      mode.value = 'invalid' as any;
      expect(preferences.containers.viewMode).toBe('table');
    });
  });

  describe('security', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('security');
      expect(mode.value).toBe(DEFAULTS.views.security.mode);
    });

    it('should read from preferences.views.security.mode', () => {
      preferences.views.security.mode = 'cards';
      const mode = useViewMode('security');
      expect(mode.value).toBe('cards');
    });

    it('should write to preferences.views.security.mode', () => {
      const mode = useViewMode('security');
      mode.value = 'list';
      expect(preferences.views.security.mode).toBe('list');
    });
  });

  describe('audit', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('audit');
      expect(mode.value).toBe(DEFAULTS.views.audit.mode);
    });

    it('should read from preferences.views.audit.mode', () => {
      preferences.views.audit.mode = 'list';
      const mode = useViewMode('audit');
      expect(mode.value).toBe('list');
    });

    it('should write to preferences.views.audit.mode', () => {
      const mode = useViewMode('audit');
      mode.value = 'cards';
      expect(preferences.views.audit.mode).toBe('cards');
    });
  });

  describe('agents', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('agents');
      expect(mode.value).toBe(DEFAULTS.views.agents.mode);
    });

    it('should read from preferences.views.agents.mode', () => {
      preferences.views.agents.mode = 'cards';
      const mode = useViewMode('agents');
      expect(mode.value).toBe('cards');
    });

    it('should write to preferences.views.agents.mode', () => {
      const mode = useViewMode('agents');
      mode.value = 'list';
      expect(preferences.views.agents.mode).toBe('list');
    });
  });

  describe('triggers', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('triggers');
      expect(mode.value).toBe(DEFAULTS.views.triggers.mode);
    });

    it('should read and write view mode', () => {
      const mode = useViewMode('triggers');
      mode.value = 'cards';
      expect(preferences.views.triggers.mode).toBe('cards');
      expect(mode.value).toBe('cards');
    });
  });

  describe('watchers', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('watchers');
      expect(mode.value).toBe(DEFAULTS.views.watchers.mode);
    });

    it('should read and write view mode', () => {
      const mode = useViewMode('watchers');
      mode.value = 'list';
      expect(preferences.views.watchers.mode).toBe('list');
      expect(mode.value).toBe('list');
    });
  });

  describe('servers', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('servers');
      expect(mode.value).toBe(DEFAULTS.views.servers.mode);
    });

    it('should read and write view mode', () => {
      const mode = useViewMode('servers');
      mode.value = 'cards';
      expect(preferences.views.servers.mode).toBe('cards');
      expect(mode.value).toBe('cards');
    });
  });

  describe('registries', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('registries');
      expect(mode.value).toBe(DEFAULTS.views.registries.mode);
    });

    it('should read and write view mode', () => {
      const mode = useViewMode('registries');
      mode.value = 'list';
      expect(preferences.views.registries.mode).toBe('list');
      expect(mode.value).toBe('list');
    });
  });

  describe('notifications', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('notifications');
      expect(mode.value).toBe(DEFAULTS.views.notifications.mode);
    });

    it('should read and write view mode', () => {
      const mode = useViewMode('notifications');
      mode.value = 'cards';
      expect(preferences.views.notifications.mode).toBe('cards');
      expect(mode.value).toBe('cards');
    });
  });

  describe('auth', () => {
    it('should return the default view mode', () => {
      const mode = useViewMode('auth');
      expect(mode.value).toBe(DEFAULTS.views.auth.mode);
    });

    it('should read and write view mode', () => {
      const mode = useViewMode('auth');
      mode.value = 'list';
      expect(preferences.views.auth.mode).toBe('list');
      expect(mode.value).toBe('list');
    });
  });

  describe('cross-view isolation', () => {
    it('should not affect other views when changing one', () => {
      const security = useViewMode('security');
      const audit = useViewMode('audit');
      const agents = useViewMode('agents');

      security.value = 'cards';
      expect(audit.value).toBe('table');
      expect(agents.value).toBe('table');
    });

    it('should not affect containers when changing a view', () => {
      const containers = useViewMode('containers');
      const triggers = useViewMode('triggers');

      triggers.value = 'list';
      expect(containers.value).toBe('table');
    });
  });
});
