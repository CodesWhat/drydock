import axios from 'axios';
import Ghcr from './Ghcr.js';

vi.mock('axios');

/**
 * Create a proper Axios-shaped error so that `axios.isAxiosError(err)` returns
 * true and `err.response.status` carries the expected HTTP status code.
 */
function makeAxiosError(status: number) {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number };
  };
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

describe('GitHub Container Registry', () => {
  let ghcr;

  beforeEach(async () => {
    axios.mockReset();
    axios.mockResolvedValue({ data: { token: 'registry-token' } });
    // Restore the real isAxiosError behaviour: check for the `.isAxiosError` flag
    // that our makeAxiosError helper sets on the thrown error objects.
    (axios as any).isAxiosError = (err: unknown): boolean =>
      err != null &&
      typeof err === 'object' &&
      (err as { isAxiosError?: boolean }).isAxiosError === true;
    ghcr = new Ghcr();
    await ghcr.register('registry', 'ghcr', 'test', {
      username: 'testuser',
      token: 'testtoken',
    });
  });

  test('should create instance', async () => {
    expect(ghcr).toBeDefined();
    expect(ghcr).toBeInstanceOf(Ghcr);
  });

  test('should match registry', async () => {
    expect(ghcr.match({ registry: { url: 'ghcr.io' } })).toBe(true);
    expect(ghcr.match({ registry: { url: 'docker.io' } })).toBe(false);
  });

  test('should normalize image name', async () => {
    const image = { name: 'user/repo', registry: { url: 'ghcr.io' } };
    const normalized = ghcr.normalizeImage(image);
    expect(normalized.name).toBe('user/repo');
    expect(normalized.registry.url).toBe('https://ghcr.io/v2');
  });

  test('should not modify URL if already starts with https', async () => {
    const image = {
      name: 'user/repo',
      registry: { url: 'https://ghcr.io/v2' },
    };
    const normalized = ghcr.normalizeImage(image);
    expect(normalized.registry.url).toBe('https://ghcr.io/v2');
  });

  test('should mask configuration token', async () => {
    ghcr.configuration = { username: 'testuser', token: 'secret_token' };
    const masked = ghcr.maskConfiguration();
    expect(masked.username).toBe('testuser');
    expect(masked.token).toBe('[REDACTED]');
  });

  test('should return auth pull credentials', async () => {
    ghcr.configuration = { username: 'testuser', token: 'testtoken' };
    const auth = await ghcr.getAuthPull();
    expect(auth).toEqual({
      username: 'testuser',
      password: 'testtoken',
    });
  });

  test('should return undefined auth pull when no credentials', async () => {
    ghcr.configuration = {};
    const auth = await ghcr.getAuthPull();
    expect(auth).toBeUndefined();
  });

  test('should authenticate with token', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    const image = { name: 'user/repo' };
    const requestOptions = {
      headers: {},
      url: 'https://ghcr.io/v2/user/repo/manifests/latest',
    };

    const result = await ghcr.authenticate(image, requestOptions);

    const expectedBasic = Buffer.from('test-user:test-token', 'utf-8').toString('base64');
    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      maxRedirects: 0,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${expectedBasic}`,
      },
    });
    expect(result.headers.Authorization).toBe('Bearer registry-token');
  });

  test('should throw actionable error when configured credentials are rejected with 403', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    axios.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    const image = { name: 'user/repo' };
    const requestOptions = {
      headers: {},
      url: 'https://ghcr.io/v2/user/repo/manifests/latest',
    };

    await expect(ghcr.authenticate(image, requestOptions)).rejects.toThrow(
      /Authentication failed for registry ghcr\.test \(HTTP 403\): GHCR credentials were rejected/,
    );

    const expectedBasic = Buffer.from('test-user:test-token', 'utf-8').toString('base64');
    expect(axios).toHaveBeenCalledTimes(1);
    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      maxRedirects: 0,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${expectedBasic}`,
      },
    });
  });

  test('should not retry anonymously when no credentials are configured', async () => {
    ghcr.configuration = {};
    axios.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    const image = { name: 'user/repo' };
    const requestOptions = {
      headers: {},
      url: 'https://ghcr.io/v2/user/repo/manifests/latest',
    };

    await expect(ghcr.authenticate(image, requestOptions)).rejects.toThrow('status code 403');
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('should not retry anonymously for non-auth token failures', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    axios.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    const image = { name: 'user/repo' };
    const requestOptions = {
      headers: {},
      url: 'https://ghcr.io/v2/user/repo/manifests/latest',
    };

    await expect(ghcr.authenticate(image, requestOptions)).rejects.toThrow('status code 500');
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('should not retry when auth call rejects with a non-Error value', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    axios.mockRejectedValueOnce('raw failure');
    const image = { name: 'user/repo' };
    const requestOptions = {
      headers: {},
      url: 'https://ghcr.io/v2/user/repo/manifests/latest',
    };

    await expect(ghcr.authenticate(image, requestOptions)).rejects.toThrow(
      'token request failed (raw failure)',
    );
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('should authenticate without token', async () => {
    ghcr.configuration = {};
    const image = { name: 'user/repo' };
    const requestOptions = {
      headers: {},
      url: 'https://ghcr.io/v2/user/repo/manifests/latest',
    };

    const result = await ghcr.authenticate(image, requestOptions);

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      maxRedirects: 0,
      headers: {
        Accept: 'application/json',
      },
    });
    expect(result.headers.Authorization).toBe('Bearer registry-token');
  });

  test('should authenticate with token endpoint access_token field', async () => {
    ghcr.configuration = {};
    axios.mockResolvedValueOnce({ data: { access_token: 'access-token' } });
    const image = { name: 'user/repo' };
    const requestOptions = {
      headers: {},
      url: 'https://ghcr.io/v2/user/repo/manifests/latest',
    };

    const result = await ghcr.authenticate(image, requestOptions);

    expect(result.headers.Authorization).toBe('Bearer access-token');
  });

  test('should use configured credentials when resolving a Bearer challenge', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    axios.mockResolvedValueOnce({ data: { access_token: 'challenge-token' } });

    const result = await (ghcr as any).resolveBearerChallengeOptions(
      {
        headers: {},
        url: 'https://ghcr.io/v2/user/repo/manifests/latest',
      },
      'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/repo:pull"',
      { name: 'user/repo' },
    );

    const expectedBasic = Buffer.from('test-user:test-token', 'utf-8').toString('base64');
    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      maxRedirects: 0,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${expectedBasic}`,
      },
    });
    expect(result.headers.Authorization).toBe('Bearer challenge-token');
  });

  test('should fetch published date from GHCR package versions API (org endpoint)', async () => {
    axios.mockResolvedValueOnce({
      data: [
        {
          updated_at: '2026-03-02T09:30:00.000Z',
          metadata: {
            container: {
              tags: ['1.2.3', 'latest'],
            },
          },
        },
      ],
    });

    const publishedAt = await ghcr.getImagePublishedAt(
      { name: 'acme/widgets', tag: { value: 'latest' } },
      '1.2.3',
    );

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://api.github.com/orgs/acme/packages/container/widgets/versions?per_page=100&page=1',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer testtoken',
      },
    });
    expect(publishedAt).toBe('2026-03-02T09:30:00.000Z');
  });

  test('should fallback to GHCR user endpoint when org package lookup returns 404', async () => {
    axios.mockRejectedValueOnce(makeAxiosError(404)).mockResolvedValueOnce({
      data: [
        {
          updated_at: '2026-03-05T10:00:00.000Z',
          metadata: {
            container: {
              tags: ['2.0.0'],
            },
          },
        },
      ],
    });

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'octocat/demo',
      tag: { value: '2.0.0' },
    });

    expect(axios).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: 'https://api.github.com/orgs/octocat/packages/container/demo/versions?per_page=100&page=1',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer testtoken',
      },
    });
    expect(axios).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://api.github.com/users/octocat/packages/container/demo/versions?per_page=100&page=1',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer testtoken',
      },
    });
    expect(publishedAt).toBe('2026-03-05T10:00:00.000Z');
  });

  test('should return undefined when GHCR versions do not include the requested tag', async () => {
    axios.mockResolvedValueOnce({
      data: [
        {
          updated_at: '2026-03-02T09:30:00.000Z',
          metadata: {
            container: {
              tags: ['not-requested'],
            },
          },
        },
      ],
    });

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'acme/widgets',
      tag: { value: '1.2.3' },
    });

    expect(publishedAt).toBeUndefined();
  });

  test('should return undefined for invalid GHCR image/tag inputs', async () => {
    const missingTag = await ghcr.getImagePublishedAt({
      name: 'acme/widgets',
      tag: { value: '' },
    });
    const missingPackagePath = await ghcr.getImagePublishedAt({
      name: 'acme',
      tag: { value: '1.2.3' },
    });
    const missingName = await ghcr.getImagePublishedAt({
      name: '',
      tag: { value: '1.2.3' },
    });

    expect(missingTag).toBeUndefined();
    expect(missingPackagePath).toBeUndefined();
    expect(missingName).toBeUndefined();
    expect(axios).not.toHaveBeenCalled();
  });

  test('should return undefined when GHCR versions payload is not an array', async () => {
    axios.mockResolvedValueOnce({
      data: { message: 'not-an-array' },
    });

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'acme/widgets',
      tag: { value: '1.2.3' },
    });

    expect(publishedAt).toBeUndefined();
  });

  test('should return undefined when GHCR updated_at is not a valid date', async () => {
    axios.mockResolvedValueOnce({
      data: [
        {
          updated_at: 'invalid-date',
          metadata: {
            container: {
              tags: ['1.2.3'],
            },
          },
        },
      ],
    });

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'acme/widgets',
      tag: { value: '1.2.3' },
    });

    expect(publishedAt).toBeUndefined();
  });

  test('should rethrow GHCR org lookup errors that are not 404', async () => {
    axios.mockRejectedValueOnce(new Error('Request failed with status code 500'));

    await expect(
      ghcr.getImagePublishedAt({
        name: 'acme/widgets',
        tag: { value: '1.2.3' },
      }),
    ).rejects.toThrow('status code 500');
  });

  test('should return undefined when both GHCR org and user lookups return 404', async () => {
    axios.mockRejectedValueOnce(makeAxiosError(404)).mockRejectedValueOnce(makeAxiosError(404));

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'octocat/demo',
      tag: { value: '2.0.0' },
    });

    expect(publishedAt).toBeUndefined();
  });

  test('should rethrow non-404 errors from GHCR user lookup fallback', async () => {
    axios
      .mockRejectedValueOnce(makeAxiosError(404))
      .mockRejectedValueOnce(new Error('Request failed with status code 500'));

    await expect(
      ghcr.getImagePublishedAt({
        name: 'octocat/demo',
        tag: { value: '2.0.0' },
      }),
    ).rejects.toThrow('status code 500');
  });

  test('should call GHCR versions API without Authorization header when token is missing', async () => {
    ghcr.configuration = {};
    axios.mockResolvedValueOnce({
      data: [],
    });

    await ghcr.getImagePublishedAt({
      name: 'acme/widgets',
      tag: { value: '1.2.3' },
    });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          Accept: 'application/vnd.github+json',
        },
      }),
    );
  });

  test('should ignore non-Error values when parsing rejected credential status', async () => {
    expect((ghcr as any).getRejectedCredentialStatus('raw-failure')).toBeUndefined();
  });

  test('isNotFoundError: plain Error with status-code-404 message is not treated as a 404 (axios check required)', async () => {
    // A plain Error (no .isAxiosError flag) mentioning "status code 404" must NOT
    // be swallowed — it must propagate as an unexpected error.
    axios
      .mockRejectedValueOnce(new Error('Request failed with status code 404'))
      .mockRejectedValueOnce(new Error('Some other error'));

    await expect(
      ghcr.getImagePublishedAt({
        name: 'acme/widgets',
        tag: { value: '1.2.3' },
      }),
    ).rejects.toThrow('Request failed with status code 404');
  });

  test('isNotFoundError: proper AxiosError with status 404 is treated as a 404 and falls back to user endpoint', async () => {
    axios.mockRejectedValueOnce(makeAxiosError(404)).mockResolvedValueOnce({ data: [] });

    const result = await ghcr.getImagePublishedAt({
      name: 'octocat/demo',
      tag: { value: '1.0.0' },
    });

    expect(result).toBeUndefined();
    expect(axios).toHaveBeenCalledTimes(2);
  });

  test('should validate string configuration', async () => {
    expect(() => ghcr.validateConfiguration('')).not.toThrow();
    expect(() => ghcr.validateConfiguration('some-string')).not.toThrow();
  });

  test('should return undefined auth pull when missing username', async () => {
    ghcr.configuration = { token: 'test-token' };
    const auth = await ghcr.getAuthPull();
    expect(auth).toBeUndefined();
  });

  test('should return undefined auth pull when missing token', async () => {
    ghcr.configuration = { username: 'testuser' };
    const auth = await ghcr.getAuthPull();
    expect(auth).toBeUndefined();
  });

  test('publishedAtIsPushDate is true on Ghcr', () => {
    expect(ghcr.publishedAtIsPushDate).toBe(true);
  });

  test('should paginate and return a tag found on page 2 of org endpoint', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      updated_at: '2026-01-01T00:00:00.000Z',
      metadata: { container: { tags: [`v0.${i}.0`] } },
    }));
    const page2 = [
      {
        updated_at: '2026-06-01T12:00:00.000Z',
        metadata: { container: { tags: ['target-tag'] } },
      },
    ];

    axios.mockResolvedValueOnce({ data: fullPage }).mockResolvedValueOnce({ data: page2 });

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'acme/widgets',
      tag: { value: 'target-tag' },
    });

    expect(publishedAt).toBe('2026-06-01T12:00:00.000Z');
    expect(axios).toHaveBeenCalledTimes(2);
    expect(axios).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: 'https://api.github.com/orgs/acme/packages/container/widgets/versions?per_page=100&page=1',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer testtoken' },
    });
    expect(axios).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://api.github.com/orgs/acme/packages/container/widgets/versions?per_page=100&page=2',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer testtoken' },
    });
  });

  test('should stop paginating at a short page and return undefined when tag is never found', async () => {
    const shortPage = Array.from({ length: 50 }, (_, i) => ({
      updated_at: '2026-01-01T00:00:00.000Z',
      metadata: { container: { tags: [`v0.${i}.0`] } },
    }));

    axios.mockResolvedValueOnce({ data: shortPage });

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'acme/widgets',
      tag: { value: 'not-here' },
    });

    expect(publishedAt).toBeUndefined();
    // Only one page fetched — short page stops the loop, page 2 never requested
    expect(axios).toHaveBeenCalledTimes(1);
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.github.com/orgs/acme/packages/container/widgets/versions?per_page=100&page=1',
      }),
    );
  });

  test('should stop pagination at the 10-page cap and return undefined', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      updated_at: '2026-01-01T00:00:00.000Z',
      metadata: { container: { tags: [`v${i}.0.0`] } },
    }));

    for (let i = 0; i < 10; i++) {
      axios.mockResolvedValueOnce({ data: fullPage });
    }

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'acme/big-package',
      tag: { value: 'not-here' },
    });

    expect(publishedAt).toBeUndefined();
    // Exactly 10 pages fetched — page 11 must never be called
    expect(axios).toHaveBeenCalledTimes(10);
    expect(axios).toHaveBeenLastCalledWith({
      method: 'GET',
      url: 'https://api.github.com/orgs/acme/packages/container/big-package/versions?per_page=100&page=10',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer testtoken' },
    });
  });

  test('should paginate the user endpoint after org 404 and return a tag found on page 2', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      updated_at: '2026-01-01T00:00:00.000Z',
      metadata: { container: { tags: [`v0.${i}.0`] } },
    }));
    const page2 = [
      {
        updated_at: '2026-06-15T08:00:00.000Z',
        metadata: { container: { tags: ['user-page2-tag'] } },
      },
    ];

    axios
      .mockRejectedValueOnce(makeAxiosError(404)) // org 404
      .mockResolvedValueOnce({ data: fullPage }) // user page 1: no match
      .mockResolvedValueOnce({ data: page2 }); // user page 2: match

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'octocat/demo',
      tag: { value: 'user-page2-tag' },
    });

    expect(publishedAt).toBe('2026-06-15T08:00:00.000Z');
    expect(axios).toHaveBeenCalledTimes(3);
    expect(axios).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://api.github.com/users/octocat/packages/container/demo/versions?per_page=100&page=1',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer testtoken' },
    });
    expect(axios).toHaveBeenNthCalledWith(3, {
      method: 'GET',
      url: 'https://api.github.com/users/octocat/packages/container/demo/versions?per_page=100&page=2',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer testtoken' },
    });
  });
});
