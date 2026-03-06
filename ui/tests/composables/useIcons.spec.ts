import { nextTick } from 'vue';
import { setTestPreferences } from '../helpers/preferences';

describe('useIcons', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  async function loadUseIcons() {
    const mod = await import('@/composables/useIcons');
    return mod.useIcons();
  }

  describe('iconLibrary', () => {
    it('should default to ph-duotone', async () => {
      const { iconLibrary } = await loadUseIcons();
      expect(iconLibrary.value).toBe('ph-duotone');
    });

    it('should load saved library from preferences', async () => {
      setTestPreferences({ icons: { library: 'lucide' } });
      const { iconLibrary } = await loadUseIcons();
      expect(iconLibrary.value).toBe('lucide');
    });

    it('should fall back to default when preference value is invalid', async () => {
      setTestPreferences({ icons: { library: 'invalid-lib' } });
      const { iconLibrary } = await loadUseIcons();
      expect(iconLibrary.value).toBe('ph-duotone');
    });
  });

  describe('setIconLibrary', () => {
    it('should update iconLibrary and persist to preferences', async () => {
      const { iconLibrary, setIconLibrary } = await loadUseIcons();
      setIconLibrary('tabler');
      await nextTick();
      expect(iconLibrary.value).toBe('tabler');
      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      expect(JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').icons.library).toBe(
        'tabler',
      );
    });
  });

  describe('iconScale', () => {
    it('should default to 1', async () => {
      const { iconScale } = await loadUseIcons();
      expect(iconScale.value).toBe(1);
    });

    it('should load saved scale from preferences', async () => {
      setTestPreferences({ icons: { scale: 1.2 } });
      const { iconScale } = await loadUseIcons();
      expect(iconScale.value).toBe(1.2);
    });

    it('should pass through out-of-range scale values from preferences', async () => {
      setTestPreferences({ icons: { scale: 5.0 } });
      const { iconScale } = await loadUseIcons();
      expect(iconScale.value).toBe(5.0);
    });

    it('should pass through below-minimum scale values from preferences', async () => {
      setTestPreferences({ icons: { scale: 0.5 } });
      const { iconScale } = await loadUseIcons();
      expect(iconScale.value).toBe(0.5);
    });
  });

  describe('setIconScale', () => {
    it('should update scale and persist to preferences', async () => {
      const { iconScale, setIconScale } = await loadUseIcons();
      setIconScale(1.3);
      await nextTick();
      expect(iconScale.value).toBe(1.3);
      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      expect(JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').icons.scale).toBe(1.3);
    });
  });

  describe('icon', () => {
    it('should resolve icon name via current library', async () => {
      const { icon } = await loadUseIcons();
      const resolved = icon('dashboard');
      expect(resolved).toBe('ph:squares-four-duotone');
    });

    it('should return raw name for unknown icons', async () => {
      const { icon } = await loadUseIcons();
      expect(icon('nonexistent-icon')).toBe('nonexistent-icon');
    });

    it('should resolve via selected library after switch', async () => {
      const { icon, setIconLibrary } = await loadUseIcons();
      setIconLibrary('lucide');
      expect(icon('dashboard')).toBe('lucide:layout-dashboard');
    });
  });
});
