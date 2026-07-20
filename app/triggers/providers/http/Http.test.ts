import Http, { isMetadataAddress } from './Http.js';

// Mock axios
vi.mock('axios', () => ({ default: vi.fn() }));
vi.mock('../../../log/index.js', () => ({
  default: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  },
}));

var dnsMockControl = vi.hoisted(() => ({
  lookupImpl: null as null | ((hostname: string) => Promise<{ address: string; family: number }[]>),
}));

vi.mock('node:dns/promises', async () => {
  return {
    lookup: (hostname: string, options: unknown) => {
      if (dnsMockControl.lookupImpl !== null) {
        return dnsMockControl.lookupImpl(hostname);
      }
      // Default: resolve to a normal RFC-1918 address (not metadata)
      return Promise.resolve([{ address: '192.168.1.50', family: 4 }]);
    },
  };
});

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

  test('should fail validation when BASIC auth is missing password', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'BASIC', user: 'user' },
    };

    expect(() => http.validateConfiguration(config)).toThrow('"auth.password" is required');
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

    expect(http.validateConfiguration(config)).toMatchObject(config);
  });

  test('should validate configuration with complete BEARER auth', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'BEARER', bearer: 'token' },
    };

    expect(http.validateConfiguration(config)).toMatchObject(config);
  });

  test('should reject unsupported URL schemes', async () => {
    const config = {
      url: 'ftp://example.com/webhook',
    };

    expect(() => http.validateConfiguration(config)).toThrow();
  });

  test('should reject unsupported proxy URL schemes', async () => {
    const config = {
      url: 'https://example.com/webhook',
      proxy: 'ftp://proxy:21',
    };

    expect(() => http.validateConfiguration(config)).toThrow();
  });

  test('should validate GET method explicitly', async () => {
    const config = {
      url: 'https://example.com/webhook',
      method: 'GET',
    };

    expect(http.validateConfiguration(config)).toMatchObject(config);
  });

  test('should validate POST method explicitly', async () => {
    const config = {
      url: 'https://example.com/webhook',
      method: 'POST',
    };

    expect(http.validateConfiguration(config)).toMatchObject(config);
  });

  test('should reject unsupported HTTP methods', async () => {
    const config = {
      url: 'https://example.com/webhook',
      method: 'PUT',
    };

    expect(() => http.validateConfiguration(config)).toThrow();
  });

  test('should default auth type to BASIC during validation', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { user: 'user', password: 'pass' },
    };

    expect(http.validateConfiguration(config)).toMatchObject({
      ...config,
      auth: { type: 'BASIC', user: 'user', password: 'pass' },
    });
  });

  test('should reject unsupported auth types', async () => {
    const config = {
      url: 'https://example.com/webhook',
      auth: { type: 'TOKEN' },
    };

    expect(() => http.validateConfiguration(config)).toThrow();
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
      maxRedirects: 0,
      lookup: expect.any(Function),
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
      maxRedirects: 0,
      lookup: expect.any(Function),
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
      maxRedirects: 0,
      lookup: expect.any(Function),
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
      maxRedirects: 0,
      lookup: expect.any(Function),
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
      maxRedirects: 0,
      lookup: expect.any(Function),
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
      maxRedirects: 0,
      lookup: expect.any(Function),
      data: container,
    });
  });

  test('should fail closed when BASIC auth username is missing', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    http.configuration = {
      url: 'https://example.com/webhook',
      method: 'POST',
      auth: { type: 'BASIC', password: 'pass' },
    };

    await expect(http.trigger({ name: 'test' })).rejects.toThrow('basic auth username is missing');
    expect(axios).not.toHaveBeenCalled();
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
      maxRedirects: 0,
      lookup: expect.any(Function),
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
      maxRedirects: 0,
      lookup: expect.any(Function),
      data: container,
      proxy: { host: 'proxy', port: 8080 },
    });
  });

  test('should use default http proxy port when none is specified', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
      proxy: 'http://proxy',
    });

    await http.trigger({ name: 'test' });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: { host: 'proxy', port: 80 },
      }),
    );
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

  test('should fail closed on unsupported proxy URL schemes at runtime', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    http.configuration = {
      url: 'https://example.com/webhook',
      method: 'POST',
      proxy: 'ftp://proxy:21',
    };

    await expect(http.trigger({ name: 'test' })).rejects.toThrow(
      'proxy URL scheme "ftp:" is unsupported',
    );
    expect(axios).not.toHaveBeenCalled();
  });

  test('should trigger batch with runtimeContext.title only — envelope with empty body', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
    });
    const containers = [{ name: 'app1' }];

    await http.triggerBatch(containers, {
      title: 'Security scan: 1 finding',
      eventKind: 'security-alert-digest',
    });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          title: 'Security scan: 1 finding',
          body: '',
          eventKind: 'security-alert-digest',
          containers,
        },
      }),
    );
  });

  test('should trigger batch with runtimeContext.body only — envelope with empty title', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
    });
    const containers = [{ name: 'app1' }];

    await http.triggerBatch(containers, { body: '- app1: 1 critical' });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          title: '',
          body: '- app1: 1 critical',
          eventKind: undefined,
          containers,
        },
      }),
    );
  });

  test('should trigger batch with full runtimeContext — full envelope', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
    });
    const containers = [{ name: 'app1' }];
    const runtimeContext = {
      title: 'Security scan: 1 finding',
      body: '- app1: 1 critical',
      eventKind: 'security-alert-digest',
    };

    await http.triggerBatch(containers, runtimeContext);

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          title: 'Security scan: 1 finding',
          body: '- app1: 1 critical',
          eventKind: 'security-alert-digest',
          containers,
        },
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

