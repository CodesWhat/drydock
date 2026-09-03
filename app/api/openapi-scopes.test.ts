/**
 * Tests for the OpenAPI scope annotation.
 *
 * The last block drives the real router and the real document together,
 * because the value of deriving the annotation from the router is that the two
 * cannot disagree, and only a test that uses both can prove that.
 */
import express from 'express';
import { openApiDocument } from './openapi.js';
import {
  SCOPE_EXTENSION,
  securityForScope,
  toOpenApiPath,
  withRouteScopes,
} from './openapi-scopes.js';
import { DYNAMIC_SCOPE, mountRouter, SESSION_ONLY, scoped } from './route-scopes.js';

const mockGetExperimentalPortwingEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('../configuration/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../configuration/index.js')>();
  return {
    ...actual,
    getExperimentalPortwingEnabled: mockGetExperimentalPortwingEnabled,
  };
});

function noop() {}

describe('toOpenApiPath', () => {
  test.each([
    ['/api/v1/containers', '/api/v1/containers'],
    ['/api/v1/containers/:id', '/api/v1/containers/{id}'],
    ['/api/v1/authentications/:type/:name/:agent', '/api/v1/authentications/{type}/{name}/{agent}'],
    ['/api/v1/{*path}', '/api/v1/{*path}'],
  ])('%s becomes %s', (routePath, expected) => {
    expect(toOpenApiPath(routePath)).toBe(expected);
  });
});

describe('securityForScope', () => {
  test('a session-only route never advertises the key scheme', () => {
    // Publishing apiKeyBearerAuth here would be a lie an integrator acts on.
    expect(securityForScope(SESSION_ONLY)).toStrictEqual([{ sessionAuth: [] }]);
  });

  test.each(['read', 'admin', 'api-keys:manage', DYNAMIC_SCOPE])(
    '%s advertises both a key and a session',
    (scope) => {
      expect(securityForScope(scope)).toStrictEqual([
        { apiKeyBearerAuth: [] },
        { sessionAuth: [] },
      ]);
    },
  );
});

describe('withRouteScopes', () => {
  function routerWith(register: (router: express.Router) => void): express.Router {
    const router = express.Router();
    register(router);
    return router;
  }

  test('annotates an operation with the scope its route declares', () => {
    const router = routerWith((r) => r.get('/things', scoped('read', noop)));
    const document = { paths: { '/api/v1/things': { get: { operationId: 'listThings' } } } };

    const annotated = withRouteScopes(document, router);

    expect(annotated.paths['/api/v1/things'].get).toMatchObject({
      [SCOPE_EXTENSION]: 'read',
      security: [{ apiKeyBearerAuth: [] }, { sessionAuth: [] }],
    });
  });

  test('converts express parameters to OpenAPI ones when matching', () => {
    const router = routerWith((r) =>
      r.post('/things/:id/update', scoped('containers:update', noop)),
    );
    const document = { paths: { '/api/v1/things/{id}/update': { post: {} } } };

    const annotated = withRouteScopes(document, router);

    expect(annotated.paths['/api/v1/things/{id}/update'].post[SCOPE_EXTENSION]).toBe(
      'containers:update',
    );
  });

  test('leaves the source document untouched', () => {
    const router = routerWith((r) => r.get('/things', scoped('read', noop)));
    const document = { paths: { '/api/v1/things': { get: {} } } };

    withRouteScopes(document, router);

    expect(document.paths['/api/v1/things'].get).toStrictEqual({});
  });

  test('keeps a security block the operation declares for itself', () => {
    // The webhook and metrics paths authenticate with their own schemes and
    // never reach the chain; overwriting them would misdescribe them.
    const router = routerWith((r) => r.post('/hook', scoped(SESSION_ONLY, noop)));
    const document = {
      paths: { '/api/v1/hook': { post: { security: [{ webhookBearerAuth: [] }] } } },
    };

    const annotated = withRouteScopes(document, router);

    expect(annotated.paths['/api/v1/hook'].post.security).toStrictEqual([
      { webhookBearerAuth: [] },
    ]);
    expect(annotated.paths['/api/v1/hook'].post[SCOPE_EXTENSION]).toBe(SESSION_ONLY);
  });

  test('a session-only route is published without the key scheme', () => {
    const router = routerWith((r) => r.get('/dump', scoped(SESSION_ONLY, noop)));
    const document = { paths: { '/api/v1/dump': { get: {} } } };

    const annotated = withRouteScopes(document, router);

    expect(annotated.paths['/api/v1/dump'].get.security).toStrictEqual([{ sessionAuth: [] }]);
  });

  test('resolves a mounted sub-router to its real path', () => {
    const parent = express.Router();
    const child = express.Router();
    child.get('/', scoped('api-keys:manage', noop));
    mountRouter(parent, '/api-keys', child);
    const document = { paths: { '/api/v1/api-keys': { get: {} } } };

    const annotated = withRouteScopes(document, parent);

    expect(annotated.paths['/api/v1/api-keys'].get[SCOPE_EXTENSION]).toBe('api-keys:manage');
  });

  test('honours a non-default base path', () => {
    const router = routerWith((r) => r.get('/things', scoped('read', noop)));
    const document = { paths: { '/other/things': { get: {} } } };

    const annotated = withRouteScopes(document, router, '/other');

    expect(annotated.paths['/other/things'].get[SCOPE_EXTENSION]).toBe('read');
  });

  test('ignores a route whose path is not documented', () => {
    const router = routerWith((r) => r.get('/undocumented', scoped('read', noop)));
    const document = { paths: { '/api/v1/things': { get: {} } } };

    const annotated = withRouteScopes(document, router);

    expect(annotated.paths).toStrictEqual({ '/api/v1/things': { get: {} } });
  });

  test('ignores a documented path whose method the router does not serve', () => {
    const router = routerWith((r) => r.get('/things', scoped('read', noop)));
    const document = { paths: { '/api/v1/things': { get: {}, delete: {} } } };

    const annotated = withRouteScopes(document, router);

    expect(annotated.paths['/api/v1/things'].delete).toStrictEqual({});
  });

  test('ignores a route registered without a scope declaration', () => {
    // The completeness test is what fails on this; annotating it with a guess
    // would hide the gap behind a plausible-looking document.
    const router = routerWith((r) => r.get('/things', noop));
    const document = { paths: { '/api/v1/things': { get: {} } } };

    const annotated = withRouteScopes(document, router);

    expect(annotated.paths['/api/v1/things'].get).toStrictEqual({});
  });

  test('ignores a path item entry that is not an operation object', () => {
    const router = routerWith((r) => r.get('/things', scoped('read', noop)));
    const document = { paths: { '/api/v1/things': { get: null } } };

    expect(withRouteScopes(document, router).paths['/api/v1/things'].get).toBeNull();
  });

  test('ignores an express-only method that OpenAPI has no operation for', () => {
    const router = express.Router();
    router.all('/things', scoped('read', noop));
    const document = { paths: { '/api/v1/things': { get: {} } } };

    const annotated = withRouteScopes(document, router);

    // Express records `all` as the pseudo-method `_ALL`, which OpenAPI has no
    // operation for. Publishing it as `get` would claim a scope for verbs the
    // same registration also serves, so it is skipped instead.
    expect(annotated.paths['/api/v1/things'].get).toStrictEqual({});
  });

  test('returns the document unchanged when it declares no paths', () => {
    const router = routerWith((r) => r.get('/things', scoped('read', noop)));

    expect(withRouteScopes({}, router)).toStrictEqual({});
  });
});

