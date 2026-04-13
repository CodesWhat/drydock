const mockExistsSync = vi.hoisted(() => vi.fn());
const mockProbeSocketApiVersion = vi.hoisted(() => vi.fn());
const mockDisableSocketRedirects = vi.hoisted(() => vi.fn());
const mockInspect = vi.hoisted(() => vi.fn());
const mockGetContainer = vi.hoisted(() => vi.fn(() => ({ inspect: mockInspect })));
const mockDockerode = vi.hoisted(() =>
  vi.fn(function MockDockerode() {
    return {
      getContainer: mockGetContainer,
    };
  }),
);

vi.mock('node:fs', () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  },
}));

vi.mock('dockerode', () => ({
  default: mockDockerode,
}));

vi.mock('../watchers/providers/docker/socket-version-probe.js', () => ({
  probeSocketApiVersion: (...args: unknown[]) => mockProbeSocketApiVersion(...args),
}));

vi.mock('../watchers/providers/docker/disable-socket-redirects.js', () => ({
  disableSocketRedirects: (...args: unknown[]) => mockDisableSocketRedirects(...args),
}));

describe('curl healthcheck compatibility', () => {
  const originalHostname = process.env.HOSTNAME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTNAME = 'drydock-self';
    mockExistsSync.mockReturnValue(true);
    mockProbeSocketApiVersion.mockResolvedValue('1.44');
    mockInspect.mockResolvedValue({
      Config: {
        Healthcheck: {
          Test: ['CMD-SHELL', 'curl --fail http://localhost:3000/health || exit 1'],
        },
      },
    });
  });

  afterAll(() => {
    if (originalHostname === undefined) {
      delete process.env.HOSTNAME;
    } else {
      process.env.HOSTNAME = originalHostname;
    }
  });

  test('detects a custom curl healthcheck override on the current container', async () => {
    const { getCurlHealthcheckOverrideCompatibility } = await import('./curl-healthcheck.js');

    const result = await getCurlHealthcheckOverrideCompatibility();

    expect(result).toEqual({
      detected: true,
      commandPreview: 'CMD-SHELL curl --fail http://localhost:3000/health || exit 1',
    });
    expect(mockDockerode).toHaveBeenCalledWith({
      socketPath: '/var/run/docker.sock',
      version: 'v1.44',
    });
    expect(mockGetContainer).toHaveBeenCalledWith(expect.any(String));
    expect(mockDisableSocketRedirects).toHaveBeenCalled();
  });

  test('returns not detected when hostname is not a valid container identifier', async () => {
    const { getCurlHealthcheckOverrideCompatibility } = await import('./curl-healthcheck.js');
    const originalHostname = process.env.HOSTNAME;
    process.env.HOSTNAME = 'pod/name';

    try {
      await expect(getCurlHealthcheckOverrideCompatibility()).resolves.toEqual({
        detected: false,
      });
      expect(mockDockerode).not.toHaveBeenCalled();
    } finally {
      if (originalHostname === undefined) {
        delete process.env.HOSTNAME;
      } else {
        process.env.HOSTNAME = originalHostname;
      }
    }
  });

  test('returns not detected when the healthcheck does not use curl', async () => {
    mockInspect.mockResolvedValue({
      Config: {
        Healthcheck: {
          Test: ['CMD', '/bin/healthcheck', '3000'],
        },
      },
    });
    const { getCurlHealthcheckOverrideCompatibility } = await import('./curl-healthcheck.js');

    await expect(getCurlHealthcheckOverrideCompatibility()).resolves.toEqual({
      detected: false,
    });
  });

  test('returns undefined preview for empty and blank healthcheck commands', async () => {
    const { getHealthcheckCommandPreview } = await import('./curl-healthcheck.js');

    expect(getHealthcheckCommandPreview([])).toBeUndefined();
    expect(getHealthcheckCommandPreview([' ', '\t'])).toBeUndefined();
  });

  test('truncates long healthcheck command previews', async () => {
    const { getHealthcheckCommandPreview } = await import('./curl-healthcheck.js');

    const preview = getHealthcheckCommandPreview(['CMD-SHELL', 'x'.repeat(200)]);
    expect(preview).toHaveLength(160);
    expect(preview?.endsWith('…')).toBe(true);
  });

  test('creates docker client without version when socket probing returns nothing', async () => {
    mockProbeSocketApiVersion.mockResolvedValue(undefined);
    const { getCurlHealthcheckOverrideCompatibility } = await import('./curl-healthcheck.js');

    await expect(getCurlHealthcheckOverrideCompatibility()).resolves.toEqual({
      detected: true,
      commandPreview: 'CMD-SHELL curl --fail http://localhost:3000/health || exit 1',
    });
    expect(mockDockerode).toHaveBeenCalledWith({
      socketPath: '/var/run/docker.sock',
    });
  });

  test('returns not detected when Docker inspection throws', async () => {
    mockInspect.mockRejectedValue(new Error('inspect failed'));
    const { getCurlHealthcheckOverrideCompatibility } = await import('./curl-healthcheck.js');

    await expect(getCurlHealthcheckOverrideCompatibility()).resolves.toEqual({
      detected: false,
    });
  });
});
