const mocks = vi.hoisted(() => {
  const app = {
    component: vi.fn(),
    directive: vi.fn(),
    use: vi.fn(),
    mount: vi.fn(),
  };

  return {
    app,
    createApp: vi.fn(() => app),
    disableIconifyApi: vi.fn(),
    getSettings: vi.fn(),
    loadServerFeatures: vi.fn().mockResolvedValue(undefined),
    registerIcons: vi.fn(),
    router: { __name: 'router' },
  };
});

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return {
    ...actual,
    createApp: mocks.createApp,
  };
});

vi.mock('@/boot/icons', () => ({
  disableIconifyApi: mocks.disableIconifyApi,
  registerIcons: mocks.registerIcons,
}));

vi.mock('@/services/settings', () => ({
  getSettings: mocks.getSettings,
}));

vi.mock('@/composables/useServerFeatures', () => ({
  loadServerFeatures: mocks.loadServerFeatures,
}));

vi.mock('@/router', () => ({
  default: mocks.router,
}));

async function importMain() {
  await import('@/main');
  await Promise.resolve();
  await Promise.resolve();
}

describe('main bootstrap', {
  timeout: 15_000,
}, () => {
  const fontSizeClasses = [
    'dd-font-size-80',
    'dd-font-size-85',
    'dd-font-size-90',
    'dd-font-size-95',
    'dd-font-size-100',
    'dd-font-size-105',
    'dd-font-size-110',
    'dd-font-size-115',
    'dd-font-size-120',
    'dd-font-size-125',
    'dd-font-size-130',
  ];
  const radiusClasses = [
    'dd-radius-none',
    'dd-radius-sharp',
    'dd-radius-modern',
    'dd-radius-soft',
    'dd-radius-round',
  ];

  beforeEach(() => {
    vi.resetModules();
    mocks.createApp.mockClear();
    mocks.disableIconifyApi.mockClear();
    mocks.getSettings.mockReset();
    mocks.loadServerFeatures.mockClear();
    mocks.registerIcons.mockClear();
    mocks.app.component.mockClear();
    mocks.app.directive.mockClear();
    mocks.app.use.mockClear();
    mocks.app.mount.mockClear();
    mocks.createApp.mockReturnValue(mocks.app as never);
    localStorage.clear();
    document.documentElement.classList.remove(...fontSizeClasses, ...radiusClasses);
  });

  it('registers core components and disables iconify API when internetless mode is enabled', async () => {
    mocks.getSettings.mockResolvedValueOnce({ internetlessMode: true });

    await importMain();

    expect(mocks.registerIcons).toHaveBeenCalledTimes(1);
    expect(mocks.loadServerFeatures).toHaveBeenCalledTimes(1);
    expect(mocks.disableIconifyApi).toHaveBeenCalledTimes(1);
    expect(mocks.createApp).toHaveBeenCalledTimes(1);
    expect(mocks.app.component).toHaveBeenCalledWith('AppIcon', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('AppLayout', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('ContainerIcon', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('ThemeToggle', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('ToggleSwitch', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('DataFilterBar', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('DataTable', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('DataCardGrid', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('DataListAccordion', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('DataViewLayout', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('DetailPanel', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('EmptyState', expect.anything());
    expect(mocks.app.component).toHaveBeenCalledWith('ConfirmDialog', expect.anything());
    expect(mocks.app.directive).toHaveBeenCalledWith('tooltip', expect.anything());
    expect(mocks.app.use).toHaveBeenCalledWith(mocks.router);
    expect(mocks.app.mount).toHaveBeenCalledWith('#app');
  });

  it('keeps iconify API enabled when internetless mode is false', async () => {
    mocks.getSettings.mockResolvedValueOnce({ internetlessMode: false });

    await importMain();

    expect(mocks.registerIcons).toHaveBeenCalledTimes(1);
    expect(mocks.disableIconifyApi).not.toHaveBeenCalled();
  });

  it('swallows settings-loading failures during startup', async () => {
    mocks.getSettings.mockRejectedValueOnce(new Error('settings unavailable'));

    await expect(importMain()).resolves.toBeUndefined();
    expect(mocks.registerIcons).toHaveBeenCalledTimes(1);
    expect(mocks.disableIconifyApi).not.toHaveBeenCalled();
  });

  it('applies persisted non-default font size before mount', async () => {
    mocks.getSettings.mockResolvedValueOnce({ internetlessMode: false });
    localStorage.setItem('dd-preferences', JSON.stringify({ appearance: { fontSize: 1.25 } }));

    await importMain();

    expect(document.documentElement.classList.contains('dd-font-size-125')).toBe(true);
    expect(document.documentElement.classList.contains('dd-font-size-100')).toBe(false);
  });

  it('skips invalid persisted font size values', async () => {
    vi.doMock('@/preferences/validators', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/preferences/validators')>();
      return {
        ...actual,
        isValidFontSize: vi.fn(() => false),
      };
    });

    mocks.getSettings.mockResolvedValueOnce({ internetlessMode: false });
    localStorage.setItem('dd-preferences', JSON.stringify({ appearance: { fontSize: 9 } }));

    try {
      await importMain();

      const hasFontSizeClass = fontSizeClasses.some((name) =>
        document.documentElement.classList.contains(name),
      );
      expect(hasFontSizeClass).toBe(false);
    } finally {
      vi.doUnmock('@/preferences/validators');
    }
  });

  it('applies persisted non-sharp radius before mount', async () => {
    mocks.getSettings.mockResolvedValueOnce({ internetlessMode: false });
    localStorage.setItem('dd-preferences', JSON.stringify({ appearance: { radius: 'soft' } }));

    await importMain();

    expect(document.documentElement.classList.contains('dd-radius-soft')).toBe(true);
    expect(document.documentElement.classList.contains('dd-radius-sharp')).toBe(false);
  });
});
