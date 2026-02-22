import {
  getAllAuthentications,
  getAuthenticationIcon,
  getAuthProviderColor,
  getAuthProviderIcon,
} from '@/services/authentication';

global.fetch = vi.fn();

describe('Authentication Service', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
  });

  it('returns the default authentication icon', () => {
    expect(getAuthenticationIcon()).toBe('sh-lock');
  });

  it('returns provider icon for known authentication types', () => {
    expect(getAuthProviderIcon('basic')).toBe('sh-key');
    expect(getAuthProviderIcon('oidc')).toBe('sh-openid');
    expect(getAuthProviderIcon('anonymous')).toBe('sh-user-secret');
  });

  it('falls back to lock icon for unknown authentication types', () => {
    expect(getAuthProviderIcon('unsupported')).toBe('sh-lock');
    expect(getAuthProviderIcon(undefined)).toBe('sh-lock');
  });

  it('returns provider color for known authentication types', () => {
    expect(getAuthProviderColor('basic')).toBe('#F59E0B');
    expect(getAuthProviderColor('oidc')).toBe('#F97316');
    expect(getAuthProviderColor('anonymous')).toBe('#6B7280');
  });

  it('falls back to default color for unknown authentication types', () => {
    expect(getAuthProviderColor('unsupported')).toBe('#6B7280');
    expect(getAuthProviderColor(undefined)).toBe('#6B7280');
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
