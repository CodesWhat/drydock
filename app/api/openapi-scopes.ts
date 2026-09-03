/**
 * Annotate the published OpenAPI document with the scope each operation is
 * reachable at.
 *
 * Derived from the live Express router rather than written into the path
 * modules by hand, for the same reason the completeness test walks the router:
 * a hand-kept second copy of the scope map drifts, and a stale published scope
 * is worse than none — an integrator would scope a key to what the document
 * claims and get a 403 at runtime.
 *
 * Applied at serve time on a clone. The document itself stays a static
 * module-level constant, and annotating it in place would leak router state
 * into every other consumer of it, including the response contract validator.
 */

import { collectRouteScopes, type RouteScopeDeclaration, SESSION_ONLY } from './route-scopes.js';

/** Vendor extension carrying the declared scope for an operation. */
export const SCOPE_EXTENSION = 'x-drydock-scope';

const API_KEY_SECURITY = [{ apiKeyBearerAuth: [] }, { sessionAuth: [] }];
const SESSION_ONLY_SECURITY = [{ sessionAuth: [] }];

const OPENAPI_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

type OperationObject = Record<string, unknown>;
type PathItemObject = Record<string, OperationObject | unknown>;
type OpenApiDocumentLike = { paths?: Record<string, PathItemObject> };

/**
 * Express writes `:id`, OpenAPI writes `{id}`. Express 5 also renders a
 * wildcard as `{*path}`, which is already the OpenAPI spelling.
 * @param routePath
 */
export function toOpenApiPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * The security requirement a scope implies.
 *
 * A session-only route is unreachable with a key at any scope, so publishing
 * `apiKeyBearerAuth` on it would be a lie an integrator could act on. A
 * dynamic route resolves its scope from a path parameter and is reachable with
 * a key, so it keeps both schemes and carries `dynamic` as its declared scope.
 * @param scope
 */
export function securityForScope(scope: string): Array<Record<string, string[]>> {
  return scope === SESSION_ONLY ? SESSION_ONLY_SECURITY : API_KEY_SECURITY;
}

function annotateOperation(operation: OperationObject, scope: string): void {
  operation[SCOPE_EXTENSION] = scope;
  // An operation that already declares its own security keeps it: the webhook
  // and metrics paths authenticate with their own schemes and never reach the
  // authenticator chain, so overwriting them here would misdescribe them.
  if (operation.security === undefined) {
    operation.security = securityForScope(scope);
  }
}

/**
 * Return a copy of the document with every operation the router declares
 * annotated with its scope and, unless it declares one itself, the security
 * schemes that scope admits.
 *
 * Operations the router does not cover are left exactly as written, so a path
 * documented but not mounted (or mounted behind a flag that is off) is visible
 * as an operation with no scope rather than silently given one.
 * @param document
 * @param router
 * @param basePath
 */
export function withRouteScopes<T extends OpenApiDocumentLike>(
  document: T,
  router: unknown,
  basePath = '/api/v1',
): T {
  const annotated = structuredClone(document);
  const paths = annotated.paths;
  if (!paths) {
    return annotated;
  }

  for (const declaration of collectRouteScopes(router, basePath)) {
    applyDeclaration(paths, declaration);
  }
  return annotated;
}

function applyDeclaration(
  paths: Record<string, PathItemObject>,
  declaration: RouteScopeDeclaration,
): void {
  if (declaration.scope === undefined) {
    return;
  }
  const pathItem = paths[toOpenApiPath(declaration.path)];
  if (!pathItem) {
    return;
  }
  const method = declaration.method.toLowerCase();
  if (!OPENAPI_METHODS.has(method)) {
    return;
  }
  const operation = pathItem[method];
  if (operation === undefined || operation === null || typeof operation !== 'object') {
    return;
  }
  annotateOperation(operation as OperationObject, declaration.scope);
}
