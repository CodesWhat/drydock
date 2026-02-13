import {
  getAllAuthentications,
  getAuthenticationIcon,
  getAuthProviderIcon,
} from '@/services/authentication';

global.fetch = vi.fn();

describe('Authentication Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  it('returns the default authentication icon', () => {
    expect(getAuthenticationIcon()).toBe('fas fa-lock');
  });

  it('returns provider icon for known authentication types', () => {
    expect(getAuthProviderIcon('basic')).toBe('fas fa-key');
    expect(getAuthProviderIcon('oidc')).toBe('fas fa-openid');
    expect(getAuthProviderIcon('anonymous')).toBe('fas fa-user-secret');
  });

  it('falls back to lock icon for unknown authentication types', () => {
    expect(getAuthProviderIcon('unsupported')).toBe('fas fa-lock');
    expect(getAuthProviderIcon(undefined)).toBe('fas fa-lock');
  });

  it('fetches all authentications', async () => {
    const mockAuthentications = [{ name: 'local-basic', type: 'basic' }];
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAuthentications,
    } as any);

    const result = await getAllAuthentications();

    expect(fetch).toHaveBeenCalledWith('/api/authentications', {
      credentials: 'include',
    });
    expect(result).toEqual(mockAuthentications);
  });
});
