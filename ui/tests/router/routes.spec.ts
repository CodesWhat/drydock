import { ROUTES } from '@/router/routes';

describe('ROUTES', () => {
  it('does not contain duplicate path values', () => {
    const pathToRouteNames = new Map<string, string[]>();

    for (const [routeName, path] of Object.entries(ROUTES)) {
      const existingRouteNames = pathToRouteNames.get(path) ?? [];
      existingRouteNames.push(routeName);
      pathToRouteNames.set(path, existingRouteNames);
    }

    const duplicatePaths = Array.from(pathToRouteNames.entries()).filter(
      ([, routeNames]) => routeNames.length > 1,
    );

    expect(duplicatePaths).toEqual([]);
  });
});
