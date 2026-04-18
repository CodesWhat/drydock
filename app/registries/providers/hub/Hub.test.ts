import Hub from './Hub.js';

// Mock axios
vi.mock('axios', () => ({ default: vi.fn() }));

describe('Docker Hub Registry', () => {
  let hub;

  beforeEach(async () => {
    hub = new Hub();
    await hub.register('registry', 'hub', 'test', {});
    vi.clearAllMocks();
  });

  test('should create instance', async () => {
    expect(hub).toBeDefined();
    expect(hub).toBeInstanceOf(Hub);
  });

  test('should have correct registry url after init', async () => {
    expect(hub.configuration.url).toBe('https://registry-1.docker.io');
  });

  test('should match registry', async () => {
    expect(hub.match({ registry: { url: 'registry-1.docker.io' } })).toBe(true);
    expect(hub.match({ registry: { url: 'docker.io' } })).toBe(true);
    expect(hub.match({ registry: { url: undefined } })).toBe(true);
    expect(hub.match({ registry: { url: 'other.registry.com' } })).toBe(false);
  });

  test('should match missing registry object as Docker Hub default', async () => {
    expect(() => hub.match({})).not.toThrow();
    expect(hub.match({})).toBe(true);
  });

  test('should reject hostnames that bypass unescaped dot in regex', async () => {
    expect(hub.match({ registry: { url: 'dockerXio' } })).toBe(false);
    expect(hub.match({ registry: { url: 'evil-docker.io.attacker.com' } })).toBe(false);
    expect(hub.match({ registry: { url: 'notdocker.io' } })).toBe(false);
  });

  test('should normalize image name for official images', async () => {
    const image = { name: 'nginx', registry: {} };
    const normalized = hub.normalizeImage(image);
    expect(normalized.name).toBe('library/nginx');
    expect(normalized.registry.url).toBe('https://registry-1.docker.io/v2');
  });

  test('should not normalize image name for user images', async () => {
    const image = { name: 'user/nginx', registry: {} };
    const normalized = hub.normalizeImage(image);
    expect(normalized.name).toBe('user/nginx');
    expect(normalized.registry.url).toBe('https://registry-1.docker.io/v2');
  });

  test('should keep undefined image name when normalizing', async () => {
    const image = { registry: {} };
    const normalized = hub.normalizeImage(image);
    expect(normalized.name).toBeUndefined();
    expect(normalized.registry.url).toBe('https://registry-1.docker.io/v2');
  });

  test('should mask configuration with token', async () => {
    hub.configuration = { login: 'testuser', token: 'secret_token' };
    const masked = hub.maskConfiguration();
    expect(masked.login).toBe('testuser');
    expect(masked.token).toBe('[REDACTED]');
  });

  test('should get image full name without registry prefix', async () => {
    const image = {
      name: 'library/nginx',
      registry: { url: 'https://registry-1.docker.io/v2' },
    };
    const fullName = hub.getImageFullName(image, '1.0.0');
    expect(fullName).toBe('nginx:1.0.0');
  });

  test('should get image full name for user images', async () => {
    const image = {
      name: 'user/nginx',
      registry: { url: 'https://registry-1.docker.io/v2' },
    };
    const fullName = hub.getImageFullName(image, '1.0.0');
    expect(fullName).toBe('user/nginx:1.0.0');
  });

  test('should initialize with token as password', async () => {
    const hubWithToken = new Hub();
    await hubWithToken.register('registry', 'hub', 'test', {
      login: 'mydockerid',
      token: 'mytoken',
    });
    expect(hubWithToken.configuration.password).toBe('mytoken');
  });

  test('should authenticate with credentials', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { token: 'auth-token' } });

    hub.getAuthCredentials = vi.fn().mockReturnValue('base64credentials');

    const image = { name: 'library/nginx' };
    const requestOptions = { headers: {} };

    const result = await hub.authenticate(image, requestOptions);

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fnginx%3Apull&grant_type=password',
      headers: {
        Accept: 'application/json',
        Authorization: 'Basic base64credentials',
      },
    });
    expect(result.headers.Authorization).toBe('Bearer auth-token');
  });

  test('should authenticate without credentials', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { token: 'public-token' } });

    hub.getAuthCredentials = vi.fn().mockReturnValue(null);

    const image = { name: 'library/nginx' };
    const requestOptions = { headers: {} };

    const result = await hub.authenticate(image, requestOptions);

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fnginx%3Apull&grant_type=password',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(result.headers.Authorization).toBe('Bearer public-token');
  });

  test('should retry anonymously when configured credentials are rejected with 401', async () => {
    const { default: axios } = await import('axios');
    axios
      .mockRejectedValueOnce(new Error('Request failed with status code 401'))
      .mockResolvedValueOnce({ data: { token: 'public-token' } });

    hub.getAuthCredentials = vi.fn().mockReturnValue('base64credentials');
    const warnSpy = vi.spyOn(hub.log, 'warn');

    const image = { name: 'library/nginx' };
    const requestOptions = { headers: {} };

    const result = await hub.authenticate(image, requestOptions);

    expect(axios).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: 'https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fnginx%3Apull&grant_type=password',
      headers: {
        Accept: 'application/json',
        Authorization: 'Basic base64credentials',
      },
    });
    expect(axios).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      url: 'https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Fnginx%3Apull&grant_type=password',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Docker Hub credentials were rejected for registry hub.test (status 401)',
      ),
    );
    expect(result.headers.Authorization).toBe('Bearer public-token');
  });

  test('should fetch published date from Docker Hub tag metadata', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { last_updated: '2026-03-01T12:34:56.000Z' } });

    const publishedAt = await hub.getImagePublishedAt(
      { name: 'library/nginx', tag: { value: 'latest' } },
      '1.26.0',
    );

    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://hub.docker.com/v2/repositories/library/nginx/tags/1.26.0',
      headers: {
        Accept: 'application/json',
      },
    });
    expect(publishedAt).toBe('2026-03-01T12:34:56.000Z');
  });

  test('should return undefined when Docker Hub tag metadata has no last_updated', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });

    const publishedAt = await hub.getImagePublishedAt({
      name: 'library/nginx',
      tag: { value: 'latest' },
    });

    expect(publishedAt).toBeUndefined();
  });

  test('should return undefined when Docker Hub image name or tag is missing', async () => {
    const { default: axios } = await import('axios');

    const missingName = await hub.getImagePublishedAt({
      tag: { value: 'latest' },
    } as any);
    const missingTag = await hub.getImagePublishedAt({
      name: 'library/nginx',
      tag: { value: '' },
    });

    expect(missingName).toBeUndefined();
    expect(missingTag).toBeUndefined();
    expect(axios).not.toHaveBeenCalled();
  });

  test('should return undefined when Docker Hub last_updated is not a valid date', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: { last_updated: 'invalid-date' } });

    const publishedAt = await hub.getImagePublishedAt({
      name: 'library/nginx',
      tag: { value: 'latest' },
    });

    expect(publishedAt).toBeUndefined();
  });

  test('should validate string configuration', async () => {
    expect(() => hub.validateConfiguration('')).not.toThrow();
    expect(() => hub.validateConfiguration('some-string')).toThrow();
  });

  test('should reject conflicting object configuration with auth and password', async () => {
    const config = {
      login: 'user',
      password: 'pass',
      auth: Buffer.from('user:pass').toString('base64'),
    };
    expect(() => hub.validateConfiguration(config)).toThrow();
  });

  test('should validate object configuration with login/token', async () => {
    const config = {
      login: 'user',
      token: 'pat-token',
    };
    expect(() => hub.validateConfiguration(config)).not.toThrow();
  });

  test('should mask all configuration fields', async () => {
    hub.configuration = {
      url: 'https://registry-1.docker.io',
      login: 'testuser',
      password: 'testpass',
      token: 'testtoken',
      auth: 'dGVzdDp0ZXN0',
    };
    const masked = hub.maskConfiguration();
    expect(masked).toEqual({
      url: 'https://registry-1.docker.io',
      login: 'testuser',
      password: '[REDACTED]',
      token: '[REDACTED]',
      auth: '[REDACTED]',
    });
  });

  test('should throw when hub token response is missing token', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    const image = { name: 'library/nginx' };
    const requestOptions = { headers: {} };

    await expect(hub.authenticate(image, requestOptions)).rejects.toThrow(
      'Docker Hub token endpoint response does not contain token',
    );
  });

  test('should propagate network errors from authenticate', async () => {
    const { default: axios } = await import('axios');
    axios.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'));
    const image = { name: 'library/nginx' };

    await expect(hub.authenticate(image, { headers: {} })).rejects.toThrow(
      'connect ECONNREFUSED 127.0.0.1:443',
    );
  });

  test('should propagate timeout errors from authenticate', async () => {
    const { default: axios } = await import('axios');
    axios.mockRejectedValue(new Error('timeout of 15000ms exceeded'));
    const image = { name: 'library/nginx' };

    await expect(hub.authenticate(image, { headers: {} })).rejects.toThrow(
      'timeout of 15000ms exceeded',
    );
  });

  test('should propagate 401 errors from authenticate', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 401');
    (error as any).response = { status: 401 };
    axios.mockRejectedValue(error);
    const image = { name: 'library/nginx' };

    await expect(hub.authenticate(image, { headers: {} })).rejects.toThrow(
      'Request failed with status code 401',
    );
  });

  test('should propagate 429 rate limit errors from authenticate', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 429');
    (error as any).response = { status: 429 };
    axios.mockRejectedValue(error);
    const image = { name: 'library/nginx' };

    await expect(hub.authenticate(image, { headers: {} })).rejects.toThrow(
      'Request failed with status code 429',
    );
  });

  test('should propagate network errors from getImagePublishedAt', async () => {
    const { default: axios } = await import('axios');
    axios.mockRejectedValue(new Error('connect ETIMEDOUT 10.0.0.1:443'));
    const image = { name: 'library/nginx', tag: { value: 'latest' } };

    await expect(hub.getImagePublishedAt(image)).rejects.toThrow('connect ETIMEDOUT 10.0.0.1:443');
  });

  test('should propagate 404 errors from getImagePublishedAt', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 404');
    (error as any).response = { status: 404 };
    axios.mockRejectedValue(error);
    const image = { name: 'library/nginx', tag: { value: 'nonexistent' } };

    await expect(hub.getImagePublishedAt(image)).rejects.toThrow(
      'Request failed with status code 404',
    );
  });

  test('should propagate 429 rate limit errors from getImagePublishedAt', async () => {
    const { default: axios } = await import('axios');
    const error = new Error('Request failed with status code 429');
    (error as any).response = { status: 429 };
    axios.mockRejectedValue(error);
    const image = { name: 'library/nginx', tag: { value: 'latest' } };

    await expect(hub.getImagePublishedAt(image)).rejects.toThrow(
      'Request failed with status code 429',
    );
  });
});
