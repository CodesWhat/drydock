import { setTestPreferences } from '../helpers/preferences';

describe('useFont', () => {
  const fontClasses = [
    'dd-font-ibm-plex-mono',
    'dd-font-jetbrains-mono',
    'dd-font-source-code-pro',
    'dd-font-inconsolata',
    'dd-font-commit-mono',
    'dd-font-comic-mono',
  ];

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    // Clean up any font link tags from previous tests
    document.querySelectorAll('link[data-font]').forEach((el) => el.remove());
    document.documentElement.classList.remove(...fontClasses);
  });

  async function loadUseFont() {
    const mod = await import('@/composables/useFont');
    return { ...mod.useFont(), fontOptions: mod.fontOptions };
  }

  describe('activeFont', () => {
    it('should default to ibm-plex-mono', async () => {
      const { activeFont } = await loadUseFont();
      expect(activeFont.value).toBe('ibm-plex-mono');
    });

    it('should load saved font from preferences', async () => {
      setTestPreferences({ font: { family: 'jetbrains-mono' } });
      const { activeFont } = await loadUseFont();
      expect(activeFont.value).toBe('jetbrains-mono');
    });

    it('should fall back to default when preference value is invalid', async () => {
      setTestPreferences({ font: { family: 'comic-sans-ms' } });
      const { activeFont } = await loadUseFont();
      expect(activeFont.value).toBe('ibm-plex-mono');
    });
  });

  describe('fontOptions', () => {
    it('should include all 6 fonts', async () => {
      const { fontOptions } = await loadUseFont();
      expect(fontOptions).toHaveLength(6);
    });

    it('should mark only ibm-plex-mono as bundled', async () => {
      const { fontOptions } = await loadUseFont();
      const bundled = fontOptions.filter((f) => f.bundled);
      expect(bundled).toHaveLength(1);
      expect(bundled[0].id).toBe('ibm-plex-mono');
    });

    it('should have valid family strings', async () => {
      const { fontOptions } = await loadUseFont();
      for (const f of fontOptions) {
        expect(f.family).toContain('monospace');
      }
    });
  });

  describe('isFontLoaded', () => {
    it('should return true for bundled font', async () => {
      const { isFontLoaded } = await loadUseFont();
      expect(isFontLoaded('ibm-plex-mono')).toBe(true);
    });

    it('should return false for non-loaded font', async () => {
      const { isFontLoaded } = await loadUseFont();
      expect(isFontLoaded('jetbrains-mono')).toBe(false);
    });
  });

  describe('applyFont', () => {
    it('should set the default font class on init', async () => {
      await loadUseFont();
      expect(document.documentElement.classList.contains('dd-font-ibm-plex-mono')).toBe(true);
    });

    it('should apply saved font class on init', async () => {
      setTestPreferences({ font: { family: 'jetbrains-mono' } });
      await loadUseFont();
      expect(document.documentElement.classList.contains('dd-font-jetbrains-mono')).toBe(true);
      expect(document.documentElement.classList.contains('dd-font-ibm-plex-mono')).toBe(false);
    });

    it('should not change classes for an unknown font id', async () => {
      const { applyFont } = (await import('@/composables/useFont')).useFont();
      document.documentElement.classList.remove(...fontClasses);
      applyFont('nonexistent-font' as any);
      expect(fontClasses.some((name) => document.documentElement.classList.contains(name))).toBe(
        false,
      );
    });
  });
});