describe('the published document', () => {
  test('every documented operation the router serves carries its scope', async () => {
    const api = await import('./api.js');
    const annotated = withRouteScopes(openApiDocument, api.init());

    const unannotated: string[] = [];
    for (const [path, item] of Object.entries(annotated.paths)) {
      for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
        if (
          operation &&
          typeof operation === 'object' &&
          !(SCOPE_EXTENSION in (operation as Record<string, unknown>))
        ) {
          unannotated.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    // Everything left is registered directly on the app rather than through
    // the /api/v1 router, so the router walk cannot see it and must not claim
    // a scope for it: /health and the auth bootstrap routes are the surface a
    // caller reaches before it has any credential at all, and /metrics
    // authenticates with its own bearer scheme.
    expect(unannotated).toStrictEqual([
      'GET /health',
      'GET /api/v1/auth/status',
      'GET /api/auth/status',
      'GET /auth/status',
      'GET /auth/strategies',
      'POST /auth/login',
      'POST /auth/remember',
      'GET /auth/user',
      'POST /auth/logout',
      'GET /metrics',
    ]);
  });

  test('key management is published as api-keys:manage on every verb', async () => {
    const api = await import('./api.js');
    const annotated = withRouteScopes(openApiDocument, api.init());

    expect(annotated.paths['/api/v1/api-keys'].get[SCOPE_EXTENSION]).toBe('api-keys:manage');
    expect(annotated.paths['/api/v1/api-keys'].post[SCOPE_EXTENSION]).toBe('api-keys:manage');
    expect(annotated.paths['/api/v1/api-keys/{keyId}'].delete[SCOPE_EXTENSION]).toBe(
      'api-keys:manage',
    );
  });

  test('the document the /openapi.json route serves is the annotated one', async () => {
    // The block above proves withRouteScopes annotates the real document from
    // the real router; this proves the route actually calls it, which is the
    // half an integrator sees.
    const api = await import('./api.js');
    const router = api.init() as unknown as {
      stack: Array<{
        route?: { path: string; stack: Array<{ handle: (...args: unknown[]) => unknown }> };
      }>;
    };
    const layer = router.stack.find((entry) => entry.route?.path === '/openapi.json');
    const handler = layer?.route?.stack.at(-1)?.handle;
    expect(handler).toBeTypeOf('function');

    const res = { type: vi.fn().mockReturnThis(), send: vi.fn() };
    await handler?.({}, res);

    const served = JSON.parse(res.send.mock.calls[0][0] as string);
    expect(served.components.securitySchemes.apiKeyBearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'ddk',
    });
    expect(served.paths['/api/v1/api-keys'].get[SCOPE_EXTENSION]).toBe('api-keys:manage');
    expect(served.paths['/api/v1/api-keys'].get.security).toStrictEqual([
      { apiKeyBearerAuth: [] },
      { sessionAuth: [] },
    ]);
    expect(served.paths['/api/v1/debug/dump'].get.security).toStrictEqual([{ sessionAuth: [] }]);
  });

  test('a session-only route is not published as key-reachable', async () => {
    const api = await import('./api.js');
    const annotated = withRouteScopes(openApiDocument, api.init());

    const dump = annotated.paths['/api/v1/debug/dump']?.get;
    expect(dump?.[SCOPE_EXTENSION]).toBe(SESSION_ONLY);
    expect(dump?.security).toStrictEqual([{ sessionAuth: [] }]);
  });
});
