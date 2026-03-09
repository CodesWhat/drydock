import path from 'node:path';

const {
  mockRouter,
  mockRateLimit,
  mockRandomUUID,
  mockAccess,
  mockMkdir,
  mockWriteFile,
  mockRename,
  mockUnlink,
  mockReaddir,
  mockStat,
  mockAxiosGet,
  mockAxiosIsAxiosError,
  mockIsInternetlessModeEnabled,
  mockGetStoreConfiguration,
  mockResolveFromRuntimeRoot,
  mockCreateAuthenticatedRouteRateLimitKeyGenerator,
  mockIsIdentityAwareRateLimitKeyingEnabled,
} = vi.hoisted(() => ({
  mockRouter: { get: vi.fn(), delete: vi.fn() },
  mockRateLimit: vi.fn(() => 'icon-rate-limit-middleware'),
  mockRandomUUID: vi.fn(() => 'uuid-test'),
  mockAccess: vi.fn(),
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockRename: vi.fn(),
  mockUnlink: vi.fn(),
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
  mockAxiosGet: vi.fn(),
  mockAxiosIsAxiosError: vi.fn(() => false),
  mockIsInternetlessModeEnabled: vi.fn(() => false),
  mockGetStoreConfiguration: vi.fn(() => ({ path: '/store', file: 'dd.json' })),
  mockResolveFromRuntimeRoot: vi.fn(),
  mockCreateAuthenticatedRouteRateLimitKeyGenerator: vi.fn(() => undefined),
  mockIsIdentityAwareRateLimitKeyingEnabled: vi.fn(() => false),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
}));

vi.mock('express-rate-limit', () => ({
  default: mockRateLimit,
}));

vi.mock('node:crypto', () => ({
  default: {
    randomUUID: mockRandomUUID,
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    access: mockAccess,
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    rename: mockRename,
    unlink: mockUnlink,
    readdir: mockReaddir,
    stat: mockStat,
  },
}));

vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
    isAxiosError: mockAxiosIsAxiosError,
  },
}));

vi.mock('../store/settings', () => ({
  isInternetlessModeEnabled: mockIsInternetlessModeEnabled,
}));

vi.mock('../store', () => ({
  getConfiguration: mockGetStoreConfiguration,
}));

vi.mock('../runtime/paths', async () => {
  const actual = await vi.importActual<typeof import('../runtime/paths')>('../runtime/paths');
  return {
    ...actual,
    resolveFromRuntimeRoot: mockResolveFromRuntimeRoot,
  };
});

vi.mock('../log', () => ({
  default: { child: vi.fn(() => ({ warn: vi.fn(), info: vi.fn() })) },
}));
vi.mock('./rate-limit-key.js', () => ({
  createAuthenticatedRouteRateLimitKeyGenerator: mockCreateAuthenticatedRouteRateLimitKeyGenerator,
  isIdentityAwareRateLimitKeyingEnabled: mockIsIdentityAwareRateLimitKeyingEnabled,
}));

import { ICON_CACHE_ENFORCEMENT_INTERVAL_MS } from './icons/settings.js';
import { enforceIconCacheLimits, resetIconCacheEnforcementStateForTests } from './icons/storage.js';
import * as iconsRouter from './icons.js';

function getHandler() {
  iconsRouter.init();
  const route = mockRouter.get.mock.calls.find((call) => call[0] === '/:provider/:slug');
  return route[route.length - 1];
}

function getDeleteHandler() {
  iconsRouter.init();
  return mockRouter.delete.mock.calls.find((call) => call[0] === '/cache')[1];
}

function createResponse() {
  return {
    set: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    sendFile: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    sendStatus: vi.fn(),
  };
}

