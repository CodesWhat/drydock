const mocks = vi.hoisted(() => {
  let guard: ((to: any) => Promise<unknown>) | undefined;
  let errorHandler: ((error: unknown) => void) | undefined;
  let afterHandler: ((failure?: unknown) => void) | undefined;
  let routes: any[] = [];

  return {
    getGuard: () => guard,
    getErrorHandler: () => errorHandler,
    getAfterHandler: () => afterHandler,
    getRoutes: () => routes,
    createRouter: vi.fn((options: { routes?: any[] }) => {
      routes = options?.routes ?? [];
      return {
        beforeEach: vi.fn((fn: (to: any) => Promise<unknown>) => {
          guard = fn;
        }),
        onError: vi.fn((fn: (error: unknown) => void) => {
          errorHandler = fn;
        }),
        afterEach: vi.fn((fn: (_to: unknown, _from: unknown, failure?: unknown) => void) => {
          afterHandler = (failure?: unknown) => fn({}, {}, failure);
        }),
      };
    }),
    createWebHistory: vi.fn(() => ({ kind: 'history' })),
    getUser: vi.fn(),
    hydrateFromServer: vi.fn(),
    requestStaleChunkReload: vi.fn(),
    clearStaleChunkReloadGuard: vi.fn(),
  };
});

vi.mock('vue-router', () => ({
  createRouter: mocks.createRouter,
  createWebHistory: mocks.createWebHistory,
}));

vi.mock('@/services/auth', () => ({
  getUser: mocks.getUser,
}));
vi.mock('@/preferences/sync', () => ({ hydrateFromServer: mocks.hydrateFromServer }));
vi.mock('@/bootstrap/stale-chunk-recovery', () => ({
  requestStaleChunkReload: mocks.requestStaleChunkReload,
  clearStaleChunkReloadGuard: mocks.clearStaleChunkReloadGuard,
}));

import router from '@/router';

describe('router auth guard', () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.hydrateFromServer.mockReset();
    mocks.requestStaleChunkReload.mockReset();
    mocks.clearStaleChunkReloadGuard.mockReset();
  });

  it('routes lazy chunk failures through the one-shot recovery handler', () => {
    const error = new TypeError('Failed to fetch dynamically imported module');
    mocks.getErrorHandler()?.(error);

    expect(mocks.requestStaleChunkReload).toHaveBeenCalledWith(error);
  });

  it('clears the reload guard after a successful navigation', () => {
    mocks.getAfterHandler()?.();

    expect(mocks.clearStaleChunkReloadGuard).toHaveBeenCalledTimes(1);
  });

  it('keeps the reload guard when navigation itself failed', () => {
    mocks.getAfterHandler()?.(new Error('navigation failed'));

    expect(mocks.clearStaleChunkReloadGuard).not.toHaveBeenCalled();
  });

  it('registers a beforeEach guard', () => {
    expect(router).toBeDefined();
    expect(mocks.createRouter).toHaveBeenCalledTimes(1);
    expect(mocks.createWebHistory).toHaveBeenCalledTimes(1);
    expect(mocks.getGuard()).toBeTypeOf('function');
  });

  it('defines lazy view loaders for all named routes', async () => {
    const routes = mocks.getRoutes();
    const topLevelLoaders = routes
      .filter((route) => typeof route?.component === 'function')
      .map((route) => route.component as () => Promise<unknown>);
    const childLoaders = routes
      .flatMap((route) => (Array.isArray(route?.children) ? route.children : []))
      .filter((route) => typeof route?.component === 'function')
      .map((route) => route.component as () => Promise<unknown>);
    const loaders = [...topLevelLoaders, ...childLoaders];

    expect(loaders).toHaveLength(16);
    await Promise.all(loaders.map((loader) => loader()));
  });

  it('allows access to login route without auth checks', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');

    const result = await guard({
      name: 'login',
      query: {},
      path: '/login',
    });

    expect(result).toBe(true);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated users to login with next path', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');
    mocks.getUser.mockResolvedValue(undefined);

    const result = await guard({
      name: 'containers',
      query: {},
      path: '/containers',
    });

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      name: 'login',
      query: { next: '/containers' },
    });
    expect(mocks.hydrateFromServer).not.toHaveBeenCalled();
  });

  it('does not hydrate preferences for the anonymous sentinel user', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');
    mocks.getUser.mockResolvedValue({ username: 'anonymous' });

    await guard({ name: 'dashboard', query: {}, path: '/' });

    expect(mocks.hydrateFromServer).not.toHaveBeenCalled();
  });

  it('allows authenticated users to follow a safe next query path', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');
    mocks.getUser.mockResolvedValue({ id: 'u-1', username: 'alice' });

    const result = await guard({
      name: 'dashboard',
      query: { next: '/security' },
      path: '/',
    });

    expect(result).toBe('/security');
    expect(mocks.hydrateFromServer).toHaveBeenCalledWith('alice');
  });

  it('ignores unsafe next query values for authenticated users', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');
    mocks.getUser.mockResolvedValue({ id: 'u-1', username: 'alice' });

    const result = await guard({
      name: 'dashboard',
      query: { next: '//evil.example' },
      path: '/',
    });

    expect(result).toBe(true);
  });

  it('allows authenticated users without next query to continue normally', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');
    mocks.getUser.mockResolvedValue({ id: 'u-1', username: 'alice' });

    const result = await guard({
      name: 'dashboard',
      query: {},
      path: '/',
    });

    expect(result).toBe(true);
  });

  it('does not wait for preference hydration before resolving navigation', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');
    mocks.getUser.mockResolvedValue({ username: 'alice' });
    mocks.hydrateFromServer.mockReturnValue(new Promise(() => {}));

    await expect(guard({ name: 'dashboard', query: {}, path: '/' })).resolves.toBe(true);
    expect(mocks.hydrateFromServer).toHaveBeenCalledWith('alice');
  });
});
