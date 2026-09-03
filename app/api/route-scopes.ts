/**
 * API key scope registry.
 *
 * Every route under `/api/v1` declares, at the point it is registered, which
 * API key scope reaches it. `scoped()` records the declaration on the handler
 * and `collectRouteScopes()` reads it back off the live Express router stack,
 * so the map is derived from routing rather than kept alongside it. A path
 * table matched against `req.path` would duplicate the router and drift; this
 * cannot, because a route with no declaration is a route the completeness test
 * fails on (`route-scope-completeness.test.ts`).
 *
 * That test is a security control, not a lint. Everything not declared is
 * denied to key authentication at any scope — default-deny — so weakening or
 * skipping it would let a new route default to reachable-by-any-key.
 *
 * Enforcement lives inside `scoped()` itself rather than in a middleware ahead
 * of the routers. A pre-router middleware cannot know which route is about to
 * match without re-implementing routing, whereas the wrapper runs exactly when
 * its own route matches, so the declaration and the check are the same object
 * and cannot disagree.
 *
 * Only API key principals are checked. Sessions, Basic, OIDC and anonymous
 * traverse `scoped()` untouched, so this is behaviour-preserving for every
 * caller that is not using a key.
 *
 * The mount path is recorded separately, by `mountRouter()`, because Express 5
 * drops it: `Layer.path` is set during matching and is undefined at rest, and
 * the compiled matcher does not expose the pattern it was built from. So a
 * registry keyed at registration time could not know its own mount, and the
 * key is assembled during the walk instead.
 */

import type { Response } from 'express';
import { sendErrorResponse } from './error-response.js';
import type { PrincipalCarrier } from './principal.js';