// ---- Security: SSRF metadata guard (finding 3) ----

describe('isMetadataAddress helper', () => {
  test('169.254.169.254 is a metadata address (AWS IMDSv1)', () => {
    expect(isMetadataAddress('169.254.169.254')).toBe(true);
  });

  test('169.254.0.1 is a metadata/link-local address', () => {
    expect(isMetadataAddress('169.254.0.1')).toBe(true);
  });

  test('169.254.255.255 is a metadata/link-local address', () => {
    expect(isMetadataAddress('169.254.255.255')).toBe(true);
  });

  test('192.168.1.50 is NOT a metadata address (RFC-1918, allowed)', () => {
    expect(isMetadataAddress('192.168.1.50')).toBe(false);
  });

  test('10.0.0.1 is NOT a metadata address (RFC-1918, allowed)', () => {
    expect(isMetadataAddress('10.0.0.1')).toBe(false);
  });

  test('1.2.3.4 is NOT a metadata address (public)', () => {
    expect(isMetadataAddress('1.2.3.4')).toBe(false);
  });

  test('fe80::1 is a metadata/link-local IPv6 address', () => {
    expect(isMetadataAddress('fe80::1')).toBe(true);
  });

  test('fe80:0000:0000:0000:0000:0000:0000:0001 is link-local IPv6', () => {
    expect(isMetadataAddress('fe80:0000:0000:0000:0000:0000:0000:0001')).toBe(true);
  });

  test('fd00:ec2::254 is the AWS metadata IPv6 address', () => {
    expect(isMetadataAddress('fd00:ec2::254')).toBe(true);
  });

  test('::1 is NOT a metadata address', () => {
    expect(isMetadataAddress('::1')).toBe(false);
  });

  test('2001:db8::1 is NOT a metadata address', () => {
    expect(isMetadataAddress('2001:db8::1')).toBe(false);
  });
});

describe('isMetadataAddress — IPv4-mapped IPv6 normalization', () => {
  // --- blocked ---
  test('::ffff:169.254.169.254 (dotted-quad mapped) is blocked', () => {
    expect(isMetadataAddress('::ffff:169.254.169.254')).toBe(true);
  });

  test('::FFFF:169.254.169.254 (mixed case) is blocked', () => {
    expect(isMetadataAddress('::FFFF:169.254.169.254')).toBe(true);
  });

  test('0:0:0:0:0:ffff:169.254.169.254 (uncompressed dotted-quad mapped) is blocked', () => {
    expect(isMetadataAddress('0:0:0:0:0:ffff:169.254.169.254')).toBe(true);
  });

  test('::ffff:a9fe:a9fe (hex-pair mapped for 169.254.169.254) is blocked', () => {
    expect(isMetadataAddress('::ffff:a9fe:a9fe')).toBe(true);
  });

  test('0:0:0:0:0:ffff:a9fe:a9fe (uncompressed hex-pair mapped) is blocked', () => {
    expect(isMetadataAddress('0:0:0:0:0:ffff:a9fe:a9fe')).toBe(true);
  });

  test('::169.254.169.254 (obsolete IPv4-compatible form) is blocked', () => {
    expect(isMetadataAddress('::169.254.169.254')).toBe(true);
  });

  // --- allowed ---
  test('::ffff:8.8.8.8 (public DNS) is NOT blocked', () => {
    expect(isMetadataAddress('::ffff:8.8.8.8')).toBe(false);
  });

  test('::ffff:10.0.0.5 (RFC-1918, intentionally allowed) is NOT blocked', () => {
    expect(isMetadataAddress('::ffff:10.0.0.5')).toBe(false);
  });
});

