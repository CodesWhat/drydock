const mocks = vi.hoisted(() => {
  let guard: ((to: any) => Promise<unknown>) | undefined;
  let routes: any[] = [];

  return {
    getGuard: () => guard,
    getRoutes: () => routes,
    createRouter: vi.fn((options: { routes?: any[] }) => {
      routes = options?.routes ?? [];
      return {
        beforeEach: vi.fn((fn: (to: any) => Promise<unknown>) => {
          guard = fn;
        }),
      };
    }),
    createWebHistory: vi.fn(() => ({ kind: 'history' })),
    getUser: vi.fn(),
  };
});

vi.mock('vue-router', () => ({
  createRouter: mocks.createRouter,
  createWebHistory: mocks.createWebHistory,
}));

vi.mock('@/services/auth', () => ({
  getUser: mocks.getUser,
}));

import router from '@/router';

describe('router auth guard', () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
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

    expect(loaders).toHaveLength(15);
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
  });

  it('allows authenticated users to follow a safe next query path', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');
    mocks.getUser.mockResolvedValue({ id: 'u-1' });

    const result = await guard({
      name: 'dashboard',
      query: { next: '/security' },
      path: '/',
    });

    expect(result).toBe('/security');
  });

  it('ignores unsafe next query values for authenticated users', async () => {
    const guard = mocks.getGuard();
    if (!guard) throw new Error('Missing route guard');
    mocks.getUser.mockResolvedValue({ id: 'u-1' });

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
    mocks.getUser.mockResolvedValue({ id: 'u-1' });

    const result = await guard({
      name: 'dashboard',
      query: {},
      path: '/',
    });

    expect(result).toBe(true);
  });
});
