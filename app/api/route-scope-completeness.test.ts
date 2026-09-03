import express from 'express';
import {
  collectRouteScopes,
  DYNAMIC_SCOPE,
  findUndeclaredRoutes,
  formatRouteScope,
  type RouteScopeDeclaration,
  scoped,
  UNRECORDED_MOUNT,
} from './route-scopes.js';

/**
 * The scope map, asserted against the live Express router stack rather than a
 * hand-kept path table matched on `req.path` — that would duplicate the router
 * and drift. These three tests are a security control, not a lint. Everything
 * not declared is denied to API key authentication at any scope, so a route
 * that slips through undeclared would default to reachable-by-any-key the
 * moment enforcement lands. If one of them starts failing, the fix is a
 * `scoped()` declaration on the new route, never an exclusion here.
 *
 * The expected list is the phase spec's scope table
 * (`spec-11.1-api-keys.md`, "Scopes") resolved to concrete routes. Adding a
 * route means adding a line, deliberately: a reviewer sees the scope a new
 * endpoint is reachable at in the diff.
 *
 * HEAD is absent by design. Express resolves a HEAD with no explicit handler
 * through the route's GET handler, so a GET declaration covers both.
 */
const EXPECTED_ROUTE_SCOPES = [
  'DELETE /api/v1/api-keys/:keyId → api-keys:manage',
  'DELETE /api/v1/containers/:id → admin',
  'DELETE /api/v1/icons/cache → admin',
  'DELETE /api/v1/notifications/outbox/:id → triggers:test',
  'DELETE /api/v1/portwing/keys/:keyId → session-only',
  'GET /api/v1/agents → read',
  'GET /api/v1/agents/:name/log/entries → read',
  'GET /api/v1/api-keys → api-keys:manage',
  'GET /api/v1/app → read',
  'GET /api/v1/approvals → read',
  'GET /api/v1/approvals/:id → read',
  'GET /api/v1/approvals/summary → read',
  'GET /api/v1/audit → read',
  'GET /api/v1/authentications → read',
  'GET /api/v1/authentications/:type/:name → read',
  'GET /api/v1/authentications/:type/:name/:agent → read',
  'GET /api/v1/containers → read',
  'GET /api/v1/containers/:id → read',
  'GET /api/v1/containers/:id/backups → read',
  'GET /api/v1/containers/:id/intermediate-release-notes → read',
  'GET /api/v1/containers/:id/logs → read',
  'GET /api/v1/containers/:id/release-notes → read',
  'GET /api/v1/containers/:id/sbom → read',
  'GET /api/v1/containers/:id/stats → read',
  'GET /api/v1/containers/:id/stats/stream → read',
  'GET /api/v1/containers/:id/triggers → read',
  'GET /api/v1/containers/:id/update-operations → read',
  'GET /api/v1/containers/:id/vulnerabilities → read',
  'GET /api/v1/containers/backups → read',
  'GET /api/v1/containers/dependencies → read',
  'GET /api/v1/containers/groups → read',
  'GET /api/v1/containers/recent-status → read',
  'GET /api/v1/containers/security/vulnerabilities → read',
  'GET /api/v1/containers/stats → read',
  'GET /api/v1/containers/summary → read',
  'GET /api/v1/debug/dump → session-only',
  'GET /api/v1/events/ui → read',
  'GET /api/v1/icons/:provider/:slug → read',
  'GET /api/v1/log → read',
  'GET /api/v1/log/components → read',
  'GET /api/v1/log/entries → read',
  'GET /api/v1/notifications → read',
  'GET /api/v1/notifications/outbox → read',
  'GET /api/v1/openapi.json → read',
  'GET /api/v1/portwing/keys → session-only',
  'GET /api/v1/preferences → read',
  'GET /api/v1/registries → read',
  'GET /api/v1/registries/:type/:name → read',
  'GET /api/v1/registries/:type/:name/:agent → read',
  'GET /api/v1/self-update/:operationId/status → session-only',
  'GET /api/v1/server → read',
  'GET /api/v1/server/security/runtime → read',
  'GET /api/v1/settings → read',
  'GET /api/v1/stats/summary → read',
  'GET /api/v1/stats/summary/stream → read',
  'GET /api/v1/store → read',
  'GET /api/v1/triggers → read',
  'GET /api/v1/triggers/:type/:name → read',
  'GET /api/v1/triggers/:type/:name/:agent → read',
  'GET /api/v1/update-operations/:id → read',
  'GET /api/v1/watchers → read',
  'GET /api/v1/watchers/:type/:name → read',
  'GET /api/v1/watchers/:type/:name/:agent → read',
  'GET /api/v1/{*path} → read',
  'PATCH /api/v1/containers/:id/update-policy → containers:update',
  'PATCH /api/v1/notifications/:id → admin',
  'PATCH /api/v1/preferences → admin',
  'PATCH /api/v1/settings → admin',
  'POST /api/v1/api-keys → api-keys:manage',
  'POST /api/v1/approvals/:id/approve → containers:update',
  'POST /api/v1/approvals/:id/defer → containers:update',
  'POST /api/v1/approvals/:id/reject → containers:update',
  'POST /api/v1/containers/:id/env/reveal → session-only',
  'POST /api/v1/containers/:id/preview → containers:watch',
  'POST /api/v1/containers/:id/restart → admin',
  'POST /api/v1/containers/:id/rollback → containers:update',
  'POST /api/v1/containers/:id/scan → containers:watch',
  'POST /api/v1/containers/:id/start → admin',
  'POST /api/v1/containers/:id/stop → admin',
  'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName → dynamic',
  'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName/:triggerAgent → dynamic',
  'POST /api/v1/containers/:id/update → containers:update',
  'POST /api/v1/containers/:id/update-chain-preview → containers:watch',
  'POST /api/v1/containers/:id/watch → containers:watch',
  'POST /api/v1/containers/scan-all → containers:watch',
  'POST /api/v1/containers/update → containers:update',
  'POST /api/v1/containers/watch → containers:watch',
  'POST /api/v1/dependency-groups/:rootId/update → containers:update',
  'POST /api/v1/events/ui/self-update/:operationId/ack → admin',
  'POST /api/v1/internal/self-update/finalize → session-only',
  'POST /api/v1/notifications/:id/preview → triggers:test',
  'POST /api/v1/notifications/outbox/:id/retry → triggers:test',
  'POST /api/v1/operations/:id/cancel → containers:update',
  'POST /api/v1/portwing/keys → session-only',
  'POST /api/v1/server/security/assets/:provider/:operation → admin',
  'POST /api/v1/triggers/:type/:name → dynamic',
  'POST /api/v1/triggers/:type/:name/:agent → dynamic',
  'POST /api/v1/webhook/update/:containerName → session-only',
  'POST /api/v1/webhook/watch → session-only',
  'POST /api/v1/webhook/watch/:containerName → session-only',
  'POST /api/v1/webhooks/registry → session-only',
  'PUT /api/v1/settings → admin',
];

