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
      const mockUser = { username: 'testuser' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      const user = await getUser();

      expect(fetchMock).toHaveBeenCalledWith('/auth/user', {
        redirect: 'manual',
        credentials: 'include',
        signal: expect.any(AbortSignal),
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

    it('aborts a stalled bootstrap request after eight seconds and falls back to logged out', async () => {
      const controller = new AbortController();
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
      fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        });
      });
      const { getUser } = await loadAuthService();

      try {
        const userPromise = getUser();
        expect(timeoutSpy).toHaveBeenCalledWith(8_000);
        controller.abort(new DOMException('Timed out', 'TimeoutError'));

        await expect(userPromise).resolves.toBeUndefined();
      } finally {
        timeoutSpy.mockRestore();
      }
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

    it('revalidates a settled authenticated user on the next call', async () => {
      const { getUser } = await loadAuthService();
      const mockUser = { username: 'cached-user' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      expect(await getUser()).toEqual(mockUser);
      expect(await getUser()).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reuses the in-flight request for concurrent callers', async () => {
      const { getUser } = await loadAuthService();
      const mockUser = { username: 'shared-user' };
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

    it('does not keep an unauthenticated result cached after the request settles', async () => {
      const { getUser } = await loadAuthService();
      const mockUser = { username: 'fresh-user' };
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockUser,
      });

      expect(await getUser()).toBeUndefined();
      expect(await getUser()).toEqual(mockUser);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('loginBasic second-factor challenge', () => {
    const challenge = {
      id: 'c'.repeat(43),
      expiresAt: '2026-10-04T12:05:00.000Z',
      methods: ['totp', 'recovery'],
    };

    it('keeps returning the payload for a 200', async () => {
      const { loginBasic } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ username: 'a' }),
      });
      await expect(loginBasic('a', 'b')).resolves.toEqual({ username: 'a' });
    });

    it('returns the challenge for a 202 and does not treat it as a session', async () => {
      const { loginBasic } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ challenge }) });
      await expect(loginBasic('a', 'b')).resolves.toEqual({ challenge });
    });

    it('drops unknown methods and rejects a malformed 202 body', async () => {
      const { loginBasic } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ challenge: { ...challenge, methods: ['totp', 5, 'sms'] } }),
      });
      await expect(loginBasic('a', 'b')).resolves.toEqual({
        challenge: { ...challenge, methods: ['totp'] },
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ challenge: { id: challenge.id, expiresAt: challenge.expiresAt } }),
      });
      await expect(loginBasic('a', 'b')).rejects.toThrow('Unexpected login challenge response');
      fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ nope: 1 }) });
      await expect(loginBasic('a', 'b')).rejects.toThrow('Unexpected login challenge response');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ challenge: { ...challenge, methods: [] } }),
      });
      await expect(loginBasic('a', 'b')).rejects.toThrow('Unexpected login challenge response');
    });

    it('never writes the challenge id to web storage or the URL', async () => {
      const { loginBasic, completeLoginChallenge } = await loadAuthService();
      const local = vi.spyOn(Storage.prototype, 'setItem');
      const hrefBefore = globalThis.location.href;
      fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ challenge }) });
      await loginBasic('a', 'b');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ username: 'a' }),
      });
      await completeLoginChallenge(challenge.id, { code: '123456' }, false);
      expect(local).not.toHaveBeenCalled();
      expect(globalThis.location.href).toBe(hrefBefore);
      local.mockRestore();
    });
  });

  describe('completeLoginChallenge', () => {
    const id = 'd'.repeat(43);

    it('PUTs a code with remember and returns the user', async () => {
      const { completeLoginChallenge } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ username: 'a' }),
      });
      await expect(completeLoginChallenge(id, { code: '123456' }, true)).resolves.toEqual({
        username: 'a',
      });
      expect(fetchMock).toHaveBeenCalledWith(`/auth/login-challenges/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456', remember: true }),
      });
    });

    it('PUTs a recovery code', async () => {
      const { completeLoginChallenge } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ username: 'a' }),
      });
      await completeLoginChallenge(id, { recoveryCode: 'abcd-efgh' }, false);
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        recoveryCode: 'abcd-efgh',
        remember: false,
      });
    });

    it('clears the cached user so the next check revalidates', async () => {
      const { completeLoginChallenge, getUser } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ username: 'a' }),
      });
      await completeLoginChallenge(id, { code: '123456' }, false);
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ username: 'a' }) });
      await getUser();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([[401], [400], [503]])('throws a typed error carrying status %i', async (status) => {
      const { completeLoginChallenge } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status,
        headers: new Headers(),
        json: async () => ({ error: 'x' }),
      });
      await expect(completeLoginChallenge(id, { code: '123456' }, false)).rejects.toMatchObject({
        name: 'AuthRequestError',
        status,
        retryAfterSeconds: undefined,
      });
    });

    it('reads Retry-After seconds on 429 and 423', async () => {
      const { completeLoginChallenge } = await loadAuthService();
      for (const status of [429, 423]) {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status,
          headers: new Headers({ 'Retry-After': '90' }),
          json: async () => ({ error: 'x' }),
        });
        await expect(completeLoginChallenge(id, { code: '1' }, false)).rejects.toMatchObject({
          status,
          retryAfterSeconds: 90,
        });
      }
    });

    it('ignores a Retry-After that is not whole seconds, or a missing headers object', async () => {
      const { completeLoginChallenge } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
      });
      await expect(completeLoginChallenge(id, { code: '1' }, false)).rejects.toMatchObject({
        status: 429,
        retryAfterSeconds: undefined,
      });
      fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
      await expect(completeLoginChallenge(id, { code: '1' }, false)).rejects.toMatchObject({
        retryAfterSeconds: undefined,
      });
    });

    it('does not put the challenge id in an error message', async () => {
      const { completeLoginChallenge } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() });
      const failure = await completeLoginChallenge(id, { code: '1' }, false).catch((e) => e);
      expect(String(failure.message)).not.toContain(id);
    });

    it('lets a network failure through as a status-less error', async () => {
      const { completeLoginChallenge } = await loadAuthService();
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(completeLoginChallenge(id, { code: '1' }, false)).rejects.toThrow(
        'Failed to fetch',
      );
    });
  });

  describe('cancelLoginChallenge', () => {
    it('DELETEs the challenge', async () => {
      const { cancelLoginChallenge } = await loadAuthService();
      fetchMock.mockResolvedValueOnce({ ok: true, status: 204 });
      await cancelLoginChallenge('e'.repeat(43));
      expect(fetchMock).toHaveBeenCalledWith(`/auth/login-challenges/${'e'.repeat(43)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    });

    it('is best-effort: a failed request never throws', async () => {
      const { cancelLoginChallenge } = await loadAuthService();
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(cancelLoginChallenge('e'.repeat(43))).resolves.toBeUndefined();
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
      const mockRedirection = {
        redirect: 'https://idp.example.com/authorize?code=abc',
        strictEndpoints: ['https://idp.example.com/authorize'],
        allowedOrigins: ['https://idp.example.com'],
      };
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
