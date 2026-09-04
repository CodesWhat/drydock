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
  // A helper matching NavigationRoute's own constructor default: it always
  // has an origin, so build these the same way workbox does.
  const url = (pathAndSearch: string): URL => new URL(pathAndSearch, 'https://drydock.example');

  it('keeps the OIDC callback and every other server-owned route off the app shell', () => {
    // The regression in #939: this is a document navigation, so the app shell
    // used to answer it and Express never ran the code exchange.
    expect(isServerOwnedNavigation(url('/auth/oidc/authentik/cb?code=x'))).toBe(true);
    expect(isServerOwnedNavigation(url('/auth/oidc/authentik/cb'))).toBe(true);
    expect(isServerOwnedNavigation(url('/auth/oidc/authentik/redirect'))).toBe(true);
    expect(isServerOwnedNavigation(url('/auth/login'))).toBe(true);
    expect(isServerOwnedNavigation(url('/health'))).toBe(true);
    expect(isServerOwnedNavigation(url('/health?verbose=1'))).toBe(true);
    expect(isServerOwnedNavigation(url('/metrics'))).toBe(true);
    expect(isServerOwnedNavigation(url('/api'))).toBe(true);
    expect(isServerOwnedNavigation(url('/api/v1/containers'))).toBe(true);
  });

  it('leaves SPA routes on the app shell, including the /auth view Express does not answer', () => {
    expect(isServerOwnedNavigation(url('/'))).toBe(false);
    expect(isServerOwnedNavigation(url('/containers'))).toBe(false);
    expect(isServerOwnedNavigation(url('/containers/abc123/logs'))).toBe(false);
    expect(isServerOwnedNavigation(url('/login?next=%2Fcontainers'))).toBe(false);
    // Bare /auth is ROUTES.AUTH, a real SPA view; Express matches the mount
    // but has no handler there, so the shell should answer.
    expect(isServerOwnedNavigation(url('/auth'))).toBe(false);
    expect(isServerOwnedNavigation(url('/auth?tab=providers'))).toBe(false);
    // Prefixes that merely start with a server-owned name are still the SPA's.
    expect(isServerOwnedNavigation(url('/authorization'))).toBe(false);
    expect(isServerOwnedNavigation(url('/healthcheck'))).toBe(false);
    expect(isServerOwnedNavigation(url('/metrics-guide'))).toBe(false);
    expect(isServerOwnedNavigation(url('/apiary'))).toBe(false);
  });

  it('matches (or misses) the same way workbox-routing NavigationRoute itself would', async () => {
    // workbox-routing is reachable here as a transitive dependency of
    // vite-plugin-pwa (ui/package.json), not a direct devDependency, so
    // import it dynamically rather than adding a package purely for this
    // assertion. This exercises the real matching logic from
    // node_modules/workbox-routing/NavigationRoute.js instead of our mirror
    // of it.
    //
    // workbox-core's logger reads `self` unconditionally on module load,
    // since it's written to run inside a service worker's global scope.
    // This file runs under the node test environment (no `self`), so stub
    // it the same way a real service worker global would provide it.
    (globalThis as { self?: typeof globalThis }).self ??= globalThis;
    const { NavigationRoute } = await import('workbox-routing');
    // Cast .match to the minimal shape it actually reads (url and
    // request.mode — see NavigationRoute.js's _match), rather than
    // constructing an ExtendableEvent, which isn't in this project's `lib`.
    const matches = (route: InstanceType<typeof NavigationRoute>, requestUrl: URL): boolean =>
      (route.match as unknown as (options: { url: URL; request: { mode: string } }) => boolean)({
        url: requestUrl,
        request: { mode: 'navigate' },
      });
    const route = new NavigationRoute(async () => new Response(), {
      denylist: SERVER_OWNED_NAVIGATION_PATTERNS,
    });
    const oldApiOnlyDenylistRoute = new NavigationRoute(async () => new Response(), {
      denylist: [/^\/api\//],
    });
    const callbackUrl = new URL('https://drydock.example/auth/oidc/authentik/cb?code=x');

    expect(matches(route, callbackUrl)).toBe(false);
    expect(matches(oldApiOnlyDenylistRoute, callbackUrl)).toBe(true);
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

describe('service-worker denylist stays coupled to the Express route table', () => {
  // Every top-level mount that reaches Express by top-level navigation but
  // is meant to be answered by the SPA shell instead, with why.
  const SPA_OWNED_MOUNTS = [
    // uiRouter: the SPA's own static assets and history fallback.
    '/',
    // app.use('/auth', router) in app/api/auth.ts matches this exact path,
    // but the router defines no handler for it (only subpaths like
    // /auth/login do), so an unauthenticated GET falls through to
    // requireAuthentication and returns 401. ROUTES.AUTH is a real SPA view,
    // so the shell should answer instead.
    '/auth',
  ];

  const extractAppMountPaths = (source: string): string[] => {
    // Only app.<method>('/literal', ...) — a router mounted at root
    // (router.use(...)) isn't a top-level Express mount point.
    const pattern = /\bapp\.(?:use|get|post|all)\(\s*(['"])(\/[^'"]*)\1/g;
    return [...source.matchAll(pattern)].map((match) => match[2]);
  };

  it('denies (or explicitly exempts) every top-level mount in app/api/index.ts and app/api/auth.ts', () => {
    const indexSource = readFileSync(
      fileURLToPath(new URL('../../../app/api/index.ts', import.meta.url)),
      'utf8',
    );
    const authSource = readFileSync(
      fileURLToPath(new URL('../../../app/api/auth.ts', import.meta.url)),
      'utf8',
    );
    const mountPaths = new Set([
      ...extractAppMountPaths(indexSource),
      ...extractAppMountPaths(authSource),
    ]);

    // Guards the extractor itself: if it ever stops finding anything (e.g.
    // the mount syntax changes), the loop below would vacuously pass.
    expect(mountPaths.size).toBeGreaterThan(0);

    for (const mountPath of mountPaths) {
      if (SPA_OWNED_MOUNTS.includes(mountPath)) {
        continue;
      }

      // A new mount like app.use('/webhooks', ...) with no matching
      // denylist pattern and no SPA_OWNED_MOUNTS entry fails right here.
      expect(isServerOwnedNavigation(new URL(mountPath, 'https://drydock.example'))).toBe(true);
      expect(isServerOwnedNavigation(new URL(`${mountPath}/x`, 'https://drydock.example'))).toBe(
        true,
      );
    }
  });
});
