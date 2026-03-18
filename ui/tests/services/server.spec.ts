import { getSecurityRuntime, getServer } from '@/services/server';

global.fetch = vi.fn();

describe('Server Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  it('fetches server configuration', async () => {
    const payload = { configuration: { port: 3000 } };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as any);

    const result = await getServer();

    expect(fetch).toHaveBeenCalledWith('/api/v1/server', { credentials: 'include' });
    expect(result).toEqual(payload);
  });

  it('throws when fetching server configuration fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as any);

    await expect(getServer()).rejects.toThrow('Failed to get server: Internal Server Error');
  });

  it('fetches security runtime status', async () => {
    const payload = { ready: true };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    } as any);

    const result = await getSecurityRuntime();

    expect(fetch).toHaveBeenCalledWith('/api/v1/server/security/runtime', {
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

  it('throws without error details when response body has no error field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      json: vi.fn().mockResolvedValue({ message: 'something else' }),
    } as any);

    await expect(getSecurityRuntime()).rejects.toThrow(
      'Failed to get security runtime status: Bad Request',
    );
  });

  it('throws with status text only when response body is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    } as any);

    await expect(getSecurityRuntime()).rejects.toThrow(
      'Failed to get security runtime status: Internal Server Error',
    );
  });
});
