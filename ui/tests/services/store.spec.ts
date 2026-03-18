import { getStore } from '@/services/store';

global.fetch = vi.fn();

describe('Store Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  it('fetches store configuration', async () => {
    const payload = { configuration: { path: '/store', file: 'dd.json' } };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as any);

    const result = await getStore();

    expect(fetch).toHaveBeenCalledWith('/api/v1/store', { credentials: 'include' });
    expect(result).toEqual(payload);
  });

  it('throws when fetching store configuration fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as any);

    await expect(getStore()).rejects.toThrow('Failed to get store: Internal Server Error');
  });
});