export const API_SCOPES = [
  'read',
  'containers:watch',
  'containers:update',
  'triggers:test',
  'admin',
  'api-keys:manage',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/**
 * Key management is its own scope and `admin` never implies it. It has to be
 * selected explicitly at creation, so an ordinary admin key cannot mint or
 * revoke keys by accident — which is what happens when key management is just
 * another cell in an admin permission grid.
 */
export const API_KEYS_MANAGE_SCOPE = 'api-keys:manage' satisfies ApiScope;

/** The scope that implies every other one, except {@link API_KEYS_MANAGE_SCOPE}. */
export const ADMIN_SCOPE = 'admin' satisfies ApiScope;

/**
 * Reachable with a session and never with an API key, whatever scopes it
 * holds — the debug dump, environment reveal, the edge agent registry, the
 * self-update callbacks and the webhook routers, which carry their own bearer.
 */
export const SESSION_ONLY = 'session-only';

/**
 * The required scope depends on a path parameter, so the check runs inside the
 * handler rather than as static route middleware. One route pair uses this:
 * running a trigger against a container needs `containers:update` for a
 * docker/dockercompose trigger and `triggers:test` for a notification one.
 */
export const DYNAMIC_SCOPE = 'dynamic';

export type RouteScope = ApiScope | typeof SESSION_ONLY | typeof DYNAMIC_SCOPE;

/** Any Express handler signature, without widening to `any`. */
type RouteHandler = (...args: never[]) => unknown;

/** The 403 an API key gets on a route it holds no scope for. */
export const MISSING_SCOPE_MESSAGE = 'API key is missing the required scope';
/** The 403 an API key gets on a route only a session may reach. */
export const SESSION_ONLY_MESSAGE = 'This route is not reachable with an API key';

/**
 * Does this key hold the scope a route requires?
 *
 * `admin` implies every scope except `api-keys:manage`, which is never implied
 * and must be held outright.
 * @param scopes - the scopes the key holds
 * @param required - the scope the route declared
 */
export function hasApiKeyScope(scopes: readonly string[], required: ApiScope): boolean {
  if (scopes.includes(required)) {
    return true;
  }
  if (required === API_KEYS_MANAGE_SCOPE) {
    return false;
  }
  return scopes.includes(ADMIN_SCOPE);
}

/**
 * Check a request against a route's declared scope, answering 403 when it
 * fails.
 *
 * Returns true when the handler should run. Anything that is not an API key
 * principal is waved through: scopes constrain key holders only, and this is
 * what keeps the change behaviour-preserving for sessions, Basic, OIDC and
 * anonymous.
 * @param req - the request, or anything carrying a principal
 * @param res - the response to answer on
 * @param scope - the scope the route declared
 */
export function enforceApiKeyScope(
  req: PrincipalCarrier | undefined,
  res: Pick<Response, 'status'> | undefined,
  scope: RouteScope,
): boolean {
  const principal = req?.principal;
  if (principal?.kind !== 'api-key') {
    return true;
  }

  // The required scope depends on a path parameter, so the handler owns the
  // check. Waving it through here is safe only because the handler is required
  // to call enforceApiKeyScope itself; the completeness test pins which routes
  // are allowed to be dynamic.
  if (scope === DYNAMIC_SCOPE) {
    return true;
  }

  const deny = (message: string, details?: Record<string, unknown>): false => {
    if (res) {
      sendErrorResponse(res as Response, 403, details ? { message, details } : { message });
    }
    return false;
  };

  if (scope === SESSION_ONLY) {
    return deny(SESSION_ONLY_MESSAGE);
  }

  if (hasApiKeyScope(principal.scopes, scope)) {
    return true;
  }

  return deny(MISSING_SCOPE_MESSAGE, { requiredScope: scope });
}

const ROUTE_SCOPE = Symbol.for('drydock.api.routeScope');
const MOUNT_PATH = Symbol.for('drydock.api.mountPath');

/** A mount reached through plain `router.use()`, so its prefix is unknown. */
export const UNRECORDED_MOUNT = '<unrecorded-mount>';

export interface RouteScopeDeclaration {
  method: string;
  path: string;
  /** undefined means the route was registered without a declaration. */
  scope?: RouteScope;
}

interface ExpressRouteLike {
  path: string;
  methods: Record<string, boolean>;
  stack: { handle?: unknown }[];
}

interface ExpressLayerLike {
  route?: ExpressRouteLike;
  handle?: unknown;
}

interface RouterLike {
  stack: ExpressLayerLike[];
}

/**
 * Declare which scope reaches a route, and return the handler to register.
 *
 * Applied at the registration site — `router.post('/:id/update',
 * scoped('containers:update', updateContainer))` — so the declaration cannot
 * be separated from the route it describes.
 * @param scope
 * @param handler
 */
export function scoped<H extends RouteHandler>(scope: RouteScope, handler: H): H {
  // A wrapper rather than a property on the handler itself, so registering one
  // shared handler on two routes with different scopes cannot make the second
  // silently overwrite the first. The name is copied across because Express
  // reads it into `Layer.name`, which is what a router-stack dump shows.
  const declared = ((...args: Parameters<H>) => {
    const [req, res] = args as unknown as [PrincipalCarrier | undefined, Response | undefined];
    if (!enforceApiKeyScope(req, res, scope)) {
      return undefined;
    }
    return handler(...args);
  }) as H;
  Object.defineProperty(declared, 'name', { value: handler.name, configurable: true });
  Object.defineProperty(declared, ROUTE_SCOPE, {
    value: scope,
    enumerable: false,
    configurable: true,
  });
  return declared;
}

/**
 * Read a declaration back off a handler.
 * @param handler
 */
export function getRouteScope(handler: unknown): RouteScope | undefined {
  if (typeof handler !== 'function') {
    return undefined;
  }
  const scope = (handler as unknown as Record<symbol, unknown>)[ROUTE_SCOPE];
  return typeof scope === 'string' ? (scope as RouteScope) : undefined;
}

/**
 * Mount a sub-router and remember where it was mounted.
 *
 * Express 5 keeps no static record of a mount path, so the walk would
 * otherwise see `GET /` a dozen times with no way to tell `/app` from
 * `/settings`. Recording it here keeps the path written exactly once, at the
 * mount, so it cannot drift from the routing.
 * @param parent
 * @param mountPath
 * @param child
 */
export function mountRouter(
  parent: { use: (...args: never[]) => unknown },
  mountPath: string,
  child: object,
): void {
  const existing = (child as Record<symbol, unknown>)[MOUNT_PATH];
  if (typeof existing === 'string' && existing !== mountPath) {
    throw new Error(
      `Router is already mounted at ${existing}; mounting the same router at ${mountPath} would make its scope declarations ambiguous`,
    );
  }
  (parent.use as (path: string, handler: object) => unknown)(mountPath, child);
  Object.defineProperty(child, MOUNT_PATH, {
    value: mountPath,
    enumerable: false,
    configurable: true,
  });
}

function getMountPath(child: unknown): string {
  const mountPath = (child as Record<symbol, unknown>)[MOUNT_PATH];
  return typeof mountPath === 'string' ? mountPath : UNRECORDED_MOUNT;
}

function asRouter(candidate: unknown): RouterLike | undefined {
  if (typeof candidate !== 'function' && typeof candidate !== 'object') {
    return undefined;
  }
  if (candidate === null) {
    return undefined;
  }
  const stack = (candidate as { stack?: unknown }).stack;
  return Array.isArray(stack) ? ({ stack } as RouterLike) : undefined;
}

function joinPath(basePath: string, routePath: string): string {
  const suffix = routePath === '/' ? '' : routePath;
  return `${basePath}${suffix}` || '/';
}

function getRouteMethods(route: ExpressRouteLike): string[] {
  return Object.keys(route.methods)
    .filter((method) => route.methods[method])
    .map((method) => method.toUpperCase());
}

function getDeclaredScope(route: ExpressRouteLike): RouteScope | undefined {
  for (const layer of route.stack) {
    const scope = getRouteScope(layer.handle);
    if (scope !== undefined) {
      return scope;
    }
  }
  return undefined;
}

function walkRouter(
  router: RouterLike,
  basePath: string,
  declarations: RouteScopeDeclaration[],
): void {
  for (const layer of router.stack) {
    if (layer.route) {
      const path = joinPath(basePath, layer.route.path);
      const scope = getDeclaredScope(layer.route);
      for (const method of getRouteMethods(layer.route)) {
        declarations.push(scope === undefined ? { method, path } : { method, path, scope });
      }
      continue;
    }
    const child = asRouter(layer.handle);
    if (child) {
      walkRouter(child, `${basePath}${getMountPath(layer.handle)}`, declarations);
    }
  }
}

/**
 * Walk a live Express router and return every route it can reach, with the
 * scope each one declared.
 * @param router - an Express router or app
 * @param basePath - the prefix the router is served under
 */
export function collectRouteScopes(router: unknown, basePath = ''): RouteScopeDeclaration[] {
  const declarations: RouteScopeDeclaration[] = [];
  const rootRouter = asRouter(router);
  if (rootRouter) {
    walkRouter(rootRouter, basePath, declarations);
  }
  return declarations;
}

/**
 * The routes that were registered without a scope declaration. A non-empty
 * result is the completeness test's failure.
 * @param declarations
 */
export function findUndeclaredRoutes(
  declarations: RouteScopeDeclaration[],
): RouteScopeDeclaration[] {
  return declarations.filter((declaration) => declaration.scope === undefined);
}

/**
 * Render a declaration as the single line the inventory and the failure
 * messages both use.
 * @param declaration
 */
export function formatRouteScope(declaration: RouteScopeDeclaration): string {
  return `${declaration.method} ${declaration.path} → ${declaration.scope ?? 'UNDECLARED'}`;
}
