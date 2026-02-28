describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    document.documentElement.className = '';
  });

  async function loadUseTheme() {
    const mod = await import('@/theme/useTheme');
    return mod.useTheme();
  }

  describe('themeFamily', () => {
    it('should default to drydock', async () => {
      const { themeFamily } = await loadUseTheme();
      expect(themeFamily.value).toBe('drydock');
    });

    it('should load saved family from localStorage', async () => {
      localStorage.setItem('drydock-theme-family', 'github');
      const { themeFamily } = await loadUseTheme();
      expect(themeFamily.value).toBe('github');
    });

    it('should ignore invalid localStorage values', async () => {
      localStorage.setItem('drydock-theme-family', 'nonexistent');
      const { themeFamily } = await loadUseTheme();
      expect(themeFamily.value).toBe('drydock');
    });
  });

  describe('themeVariant', () => {
    it('should default to dark', async () => {
      const { themeVariant } = await loadUseTheme();
      expect(themeVariant.value).toBe('dark');
    });

    it('should load saved variant from localStorage', async () => {
      localStorage.setItem('drydock-theme-variant', 'light');
      const { themeVariant } = await loadUseTheme();
      expect(themeVariant.value).toBe('light');
    });

    it('should ignore invalid variant values', async () => {
      localStorage.setItem('drydock-theme-variant', 'midnight');
      const { themeVariant } = await loadUseTheme();
      expect(themeVariant.value).toBe('dark');
    });
  });

  describe('setThemeFamily', () => {
    it('should update family and persist', async () => {
      const { themeFamily, setThemeFamily } = await loadUseTheme();
      setThemeFamily('dracula');
      expect(themeFamily.value).toBe('dracula');
      expect(localStorage.getItem('drydock-theme-family')).toBe('dracula');
    });
  });

  describe('setThemeVariant', () => {
    it('should update variant and persist', async () => {
      const { themeVariant, setThemeVariant } = await loadUseTheme();
      setThemeVariant('light');
      expect(themeVariant.value).toBe('light');
      expect(localStorage.getItem('drydock-theme-variant')).toBe('light');
    });
  });

  describe('toggleVariant', () => {
    it('should cycle dark → light → system → dark', async () => {
      const { themeVariant, toggleVariant } = await loadUseTheme();
      expect(themeVariant.value).toBe('dark');

      toggleVariant();
      expect(themeVariant.value).toBe('light');

      toggleVariant();
      expect(themeVariant.value).toBe('system');

      toggleVariant();
      expect(themeVariant.value).toBe('dark');
    });
  });

  describe('resolvedVariant', () => {
    it('should resolve dark when variant is dark', async () => {
      const { resolvedVariant } = await loadUseTheme();
      expect(resolvedVariant.value).toBe('dark');
    });

    it('should resolve light when variant is light', async () => {
      const { setThemeVariant, resolvedVariant } = await loadUseTheme();
      setThemeVariant('light');
      expect(resolvedVariant.value).toBe('light');
    });
  });

  describe('isDark', () => {
    it('should be true in dark mode', async () => {
      const { isDark } = await loadUseTheme();
      expect(isDark.value).toBe(true);
    });

    it('should be false in light mode', async () => {
      const { isDark, setThemeVariant } = await loadUseTheme();
      setThemeVariant('light');
      expect(isDark.value).toBe(false);
    });
  });

  describe('applyClasses', () => {
    it('should add dark class to html element', async () => {
      await loadUseTheme();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should add light class when variant is light', async () => {
      localStorage.setItem('drydock-theme-variant', 'light');
      await loadUseTheme();
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });

    it('should add theme-{family} class for non-drydock families', async () => {
      localStorage.setItem('drydock-theme-family', 'github');
      await loadUseTheme();
      expect(document.documentElement.classList.contains('theme-github')).toBe(true);
    });

    it('should not add theme- class for drydock family', async () => {
      await loadUseTheme();
      const classes = Array.from(document.documentElement.classList);
      expect(classes.some((c) => c.startsWith('theme-'))).toBe(false);
    });

    it('should replace stale theme and variant classes when applying current state', async () => {
      document.documentElement.className = 'theme-github dark stale';
      localStorage.setItem('drydock-theme-family', 'catppuccin');
      localStorage.setItem('drydock-theme-variant', 'light');

      await loadUseTheme();

      const classes = Array.from(document.documentElement.classList);
      expect(classes).toContain('theme-catppuccin');
      expect(classes).toContain('light');
      expect(classes).not.toContain('theme-github');
      expect(classes).not.toContain('dark');
    });
  });
});
