const mocks = vi.hoisted(() => ({
  addIcon: vi.fn(),
  setAPIModule: vi.fn(),
}));

vi.mock('iconify-icon', () => ({
  addIcon: mocks.addIcon,
  _api: {
    setAPIModule: mocks.setAPIModule,
  },
}));

import { disableIconifyApi, registerIcons } from '@/boot/icons';

describe('icon boot helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('registers bundled icons with iconify', () => {
    registerIcons();

    expect(mocks.addIcon).toHaveBeenCalled();
    const [name, payload] = mocks.addIcon.mock.calls[0];
    expect(typeof name).toBe('string');
    expect(payload).toEqual(
      expect.objectContaining({
        body: expect.any(String),
      }),
    );
  });

  it('installs a no-op API module for offline mode', () => {
    disableIconifyApi();

    expect(mocks.setAPIModule).toHaveBeenCalledTimes(1);
    const [provider, module] = mocks.setAPIModule.mock.calls[0] as [
      string,
      {
        prepare: (provider: string, prefix: string, icons: string[]) => unknown[];
        send: (host: string, params: unknown, callback: unknown) => void;
      },
    ];

    expect(provider).toBe('');
    expect(module.prepare('p', 'i', ['a'])).toEqual([]);
    expect(() => module.send('host', {}, () => undefined)).not.toThrow();
  });
});
