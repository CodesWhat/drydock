const {
  mockRouter,
  mockRandomUUID,
  mockAccess,
  mockMkdir,
  mockWriteFile,
  mockRename,
  mockUnlink,
  mockAxiosGet,
  mockAxiosIsAxiosError,
  mockIsInternetlessModeEnabled,
  mockGetStoreConfiguration,
} = vi.hoisted(() => ({
  mockRouter: { get: vi.fn() },
  mockRandomUUID: vi.fn(() => 'uuid-test'),
  mockAccess: vi.fn(),
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockRename: vi.fn(),
  mockUnlink: vi.fn(),
  mockAxiosGet: vi.fn(),
  mockAxiosIsAxiosError: vi.fn(() => false),
  mockIsInternetlessModeEnabled: vi.fn(() => false),
  mockGetStoreConfiguration: vi.fn(() => ({ path: '/store', file: 'dd.json' })),
}));

vi.mock('express', () => ({
  default: { Router: vi.fn(() => mockRouter) },
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

vi.mock('../log', () => ({
  default: { child: vi.fn(() => ({ warn: vi.fn() })) },
}));

import * as iconsRouter from './icons.js';

function getHandler() {
  iconsRouter.init();
  return mockRouter.get.mock.calls.find((call) => call[0] === '/:provider/:slug')[1];
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
    vi.clearAllMocks();
    mockIsInternetlessModeEnabled.mockReturnValue(false);
    mockGetStoreConfiguration.mockReturnValue({ path: '/store', file: 'dd.json' });
    mockAxiosIsAxiosError.mockReturnValue(false);
    mockAccess.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  test('should initialize router with icon route', () => {
    const router = iconsRouter.init();
    expect(router.get).toHaveBeenCalledWith('/:provider/:slug', expect.any(Function));
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
    expect(res.sendFile).toHaveBeenCalledWith('/store/icons/homarr/docker.png');
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
    expect(res.sendFile).toHaveBeenCalledWith('/store/icons/simple/docker.svg');
  });

  test('should normalize slug extension and fetch homarr icon URL', async () => {
    mockAccess.mockRejectedValue(new Error('not found'));
    mockAxiosGet.mockResolvedValue({
      data: Buffer.from('png'),
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
      },
    );
    expect(res.sendFile).toHaveBeenCalledWith('/store/icons/homarr/docker.png');
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
    expect(res.sendFile).toHaveBeenCalledWith('/store/icons/simple/docker.svg');
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
      error: expect.stringContaining('rename failed'),
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
      error: 'Unable to fetch icon simple/docker (boom)',
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

    expect(res1.sendFile).toHaveBeenCalledWith('/store/icons/simple/docker.svg');
    expect(res2.sendFile).toHaveBeenCalledWith('/store/icons/simple/docker.svg');
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
      error: expect.any(String),
    });
  });

  test('should reject request when params are missing', async () => {
    const handler = getHandler();
    const res = createResponse();

    await handler({}, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.any(String),
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
      error: expect.stringContaining('rename failed'),
    });
  });
});