// The router is built exactly once: several sub-routers register their routes
// on a module-scope router inside init(), so a second call would double every
// layer they own.
const mockGetExperimentalPortwingEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('../configuration/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../configuration/index.js')>();
  return {
    ...actual,
    getExperimentalPortwingEnabled: mockGetExperimentalPortwingEnabled,
  };
});

describe('route scope completeness', () => {
  let declarations: RouteScopeDeclaration[];

  beforeAll(async () => {
    const api = await import('./api.js');
    declarations = collectRouteScopes(api.init(), '/api/v1');
  });

  test('every route under /api/v1 declares the scope that reaches it', () => {
    expect(findUndeclaredRoutes(declarations).map(formatRouteScope)).toStrictEqual([]);
  });

  test('every sub-router was mounted through mountRouter, so every path is real', () => {
    const unresolved = declarations
      .filter((declaration) => declaration.path.includes(UNRECORDED_MOUNT))
      .map(formatRouteScope);

    expect(unresolved).toStrictEqual([]);
  });

  test('the declared scopes match the phase spec table', () => {
    expect(declarations.map(formatRouteScope).sort()).toStrictEqual(EXPECTED_ROUTE_SCOPES);
  });

  test('only the routes that gate internally are declared dynamic', () => {
    // `dynamic` is the one declaration `enforceApiKeyScope` waves through as
    // route middleware, so each of these four is a hole unless its handler
    // calls the helper itself. Enumerated separately from the table above so
    // adding a fifth is a deliberate line in a diff rather than a scope
    // silently loosening to nothing.
    const dynamic = declarations
      .filter((declaration) => declaration.scope === DYNAMIC_SCOPE)
      .map(formatRouteScope)
      .sort();

    expect(dynamic).toStrictEqual([
      'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName → dynamic',
      'POST /api/v1/containers/:id/triggers/:triggerType/:triggerName/:triggerAgent → dynamic',
      'POST /api/v1/triggers/:type/:name → dynamic',
      'POST /api/v1/triggers/:type/:name/:agent → dynamic',
    ]);
  });

  test('a route registered without scoped() fails the completeness check', () => {
    const router = express.Router();
    router.get(
      '/declared',
      scoped('read', (_req, _res) => {}),
    );
    router.post('/added-without-a-scope', (_req, _res) => {});

    expect(
      findUndeclaredRoutes(collectRouteScopes(router, '/api/v1')).map(formatRouteScope),
    ).toStrictEqual(['POST /api/v1/added-without-a-scope → UNDECLARED']);
  });
});
