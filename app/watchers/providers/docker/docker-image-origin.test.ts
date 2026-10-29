import { getDaemonApiVersion, isLocallyBuiltImage } from './docker-image-origin.js';

describe('getDaemonApiVersion', () => {
  test('uses the version docker-modem is pinned to', async () => {
    const version = vi.fn();
    await expect(
      getDaemonApiVersion({ modem: { version: 'v1.54' }, version } as any),
    ).resolves.toBe('1.54');
    expect(version).not.toHaveBeenCalled();
  });

  test('asks the daemon when unversioned and caches the answer per client', async () => {
    const version = vi.fn().mockResolvedValue({ ApiVersion: '1.53' });
    const api: any = { modem: {}, version };
    await expect(getDaemonApiVersion(api)).resolves.toBe('1.53');
    await expect(getDaemonApiVersion(api)).resolves.toBe('1.53');
    expect(version).toHaveBeenCalledTimes(1);
  });

  test('returns undefined without caching when the lookup fails or has no ApiVersion', async () => {
    const version = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ApiVersion: '1.53' });
    const api: any = { version };
    await expect(getDaemonApiVersion(api)).resolves.toBeUndefined();
    await expect(getDaemonApiVersion(api)).resolves.toBeUndefined();
    await expect(getDaemonApiVersion(api)).resolves.toBe('1.53');
  });

  test('returns undefined when the client cannot report a version', async () => {
    await expect(getDaemonApiVersion(undefined)).resolves.toBeUndefined();
    await expect(getDaemonApiVersion({} as any)).resolves.toBeUndefined();
  });
});

describe('isLocallyBuiltImage', () => {
  const api = (v: string) => ({ modem: { version: `v${v}` } }) as any;

  test('Identity.Pull wins over everything', async () => {
    await expect(
      isLocallyBuiltImage(api('1.53'), { Identity: { Pull: [{ Repository: 'x' }] } }, false),
    ).resolves.toBe(false);
  });

  test.each([[{ Build: [{}] }], [{ Signature: [{}] }], [{ Pull: [] }]])(
    'Identity without Pull entries is local (%j)',
    async (identity) => {
      await expect(isLocallyBuiltImage(api('1.53'), { Identity: identity }, true)).resolves.toBe(
        true,
      );
    },
  );

  test('no Identity, Descriptor and API 1.53 or newer is local', async () => {
    await expect(isLocallyBuiltImage(api('1.54'), { Descriptor: {} }, true)).resolves.toBe(true);
    await expect(isLocallyBuiltImage(api('1.100'), { Descriptor: {} }, true)).resolves.toBe(true);
  });

  test('no Identity, Descriptor but unknown or older API falls back to RepoDigests', async () => {
    await expect(isLocallyBuiltImage(api('1.52'), { Descriptor: {} }, true)).resolves.toBe(false);
    await expect(isLocallyBuiltImage({} as any, { Descriptor: {} }, false)).resolves.toBe(true);
  });

  test('classic store keeps the RepoDigests rule without asking for the version', async () => {
    const version = vi.fn();
    await expect(isLocallyBuiltImage({ version } as any, {}, false)).resolves.toBe(true);
    await expect(isLocallyBuiltImage({ version } as any, {}, true)).resolves.toBe(false);
    expect(version).not.toHaveBeenCalled();
  });
});
