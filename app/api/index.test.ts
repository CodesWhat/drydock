// @ts-nocheck
const { mockApp, mockFs, mockHttps, mockGetServerConfiguration } = vi.hoisted(() => ({
  mockApp: {
    set: vi.fn(),
    use: vi.fn(),
    listen: vi.fn((port, cb) => cb()),
  },
  mockFs: {
    readFileSync: vi.fn(),
  },
  mockHttps: {
    createServer: vi.fn(() => ({
      listen: vi.fn((port, cb) => cb()),
    })),
  },
  mockGetServerConfiguration: vi.fn(() => ({
    enabled: true,
    port: 3000,
    cors: {},
    tls: {},
  })),
}));

vi.mock('node:fs', () => ({
  default: mockFs,
}));

vi.mock('node:https', () => ({
  default: mockHttps,
}));

vi.mock('express', () => ({
  default: Object.assign(
    vi.fn(() => mockApp),
    {
      json: vi.fn(() => 'json-middleware'),
    },
  ),
}));

vi.mock('cors', () => ({
  default: vi.fn(() => 'cors-middleware'),
}));

vi.mock('../log', () => ({
  default: {
    child: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock('./auth', () => ({
  init: vi.fn(),
}));

vi.mock('./api', () => ({
  init: vi.fn(() => 'api-router'),
}));

vi.mock('./ui', () => ({
  init: vi.fn(() => 'ui-router'),
}));

vi.mock('./prometheus', () => ({
  init: vi.fn(() => 'prometheus-router'),
}));

vi.mock('./health', () => ({
  init: vi.fn(() => 'health-router'),
}));

vi.mock('../configuration', () => ({
  getServerConfiguration: mockGetServerConfiguration,
}));

// The index module reads configuration at module level, so we must
// re-import after setting the desired mock return value.
describe('API Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.set.mockClear();
    mockApp.use.mockClear();
    mockApp.listen.mockClear();
  });

  test('should not start server when disabled', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: false,
      port: 3000,
      cors: {},
      tls: {},
    });

    // Re-import to pick up the new configuration
    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    // auth.init should not have been called since server is disabled
    // We need to check the freshly imported auth mock
    const freshAuth = await import('./auth.js');
    expect(freshAuth.init).not.toHaveBeenCalled();
  });

  test('should start HTTP server when enabled', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
  });

  test('should enable CORS when configured', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {
        enabled: true,
        origin: '*', // NOSONAR - test fixture
        methods: 'GET,POST',
      },
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).toHaveBeenCalledWith('cors-middleware');
  });

  test('should mount all routers', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.use).toHaveBeenCalledWith('/health', 'health-router');
    expect(mockApp.use).toHaveBeenCalledWith('/api', 'api-router');
    expect(mockApp.use).toHaveBeenCalledWith('/metrics', 'prometheus-router');
    expect(mockApp.use).toHaveBeenCalledWith('/', 'ui-router');
  });

  test('should not set trust proxy when default (false)', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      trustproxy: false,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.set).not.toHaveBeenCalledWith('trust proxy', expect.anything());
    expect(mockApp.set).toHaveBeenCalledWith('json replacer', expect.any(Function));
  });

  test('should set trust proxy when configured as hop count', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      trustproxy: 1,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.set).toHaveBeenCalledWith('trust proxy', 1);
  });

  test('should set trust proxy when configured as true', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      trustproxy: true,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.set).toHaveBeenCalledWith('trust proxy', true);
  });

  test('should set json replacer', async () => {
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {},
      trustproxy: false,
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockApp.set).toHaveBeenCalledWith('json replacer', expect.any(Function));

    // Test the json replacer function
    const replacerCall = mockApp.set.mock.calls.find((c) => c[0] === 'json replacer');
    const replacer = replacerCall[1];
    expect(replacer('key', undefined)).toBeNull();
    expect(replacer('key', 'value')).toBe('value');
    expect(replacer('key', 0)).toBe(0);
  });

  test('should start HTTPS server when TLS enabled', async () => {
    mockFs.readFileSync.mockReturnValueOnce('key-content').mockReturnValueOnce('cert-content');
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {
        enabled: true,
        key: '/path/to/key',
        cert: '/path/to/cert',
      },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await indexRouter.init();

    expect(mockFs.readFileSync).toHaveBeenCalledWith('/path/to/key');
    expect(mockFs.readFileSync).toHaveBeenCalledWith('/path/to/cert');
    expect(mockHttps.createServer).toHaveBeenCalledWith(
      { key: 'key-content', cert: 'cert-content' },
      mockApp,
    );
  });

  test('should throw when TLS key file cannot be read', async () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('File not found');
    });
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {
        enabled: true,
        key: '/bad/path',
        cert: '/path/to/cert',
      },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await expect(indexRouter.init()).rejects.toThrow('File not found');
  });

  test('should throw when TLS cert file cannot be read', async () => {
    mockFs.readFileSync.mockReturnValueOnce('key-content').mockImplementationOnce(() => {
      throw new Error('Cert not found');
    });
    mockGetServerConfiguration.mockReturnValue({
      enabled: true,
      port: 3000,
      cors: {},
      tls: {
        enabled: true,
        key: '/path/to/key',
        cert: '/bad/cert',
      },
    });

    vi.resetModules();
    const indexRouter = await import('./index.js');
    await expect(indexRouter.init()).rejects.toThrow('Cert not found');
  });
});
