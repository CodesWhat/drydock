describe('useFont', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    // Clean up any font link tags from previous tests
    document.querySelectorAll('link[data-font]').forEach((el) => el.remove());
    document.documentElement.style.removeProperty('--drydock-font');
    document.documentElement.style.removeProperty('--font-mono');
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

    it('should load saved font from localStorage', async () => {
      localStorage.setItem('drydock-font-family', 'jetbrains-mono');
      const { activeFont } = await loadUseFont();
      expect(activeFont.value).toBe('jetbrains-mono');
    });

    it('should ignore invalid localStorage values', async () => {
      localStorage.setItem('drydock-font-family', 'comic-sans-ms');
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
    it('should set both global font CSS variables on init', async () => {
      await loadUseFont();
      const drydockFont = document.documentElement.style.getPropertyValue('--drydock-font');
      const monoFont = document.documentElement.style.getPropertyValue('--font-mono');
      expect(drydockFont).toBe('"IBM Plex Mono", monospace');
      expect(monoFont).toBe('"IBM Plex Mono", monospace');
    });

    it('should apply saved font to both CSS variables on init', async () => {
      localStorage.setItem('drydock-font-family', 'jetbrains-mono');
      await loadUseFont();
      const drydockFont = document.documentElement.style.getPropertyValue('--drydock-font');
      const monoFont = document.documentElement.style.getPropertyValue('--font-mono');
      expect(drydockFont).toBe('"JetBrains Mono", monospace');
      expect(monoFont).toBe('"JetBrains Mono", monospace');
    });
  });
});
