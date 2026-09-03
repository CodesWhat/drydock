import express from 'express';
import {
  ADMIN_SCOPE,
  API_KEYS_MANAGE_SCOPE,
  API_SCOPES,
  collectRouteScopes,
  DYNAMIC_SCOPE,
  enforceApiKeyScope,
  findUndeclaredRoutes,
  formatRouteScope,
  getRouteScope,
  hasApiKeyScope,
  MISSING_SCOPE_MESSAGE,
  mountRouter,
  type RouteScopeDeclaration,
  SESSION_ONLY,
  SESSION_ONLY_MESSAGE,
  scoped,
  UNRECORDED_MOUNT,
} from './route-scopes.js';

/**
 * Build a router-shaped object by hand. The walker duck-types the Express
 * router stack, so a synthetic stack is how the branches Express itself never
 * produces (a method flagged false, a mount recorded as a non-string) get
 * exercised.
 * @param stack
 */
function fakeRouter(stack: unknown[]): unknown {
  return { stack };
}

describe('scope vocabulary', () => {
  test('ships the five scopes plus key management', () => {
    expect(API_SCOPES).toStrictEqual([
      'read',
      'containers:watch',
      'containers:update',
      'triggers:test',
      'admin',
      'api-keys:manage',
    ]);
  });

  test('the two non-scope markers are distinct from every scope', () => {
    expect(API_SCOPES as readonly string[]).not.toContain(SESSION_ONLY);
    expect(API_SCOPES as readonly string[]).not.toContain(DYNAMIC_SCOPE);
    expect(SESSION_ONLY).not.toBe(DYNAMIC_SCOPE);
  });
});

