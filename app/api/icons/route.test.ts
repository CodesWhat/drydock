import { ICON_PROXY_ROUTE_PATH, isIconProxyApiPath } from './route.js';

describe('icon proxy route contract', () => {
  test('defines the router path from the provider and slug segments', () => {
    expect(ICON_PROXY_ROUTE_PATH).toBe('/:provider/:slug');
  });

  test.each([
    ['/icons/selfhst/docker', true],
    ['/icons/selfhst/docker/', true],
    ['/icons', false],
    ['/icons/selfhst', false],
    ['/icons/selfhst/docker/extra', false],
    ['x/icons/selfhst/docker', false],
    ['/other/selfhst/docker', false],
    ['/icons//docker', false],
  ])('matches %s consistently with the mounted API route', (path, expected) => {
    expect(isIconProxyApiPath(path)).toBe(expected);
  });
});
