import { getSecurityRuntime, getServer, getServerIcon } from '@/services/server';

global.fetch = vi.fn();

describe('Server Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  it('returns server icon', () => {
    expect(getServerIcon()).toBe('sh-server');
  });

  it('fetches server configuration', async () => {
    const payload = { configuration: { port: 3000 } };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as any);

    const result = await getServer();

    expect(fetch).toHaveBeenCalledWith('/api/server', { credentials: 'include' });
    expect(result).toEqual(payload);
  });

  it('fetches security runtime status', async () => {
    const payload = { ready: true };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as any);

    const result = await getSecurityRuntime();

    expect(fetch).toHaveBeenCalledWith('/api/server/security/runtime', {
      credentials: 'include',
    });
    expect(result).toEqual(payload);
  });

  it('throws with API error details when runtime call fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      json: vi.fn().mockResolvedValue({ error: 'missing trivy' }),
    } as any);

    await expect(getSecurityRuntime()).rejects.toThrow(
      'Failed to get security runtime status: Bad Request (missing trivy)',
    );
  });
});