describe('scoped', () => {
  test('records the declaration and delegates to the handler', () => {
    const handler = vi.fn(function getThing(_req: unknown, _res: unknown) {
      return 'called';
    });
    const declared = scoped('read', handler);

    expect(getRouteScope(declared)).toBe('read');
    expect(declared({} as never, {} as never)).toBe('called');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('keeps the handler name, which is what a router-stack dump shows', () => {
    function getContainers() {}
    expect(scoped('read', getContainers).name).toBe('getContainers');
  });

  test('does not mark the handler it wraps, so one handler can carry two scopes', () => {
    const handler = () => {};
    const asRead = scoped('read', handler);
    const asAdmin = scoped('admin', handler);

    expect(getRouteScope(handler)).toBeUndefined();
    expect(getRouteScope(asRead)).toBe('read');
    expect(getRouteScope(asAdmin)).toBe('admin');
  });
});

describe('getRouteScope', () => {
  test('returns undefined for a non-function', () => {
    expect(getRouteScope('not a handler')).toBeUndefined();
  });

  test('returns undefined for an undeclared handler', () => {
    expect(getRouteScope(() => {})).toBeUndefined();
  });

  test('returns undefined when the declaration is not a string', () => {
    const handler = () => {};
    Object.defineProperty(handler, Symbol.for('drydock.api.routeScope'), { value: 42 });
    expect(getRouteScope(handler)).toBeUndefined();
  });
});

describe('mountRouter', () => {
  test('mounts the child and records the prefix the walker reports', () => {
    const parent = express.Router();
    const child = express.Router();
    child.get(
      '/entries',
      scoped('read', (_req, _res) => {}),
    );
    mountRouter(parent, '/log', child);

    expect(collectRouteScopes(parent).map(formatRouteScope)).toStrictEqual([
      'GET /log/entries → read',
    ]);
  });

  test('accepts the same router mounted again at the same path', () => {
    const parent = express.Router();
    const child = express.Router();
    mountRouter(parent, '/containers', child);

    expect(() => mountRouter(parent, '/containers', child)).not.toThrow();
  });

  test('refuses a second mount path, which would make the declarations ambiguous', () => {
    const parent = express.Router();
    const child = express.Router();
    child.get(
      '/',
      scoped('read', (_req, _res) => {}),
    );
    mountRouter(parent, '/settings', child);

    expect(() => mountRouter(parent, '/preferences', child)).toThrow(
      'Router is already mounted at /settings; mounting the same router at /preferences would make its scope declarations ambiguous',
    );
    // The guard runs before the mount, so the rejected prefix left no route behind.
    expect(collectRouteScopes(parent).map(formatRouteScope)).toStrictEqual([
      'GET /settings → read',
    ]);
  });

  test('a router mounted with plain use() reports an unrecorded prefix', () => {
    const parent = express.Router();
    const child = express.Router();
    child.get(
      '/keys',
      scoped(SESSION_ONLY, (_req, _res) => {}),
    );
    parent.use('/portwing', child);

    expect(collectRouteScopes(parent).map(formatRouteScope)).toStrictEqual([
      `GET ${UNRECORDED_MOUNT}/keys → session-only`,
    ]);
  });
});

describe('collectRouteScopes', () => {
  test('returns nothing for something that is not a router', () => {
    expect(collectRouteScopes(undefined)).toStrictEqual([]);
    expect(collectRouteScopes(null)).toStrictEqual([]);
    expect(collectRouteScopes(7)).toStrictEqual([]);
    expect(collectRouteScopes({ notAStack: [] })).toStrictEqual([]);
  });

  test('prefixes every route with the base path it was given', () => {
    const router = express.Router();
    router.post(
      '/:id/update',
      scoped('containers:update', (_req, _res) => {}),
    );

    expect(collectRouteScopes(router, '/api/v1/containers').map(formatRouteScope)).toStrictEqual([
      'POST /api/v1/containers/:id/update → containers:update',
    ]);
  });

  test("collapses a route registered at '/' onto its mount path", () => {
    const parent = express.Router();
    const child = express.Router();
    child.get(
      '/',
      scoped('read', (_req, _res) => {}),
    );
    child.patch(
      '/',
      scoped('admin', (_req, _res) => {}),
    );
    mountRouter(parent, '/preferences', child);

    expect(collectRouteScopes(parent, '/api/v1').map(formatRouteScope)).toStrictEqual([
      'GET /api/v1/preferences → read',
      'PATCH /api/v1/preferences → admin',
    ]);
  });

  test("reports a router's own root route as '/'", () => {
    const router = express.Router();
    router.get(
      '/',
      scoped('read', (_req, _res) => {}),
    );

    expect(collectRouteScopes(router).map(formatRouteScope)).toStrictEqual(['GET / → read']);
  });

  test('reads the declaration past middleware registered ahead of the handler', () => {
    const router = express.Router();
    const rateLimiter = (_req: unknown, _res: unknown, next: () => void) => next();
    router.get(
      '/:provider/:slug',
      rateLimiter,
      scoped('read', (_req, _res) => {}),
    );

    expect(collectRouteScopes(router, '/icons').map(formatRouteScope)).toStrictEqual([
      'GET /icons/:provider/:slug → read',
    ]);
  });

  test('walks past middleware layers that are not routers', () => {
    const router = express.Router();
    router.use((_req, _res, next) => next());
    router.get(
      '/',
      scoped('read', (_req, _res) => {}),
    );

    expect(collectRouteScopes(router, '/app').map(formatRouteScope)).toStrictEqual([
      'GET /app → read',
    ]);
  });

  test('walks a router exposed as a function rather than an object', () => {
    const handler = () => {};
    const child = Object.assign(function subRouter() {}, {
      stack: [{ route: { path: '/dump', methods: { get: true }, stack: [{ handle: handler }] } }],
    });
    Object.defineProperty(child, Symbol.for('drydock.api.mountPath'), { value: '/debug' });

    expect(collectRouteScopes(fakeRouter([{ handle: child }])).map(formatRouteScope)).toStrictEqual(
      ['GET /debug/dump → UNDECLARED'],
    );
  });

  test('ignores a method the route has flagged off', () => {
    const declarations = collectRouteScopes(
      fakeRouter([
        {
          route: {
            path: '/keys',
            methods: { get: true, post: false },
            stack: [{ handle: scoped(SESSION_ONLY, () => {}) }],
          },
        },
      ]),
    );

    expect(declarations.map(formatRouteScope)).toStrictEqual(['GET /keys → session-only']);
  });

  test('treats a mount path recorded as a non-string as unrecorded', () => {
    const child = { stack: [{ route: { path: '/x', methods: { get: true }, stack: [] } }] };
    Object.defineProperty(child, Symbol.for('drydock.api.mountPath'), { value: 12 });

    expect(collectRouteScopes(fakeRouter([{ handle: child }])).map(formatRouteScope)).toStrictEqual(
      [`GET ${UNRECORDED_MOUNT}/x → UNDECLARED`],
    );
  });
});

describe('findUndeclaredRoutes', () => {
  test('returns only the routes registered without a declaration', () => {
    const declarations: RouteScopeDeclaration[] = [
      { method: 'GET', path: '/app', scope: 'read' },
      { method: 'POST', path: '/containers/:id/update' },
      { method: 'GET', path: '/debug/dump', scope: SESSION_ONLY },
    ];

    expect(findUndeclaredRoutes(declarations)).toStrictEqual([
      { method: 'POST', path: '/containers/:id/update' },
    ]);
  });

  test('catches a route registered without scoped()', () => {
    const router = express.Router();
    router.get(
      '/declared',
      scoped('read', (_req, _res) => {}),
    );
    router.delete('/undeclared', (_req, _res) => {});

    expect(
      findUndeclaredRoutes(collectRouteScopes(router, '/api/v1')).map(formatRouteScope),
    ).toStrictEqual(['DELETE /api/v1/undeclared → UNDECLARED']);
  });
});

describe('formatRouteScope', () => {
  test('renders the declared scope', () => {
    expect(formatRouteScope({ method: 'PATCH', path: '/settings', scope: 'admin' })).toBe(
      'PATCH /settings → admin',
    );
  });

  test('renders a missing declaration as UNDECLARED', () => {
    expect(formatRouteScope({ method: 'GET', path: '/settings' })).toBe(
      'GET /settings → UNDECLARED',
    );
  });
});

describe('scope implication', () => {
  test('a key holding the exact scope passes', () => {
    expect(hasApiKeyScope(['containers:update'], 'containers:update')).toBe(true);
  });

  test('admin implies every ordinary scope', () => {
    const ordinary = API_SCOPES.filter((scope) => scope !== API_KEYS_MANAGE_SCOPE);
    for (const scope of ordinary) {
      expect(hasApiKeyScope([ADMIN_SCOPE], scope)).toBe(true);
    }
  });

  test('admin never implies api-keys:manage', () => {
    // Decision 4: key management is not an admin power. Bundling it into an
    // admin role is exactly how it gets handed out by accident.
    expect(hasApiKeyScope([ADMIN_SCOPE], API_KEYS_MANAGE_SCOPE)).toBe(false);
  });

  test('api-keys:manage must be held outright', () => {
    expect(hasApiKeyScope([API_KEYS_MANAGE_SCOPE], API_KEYS_MANAGE_SCOPE)).toBe(true);
  });

  test('a key holding only read reaches nothing else', () => {
    expect(hasApiKeyScope(['read'], 'containers:update')).toBe(false);
    expect(hasApiKeyScope(['read'], 'admin')).toBe(false);
    expect(hasApiKeyScope(['read'], 'read')).toBe(true);
  });

  test('an empty scope set reaches nothing', () => {
    for (const scope of API_SCOPES) {
      expect(hasApiKeyScope([], scope)).toBe(false);
    }
  });
});

describe('scope enforcement', () => {
  function apiKeyRequest(scopes: string[]) {
    return {
      principal: {
        kind: 'api-key' as const,
        username: 'ci',
        keyId: 'a1b2c3d4e5f6',
        scopes,
        parentKeyId: null,
      },
    };
  }

  function createResponse() {
    const json = vi.fn();
    return { res: { status: vi.fn(() => ({ json })) }, json };
  }

  test.each([
    ['a session', { kind: 'session' as const, username: 'scott' }],
    ['basic auth', { kind: 'basic' as const, username: 'scott' }],
    ['oidc', { kind: 'oidc' as const, username: 'scott' }],
    ['anonymous', { kind: 'anonymous' as const, username: 'anonymous' }],
  ])('waves %s through untouched, so scopes constrain key holders only', (_label, principal) => {
    const { res, json } = createResponse();
    expect(enforceApiKeyScope({ principal }, res, SESSION_ONLY)).toBe(true);
    expect(json).not.toHaveBeenCalled();
  });

  test('waves an unauthenticated request through, because the auth guard owns that', () => {
    expect(enforceApiKeyScope({}, createResponse().res, 'admin')).toBe(true);
  });

  test('tolerates a missing request object', () => {
    expect(enforceApiKeyScope(undefined, createResponse().res, 'admin')).toBe(true);
  });

  test('lets a key with the scope through', () => {
    const { res, json } = createResponse();
    expect(enforceApiKeyScope(apiKeyRequest(['containers:update']), res, 'containers:update')).toBe(
      true,
    );
    expect(json).not.toHaveBeenCalled();
  });

  test('denies a key without the scope, naming what it needed', () => {
    const { res, json } = createResponse();

    expect(enforceApiKeyScope(apiKeyRequest(['read']), res, 'containers:update')).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: MISSING_SCOPE_MESSAGE,
      details: { requiredScope: 'containers:update' },
    });
  });

  test('denies an admin key on a session-only route', () => {
    const { res, json } = createResponse();

    expect(enforceApiKeyScope(apiKeyRequest([ADMIN_SCOPE]), res, SESSION_ONLY)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: SESSION_ONLY_MESSAGE });
  });

  test('defers a dynamic route to its handler', () => {
    const { res, json } = createResponse();
    expect(enforceApiKeyScope(apiKeyRequest(['read']), res, DYNAMIC_SCOPE)).toBe(true);
    expect(json).not.toHaveBeenCalled();
  });

  test('still denies without a response object to answer on', () => {
    expect(enforceApiKeyScope(apiKeyRequest(['read']), undefined, 'admin')).toBe(false);
  });
});

