import axios from 'axios';
import Ghcr from './Ghcr.js';

vi.mock('axios');

describe('GitHub Container Registry', () => {
  let ghcr;

  beforeEach(async () => {
    axios.mockReset();
    axios.mockResolvedValue({ data: { token: 'registry-token' } });
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
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${expectedBasic}`,
      },
    });
    expect(result.headers.Authorization).toBe('Bearer registry-token');
  });

  test('should retry anonymously when configured credentials are rejected with 403', async () => {
    ghcr.configuration = { username: 'test-user', token: 'test-token' };
    axios.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    axios.mockResolvedValueOnce({ data: { token: 'anon-token' } });
    const image = { name: 'user/repo' };
    const requestOptions = {
      headers: {},
      url: 'https://ghcr.io/v2/user/repo/manifests/latest',
    };
    const warnSpy = vi.spyOn(ghcr.log, 'warn');

    const result = await ghcr.authenticate(image, requestOptions);

    const expectedBasic = Buffer.from('test-user:test-token', 'utf-8').toString('base64');
    expect(axios).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${expectedBasic}`,
      },
    });
    expect(axios).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://ghcr.io/token?service=ghcr.io&scope=repository%3Auser%2Frepo%3Apull',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GHCR credentials were rejected for registry ghcr.test (status 403)'),
    );
    expect(result.headers.Authorization).toBe('Bearer anon-token');
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
      'token request failed (undefined)',
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
      url: 'https://api.github.com/orgs/acme/packages/container/widgets/versions?per_page=100',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer testtoken',
      },
    });
    expect(publishedAt).toBe('2026-03-02T09:30:00.000Z');
  });

  test('should fallback to GHCR user endpoint when org package lookup returns 404', async () => {
    axios
      .mockRejectedValueOnce(new Error('Request failed with status code 404'))
      .mockResolvedValueOnce({
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
      url: 'https://api.github.com/orgs/octocat/packages/container/demo/versions?per_page=100',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer testtoken',
      },
    });
    expect(axios).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://api.github.com/users/octocat/packages/container/demo/versions?per_page=100',
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
    axios
      .mockRejectedValueOnce(new Error('Request failed with status code 404'))
      .mockRejectedValueOnce(new Error('Request failed with status code 404'));

    const publishedAt = await ghcr.getImagePublishedAt({
      name: 'octocat/demo',
      tag: { value: '2.0.0' },
    });

    expect(publishedAt).toBeUndefined();
  });

  test('should rethrow non-404 errors from GHCR user lookup fallback', async () => {
    axios
      .mockRejectedValueOnce(new Error('Request failed with status code 404'))
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
});
