import { setTestPreferences } from '../helpers/preferences';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.unstubAllGlobals();
    document.documentElement.className = '';
    document.documentElement.style.removeProperty('--x');
    document.documentElement.style.removeProperty('--y');
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

    it('should load saved family from preferences', async () => {
      setTestPreferences({ theme: { family: 'github' } });
      const { themeFamily } = await loadUseTheme();
      expect(themeFamily.value).toBe('github');
    });

    it('should use default for invalid preference values', async () => {
      setTestPreferences({ theme: { family: 'nonexistent' } });
      const { themeFamily } = await loadUseTheme();
      expect(themeFamily.value).toBe('drydock');
    });
  });

  describe('themeVariant', () => {
    it('should default to dark', async () => {
      const { themeVariant } = await loadUseTheme();
      expect(themeVariant.value).toBe('dark');
    });

    it('should load saved variant from preferences', async () => {
      setTestPreferences({ theme: { variant: 'light' } });
      const { themeVariant } = await loadUseTheme();
      expect(themeVariant.value).toBe('light');
    });

    it('should use default for invalid variant values from preferences', async () => {
      setTestPreferences({ theme: { variant: 'midnight' } });
      const { themeVariant } = await loadUseTheme();
      expect(themeVariant.value).toBe('dark');
    });
  });

  describe('setThemeFamily', () => {
    it('should update family and persist', async () => {
      const { themeFamily, setThemeFamily } = await loadUseTheme();
      setThemeFamily('dracula');
      expect(themeFamily.value).toBe('dracula');
      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      expect(JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').theme.family).toBe(
        'dracula',
      );
    });
  });

  describe('setThemeVariant', () => {
    it('should update variant and persist', async () => {
      const { themeVariant, setThemeVariant } = await loadUseTheme();
      setThemeVariant('light');
      expect(themeVariant.value).toBe('light');
      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      expect(JSON.parse(localStorage.getItem('dd-preferences') ?? '{}').theme.variant).toBe(
        'light',
      );
    });
  });

  describe('toggleVariant', () => {
    it('should cycle dark -> light -> system -> dark', async () => {
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

  describe('transitionTheme', () => {
    it('applies changes immediately when startViewTransition is unavailable', async () => {
      Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        value: undefined,
      });

      const { transitionTheme, setThemeFamily } = await loadUseTheme();
      await transitionTheme(() => {
        setThemeFamily('github');
      });

      expect(document.documentElement.classList.contains('theme-github')).toBe(true);
      expect(document.documentElement.classList.contains('dd-transitioning')).toBe(false);
    });

    it('runs view transition callbacks and cleans up transition classes', async () => {
      const startViewTransition = vi.fn((change: () => void) => {
        change();
        return { finished: Promise.resolve() };
      });
      Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        value: startViewTransition,
      });

      const { transitionTheme, setThemeFamily } = await loadUseTheme();
      await transitionTheme(
        () => {
          setThemeFamily('catppuccin');
        },
        { clientX: 40, clientY: 80 } as MouseEvent,
      );

      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(document.documentElement.style.getPropertyValue('--x')).toBe('40px');
      expect(document.documentElement.style.getPropertyValue('--y')).toBe('80px');
      expect(document.documentElement.classList.contains('theme-catppuccin')).toBe(true);
      expect(document.documentElement.classList.contains('dd-transitioning')).toBe(false);
    });

    it('swallows aborted view transition promises and still cleans up state', async () => {
      const startViewTransition = vi.fn((change: () => void) => {
        change();
        return { finished: Promise.reject(new Error('aborted')) };
      });
      Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        value: startViewTransition,
      });

      const { transitionTheme, setThemeVariant } = await loadUseTheme();
      await expect(
        transitionTheme(() => {
          setThemeVariant('light');
        }),
      ).resolves.toBeUndefined();

      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dd-transitioning')).toBe(false);
    });
  });

  describe('system preference listener', () => {
    function setupMatchMedia(matches = false) {
      const listeners: Array<(event: { matches: boolean }) => void> = [];
      const mediaQueryList = {
        matches,
        addEventListener: vi.fn((_event: string, callback: (event: { matches: boolean }) => void) =>
          listeners.push(callback),
        ),
      };
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => mediaQueryList),
      );
      return listeners;
    }

    it('uses transition path when system mode receives a change event', async () => {
      const listeners = setupMatchMedia(false);
      const startViewTransition = vi.fn((change: () => void) => {
        change();
        return { finished: Promise.resolve() };
      });
      Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        value: startViewTransition,
      });

      const { setThemeVariant, resolvedVariant } = await loadUseTheme();
      setThemeVariant('system');
      listeners[0]?.({ matches: true });

      expect(startViewTransition).toHaveBeenCalledOnce();
      expect(resolvedVariant.value).toBe('dark');
    });

    it('updates cached system state without transition when not in system mode', async () => {
      const listeners = setupMatchMedia(true);
      const { setThemeVariant, resolvedVariant } = await loadUseTheme();

      setThemeVariant('light');
      listeners[0]?.({ matches: false });
      expect(resolvedVariant.value).toBe('light');

      setThemeVariant('system');
      expect(resolvedVariant.value).toBe('light');
    });
  });

  describe('applyClasses', () => {
    it('should add dark class to html element', async () => {
      await loadUseTheme();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should add light class when variant is light', async () => {
      setTestPreferences({ theme: { variant: 'light' } });
      await loadUseTheme();
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });

    it('should add theme-{family} class for non-drydock families', async () => {
      setTestPreferences({ theme: { family: 'github' } });
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
      setTestPreferences({ theme: { family: 'catppuccin', variant: 'light' } });

      await loadUseTheme();

      const classes = Array.from(document.documentElement.classList);
      expect(classes).toContain('theme-catppuccin');
      expect(classes).toContain('light');
      expect(classes).not.toContain('theme-github');
      expect(classes).not.toContain('dark');
    });
  });
});
