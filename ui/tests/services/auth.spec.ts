const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

async function loadAuthService() {
  vi.resetModules();
  return import('@/services/auth');
}

describe('Auth Service', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getUser', () => {
    it('returns user data when authenticated', async () => {
      const { getUser } = await loadAuthService();
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
      const { getUser } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const user = await getUser();

      expect(user).toBeUndefined();
    });

    it('handles network errors gracefully', async () => {
      const { getUser } = await loadAuthService();
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const user = await getUser();

      expect(user).toBeUndefined();
    });

    it('logs fallback error detail when thrown value is not an Error object', async () => {
      const { getUser } = await loadAuthService();
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

    it('reuses a fresh cached user without refetching', async () => {
      vi.useFakeTimers();
      const { AUTH_USER_CACHE_TTL_MS, getUser } = await loadAuthService();
      const mockUser = { username: 'cached-user', roles: ['admin'] };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      expect(await getUser()).toEqual(mockUser);
      expect(await getUser()).toEqual(mockUser);

      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(AUTH_USER_CACHE_TTL_MS + 1);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      expect(await getUser()).toEqual(mockUser);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reuses the in-flight request for concurrent callers', async () => {
      const { getUser } = await loadAuthService();
      const mockUser = { username: 'shared-user', roles: ['admin'] };
      let resolveResponse: ((value: unknown) => void) | undefined;
      fetchMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
      );

      const first = getUser();
      const second = getUser();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      resolveResponse?.({
        ok: true,
        json: async () => mockUser,
      });

      await expect(first).resolves.toEqual(mockUser);
      await expect(second).resolves.toEqual(mockUser);
    });
  });

  describe('loginBasic', () => {
    it('performs basic authentication successfully', async () => {
      const { loginBasic } = await loadAuthService();
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
      const { loginBasic } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(loginBasic('testuser', 'wrongpass')).rejects.toThrow(
        'Username or password error',
      );
    });

    it('surfaces API error details for non-credential failures', async () => {
      const { loginBasic } = await loadAuthService();
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
      const { loginBasic } = await loadAuthService();
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
      const { loginBasic } = await loadAuthService();
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
      const { loginBasic } = await loadAuthService();
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
      const { logout } = await loadAuthService();
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

    it('clears the cached user after logout', async () => {
      vi.useFakeTimers();
      const { getUser, logout } = await loadAuthService();
      const mockUser = { username: 'testuser', roles: ['admin'] };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      expect(await getUser()).toEqual(mockUser);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
      await logout();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });
      expect(await getUser()).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('getStrategies', () => {
    it('returns auth status payload with providers and errors', async () => {
      const { getStrategies } = await loadAuthService();
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
      const { getStrategies } = await loadAuthService();
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
      const { getOidcRedirection } = await loadAuthService();
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
      const { setRememberMe } = await loadAuthService();
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
