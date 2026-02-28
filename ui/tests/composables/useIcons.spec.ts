import { nextTick } from 'vue';

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

    it('should load saved library from localStorage', async () => {
      localStorage.setItem('drydock-icon-library-v1', 'lucide');
      const { iconLibrary } = await loadUseIcons();
      expect(iconLibrary.value).toBe('lucide');
    });

    it('should ignore invalid localStorage values', async () => {
      localStorage.setItem('drydock-icon-library-v1', 'invalid-lib');
      const { iconLibrary } = await loadUseIcons();
      expect(iconLibrary.value).toBe('ph-duotone');
    });
  });

  describe('setIconLibrary', () => {
    it('should update iconLibrary and persist to localStorage', async () => {
      const { iconLibrary, setIconLibrary } = await loadUseIcons();
      setIconLibrary('tabler');
      await nextTick();
      expect(iconLibrary.value).toBe('tabler');
      expect(localStorage.getItem('drydock-icon-library-v1')).toBe('tabler');
    });
  });

  describe('iconScale', () => {
    it('should default to 1', async () => {
      const { iconScale } = await loadUseIcons();
      expect(iconScale.value).toBe(1);
    });

    it('should load saved scale from localStorage', async () => {
      localStorage.setItem('drydock-icon-scale-v1', '1.2');
      const { iconScale } = await loadUseIcons();
      expect(iconScale.value).toBe(1.2);
    });

    it('should reject out-of-range scale values', async () => {
      localStorage.setItem('drydock-icon-scale-v1', '5.0');
      const { iconScale } = await loadUseIcons();
      expect(iconScale.value).toBe(1);
    });

    it('should reject scale below minimum', async () => {
      localStorage.setItem('drydock-icon-scale-v1', '0.5');
      const { iconScale } = await loadUseIcons();
      expect(iconScale.value).toBe(1);
    });
  });

  describe('setIconScale', () => {
    it('should update scale and persist to localStorage', async () => {
      const { iconScale, setIconScale } = await loadUseIcons();
      setIconScale(1.3);
      await nextTick();
      expect(iconScale.value).toBe(1.3);
      expect(localStorage.getItem('drydock-icon-scale-v1')).toBe('1.3');
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