describe('HTTP Trigger SSRF guard — IPv4-mapped IPv6 end-to-end', () => {
  let http;

  beforeEach(async () => {
    http = new Http();
    vi.clearAllMocks();
  });

  test('rejects bracketed ::ffff:169.254.169.254 URL without executing request', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'http://[::ffff:169.254.169.254]/latest/meta-data',
    });

    await expect(http.trigger({ name: 'test' })).rejects.toThrow(/metadata.*address/i);
    expect(axios).not.toHaveBeenCalled();
  });

  test('rejects bracketed ::FFFF:169.254.169.254 (mixed case) URL', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'http://[::FFFF:169.254.169.254]/latest/meta-data',
    });

    await expect(http.trigger({ name: 'test' })).rejects.toThrow(/metadata.*address/i);
    expect(axios).not.toHaveBeenCalled();
  });

  test('allows bracketed ::ffff:8.8.8.8 (public address)', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'http://[::ffff:8.8.8.8]/webhook',
    });

    await expect(http.trigger({ name: 'test' })).resolves.toBeDefined();
    expect(axios).toHaveBeenCalled();
  });
});

describe('HTTP Trigger SSRF guard', () => {
  let http;

  beforeEach(async () => {
    http = new Http();
    vi.clearAllMocks();
    dnsMockControl.lookupImpl = null;
  });

  afterEach(() => {
    dnsMockControl.lookupImpl = null;
  });

  test('rejects literal 169.254.169.254 URL without executing request', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'http://169.254.169.254/latest/meta-data/',
    });

    await expect(http.trigger({ name: 'test' })).rejects.toThrow(/metadata.*address/i);
    expect(axios).not.toHaveBeenCalled();
  });

  test('rejects hostname that resolves to 169.254.x.x (mocked dns)', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'http://metadata.internal/data',
    });

    dnsMockControl.lookupImpl = async () => [{ address: '169.254.169.254', family: 4 }];

    await expect(http.trigger({ name: 'test' })).rejects.toThrow(/metadata.*address/i);
    expect(axios).not.toHaveBeenCalled();
  });

  test('allows RFC-1918 target (192.168.x.x) — normal self-hosted use case', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'http://192.168.1.10/webhook',
    });

    // Default mock resolves to RFC-1918 192.168.1.50
    await expect(http.trigger({ name: 'test' })).resolves.toBeDefined();
    expect(axios).toHaveBeenCalled();
  });

  test('allowmetadata=true bypasses the guard for 169.254.169.254', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'http://169.254.169.254/latest/meta-data/',
      allowmetadata: true,
    });

    await expect(http.trigger({ name: 'test' })).resolves.toBeDefined();
    expect(axios).toHaveBeenCalled();
  });

  test('rejects IPv6 link-local URL in brackets [fe80::1]', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'http://[fe80::1]/webhook',
    });

    await expect(http.trigger({ name: 'test' })).rejects.toThrow(/metadata.*address/i);
    expect(axios).not.toHaveBeenCalled();
  });

  test('DNS resolution failure does not mask the error — original axios error propagates', async () => {
    const { default: axios } = await import('axios');
    axios.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await http.register('trigger', 'http', 'test', {
      url: 'http://nonexistent-host.example/webhook',
    });

    dnsMockControl.lookupImpl = async () => {
      throw new Error('ENOTFOUND nonexistent-host.example');
    };

    await expect(http.trigger({ name: 'test' })).rejects.toThrow(/ENOTFOUND/);
    expect(axios).not.toHaveBeenCalled();
  });

  test('validateConfiguration accepts allowmetadata boolean option', () => {
    expect(() =>
      http.validateConfiguration({ url: 'http://example.com/webhook', allowmetadata: true }),
    ).not.toThrow();
  });

  test('validateConfiguration defaults allowmetadata to false', () => {
    const result = http.validateConfiguration({ url: 'http://example.com/webhook' });
    expect(result.allowmetadata).toBe(false);
  });

  test('disables redirects so a validated URL cannot redirect to metadata', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    await http.register('trigger', 'http', 'test', {
      url: 'https://example.com/webhook',
    });

    await http.trigger({ name: 'test' });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRedirects: 0,
      }),
    );
  });

  test('revalidates and pins the DNS address used by the outbound socket', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    let lookupCount = 0;
    dnsMockControl.lookupImpl = async () => {
      lookupCount += 1;
      return lookupCount === 1
        ? [{ address: '203.0.113.10', family: 4 }]
        : [{ address: '169.254.169.254', family: 4 }];
    };
    await http.register('trigger', 'http', 'test', {
      url: 'https://rebind.example/webhook',
    });

    await http.trigger({ name: 'test' });

    const requestOptions = axios.mock.calls[0][0];
    await expect(
      new Promise((resolve, reject) => {
        requestOptions.lookup('rebind.example', {}, (error, address, family) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ address, family });
        });
      }),
    ).rejects.toThrow(/metadata.*address/i);
    expect(lookupCount).toBe(2);
  });
});
