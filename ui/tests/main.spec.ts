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

vi.mock('@/router', () => ({
  default: mocks.router,
}));

async function importMain() {
  await import('@/main');
  await Promise.resolve();
  await Promise.resolve();
}

describe('main bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.createApp.mockClear();
    mocks.disableIconifyApi.mockClear();
    mocks.getSettings.mockReset();
    mocks.registerIcons.mockClear();
    mocks.app.component.mockClear();
    mocks.app.directive.mockClear();
    mocks.app.use.mockClear();
    mocks.app.mount.mockClear();
    mocks.createApp.mockReturnValue(mocks.app as never);
    localStorage.clear();
  });

  it('registers core components and disables iconify API when internetless mode is enabled', async () => {
    mocks.getSettings.mockResolvedValueOnce({ internetlessMode: true });

    await importMain();

    expect(mocks.registerIcons).toHaveBeenCalledTimes(1);
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
    const setPropertySpy = vi.spyOn(document.documentElement.style, 'setProperty');
    mocks.getSettings.mockResolvedValueOnce({ internetlessMode: false });
    localStorage.setItem('dd-preferences', JSON.stringify({ appearance: { fontSize: 1.25 } }));

    await importMain();

    expect(setPropertySpy).toHaveBeenCalledWith('--dd-font-size', '1.25');
    setPropertySpy.mockRestore();
  });
});
