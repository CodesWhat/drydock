import {
  getOidcRedirection,
  getStrategies,
  getUser,
  loginBasic,
  logout,
  setRememberMe,
} from '@/services/auth';

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

describe('Auth Service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  describe('getUser', () => {
    it('returns user data when authenticated', async () => {
      const mockUser = { username: 'testuser', roles: ['admin'] };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const user = await getUser();

      expect(fetchMock).toHaveBeenCalledWith('/auth/user', {
        redirect: 'manual',
        credentials: 'include',
      });
      expect(user).toEqual(mockUser);
    });

    it('returns undefined when not authenticated', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const user = await getUser();

      expect(user).toBeUndefined();
    });

    it('handles network errors gracefully', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const user = await getUser();

      expect(user).toBeUndefined();
    });

    it('logs fallback error detail when thrown value is not an Error object', async () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      fetchMock.mockRejectedValueOnce('raw-network-error');

      try {
        const user = await getUser();
        expect(user).toBeUndefined();
        expect(debugSpy).toHaveBeenCalledWith('Unable to fetch current user: raw-network-error');
      } finally {
        debugSpy.mockRestore();
      }
    });
  });

  describe('loginBasic', () => {
    it('performs basic authentication successfully', async () => {
      const mockUser = { username: 'testuser' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const user = await loginBasic('testuser', 'testpass');

      expect(fetchMock).toHaveBeenCalledWith('/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: 'Basic dGVzdHVzZXI6dGVzdHBhc3M=', // base64 of testuser:testpass
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ remember: false }),
      });
      expect(user).toEqual(mockUser);
    });

    it('throws on login failure', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(loginBasic('testuser', 'wrongpass')).rejects.toThrow(
        'Username or password error',
      );
    });

    it('surfaces API error details for non-credential failures', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Basic auth 'ANDI': hash is required" }),
      });

      await expect(loginBasic('testuser', 'testpass')).rejects.toThrow(
        "Basic auth 'ANDI': hash is required",
      );
    });

    it('falls back to generic credential error when payload is not an object', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => 'not-an-object',
      });

      await expect(loginBasic('testuser', 'testpass')).rejects.toThrow(
        'Username or password error',
      );
    });

    it('falls back to generic credential error when payload has no error field', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'missing field' }),
      });

      await expect(loginBasic('testuser', 'testpass')).rejects.toThrow(
        'Username or password error',
      );
    });

    it('falls back to generic credential error when payload error is non-string', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'not-a-string' } }),
      });

      await expect(loginBasic('testuser', 'testpass')).rejects.toThrow(
        'Username or password error',
      );
    });
  });

  describe('logout', () => {
    it('logs out user successfully', async () => {
      const mockResponse = { success: true };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await logout();

      expect(fetchMock).toHaveBeenCalledWith('/auth/logout', {
        method: 'POST',
        credentials: 'include',
        redirect: 'manual',
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getStrategies', () => {
    it('returns auth status payload with providers and errors', async () => {
      const mockStrategies = {
        providers: [
          { name: 'basic', type: 'basic' },
          { name: 'oidc', type: 'oidc' },
        ],
        errors: [{ provider: 'basic:ANDI', error: 'hash is required' }],
      };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStrategies,
      });

      const strategies = await getStrategies();

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/status', {
        credentials: 'include',
      });
      expect(strategies).toEqual(mockStrategies);
    });

    it('throws when fetching authentication strategies fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });

      await expect(getStrategies()).rejects.toThrow(
        'Failed to get auth strategies: Internal Server Error',
      );
    });
  });

  describe('getOidcRedirection', () => {
    it('returns oidc redirection payload', async () => {
      const mockRedirection = { url: 'https://idp.example.com/authorize?code=abc' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockRedirection,
      });

      const result = await getOidcRedirection('main');

      expect(fetchMock).toHaveBeenCalledWith('/auth/oidc/main/redirect', {
        credentials: 'include',
      });
      expect(result).toEqual(mockRedirection);
    });
  });

  describe('setRememberMe', () => {
    it('stores remember-me preference for auth redirects', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
      });

      await setRememberMe(true);

      expect(fetchMock).toHaveBeenCalledWith('/auth/remember', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remember: true }),
      });
    });
  });
});