describe('Icons Router', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetIconCacheEnforcementStateForTests();
    mockIsIdentityAwareRateLimitKeyingEnabled.mockReturnValue(false);
    mockCreateAuthenticatedRouteRateLimitKeyGenerator.mockReturnValue(undefined);
    mockIsInternetlessModeEnabled.mockReturnValue(false);
    mockGetStoreConfiguration.mockReturnValue({ path: '/store', file: 'dd.json' });
    mockResolveFromRuntimeRoot.mockImplementation((...segments: string[]) =>
      path.posix.resolve('/runtime', ...segments),
    );
    mockAxiosIsAxiosError.mockReturnValue(false);
    mockAccess.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);
    mockStat.mockResolvedValue({
      mtimeMs: Date.now(),
      size: 1024,
      isFile: () => true,
    });
  });

  test('should initialize router with icon and cache routes', () => {
    const router = iconsRouter.init();
    const iconRoute = mockRouter.get.mock.calls.find((call) => call[0] === '/:provider/:slug');
    expect(iconRoute).toBeDefined();
    expect(iconRoute?.[iconRoute.length - 1]).toEqual(expect.any(Function));
    expect(router.delete).toHaveBeenCalledWith('/cache', expect.any(Function));
  });

  test('should register ip rate-limiter on icon proxy route', () => {
    iconsRouter.init();

    expect(mockRateLimit).toHaveBeenCalledWith({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      validate: { xForwardedForHeader: false },
    });
    expect(mockRouter.get).toHaveBeenCalledWith(
      '/:provider/:slug',
      'icon-rate-limit-middleware',
      expect.any(Function),
    );
  });

  test('should include identity-aware key generator in icon proxy limiter when enabled', () => {
    const keyGenerator = vi.fn(() => 'session:test');
    mockIsIdentityAwareRateLimitKeyingEnabled.mockReturnValue(true);
    mockCreateAuthenticatedRouteRateLimitKeyGenerator.mockReturnValue(keyGenerator);

    iconsRouter.init();

    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        keyGenerator,
      }),
    );
  });

  test('should serve icon from cache when available', async () => {
    mockAccess.mockResolvedValue(undefined);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'homarr',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
    expect(res.type).toHaveBeenCalledWith('image/png');
    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/store/icons/homarr',
    });
  });

  test('should serve bundled selfhst icon when cache is missing', async () => {
    mockAccess.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/runtime/assets/icons/selfhst/docker.png') {
        return;
      }
      throw new Error('not found');
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'selfhst',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/runtime/assets/icons/selfhst',
    });
  });

  test('should serve bundled selfhst icon when internetless mode is enabled', async () => {
    mockIsInternetlessModeEnabled.mockReturnValue(true);
    mockAccess.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/runtime/assets/icons/selfhst/docker.png') {
        return;
      }
      throw new Error('not found');
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'selfhst',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/runtime/assets/icons/selfhst',
    });
  });

  test('should return 404 on cache miss when internetless mode is enabled', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockIsInternetlessModeEnabled.mockReturnValue(true);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Icon simple/docker is not cached',
      fallbackIcon: 'fab fa-docker',
    });
  });

  test('should fetch icon and cache it when cache miss occurs', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/docker.svg',
      {
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
      },
    );
    expect(mockMkdir).toHaveBeenCalledWith('/store/icons/simple', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/store/icons/simple/docker.svg.tmp.uuid-test',
      expect.any(Buffer),
    );
    expect(mockRename).toHaveBeenCalledWith(
      '/store/icons/simple/docker.svg.tmp.uuid-test',
      '/store/icons/simple/docker.svg',
    );
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should normalize slug extension and fetch homarr icon URL', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'homarr',
          slug: 'docker.png',
        },
      },
      res,
    );

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/docker.png',
      {
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
      },
    );
    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/store/icons/homarr',
    });
  });

  test('should skip axios when icon appears in cache after first miss', async () => {
    mockAccess.mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce(undefined);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should refresh stale cached icon when ttl has expired', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({
      mtimeMs: 0,
      size: 512,
      isFile: () => true,
    });
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/docker.svg');
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/docker.svg',
      {
        responseType: 'arraybuffer',
        timeout: 10000,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024,
      },
    );
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should continue fetching when stale cache cleanup unlink fails', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({
      mtimeMs: 0,
      size: 512,
      isFile: () => true,
    });
    mockUnlink.mockRejectedValue(new Error('permission denied'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should refetch icon when cache path exists but is not a regular file', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/docker.svg') {
        return {
          mtimeMs: Date.now(),
          size: 512,
          isFile: () => false,
        };
      }
      return {
        mtimeMs: Date.now(),
        size: 512,
        isFile: () => true,
      };
    });
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should refetch icon when cache stat fails unexpectedly', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/docker.svg') {
        throw new Error('stat failed');
      }
      return {
        mtimeMs: Date.now(),
        size: 512,
        isFile: () => true,
      };
    });
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should evict oldest cached icons when cache size limit is exceeded', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['old.svg', 'docker.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/old.svg') {
        return { mtimeMs: Date.now() - 1_000, size: 150 * 1024 * 1024, isFile: () => true };
      }
      if (targetPath === '/store/icons/simple/docker.svg') {
        return { mtimeMs: Date.now(), size: 50 * 1024 * 1024, isFile: () => true };
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/old.svg');
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should stat provider cache entries in parallel during enforcement', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['old.svg', 'docker.svg']);

    let resolveOldStat:
      | ((stats: { mtimeMs: number; size: number; isFile: () => boolean }) => void)
      | undefined;
    const oldStatPromise = new Promise<{ mtimeMs: number; size: number; isFile: () => boolean }>(
      (resolve) => {
        resolveOldStat = resolve;
      },
    );

    mockStat.mockImplementation((targetPath: string) => {
      if (targetPath === '/store/icons/simple/old.svg') {
        return oldStatPromise;
      }
      if (targetPath === '/store/icons/simple/docker.svg') {
        return Promise.resolve({
          mtimeMs: Date.now(),
          size: 50 * 1024 * 1024,
          isFile: () => true,
        });
      }
      return Promise.resolve({
        mtimeMs: Date.now(),
        size: 1024,
        isFile: () => true,
      });
    });

    const handler = getHandler();
    const res = createResponse();
    const handlerPromise = handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    await vi.waitFor(() => expect(mockStat).toHaveBeenCalled());
    try {
      expect(mockStat).toHaveBeenCalledTimes(2);
    } finally {
      resolveOldStat?.({
        mtimeMs: Date.now() - 1_000,
        size: 150 * 1024 * 1024,
        isFile: () => true,
      });
    }

    await handlerPromise;

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/old.svg');
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should wait on in-flight icon cache enforcement instead of starting a second run', async () => {
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['docker.svg']);

    let resolveStat:
      | ((stats: { mtimeMs: number; size: number; isFile: () => boolean }) => void)
      | undefined;
    mockStat.mockImplementation(
      () =>
        new Promise<{ mtimeMs: number; size: number; isFile: () => boolean }>((resolve) => {
          resolveStat = resolve;
        }),
    );

    const firstEnforcement = enforceIconCacheLimits();
    await vi.waitFor(() => expect(mockStat).toHaveBeenCalledTimes(1));

    let secondResolved = false;
    const secondEnforcement = enforceIconCacheLimits().then(() => {
      secondResolved = true;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    resolveStat?.({
      mtimeMs: Date.now(),
      size: 1024,
      isFile: () => true,
    });

    await Promise.all([firstEnforcement, secondEnforcement]);

    expect(secondResolved).toBe(true);
    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });

  test('should drop protected path when enforcement is skipped inside interval window', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const baseTimeMs = 1_700_000_000_000;
    nowSpy.mockReturnValue(baseTimeMs);

    try {
      await enforceIconCacheLimits();

      nowSpy.mockReturnValue(baseTimeMs + 1);
      await enforceIconCacheLimits({ protectedPath: '/store/icons/simple/stale.svg' });

      mockReaddir
        .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
        .mockResolvedValueOnce(['stale.svg', 'docker.svg']);
      mockStat.mockImplementation(async (targetPath: string) => {
        if (targetPath === '/store/icons/simple/stale.svg') {
          return { mtimeMs: 0, size: 1024, isFile: () => true };
        }
        return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
      });

      nowSpy.mockReturnValue(baseTimeMs + ICON_CACHE_ENFORCEMENT_INTERVAL_MS + 1);
      await enforceIconCacheLimits();

      expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/stale.svg');
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('should skip repeated enforcement inside interval when no protected path is provided', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const baseTimeMs = 1_700_000_000_000;
    nowSpy.mockReturnValue(baseTimeMs);

    try {
      await enforceIconCacheLimits();
      mockReaddir.mockClear();

      nowSpy.mockReturnValue(baseTimeMs + 1);
      await enforceIconCacheLimits();

      expect(mockReaddir).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('should skip full cache scan for consecutive writes within enforcement interval', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['docker.svg']);
    mockStat.mockResolvedValue({
      mtimeMs: Date.now(),
      size: 1024,
      isFile: () => true,
    });
    const handler = getHandler();
    const res1 = createResponse();
    const res2 = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res1,
    );
    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'nginx',
        },
      },
      res2,
    );

    expect(mockReaddir).toHaveBeenCalledTimes(2);
    expect(mockReaddir).toHaveBeenNthCalledWith(1, '/store/icons', {
      withFileTypes: true,
    });
    expect(mockReaddir).toHaveBeenNthCalledWith(2, '/store/icons/simple');
    expect(res1.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
    expect(res2.sendFile).toHaveBeenCalledWith('nginx.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should skip non-directory and non-file cache entries during enforcement', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([
        { name: '.gitkeep', isDirectory: () => false },
        { name: 'simple', isDirectory: () => true },
      ])
      .mockResolvedValueOnce(['stale.svg', 'nested', 'docker.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/stale.svg') {
        return { mtimeMs: 0, size: 1024, isFile: () => true };
      }
      if (targetPath === '/store/icons/simple/nested') {
        return { mtimeMs: Date.now(), size: 0, isFile: () => false };
      }
      if (targetPath === '/store/icons/simple/docker.svg') {
        return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/stale.svg');
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should ignore icon entries that disappear during enforcement stat pass', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['vanished.svg', 'docker.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/vanished.svg') {
        throw new Error('ENOENT');
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should continue when cache base directory scan fails during enforcement', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir.mockRejectedValueOnce(new Error('EACCES'));
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should continue when provider cache directory scan fails during enforcement', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockRejectedValueOnce(new Error('EACCES'));
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should continue when stale entry eviction unlink fails during enforcement', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['stale.svg', 'docker.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/stale.svg') {
        return { mtimeMs: 0, size: 1024, isFile: () => true };
      }
      if (targetPath === '/store/icons/simple/docker.svg') {
        return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });
    mockUnlink.mockRejectedValue(new Error('permission denied'));
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/stale.svg');
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should continue when size-based eviction unlink fails during enforcement', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['old.svg', 'docker.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/old.svg') {
        return { mtimeMs: Date.now() - 1_000, size: 150 * 1024 * 1024, isFile: () => true };
      }
      if (targetPath === '/store/icons/simple/docker.svg') {
        return { mtimeMs: Date.now(), size: 50 * 1024 * 1024, isFile: () => true };
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });
    mockUnlink.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/old.svg') {
        throw new Error('unlink failed');
      }
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/old.svg');
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should keep protected cache file when it alone exceeds cache size budget', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockReaddir
      .mockResolvedValueOnce([{ name: 'simple', isDirectory: () => true }])
      .mockResolvedValueOnce(['docker.svg']);
    mockStat.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/store/icons/simple/docker.svg') {
        return { mtimeMs: Date.now(), size: 150 * 1024 * 1024, isFile: () => true };
      }
      return { mtimeMs: Date.now(), size: 1024, isFile: () => true };
    });
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockUnlink).not.toHaveBeenCalledWith('/store/icons/simple/docker.svg');
    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should return 404 when upstream icon is missing', async () => {
    const upstreamError = Object.assign(new Error('not found'), {
      response: { status: 404 },
    });
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockRejectedValue(upstreamError);
    mockAxiosIsAxiosError.mockReturnValue(true);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'selfhst',
          slug: 'missing',
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Icon selfhst/missing was not found',
      fallbackIcon: 'fab fa-docker',
    });
  });

  test('should treat upstream 403 as missing and return 404 metadata', async () => {
    const upstreamError = Object.assign(new Error('forbidden'), {
      response: { status: 403 },
    });
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockRejectedValue(upstreamError);
    mockAxiosIsAxiosError.mockReturnValue(true);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'selfhst',
          slug: 'missing',
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Icon selfhst/missing was not found',
      fallbackIcon: 'fab fa-docker',
    });
  });

  test('should serve bundled fallback image when upstream 403 occurs for browser image request', async () => {
    const upstreamError = Object.assign(new Error('forbidden'), {
      response: { status: 403 },
    });
    mockAccess.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/runtime/assets/icons/selfhst/docker.png') {
        return;
      }
      throw new Error('not found');
    });
    mockAxiosGet.mockRejectedValue(upstreamError);
    mockAxiosIsAxiosError.mockReturnValue(true);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'selfhst',
          slug: 'missing',
        },
        headers: {
          'sec-fetch-dest': 'image',
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      },
      res,
    );

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable');
    expect(res.type).toHaveBeenCalledWith('image/png');
    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/runtime/assets/icons/selfhst',
    });
  });

  test('should serve bundled fallback image when sec-fetch-dest header is an array', async () => {
    const upstreamError = Object.assign(new Error('forbidden'), {
      response: { status: 403 },
    });
    mockAccess.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/runtime/assets/icons/selfhst/docker.png') {
        return;
      }
      throw new Error('not found');
    });
    mockAxiosGet.mockRejectedValue(upstreamError);
    mockAxiosIsAxiosError.mockReturnValue(true);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'selfhst',
          slug: 'missing',
        },
        headers: {
          'sec-fetch-dest': ['image'],
        },
      },
      res,
    );

    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/runtime/assets/icons/selfhst',
    });
  });

  test('should serve bundled fallback image when accept header is an array of image types', async () => {
    const upstreamError = Object.assign(new Error('forbidden'), {
      response: { status: 403 },
    });
    mockAccess.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/runtime/assets/icons/selfhst/docker.png') {
        return;
      }
      throw new Error('not found');
    });
    mockAxiosGet.mockRejectedValue(upstreamError);
    mockAxiosIsAxiosError.mockReturnValue(true);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'selfhst',
          slug: 'missing',
        },
        headers: {
          accept: ['text/html', 'image/webp'],
        },
      },
      res,
    );

    expect(res.sendFile).toHaveBeenCalledWith('docker.png', {
      root: '/runtime/assets/icons/selfhst',
    });
  });

  test('should return 404 metadata when fallback image is requested but unavailable', async () => {
    const upstreamError = Object.assign(new Error('forbidden'), {
      response: { status: 403 },
    });
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockRejectedValue(upstreamError);
    mockAxiosIsAxiosError.mockReturnValue(true);
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'selfhst',
          slug: 'missing',
        },
        headers: {
          accept: 'image/png',
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Icon selfhst/missing was not found',
      fallbackIcon: 'fab fa-docker',
    });
  });

  test('should cleanup temp file and return 502 when atomic rename fails', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockRename.mockRejectedValue(new Error('rename failed'));
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(mockUnlink).toHaveBeenCalledWith('/store/icons/simple/docker.svg.tmp.uuid-test');
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unable to fetch icon simple/docker',
    });
  });

  test('should stringify non-Error fetch failures in 502 response', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockRejectedValue('boom');
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unable to fetch icon simple/docker',
    });
  });

  test('should deduplicate concurrent fetches for the same icon', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    let resolveFetch;
    mockAxiosGet.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const handler = getHandler();
    const req = {
      params: {
        provider: 'simple',
        slug: 'docker',
      },
    };
    const res1 = createResponse();
    const res2 = createResponse();

    const pending1 = handler(req, res1);
    const pending2 = handler(req, res2);
    await vi.waitFor(() => {
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    });

    resolveFetch({
      data: Buffer.from('<svg />'),
    });
    await Promise.all([pending1, pending2]);

    expect(res1.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
    expect(res2.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should release in-flight dedupe lock when fetch hangs', async () => {
    const previousTimeout = process.env.DD_ICON_IN_FLIGHT_TIMEOUT_MS;
    process.env.DD_ICON_IN_FLIGHT_TIMEOUT_MS = '20';
    try {
      mockAccess.mockRejectedValue(new Error('not found'));
      mockAxiosGet.mockImplementation(() => new Promise(() => {}));
      const handler = getHandler();
      const req = {
        params: {
          provider: 'simple',
          slug: 'docker-hang',
        },
      };

      void handler(req, createResponse());
      void handler(req, createResponse());
      await vi.waitFor(() => {
        expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      void handler(req, createResponse());
      await vi.waitFor(
        () => {
          expect(mockAxiosGet).toHaveBeenCalledTimes(2);
        },
        { timeout: 300 },
      );
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DD_ICON_IN_FLIGHT_TIMEOUT_MS;
      } else {
        process.env.DD_ICON_IN_FLIGHT_TIMEOUT_MS = previousTimeout;
      }
    }
  });

  test('should complete fetch even when timeout handle is undefined', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((..._args: unknown[]) => {
        return undefined as unknown as ReturnType<typeof setTimeout>;
      });
    const handler = getHandler();
    const res = createResponse();

    try {
      await handler(
        {
          params: {
            provider: 'simple',
            slug: 'docker',
          },
        },
        res,
      );
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect(res.sendFile).toHaveBeenCalledWith('docker.svg', {
      root: '/store/icons/simple',
    });
  });

  test('should reject invalid provider', async () => {
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'unknown',
          slug: 'docker',
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid request parameters',
    });
  });

  test('should reject request when params are missing', async () => {
    const handler = getHandler();
    const res = createResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid request parameters',
    });
  });

  test('should ignore temp cleanup unlink failures and keep original error', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('<svg />'),
    });
    mockRename.mockRejectedValue(new Error('rename failed'));
    mockUnlink.mockRejectedValue(new Error('unlink failed'));
    const handler = getHandler();
    const res = createResponse();

    await handler(
      {
        params: {
          provider: 'simple',
          slug: 'docker',
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unable to fetch icon simple/docker',
    });
  });

  describe('clearCache', () => {
    test('should clear all cached icons and return count', async () => {
      mockReaddir
        .mockResolvedValueOnce([
          { name: 'homarr', isDirectory: () => true },
          { name: 'simple', isDirectory: () => true },
        ])
        .mockResolvedValueOnce(['docker.png', 'nginx.png'])
        .mockResolvedValueOnce(['docker.svg']);
      const handler = getDeleteHandler();
      const res = createResponse();

      await handler({}, res);

      expect(mockUnlink).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ cleared: 3 });
    });

    test('should return zero when cache directory is empty', async () => {
      mockReaddir.mockResolvedValueOnce([]);
      const handler = getDeleteHandler();
      const res = createResponse();

      await handler({}, res);

      expect(mockUnlink).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ cleared: 0 });
    });

    test('should skip non-directory entries', async () => {
      mockReaddir
        .mockResolvedValueOnce([
          { name: '.gitkeep', isDirectory: () => false },
          { name: 'homarr', isDirectory: () => true },
        ])
        .mockResolvedValueOnce(['docker.png']);
      const handler = getDeleteHandler();
      const res = createResponse();

      await handler({}, res);

      expect(mockUnlink).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ cleared: 1 });
    });

    test('should handle missing cache directory gracefully', async () => {
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
      const handler = getDeleteHandler();
      const res = createResponse();

      await handler({}, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ cleared: 0 });
    });

    test('should continue when listing files for a cache directory fails', async () => {
      mockReaddir
        .mockResolvedValueOnce([{ name: 'homarr', isDirectory: () => true }])
        .mockRejectedValueOnce(new Error('EACCES'));
      const handler = getDeleteHandler();
      const res = createResponse();

      await handler({}, res);

      expect(mockUnlink).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ cleared: 0 });
    });

    test('should ignore individual file unlink failures', async () => {
      mockReaddir
        .mockResolvedValueOnce([{ name: 'homarr', isDirectory: () => true }])
        .mockResolvedValueOnce(['docker.png', 'nginx.png']);
      mockUnlink.mockRejectedValue(new Error('permission denied'));
      const handler = getDeleteHandler();
      const res = createResponse();

      await handler({}, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ cleared: 2 });
    });

    test('should return 500 when cache traversal throws unexpectedly', async () => {
      mockReaddir.mockResolvedValueOnce([
        {
          name: 'broken',
          isDirectory: () => {
            throw new Error('dir entry failure');
          },
        },
      ]);
      const handler = getDeleteHandler();
      const res = createResponse();

      await handler({}, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to clear icon cache',
      });
    });

    test('should return generic error when cache traversal throws non-Error values', async () => {
      mockReaddir.mockResolvedValueOnce([
        {
          name: 'broken',
          isDirectory: () => {
            throw 'dir traversal failed';
          },
        },
      ]);
      const handler = getDeleteHandler();
      const res = createResponse();

      await handler({}, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Failed to clear icon cache',
      });
    });
  });
});
