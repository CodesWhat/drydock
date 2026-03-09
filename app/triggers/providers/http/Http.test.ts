import Http from './Http.js';

// Mock axios
vi.mock('axios', () => ({ default: vi.fn() }));
vi.mock('../../../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

describe('HTTP Trigger', () => {
  let http;

  beforeEach(async () => {
    http = new Http();
    vi.clearAllMocks();
  });

  test('should create instance', async () => {
    expect(http).toBeDefined();
    expect(http).toBeInstanceOf(Http);
  });

  test('should have correct configuration schema', async () => {
    const schema = http.getConfigurationSchema();
    expect(schema).toBeDefined();
  });

  test('should validate configuration with URL', async () => {
    const config = {
      url: 'https://example.com/webhook',
    };

    expect(() => http.validateConfiguration(config)).not.toThrow();
  });

  test('should allow configuration without auth object', async () => {
    const config = {
      url: 'https://example.com/webhook',
    };

    expect(() => http.validateConfiguration(config)).not.toThrow();
  });

  test('should fail validation when BASIC auth is missing credentials', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'BASIC' },
    };

    expect(() => http.validateConfiguration(config)).toThrow('"auth.user" is required');
  });

  test('should fail validation when BEARER auth is missing token', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'BEARER' },
    };

    expect(() => http.validateConfiguration(config)).toThrow('"auth.bearer" is required');
  });

  test('should fail validation when lowercase basic auth is missing credentials', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'basic' },
    };

    expect(() => http.validateConfiguration(config)).toThrow('"auth.user" is required');
  });

  test('should fail validation when lowercase bearer auth is missing token', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'bearer' },
    };

    expect(() => http.validateConfiguration(config)).toThrow('"auth.bearer" is required');
  });

  test('should validate configuration with complete BASIC auth', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'BASIC', user: 'user', password: 'pass' },
    };

    expect(() => http.validateConfiguration(config)).not.toThrow();
  });

  test('should validate configuration with complete BEARER auth', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'BEARER', bearer: 'token' },
    };

    expect(() => http.validateConfiguration(config)).not.toThrow();
  });

  test('should throw error when URL is missing', async () => {
    const config = {};

    expect(() => http.validateConfiguration(config)).toThrow();
  });

  test('should trigger with container', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
    });
    const container = { name: 'test' };

    await http.trigger(container);
    expect(axios).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.com/webhook',
      timeout: 30000,
      data: container,
    });
  });

  test('should trigger batch with containers', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
    });
    const containers = [{ name: 'test1' }, { name: 'test2' }];

    await http.triggerBatch(containers);
    expect(axios).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.com/webhook',
      timeout: 30000,
      data: containers,
    });
  });

  test('should use GET method with query string', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
      method: 'GET',
    });
    const container = { name: 'test' };

    await http.trigger(container);
    expect(axios).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://example.com/webhook',
      timeout: 30000,
      params: container,
    });
  });

  test('should use BASIC auth', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
      auth: { type: 'BASIC', user: 'user', password: 'pass' },
    });
    const container = { name: 'test' };

    await http.trigger(container);
    expect(axios).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.com/webhook',
      timeout: 30000,
      data: container,
      auth: { username: 'user', password: 'pass' },
    });
  });

  test('should default auth type to BASIC when type is omitted', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
      auth: { user: 'user', password: 'pass' },
    });

    await http.trigger({ name: 'test' });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { username: 'user', password: 'pass' },
      }),
    );
  });

  test('should fallback to BASIC auth when auth type is an empty string at runtime', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
      auth: { type: 'BASIC', user: 'user', password: 'pass' },
    });

    http.configuration.auth.type = '';
    await http.trigger({ name: 'test' });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { username: 'user', password: 'pass' },
      }),
    );
  });

  test('should use BEARER auth', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
      auth: { type: 'BEARER', bearer: 'token' },
    });
    const container = { name: 'test' };

    await http.trigger(container);
    expect(axios).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.com/webhook',
      timeout: 30000,
      data: container,
      headers: { Authorization: 'Bearer token' },
    });
  });

  test('should fail closed on unknown auth type', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    http.configuration = {
      url: 'https://example.com/webhook',
      method: 'POST',
      auth: { type: 'UNKNOWN' },
    };
    const container = { name: 'test' };

    await expect(http.trigger(container)).rejects.toThrow('auth type "UNKNOWN" is unsupported');
    expect(axios).not.toHaveBeenCalled();
  });

  test('should fail closed when BASIC auth credentials are incomplete', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    http.configuration = {
      url: 'https://example.com/webhook',
      method: 'POST',
      auth: { type: 'BASIC', user: 'user' },
    };

    await expect(http.trigger({ name: 'test' })).rejects.toThrow('basic auth password is missing');
    expect(axios).not.toHaveBeenCalled();
  });

  test('should fail closed when BEARER token is missing', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    http.configuration = {
      url: 'https://example.com/webhook',
      method: 'POST',
      auth: { type: 'BEARER' },
    };

    await expect(http.trigger({ name: 'test' })).rejects.toThrow('bearer token is missing');
    expect(axios).not.toHaveBeenCalled();
  });

  test('should handle request with no auth and no proxy', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    http.configuration = {
      url: 'https://example.com/webhook',
      method: 'POST',
    };
    const container = { name: 'test' };

    await http.trigger(container);
    expect(axios).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.com/webhook',
      timeout: 30000,
      data: container,
    });
  });

  test('should omit data and params for non-GET/POST methods', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    http.configuration = {
      url: 'https://example.com/webhook',
      method: 'PUT',
    };
    const container = { name: 'test' };

    await http.trigger(container);
    expect(axios).toHaveBeenCalledWith({
      method: 'PUT',
      url: 'https://example.com/webhook',
      timeout: 30000,
    });
  });

  test('should use proxy', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
      proxy: 'http://proxy:8080',
    });
    const container = { name: 'test' };

    await http.trigger(container);
    expect(axios).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://example.com/webhook',
      timeout: 30000,
      data: container,
      proxy: { host: 'proxy', port: 8080 },
    });
  });

  test('should use default https proxy port when none is specified', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
      proxy: 'https://secure-proxy',
    });

    await http.trigger({ name: 'test' });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: { host: 'secure-proxy', port: 443 },
      }),
    );
  });

  test('should use centralized outbound timeout when env override is set', async () => {
    const previousTimeout = process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
    process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = '1234';

    try {
      const { default: axios } = await import('axios');
      axios.mockResolvedValue({ data: {} });
      await http.register('trigger', 'http', 'test', {
        url: 'https://example.com/webhook',
      });

      await http.trigger({ name: 'test' });

      expect(axios).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 1234,
        }),
      );
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS;
      } else {
        process.env.DD_OUTBOUND_HTTP_TIMEOUT_MS = previousTimeout;
      }
    }
  });
});
