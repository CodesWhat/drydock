// @vitest-environment node
import { ROUTES } from '../../src/router/routes';
import viteConfig, {
  buildSpaNavigateFallbackPattern,
  isApiRequest,
  navigateFallbackAllowlist,
} from '../../vite.config';

type CodeSplittingGroup = { name: string; test: RegExp };

const getCodeSplittingGroups = (): CodeSplittingGroup[] => {
  const output = viteConfig.build?.rolldownOptions?.output;
  const normalizedOutput = Array.isArray(output) ? output[0] : output;
  const groups = (normalizedOutput as Record<string, unknown>)?.codeSplitting as
    | { groups: CodeSplittingGroup[] }
    | undefined;

  expect(groups?.groups).toBeDefined();
  expect(Array.isArray(groups?.groups)).toBe(true);

  return groups!.groups;
};

const findGroup = (groups: CodeSplittingGroup[], path: string): string | undefined =>
  groups.find((g) => g.test.test(path))?.name;

describe('vite build configuration', () => {
  it('disables source maps for production builds', () => {
    expect(viteConfig.build?.sourcemap).toBe(false);
  });

  it('splits framework and icon vendor bundles using codeSplitting groups', () => {
    const groups = getCodeSplittingGroups();

    expect(findGroup(groups, '/Users/test/app/src/main.ts')).toBeUndefined();
    expect(
      findGroup(groups, '/Users/test/app/node_modules/vue/dist/vue.runtime.esm-bundler.js'),
    ).toBe('framework');
    expect(findGroup(groups, '/Users/test/app/node_modules/vue-router/dist/vue-router.mjs')).toBe(
      'framework',
    );
    expect(
      findGroup(groups, '/Users/test/app/node_modules/iconify-icon/dist/iconify-icon.mjs'),
    ).toBe('icons');
    expect(
      findGroup(groups, '/Users/test/app/node_modules/@headlessui/vue/dist/headlessui.esm.js'),
    ).toBe('vendor');
    expect(findGroup(groups, '/Users/test/app/node_modules/pinia/dist/pinia.mjs')).toBe('vendor');
    expect(findGroup(groups, 'C:\\app\\node_modules\\vue\\dist\\vue.runtime.esm-bundler.js')).toBe(
      'framework',
    );
  });

  it('defines exactly four codeSplitting groups in priority order', () => {
    const groups = getCodeSplittingGroups();

    expect(groups).toHaveLength(4);
    expect(groups[0]?.name).toBe('framework');
    expect(groups[1]?.name).toBe('i18n');
    expect(groups[2]?.name).toBe('icons');
    expect(groups[3]?.name).toBe('vendor');
  });
});

describe('service-worker /api runtime-caching rule', () => {
  it('matches request pathnames under /api/', () => {
    expect(isApiRequest({ url: new URL('http://x/api/containers') })).toBe(true);
    expect(isApiRequest({ url: new URL('https://drydock.example.com/api/') })).toBe(true);
  });

  it('does not match non-/api paths, including URLs that merely contain /api/ later', () => {
    expect(isApiRequest({ url: new URL('http://x/assets/app.js') })).toBe(false);
    expect(isApiRequest({ url: new URL('http://x/') })).toBe(false);
    expect(isApiRequest({ url: new URL('http://x/assets/api/decoy.js') })).toBe(false);
  });
});

// DR-102: the service worker's navigation fallback (whether a document navigation to a
// given URL is served the offline app shell) is an allowlist built directly from the
// router's own ROUTES table (routes.ts) rather than a hand-maintained list of
// server-owned paths, so a route added to the router without a matching allowlist
// entry is impossible by construction — the allowlist is Object.values(ROUTES) run
// through buildSpaNavigateFallbackPattern, not a second list someone has to remember
// to update in step. These tests pin that property: every ROUTES path (concrete and
// parametrized) matches, and every known server-owned path — including the OIDC
// callback that #939/#1016 fixed, and /health and /metrics, neither of which the old
// denylist covered — does not.
describe('service-worker navigation-fallback allowlist (DR-102)', () => {
  it('has exactly one pattern per route in ROUTES', () => {
    expect(navigateFallbackAllowlist).toHaveLength(Object.keys(ROUTES).length);
  });

  it('matches every concrete ROUTES path, including a trailing slash and a query string', () => {
    for (const routePath of Object.values(ROUTES)) {
      const concretePath = routePath.replace(/:[^/]+/g, 'sample-id');
      expect(
        navigateFallbackAllowlist.some((pattern) => pattern.test(concretePath)),
        `expected an allowlist pattern to match ${concretePath} (from route ${routePath})`,
      ).toBe(true);
      if (!concretePath.endsWith('/')) {
        expect(navigateFallbackAllowlist.some((pattern) => pattern.test(`${concretePath}/`))).toBe(
          true,
        );
      }
      expect(
        navigateFallbackAllowlist.some((pattern) => pattern.test(`${concretePath}?tab=general`)),
      ).toBe(true);
    }
  });

  it('does not match server-owned paths the SPA router does not define', () => {
    const serverPaths = [
      '/api/containers',
      '/auth/oidc/example/redirect',
      '/auth/oidc/example/cb',
      '/auth/oidc/example/cb?code=abc123',
      '/health',
      '/health?verbose=1',
      '/metrics',
    ];
    for (const path of serverPaths) {
      expect(
        navigateFallbackAllowlist.some((pattern) => pattern.test(path)),
        `expected no allowlist pattern to match ${path}`,
      ).toBe(false);
    }
  });

  it('matches bare /auth (the SPA auth view) but not its OIDC subpaths', () => {
    expect(navigateFallbackAllowlist.some((pattern) => pattern.test(ROUTES.AUTH))).toBe(true);
    expect(
      navigateFallbackAllowlist.some((pattern) => pattern.test(`${ROUTES.AUTH}/oidc/example/cb`)),
    ).toBe(false);
  });

  it('turns a param segment into a wildcard that matches any single segment but not a deeper path', () => {
    const pattern = buildSpaNavigateFallbackPattern(ROUTES.CONTAINER_LOGS);
    expect(pattern.test('/containers/abc123/logs')).toBe(true);
    expect(pattern.test('/containers/abc123/logs/')).toBe(true);
    expect(pattern.test('/containers/abc123/logs?tail=200')).toBe(true);
    expect(pattern.test('/containers/logs')).toBe(false);
    expect(pattern.test('/containers/abc123/def456/logs')).toBe(false);
  });

  it('matches the dashboard root exactly, not every path', () => {
    const pattern = buildSpaNavigateFallbackPattern(ROUTES.DASHBOARD);
    expect(pattern.test('/')).toBe(true);
    expect(pattern.test('/?tab=overview')).toBe(true);
    expect(pattern.test('/containers')).toBe(false);
  });
});