describe('scoped() enforcement', () => {
  function createResponse() {
    const json = vi.fn();
    return { res: { status: vi.fn(() => ({ json })) }, json };
  }

  test('runs the handler when the key holds the scope', () => {
    const handler = vi.fn();
    const { res } = createResponse();

    scoped('read', handler)(
      {
        principal: {
          kind: 'api-key',
          username: 'ci',
          keyId: 'a1b2c3d4e5f6',
          scopes: ['read'],
          parentKeyId: null,
        },
      } as never,
      res as never,
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('does not run the handler when the key lacks the scope', () => {
    const handler = vi.fn();
    const { res, json } = createResponse();

    scoped('admin', handler)(
      {
        principal: {
          kind: 'api-key',
          username: 'ci',
          keyId: 'a1b2c3d4e5f6',
          scopes: ['read'],
          parentKeyId: null,
        },
      } as never,
      res as never,
    );

    expect(handler).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({
      error: MISSING_SCOPE_MESSAGE,
      details: { requiredScope: 'admin' },
    });
  });

  test('runs the handler for a session, whatever the declared scope', () => {
    const handler = vi.fn();

    scoped('admin', handler)(
      { principal: { kind: 'session', username: 'scott' } } as never,
      createResponse().res as never,
    );

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('still returns the handler result when it is allowed through', () => {
    const handler = vi.fn(() => 'ran');
    expect(scoped('read', handler)({} as never, createResponse().res as never)).toBe('ran');
  });

  test('returns undefined when it blocks', () => {
    const blocked = scoped(
      'admin',
      vi.fn(() => 'ran'),
    )(
      {
        principal: {
          kind: 'api-key',
          username: 'ci',
          keyId: 'a1b2c3d4e5f6',
          scopes: [],
          parentKeyId: null,
        },
      } as never,
      createResponse().res as never,
    );

    expect(blocked).toBeUndefined();
  });
});
