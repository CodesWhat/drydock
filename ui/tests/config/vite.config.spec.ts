// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import viteConfig, {
  isApiRequest,
  isServerOwnedNavigation,
  SERVER_OWNED_NAVIGATION_PATTERNS,
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

describe('service-worker navigation-fallback denylist', () => {
  it('keeps the OIDC callback and every other server-owned route off the app shell', () => {
    // The regression in #939: this is a document navigation, so the app shell
    // used to answer it and Express never ran the code exchange.
    expect(isServerOwnedNavigation('/auth/oidc/authentik/cb?code=x')).toBe(true);
    expect(isServerOwnedNavigation('/auth/oidc/authentik/cb')).toBe(true);
    expect(isServerOwnedNavigation('/auth/oidc/authentik/redirect')).toBe(true);
    expect(isServerOwnedNavigation('/auth/login')).toBe(true);
    expect(isServerOwnedNavigation('/health')).toBe(true);
    expect(isServerOwnedNavigation('/health?verbose=1')).toBe(true);
    expect(isServerOwnedNavigation('/metrics')).toBe(true);
    expect(isServerOwnedNavigation('/api')).toBe(true);
    expect(isServerOwnedNavigation('/api/v1/containers')).toBe(true);
  });

  it('leaves SPA routes on the app shell, including the /auth view Express does not own', () => {
    expect(isServerOwnedNavigation('/')).toBe(false);
    expect(isServerOwnedNavigation('/containers')).toBe(false);
    expect(isServerOwnedNavigation('/containers/abc123/logs')).toBe(false);
    expect(isServerOwnedNavigation('/login?next=%2Fcontainers')).toBe(false);
    // Bare /auth is ROUTES.AUTH, a real SPA view; only its subpaths are Express'.
    expect(isServerOwnedNavigation('/auth')).toBe(false);
    expect(isServerOwnedNavigation('/auth?tab=providers')).toBe(false);
    // Prefixes that merely start with a server-owned name are still the SPA's.
    expect(isServerOwnedNavigation('/authorization')).toBe(false);
    expect(isServerOwnedNavigation('/healthcheck')).toBe(false);
    expect(isServerOwnedNavigation('/metrics-guide')).toBe(false);
    expect(isServerOwnedNavigation('/apiary')).toBe(false);
  });

  it('is the exact array the service worker navigation fallback is configured with', () => {
    // VitePWA keeps its resolved options in a closure, so assert the wiring at
    // the source instead: an inlined literal here would silently un-fix #939.
    const source = readFileSync(
      fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain('navigateFallbackDenylist: SERVER_OWNED_NAVIGATION_PATTERNS,');
    expect(SERVER_OWNED_NAVIGATION_PATTERNS.map(String)).toEqual([
      String(/^\/api(?:[/?]|$)/),
      String(/^\/auth\//),
      String(/^\/health(?:[/?]|$)/),
      String(/^\/metrics(?:[/?]|$)/),
    ]);
  });
});
