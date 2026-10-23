import { GatewayUnavailableError, useConnectivity } from '@/composables/useConnectivity';
import { withLastKnown } from '@/services/last-known';
import { readLastKnown, saveLastKnown } from '@/utils/last-known';

describe('withLastKnown', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns live data and remembers it', async () => {
    const result = await withLastKnown('containers', async () => [{ id: 'live' }]);

    expect(result).toEqual([{ id: 'live' }]);
    expect(readLastKnown('containers')?.data).toEqual([{ id: 'live' }]);
  });

  it('never serves the saved copy while the server answers', async () => {
    saveLastKnown('containers', [{ id: 'old' }]);

    await expect(
      withLastKnown('containers', async () => {
        throw new Error('Failed to get containers: Internal Server Error');
      }),
    ).rejects.toThrow('Internal Server Error');
    await expect(withLastKnown('containers', async () => [{ id: 'new' }])).resolves.toEqual([
      { id: 'new' },
    ]);
  });

  it('serves the saved copy after a network failure and records its age', async () => {
    const savedAt = Date.now() - 60_000;
    saveLastKnown('agents', [{ name: 'a' }], savedAt);
    const { lastKnownAt } = useConnectivity();

    const result = await withLastKnown('agents', async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(result).toEqual([{ name: 'a' }]);
    expect(lastKnownAt.value).toBe(savedAt);
  });

  it('serves the saved copy when a reverse proxy answers 502/503/504', async () => {
    saveLastKnown('registries', [{ name: 'r' }]);

    const result = await withLastKnown('registries', async () => {
      throw new GatewayUnavailableError(502);
    });

    expect(result).toEqual([{ name: 'r' }]);
  });

  it('rethrows a network failure when nothing was saved', async () => {
    await expect(
      withLastKnown('watchers', async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('does not mask aborts', async () => {
    saveLastKnown('registries', [1]);

    await expect(
      withLastKnown('registries', async () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    ).rejects.toThrow('aborted');
  });
});
