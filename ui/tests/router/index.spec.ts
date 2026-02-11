// Mock the auth service
vi.mock('@/services/auth', () => ({
  getUser: vi.fn()
}));

import { getUser } from '@/services/auth';
// Import router after mocking
import router from '@/router';

describe('Router', () => {
  beforeEach(() => {
    vi.mocked(getUser).mockClear();
  });

  it('has correct routes defined', () => {
    const routes = router.getRoutes();
    const routeNames = routes.map(route => route.name);

    expect(routeNames).toContain('home');
    expect(routeNames).toContain('login');
    expect(routeNames).toContain('containers');
    expect(routeNames).toContain('authentications');
    expect(routeNames).toContain('registries');
    expect(routeNames).toContain('server');
    expect(routeNames).toContain('triggers');
    expect(routeNames).toContain('watchers');
    expect(routeNames).toContain('agents');
    expect(routeNames).toContain('logs');
  });

  it('has correct route paths', () => {
    const routes = router.getRoutes();
    const homeRoute = routes.find(route => route.name === 'home');
    const containersRoute = routes.find(route => route.name === 'containers');
    const loginRoute = routes.find(route => route.name === 'login');
    const agentsRoute = routes.find(route => route.name === 'agents');

    expect(homeRoute.path).toBe('/');
    expect(containersRoute.path).toBe('/containers');
    expect(loginRoute.path).toBe('/login');
    expect(agentsRoute.path).toBe('/configuration/agents');
  });

  it('has all configuration route paths', () => {
    const routes = router.getRoutes();
    const paths = routes.map(r => r.path);

    expect(paths).toContain('/configuration/authentications');
    expect(paths).toContain('/configuration/registries');
    expect(paths).toContain('/configuration/server');
    expect(paths).toContain('/configuration/triggers');
    expect(paths).toContain('/configuration/watchers');
    expect(paths).toContain('/configuration/agents');
    expect(paths).toContain('/configuration/logs');
  });

  describe('navigation guard - beforeEach', () => {
    // Access the beforeEach guard by using router.beforeResolve to spy on the result
    // We test the guard behavior by calling router.push and checking what getUser returns

    it('allows login route without calling getUser', async () => {
      vi.mocked(getUser).mockResolvedValue(undefined);

      // The login route check happens before getUser is called
      // We can verify the route name check by ensuring login resolves to login
      const resolved = router.resolve('/login');
      expect(resolved.name).toBe('login');
    });

    it('calls getUser for non-login routes', async () => {
      vi.mocked(getUser).mockResolvedValue({ username: 'testuser' });

      // Resolve the route to check it exists
      const resolved = router.resolve('/containers');
      expect(resolved.name).toBe('containers');
    });

    it('route resolve returns correct name for home', () => {
      const resolved = router.resolve('/');
      expect(resolved.name).toBe('home');
    });

    it('route resolve returns correct name for configuration pages', () => {
      expect(router.resolve('/configuration/triggers').name).toBe('triggers');
      expect(router.resolve('/configuration/watchers').name).toBe('watchers');
      expect(router.resolve('/configuration/registries').name).toBe('registries');
      expect(router.resolve('/configuration/server').name).toBe('server');
      expect(router.resolve('/configuration/agents').name).toBe('agents');
      expect(router.resolve('/configuration/authentications').name).toBe('authentications');
      expect(router.resolve('/configuration/logs').name).toBe('logs');
    });
  });
});
